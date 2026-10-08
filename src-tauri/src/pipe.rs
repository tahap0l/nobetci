// The relay server for nobetci-hook.
//
// The transport is per OS — a named pipe on Windows (`pipe/named_pipe.rs`), a
// Unix socket on macOS (`pipe/unix_socket.rs`); everything below it is shared.
// One connection per hook event. Every hook event is forwarded to the island as
// a `hook` event. `PermissionRequest` is the only one
// that keeps its connection open: it goes through the rules (`rules::evaluate`),
// is answered on the spot when a rule, a trusted project or a session grant
// decides, and otherwise waits for a person on the island. Every outcome lands in
// the history (`audit`).
//
// Claude Code is never blocked by us. Three things guarantee it:
//   * nobetci-hook gives the connection 300 ms and exits cleanly if we are closed;
//   * we only wait for a person once the island has *confirmed* the card is on
//     screen (or queued), so a paused island or a webview that is not listening
//     costs a few hundred milliseconds, not two minutes;
//   * whatever happens we drop the connection after the decision timeout, and
//     the terminal takes over.
//
// What we write back is a small JSON line (`{"behavior":"deny","message":…}`).
// Turning that into the documented hookSpecificOutput is nobetci-hook's job, so
// the wire format Claude Code expects lives in exactly one place.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

use crate::audit::{self, Entry, Log};
use crate::i18n::pick;
use crate::inputguard;
use crate::island::WINDOW_LABEL;
use crate::log;
use crate::risk::Level;
use crate::rules::{self, Outcome, SessionGrants};
use crate::Shared;

/// Slightly under nobetci-hook's own 110 s wait, so we always answer first.
const DECISION_TIMEOUT: Duration = Duration::from_secs(108);
/// How long the island gets to say "the card is up" (or "it is queued").
const ACK_TIMEOUT: Duration = Duration::from_millis(800);
const MAX_PAYLOAD: usize = 1 << 20;
/// The event name the health check sends through the real relay.
pub const PING_EVENT: &str = "NobetciPing";

/// A decision on its way back to the relay.
pub struct Answer {
    /// The JSON line nobetci-hook turns into Claude Code's output.
    pub reply: String,
    pub decision: &'static str,
    pub by: &'static str,
    pub message: String,
}

/// What the island can say about a permission request.
pub enum Reply {
    /// The card is on screen or queued, and a person can act on it.
    Ack,
    Decision(Answer),
    /// Nobody will act on it here — the terminal takes it. Carries the reason.
    Decline(&'static str),
}

struct Waiting {
    tx: mpsc::Sender<Reply>,
    level: Level,
    session: String,
    tool: String,
    target: String,
}

/// Permission requests the island has been told about.
#[derive(Default)]
pub struct Pending(Mutex<HashMap<String, Waiting>>);

/// The last health-check ping that made it through the pipe: (nonce, when).
#[derive(Default)]
pub struct Health(pub Mutex<Option<(String, u64)>>);

static COUNTER: AtomicU64 = AtomicU64::new(1);

#[cfg(windows)]
mod named_pipe;
#[cfg(target_os = "macos")]
mod unix_socket;

#[cfg(windows)]
use named_pipe as transport;
#[cfg(target_os = "macos")]
use unix_socket as transport;

/// One connection from nobetci-hook, whatever carries it.
trait Conn: AsyncRead + AsyncWrite + Unpin + Send + 'static {
    /// Ends the conversation; the relay sees end-of-file.
    fn close(&mut self);
}

/// Starts listening for nobetci-hook.
pub fn start(app: AppHandle) {
    transport::start(app);
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn folder_name(cwd: &str) -> String {
    cwd.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or("").to_string()
}

/// What the island is told when a rule decided without it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutoDecision<'a> {
    session_id: &'a str,
    cwd: &'a str,
    tool: &'a str,
    target: &'a str,
    level: Level,
    outcome: Outcome,
    by: Option<&'static str>,
    rule: Option<&'a str>,
    note: Option<&'a str>,
}

async fn handle<C: Conn>(app: AppHandle, mut pipe: C) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match pipe.read(&mut chunk).await {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') || buf.len() > MAX_PAYLOAD {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    let line = match buf.iter().position(|b| *b == b'\n') {
        Some(i) => &buf[..i],
        None => &buf[..],
    };
    let Ok(mut payload) = serde_json::from_slice::<Value>(line) else { return };
    if !payload.is_object() {
        return;
    }

    let event = str_of(&payload, "hook_event_name").to_string();
    if event == PING_EVENT {
        let nonce = str_of(&payload, "nonce").to_string();
        *app.state::<Health>().0.lock().unwrap() = Some((nonce, audit::now_ms()));
        pipe.close();
        return;
    }

    let settings = app.state::<Shared>().settings.lock().unwrap().clone();
    payload["nobetci_quiet"] = json!(crate::quiet::reason(&settings));

    if event == "SessionEnd" {
        app.state::<SessionGrants>().forget_session(str_of(&payload, "session_id"));
    }
    if event != "PermissionRequest" {
        let _ = app.emit_to(WINDOW_LABEL, "hook", payload);
        pipe.close();
        return;
    }

    let tool = str_of(&payload, "tool_name").to_string();
    let cwd = str_of(&payload, "cwd").to_string();
    let session = str_of(&payload, "session_id").to_string();
    let input = payload.get("tool_input").cloned().unwrap_or(Value::Null);
    let truncated = payload.get("nobetci_truncated").and_then(Value::as_bool).unwrap_or(false);

    let eval = rules::evaluate(
        &rules::Request { tool: &tool, input: &input, cwd: &cwd, session: &session, truncated },
        &settings,
        &app.state::<SessionGrants>(),
    );
    let a = &eval.assessment;
    let id = format!("{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed));
    let started = audit::now_ms();
    let mut entry = Entry {
        ts: started,
        id: id.clone(),
        session: session.clone(),
        project: folder_name(&cwd),
        cwd: cwd.clone(),
        tool: tool.clone(),
        kind: serde_json::to_value(a.kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
        target: a.target.clone(),
        level: serde_json::to_value(a.level).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
        labels: a.findings.iter().map(|f| f.label.to_string()).collect(),
        rule: eval.rule.clone().unwrap_or_default(),
        ..Entry::default()
    };
    log::line(format!("PermissionRequest id={id} tool={tool} risk={:?} outcome={:?}", a.level, eval.outcome));

    // A rule, a trusted project or a session grant decided: answer now.
    if eval.outcome != Outcome::Ask {
        let (reply, decision) = if eval.outcome == Outcome::Allow {
            (json!({ "behavior": "allow" }), "allow")
        } else {
            let message = eval.message.clone().unwrap_or_default();
            (json!({ "behavior": "deny", "message": message, "interrupt": true }), "deny")
        };
        let _ = pipe.write_all(format!("{reply}\n").as_bytes()).await;
        let _ = pipe.flush().await;
        pipe.close();

        entry.decision = decision.into();
        entry.by = eval.by.unwrap_or("rule").into();
        entry.message = eval.message.clone().unwrap_or_default();
        record(&app, &settings, entry);
        let _ = app.emit_to(
            WINDOW_LABEL,
            "auto-decision",
            AutoDecision {
                session_id: &session,
                cwd: &cwd,
                tool: &tool,
                target: &a.target,
                level: a.level,
                outcome: eval.outcome,
                by: eval.by,
                rule: eval.rule.as_deref(),
                note: eval.note.as_deref(),
            },
        );
        return;
    }

    let (tx, mut rx) = mpsc::channel::<Reply>(4);
    app.state::<Pending>().0.lock().unwrap().insert(
        id.clone(),
        Waiting { tx, level: a.level, session: session.clone(), tool: tool.clone(), target: a.target.clone() },
    );
    inputguard::arm(true);
    payload["request_id"] = json!(id);
    payload["risk"] = serde_json::to_value(a).unwrap_or(Value::Null);
    payload["rule_note"] = json!(eval.note);
    payload["policy"] = json!(eval.policy);
    let _ = app.emit_to(WINDOW_LABEL, "hook", payload);

    let outcome = wait_for_decision(&id, &mut rx).await;
    forget(&app, &id);

    entry.ms = audit::now_ms().saturating_sub(started);
    match outcome {
        Ok(answer) => {
            // A reply here is the whole point; nobetci-hook turns it into output.
            let _ = pipe.write_all(format!("{}\n", answer.reply).as_bytes()).await;
            let _ = pipe.flush().await;
            entry.decision = answer.decision.into();
            entry.by = answer.by.into();
            entry.message = answer.message;
        }
        // No decision: say nothing at all. nobetci-hook then writes nothing to
        // stdout and Claude Code asks in the terminal, as if Nöbetçi were closed.
        Err(reason) => {
            entry.decision = "none".into();
            entry.by = reason.into();
        }
    }
    pipe.close();
    record(&app, &settings, entry);
}

fn record(app: &AppHandle, settings: &crate::settings::Settings, mut entry: Entry) {
    if !settings.audit_enabled {
        return;
    }
    // The card showed the request whole; what lingers on disk must not carry
    // live tokens.
    entry.target = crate::redact::redact(&entry.target);
    entry.message = crate::redact::redact(&entry.message);
    if let Err(err) = app.state::<Log>().append(entry, settings.audit_max_mb) {
        log::line(format!("history write failed: {err}"));
    }
    let _ = app.emit("history-changed", ());
}

/// Two waits: a short one for "the card is up", then the long one for a person.
async fn wait_for_decision(id: &str, rx: &mut mpsc::Receiver<Reply>) -> Result<Answer, &'static str> {
    match tokio::time::timeout(ACK_TIMEOUT, rx.recv()).await {
        Ok(Some(Reply::Ack)) => {}
        // A click that beats the ack is still a click.
        Ok(Some(Reply::Decision(a))) => {
            log::line(format!("id={id} answered {} by {}", a.decision, a.by));
            return Ok(a);
        }
        Ok(Some(Reply::Decline(reason))) => {
            log::line(format!("id={id} not shown ({reason}) — terminal takes over"));
            return Err(reason);
        }
        Ok(None) => return Err("unseen"),
        Err(_) => {
            log::line(format!("id={id} island never acknowledged — terminal takes over"));
            return Err("unseen");
        }
    }

    match tokio::time::timeout(DECISION_TIMEOUT, rx.recv()).await {
        Ok(Some(Reply::Decision(a))) => {
            log::line(format!("id={id} answered {} by {}", a.decision, a.by));
            Ok(a)
        }
        Ok(Some(Reply::Decline(reason))) => {
            log::line(format!("id={id} released ({reason})"));
            Err(reason)
        }
        _ => {
            log::line(format!("id={id} timed out — terminal takes over"));
            Err("timeout")
        }
    }
}

/// Drops a request from the waiting list; the click guard stops listening once
/// nothing waits.
fn forget(app: &AppHandle, request_id: &str) {
    let pending = app.state::<Pending>();
    let mut map = pending.0.lock().unwrap();
    map.remove(request_id);
    if map.is_empty() {
        inputguard::arm(false);
    }
}

fn send(app: &AppHandle, request_id: &str, reply: Reply, keep: bool) {
    let sender = {
        let pending = app.state::<Pending>();
        let mut map = pending.0.lock().unwrap();
        let tx = if keep { map.get(request_id).map(|w| w.tx.clone()) } else { map.remove(request_id).map(|w| w.tx) };
        if map.is_empty() {
            inputguard::arm(false);
        }
        tx
    };
    match sender {
        Some(tx) => {
            let _ = tx.try_send(reply);
        }
        None => log::line(format!("reply for id={request_id} — no pending request")),
    }
}

/// The island has the card on screen or queued; the long wait may begin.
pub fn acknowledge(app: &AppHandle, request_id: &str) {
    send(app, request_id, Reply::Ack, true);
}

/// Nobody will act on this one here — the terminal takes it right away.
pub fn decline(app: &AppHandle, request_id: &str, reason: &str) {
    let reason: &'static str = match reason {
        "paused" => "paused",
        "busy" => "busy",
        "resolved" => "resolved",
        _ => "terminal",
    };
    send(app, request_id, Reply::Decline(reason), false);
}

/// Where the press has to have landed: the Allow button (plus a few pixels of
/// slack). Without an anchor, the visible island. Never the whole transparent
/// panel — other windows show through it, and a real click on one of them must
/// not vouch for an invoke on our button.
fn anchor_rect(app: &AppHandle, anchor: Option<Anchor>) -> Option<inputguard::Rect> {
    let win = app.get_webview_window(WINDOW_LABEL)?;
    let (x, y, w, h, slack) = match anchor {
        Some(a) if a.w > 0.0 && a.h > 0.0 => (a.x, a.y, a.w, a.h, 4.0),
        _ => {
            let r = *app.state::<crate::Shared>().gate.rect.lock().unwrap();
            (r.x, r.y, r.w, r.h, 0.0)
        }
    };
    inputguard::island_rect(&win, x - slack, y - slack, w + 2.0 * slack, h + 2.0 * slack)
}

/// What a decision is allowed to mean for a request at this level. Errors are
/// codes the island turns into words.
fn resolve(decision: &str, level: Level, via: &str) -> Result<&'static str, &'static str> {
    match (decision, via) {
        ("deny", _) => Ok("deny"),
        // Keystrokes can be synthesised by any program and cannot be told apart
        // from real ones, so the allow hotkey only ever covers low risk.
        ("allow", "hotkey") if level == Level::Low => Ok("allow"),
        ("allow" | "allow_confirmed", "hotkey") => Err("hotkey_low_only"),
        ("allow_confirmed", _) => Ok("allow"),
        // A plain click is not enough for high or critical risk: the island has
        // to prove the user held the button. Refusing here keeps that rule true
        // even if the front end has a bug.
        ("allow", _) if level < Level::High => Ok("allow"),
        ("allow", _) => Err("hold_required"),
        _ => Err("unknown_decision"),
    }
}

/// The Allow button's rectangle in the island window, logical pixels.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct Anchor {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct Choice<'a> {
    pub decision: &'a str,
    /// Where the Allow button was when it was pressed.
    pub anchor: Option<Anchor>,
    /// Told to Claude on a denial.
    pub message: Option<&'a str>,
    /// Deny and end the turn.
    pub stop: bool,
    /// Allow this exact request again for the rest of the session.
    pub remember: bool,
    /// "hotkey" when it came from a global shortcut.
    pub via: &'a str,
}

/// Called by the island's Allow / Deny controls and the global shortcuts.
pub fn answer(app: &AppHandle, request_id: &str, c: Choice) -> Result<(), String> {
    let (level, session, tool, target) = {
        let pending = app.state::<Pending>();
        let map = pending.0.lock().unwrap();
        match map.get(request_id) {
            Some(w) => (w.level, w.session.clone(), w.tool.clone(), w.target.clone()),
            None => return Err("not_pending".into()),
        }
    };
    let word = resolve(c.decision, level, c.via).map_err(|why| {
        log::line(format!("decision id={request_id} rejected: {why}"));
        why.to_string()
    })?;
    let by: &'static str = if c.via == "hotkey" { "hotkey" } else { "user" };

    // An approval from the island must be backed by a real mouse press on the
    // island: not SendInput, not a UI Automation invoke, not a click elsewhere a
    // moment ago. A click is fresh within seconds; a hold takes its own time.
    if word == "allow" && by == "user" {
        let settings = app.state::<crate::Shared>().settings.lock().unwrap().clone();
        if settings.input_guard {
            let held = c.decision == "allow_confirmed";
            let hold_ms = if level == Level::Critical { settings.hold_critical_ms } else { settings.hold_ms };
            let window = Duration::from_millis(if held { u64::from(hold_ms) + 3_000 } else { 3_000 });
            if let Err(why) = inputguard::check(window, anchor_rect(app, c.anchor)) {
                log::line(format!("SUSPICIOUS: approval id={request_id} without a physical click ({why}) — refused"));
                return Err("input_not_physical".into());
            }
            inputguard::consume();
        }
    }

    let (reply, message) = if word == "allow" {
        if c.remember && level <= Level::Medium {
            app.state::<SessionGrants>().grant(&session, &tool, &target);
        }
        (json!({ "behavior": "allow" }), String::new())
    } else {
        let message = c
            .message
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or(pick("The user denied this through Nöbetçi.", "Kullanıcı Nöbetçi üzerinden reddetti."))
            .chars()
            .take(500)
            .collect::<String>();
        (json!({ "behavior": "deny", "message": message, "interrupt": true, "stop": c.stop }), message)
    };
    send(app, request_id, Reply::Decision(Answer { reply: reply.to_string(), decision: word, by, message }), false);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn high_risk_needs_a_confirmed_allow() {
        assert_eq!(resolve("allow", Level::Low, "user"), Ok("allow"));
        assert_eq!(resolve("allow", Level::Medium, "user"), Ok("allow"));
        assert_eq!(resolve("allow", Level::High, "user"), Err("hold_required"));
        assert_eq!(resolve("allow", Level::Critical, "user"), Err("hold_required"));
        assert_eq!(resolve("allow_confirmed", Level::Critical, "user"), Ok("allow"));
        assert_eq!(resolve("deny", Level::Critical, "user"), Ok("deny"));
        assert_eq!(resolve("always", Level::Low, "user"), Err("unknown_decision"));
    }

    #[test]
    fn the_allow_hotkey_covers_low_risk_only() {
        assert_eq!(resolve("allow", Level::Low, "hotkey"), Ok("allow"));
        assert_eq!(resolve("allow", Level::Medium, "hotkey"), Err("hotkey_low_only"));
        assert_eq!(resolve("allow_confirmed", Level::Critical, "hotkey"), Err("hotkey_low_only"));
        assert_eq!(resolve("deny", Level::Critical, "hotkey"), Ok("deny"));
    }

    #[test]
    fn folder_names() {
        assert_eq!(folder_name(r"C:\Users\dev\project\"), "project");
        assert_eq!(folder_name("/c/Users/dev/web"), "web");
        assert_eq!(folder_name(""), "");
    }
}
