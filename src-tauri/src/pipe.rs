// The relay server for nobi-hook.
//
// The transport is per OS — a named pipe on Windows (`pipe/named_pipe.rs`), a
// Unix socket on macOS and Linux (`pipe/unix_socket.rs`); everything below it is
// shared. One connection per hook event. Every hook event is forwarded to the
// island as a `hook` event. `PermissionRequest` is the only one
// that keeps its connection open: it goes through the rules (`rules::evaluate`),
// is answered on the spot when a rule, a trusted project or a session grant
// decides, and otherwise waits for a person on the island. Every outcome lands in
// the history (`audit`) — including the requests nobody here could answer: one
// too large to read, a question or plan handed straight back, and an answer the
// relay was no longer there to receive.
//
// Claude Code is never blocked by us. Three things guarantee it:
//   * nobi-hook gives up on connecting within 300 ms (2 s for the whole
//     event) and exits cleanly if we are closed;
//   * we only wait for a person once the island has *confirmed* the card is on
//     screen (or queued), so a paused island or a webview that is not listening
//     costs a few hundred milliseconds, not two minutes;
//   * whatever happens we drop the connection after the decision timeout, and
//     the terminal takes over.
//
// What we write back is a small JSON line (`{"behavior":"deny","message":…,
// "interrupt":…,"stop":…}`). Turning that into the documented hookSpecificOutput
// is nobi-hook's job, so the wire format Claude Code expects lives in exactly
// one place.

use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, Semaphore};

use crate::audit::{self, Entry, Log};
use crate::i18n::{is_tr, pick};
use crate::inputguard;
use crate::island::WINDOW_LABEL;
use crate::log;
use crate::risk::Level;
use crate::rules::{self, Outcome, SessionGrants};
use crate::Shared;

/// Slightly under nobi-hook's own 110 s wait, so we always answer first.
const DECISION_TIMEOUT: Duration = Duration::from_secs(108);
/// How long the island gets to say "the card is up" (or "it is queued").
const ACK_TIMEOUT: Duration = Duration::from_millis(800);
const MAX_PAYLOAD: usize = 1 << 20;
const FRAME_TIMEOUT: Duration = Duration::from_secs(2);
/// How long writing an answer may take. The relay is already reading by then;
/// one that is gone fails the write at once.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a card has to have been in front before it can be approved. The
/// second half of a double click, or the release that ends a hold, otherwise
/// lands on whatever card came up next — unread.
const MIN_VIEW: Duration = Duration::from_millis(350);
/// How soon after a real press of the allow shortcut its approval must arrive.
const HOTKEY_WINDOW: Duration = Duration::from_millis(1500);
static CONNECTIONS: Semaphore = Semaphore::const_new(64);
/// The event name the health check sends through the real relay.
pub const PING_EVENT: &str = "NobiPing";

/// A decision on its way back to the relay.
pub struct Answer {
    /// The JSON line nobi-hook turns into Claude Code's output.
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
    /// The level before any user rule re-scored it (see `rules::Evaluation`).
    engine_level: Level,
    /// The rules would honour a session grant for this request.
    grantable: bool,
    queued_at: Instant,
    /// When the island said the card is on screen or queued.
    acked_at: Option<Instant>,
    /// When the card last became the island's front, interactive card.
    shown_at: Option<Instant>,
    session: String,
    tool: String,
    target: String,
    /// The path the target resolves to, "" when it is not a path: a session
    /// grant covers that file only (`rules::SessionGrants`).
    resolved: String,
    /// "permission", or "question" / "plan" for Claude's own interactive tools.
    kind: &'static str,
    /// What the island was sent, for an island that reloads while it waits. Its
    /// `tool_input` is echoed back with the answer to a question or a plan.
    payload: Value,
}

impl Waiting {
    /// Since when a person can have been looking at this card.
    fn on_screen_since(&self) -> Instant {
        self.shown_at.or(self.acked_at).unwrap_or(self.queued_at)
    }

    /// Batch approval material: a permission request that is low as scored now
    /// and was low before any rule calmed it down.
    fn batchable(&self) -> bool {
        self.kind == "permission" && self.level == Level::Low && self.engine_level == Level::Low
    }
}

/// Claude's tools that wait for the user rather than for permission. They are
/// answered with the input sent back (plus the answers), never by a rule.
fn interactive_kind(tool: &str) -> Option<&'static str> {
    match tool {
        "AskUserQuestion" => Some("question"),
        "ExitPlanMode" => Some("plan"),
        _ => None,
    }
}

/// Permission requests the island has been told about.
#[derive(Default)]
pub struct Pending(Mutex<HashMap<String, Waiting>>);

#[derive(Default)]
pub struct Health {
    pub ping: Mutex<Option<String>>,
    pub codex_activity: Mutex<Option<AgentActivity>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivity {
    pub event: String,
    pub at: u64,
}

static COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_id() -> String {
    format!("{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[cfg(windows)]
mod named_pipe;
#[cfg(unix)]
mod unix_socket;

#[cfg(windows)]
use named_pipe as transport;
#[cfg(unix)]
use unix_socket as transport;

/// One connection from nobi-hook, whatever carries it.
trait Conn: AsyncRead + AsyncWrite + Unpin + Send + 'static {
    /// Ends the conversation once the relay has had whatever we wrote; it then
    /// sees end-of-file.
    fn close(&mut self) -> impl Future<Output = ()> + Send;
}

/// Starts listening for nobi-hook.
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

/// One line from the relay.
#[derive(Debug, PartialEq)]
enum Frame {
    Line(Vec<u8>),
    /// Longer than MAX_PAYLOAD: refused, with as much of it as had arrived.
    TooLong(Vec<u8>),
}

/// The next line, or None when the relay hung up (or failed) before ending one.
async fn read_frame(pipe: &mut (impl AsyncRead + Unpin)) -> Option<Frame> {
    let mut frame = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = pipe.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        let newline = chunk[..n].iter().position(|&b| b == b'\n');
        let end = newline.unwrap_or(n);
        if frame.len() + end > MAX_PAYLOAD {
            return Some(Frame::TooLong(frame));
        }
        frame.extend_from_slice(&chunk[..end]);
        if newline.is_some() {
            return Some(Frame::Line(frame));
        }
    }
}

/// The top-level string fields of a JSON object that may be cut off anywhere:
/// enough to say what an oversized request was. Nested objects and arrays are
/// skipped, so a `tool_name` inside the tool's own input cannot pose as the
/// request's.
fn top_level_strings(data: &[u8], wanted: &[&str]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    let (mut depth, mut i) = (0usize, 0usize);
    let mut key: Option<String> = None;
    let mut value_next = false;
    while i < data.len() {
        match data[i] {
            b'"' => {
                let start = i;
                i += 1;
                while i < data.len() && data[i] != b'"' {
                    i += if data[i] == b'\\' { 2 } else { 1 };
                }
                // Cut inside a string: nothing more to read.
                let Some(token) = data.get(start..=i) else { break };
                if depth == 1 {
                    let text = serde_json::from_slice::<String>(token).ok();
                    if value_next {
                        if let (Some(k), Some(v)) = (key.take(), text) {
                            if wanted.contains(&k.as_str()) {
                                found.insert(k, v);
                            }
                        }
                        value_next = false;
                    } else {
                        key = text;
                    }
                }
            }
            b':' if depth == 1 => value_next = true,
            b',' if depth == 1 => {
                key = None;
                value_next = false;
            }
            b'{' | b'[' => {
                depth += 1;
                if depth > 1 {
                    value_next = false;
                }
            }
            b'}' | b']' => depth = depth.saturating_sub(1),
            _ => {}
        }
        i += 1;
    }
    found
}

fn accept<C: Conn>(app: AppHandle, pipe: C) {
    let Ok(permit) = CONNECTIONS.try_acquire() else { return };
    tauri::async_runtime::spawn(async move {
        let _permit = permit;
        handle(app, pipe).await;
    });
}

async fn handle<C: Conn>(app: AppHandle, mut pipe: C) {
    let line = match tokio::time::timeout(FRAME_TIMEOUT, read_frame(&mut pipe)).await {
        Ok(Some(Frame::Line(line))) => line,
        Ok(Some(Frame::TooLong(start))) => {
            pipe.close().await;
            too_long(&app, &start);
            return;
        }
        _ => return,
    };
    let Ok(mut payload) = serde_json::from_slice::<Value>(&line) else { return };
    if !payload.is_object() {
        return;
    }

    let event = str_of(&payload, "hook_event_name").to_string();
    if event == PING_EVENT {
        let nonce = str_of(&payload, "nonce").to_string();
        *app.state::<Health>().ping.lock().unwrap() = Some(nonce);
        pipe.close().await;
        return;
    }
    if !event.is_empty() && str_of(&payload, "agent_name") == "Codex" {
        *app.state::<Health>().codex_activity.lock().unwrap() =
            Some(AgentActivity { event: event.clone(), at: audit::now_ms() });
    }

    let settings = app.state::<Shared>().settings.lock().unwrap().clone();
    payload["nobi_quiet"] = json!(crate::quiet::reason(&settings));

    if event == "SessionEnd" {
        app.state::<SessionGrants>().forget_session(str_of(&payload, "session_id"));
    }
    if event != "PermissionRequest" {
        let _ = app.emit_to(WINDOW_LABEL, "hook", payload);
        pipe.close().await;
        return;
    }

    let tool = str_of(&payload, "tool_name").to_string();
    let cwd = str_of(&payload, "cwd").to_string();
    let session = str_of(&payload, "session_id").to_string();
    let input = payload.get("tool_input").cloned().unwrap_or(Value::Null);
    let truncated = payload.get("nobi_truncated").and_then(Value::as_bool).unwrap_or(false);

    let interactive = interactive_kind(&tool);
    let mut eval = rules::evaluate(
        &rules::Request { tool: &tool, input: &input, cwd: &cwd, session: &session, truncated },
        &settings,
        &app.state::<SessionGrants>(),
    );
    if interactive.is_some() {
        // Nothing to score and nothing a rule may answer: only the user can.
        eval.outcome = Outcome::Ask;
        eval.assessment.level = Level::Low;
        eval.engine_level = Level::Low;
        eval.assessment.findings.clear();
        eval.grantable = false;
        eval.note = None;
    }
    let kind = interactive.unwrap_or("permission");
    let a = &eval.assessment;
    let id = next_id();
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
        engine_level: audit::engine_level(eval.engine_level, a.level),
        labels: a.findings.iter().map(|f| f.label.to_string()).collect(),
        categories: a.findings.iter().map(|f| f.category.to_string()).collect(),
        rule: eval.rule.clone().unwrap_or_default(),
        ..Entry::default()
    };
    log::line(format!("PermissionRequest id={id} tool={tool} risk={:?} outcome={:?}", a.level, eval.outcome));

    // Where the request goes when nobody here decides it: the terminal, or the
    // host's own prompt — Cursor's, the Claude app's.
    let (agent, entrypoint) = (str_of(&payload, "agent_name").to_string(), str_of(&payload, "entrypoint").to_string());
    let host = host_of(&agent, &entrypoint);

    // A question or a plan the island cannot answer whole goes straight back:
    // turned off in Settings, or cut by the relay (the answer echoes the input,
    // and a cut plan must never be handed back as if it were the real one).
    if interactive.is_some() && (!settings.island_questions || truncated) {
        pipe.close().await;
        entry.decision = "none".into();
        entry.by = host.into();
        let (who_en, who_tr) = who_asks(&agent, host);
        entry.message = if truncated {
            if is_tr() {
                format!("Aktarıcı kesti: kesilmiş soru ya da plan burada cevaplanmaz, {who_tr}.")
            } else {
                format!("Cut by the relay: a cut question or plan is never answered here, so {who_en}.")
            }
        } else if is_tr() {
            format!("Adada soru ve plan kapalı, {who_tr}.")
        } else {
            format!("Questions and plans on the island are off, so {who_en}.")
        };
        record(&app, &settings, entry);
        return;
    }

    // A rule, a trusted project or a session grant decided: answer now.
    if eval.outcome != Outcome::Ask {
        let (reply, decision) = if eval.outcome == Outcome::Allow {
            (json!({ "behavior": "allow" }), "allow")
        } else {
            // Like a person's plain Deny: Claude reads why and carries on.
            let message = eval.message.clone().unwrap_or_default();
            (deny_reply(&message, false), "deny")
        };
        let delivered = deliver(&mut pipe, &reply).await;
        pipe.close().await;

        entry.message = eval.message.clone().unwrap_or_default();
        if !delivered {
            log::line(format!("id={id} {decision} by rule could not be delivered: the relay was gone"));
            undelivered(&mut entry, decision);
            record(&app, &settings, entry);
            return;
        }
        entry.decision = decision.into();
        entry.by = eval.by.unwrap_or("rule").into();
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

    payload["request_id"] = json!(id);
    payload["nobi_kind"] = json!(kind);
    let mut risk = serde_json::to_value(a).unwrap_or(Value::Null);
    if let Some(risk) = risk.as_object_mut() {
        risk.insert("engineLevel".into(), json!(eval.engine_level));
    }
    payload["risk"] = risk;
    payload["rule_note"] = json!(eval.note);
    payload["policy"] = json!(eval.policy);
    payload["grantable"] = json!(eval.grantable);

    let (tx, mut rx) = mpsc::channel::<Reply>(4);
    {
        let pending = app.state::<Pending>();
        let mut map = pending.0.lock().unwrap();
        if map.is_empty() {
            inputguard::arm(true);
        }
        map.insert(
            id.clone(),
            Waiting {
                tx,
                level: a.level,
                engine_level: eval.engine_level,
                grantable: eval.grantable,
                queued_at: Instant::now(),
                acked_at: None,
                shown_at: None,
                session: session.clone(),
                tool: tool.clone(),
                target: a.target.clone(),
                resolved: a.resolved_path().to_string(),
                kind,
                payload: payload.clone(),
            },
        );
    }
    let _ = app.emit_to(WINDOW_LABEL, "hook", payload);

    let outcome = wait_for_decision(&id, &mut rx).await;
    forget(&app, &id);

    entry.ms = audit::now_ms().saturating_sub(started);
    match outcome {
        // A reply here is the whole point; nobi-hook turns it into output.
        Ok(answer) => {
            let delivered = deliver(&mut pipe, &answer.reply).await;
            entry.message = answer.message;
            if delivered {
                entry.decision = answer.decision.into();
                entry.by = answer.by.into();
            } else {
                log::line(format!("id={id} {} could not be delivered: the relay was gone", answer.decision));
                undelivered(&mut entry, answer.decision);
                // The island already wrote the decision on its timeline (C-21).
                let _ = app.emit_to(WINDOW_LABEL, UNDELIVERED_EVENT, undelivered_notice(&id));
            }
        }
        // No decision: say nothing at all. nobi-hook then writes nothing to
        // stdout and Claude Code asks in the terminal, as if Nobi were closed
        // (Cursor is told to ask itself; the Claude app shows its own dialog).
        Err(reason) => {
            entry.decision = "none".into();
            entry.by = taken_by(reason, host).into();
        }
    }
    pipe.close().await;
    record(&app, &settings, entry);
}

/// What the island is told when an answer it sent never reached the relay.
const UNDELIVERED_EVENT: &str = "approval-undelivered";

fn undelivered_notice(request_id: &str) -> Value {
    json!({ "requestId": request_id })
}

/// What takes over a request nobody here decides, for the history: Cursor's
/// own prompt, the Claude desktop app's own dialog, or the terminal (Claude
/// Code's, Codex's).
fn host_of(agent: &str, entrypoint: &str) -> &'static str {
    if agent == "Cursor" {
        "cursor"
    } else if entrypoint == "claude-desktop" {
        "app"
    } else {
        "terminal"
    }
}

/// The history's `by` for a request that went without a decision: the reason
/// — paused, busy, timed out, not seen, answered elsewhere — or, when it was
/// handed back, what took it over (`host_of`).
fn taken_by(reason: &'static str, host: &'static str) -> &'static str {
    if reason == "terminal" {
        host
    } else {
        reason
    }
}

/// Who asked instead of Nobi, for a history message: English, Turkish.
fn who_asks(agent: &str, host: &str) -> (&'static str, &'static str) {
    match (agent, host) {
        ("Cursor", _) => ("Cursor asked the user itself", "Cursor kullanıcıya kendisi sordu"),
        (_, "app") => ("the Claude app asked", "Claude uygulaması sordu"),
        ("Codex", _) => ("Codex asked in the terminal", "Codex terminalde sordu"),
        _ => ("Claude Code asked in the terminal", "Claude Code terminalde sordu"),
    }
}

/// Writes the answer line. False when it never got to the relay: the relay was
/// gone (the request was answered in the terminal, or Claude Code stopped
/// waiting), so the write failed.
async fn deliver<C: Conn>(pipe: &mut C, reply: &impl std::fmt::Display) -> bool {
    let line = format!("{reply}\n");
    let write = async { pipe.write_all(line.as_bytes()).await.is_ok() && pipe.flush().await.is_ok() };
    tokio::time::timeout(WRITE_TIMEOUT, write).await.unwrap_or(false)
}

/// The history says what happened — an answer nobody received — rather than
/// claiming a decision Claude Code never got.
fn undelivered(entry: &mut Entry, decision: &str) {
    let what = if decision == "allow" {
        pick(
            "Allowed through Nobi, but the request had already ended: Claude Code never got the answer.",
            "Nobi üzerinden izin verildi, ama istek çoktan bitmişti: cevap Claude Code'a ulaşmadı.",
        )
    } else {
        pick(
            "Denied through Nobi, but the request had already ended: Claude Code never got the answer.",
            "Nobi üzerinden reddedildi, ama istek çoktan bitmişti: cevap Claude Code'a ulaşmadı.",
        )
    };
    // A reason the user gave is kept; the stock one says nothing new.
    let stock = [DEFAULT_DENY.0, DEFAULT_DENY.1];
    entry.message = if entry.message.is_empty() || stock.contains(&entry.message.as_str()) {
        what.to_string()
    } else {
        format!("{what} ({})", entry.message)
    };
    entry.decision = "none".into();
    entry.by = "undelivered".into();
}

/// What Claude is told when the user denies without a reason: English, Turkish.
const DEFAULT_DENY: (&str, &str) = ("The user denied this through Nobi.", "Kullanıcı Nobi üzerinden reddetti.");

/// A frame over MAX_PAYLOAD is refused unread, and Claude Code asks in the
/// terminal (Cursor asks itself, the Claude app shows its dialog). It is still
/// logged and, if it was a permission request, written to the history — with
/// whatever its first megabyte says about it.
fn too_long(app: &AppHandle, start: &[u8]) {
    let fields =
        top_level_strings(start, &["hook_event_name", "session_id", "cwd", "tool_name", "agent_name", "entrypoint"]);
    let field = |key: &str| fields.get(key).cloned().unwrap_or_default();
    let (event, tool) = (field("hook_event_name"), field("tool_name"));
    log::line(format!(
        "relay frame over {MAX_PAYLOAD} bytes refused (event {}, tool {})",
        if event.is_empty() { "?" } else { &event },
        if tool.is_empty() { "?" } else { &tool },
    ));
    if event != "PermissionRequest" {
        return;
    }
    let settings = app.state::<Shared>().settings.lock().unwrap().clone();
    let cwd = field("cwd");
    let agent = field("agent_name");
    let host = host_of(&agent, &field("entrypoint"));
    let (who_en, who_tr) = who_asks(&agent, host);
    let entry = Entry {
        ts: audit::now_ms(),
        id: next_id(),
        session: field("session_id"),
        project: folder_name(&cwd),
        cwd,
        tool,
        // Never scored, and it could not be shown whole: what a cut request gets.
        level: "high".into(),
        decision: "none".into(),
        by: host.into(),
        message: if is_tr() {
            format!("1 MiB'tan büyük: Nobi tamamını gösteremeyeceği için {who_tr}.")
        } else {
            format!("Over 1 MiB: too large for Nobi to show whole, so {who_en}.")
        },
        ..Entry::default()
    };
    record(app, &settings, entry);
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

    let deadline = tokio::time::Instant::now() + DECISION_TIMEOUT;
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            // Acknowledged again — an island that reloaded and put its cards
            // back: nothing changes, the wait goes on.
            Ok(Some(Reply::Ack)) => continue,
            Ok(Some(Reply::Decision(a))) => {
                log::line(format!("id={id} answered {} by {}", a.decision, a.by));
                return Ok(a);
            }
            Ok(Some(Reply::Decline(reason))) => {
                log::line(format!("id={id} released ({reason})"));
                return Err(reason);
            }
            _ => {
                log::line(format!("id={id} timed out — terminal takes over"));
                return Err("timeout");
            }
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

/// Hands `reply` to the request's wait; false when nothing waits for it any more.
fn send(app: &AppHandle, request_id: &str, reply: Reply, keep: bool) -> bool {
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
            true
        }
        None => false,
    }
}

/// `send`, with a line in the log when nothing waited for the reply.
fn send_or_note(app: &AppHandle, request_id: &str, reply: Reply, keep: bool) {
    if !send(app, request_id, reply, keep) {
        log::line(format!("reply for id={request_id} — no pending request"));
    }
}

/// The island has the card on screen or queued; the long wait may begin.
pub fn acknowledge(app: &AppHandle, request_id: &str) {
    if let Some(w) = app.state::<Pending>().0.lock().unwrap().get_mut(request_id) {
        w.acked_at.get_or_insert_with(Instant::now);
    }
    send_or_note(app, request_id, Reply::Ack, true);
}

/// The card became the island's front, interactive card. It can be approved
/// once a person has had a moment to look at it (`MIN_VIEW`), and only with a
/// press that started after this.
pub fn shown(app: &AppHandle, request_id: &str) {
    if let Some(w) = app.state::<Pending>().0.lock().unwrap().get_mut(request_id) {
        w.shown_at = Some(Instant::now());
    }
}

/// Every request still waiting, oldest first, as the island was sent it in the
/// `hook` event — for an island that reloaded and lost its cards. Each also says
/// how long it has waited (`nobi_waited_ms`), so a card put back counts down
/// to the moment this side gives up, not from the start again.
pub fn pending(app: &AppHandle) -> Vec<Value> {
    payloads(&app.state::<Pending>().0.lock().unwrap(), Instant::now())
}

fn payloads(map: &HashMap<String, Waiting>, now: Instant) -> Vec<Value> {
    let mut waiting: Vec<&Waiting> = map.values().collect();
    waiting.sort_by_key(|w| w.queued_at);
    waiting
        .into_iter()
        .map(|w| {
            // The long wait (DECISION_TIMEOUT) starts at the ack.
            let waited = now.saturating_duration_since(w.acked_at.unwrap_or(w.queued_at));
            let mut payload = w.payload.clone();
            payload["nobi_waited_ms"] = json!(u64::try_from(waited.as_millis()).unwrap_or(u64::MAX));
            payload
        })
        .collect()
}

/// Nobody will act on this one here — the terminal takes it right away.
pub fn decline(app: &AppHandle, request_id: &str, reason: &str) {
    let gone = !send(app, request_id, Reply::Decline(decline_reason(reason)), false);
    if gone && worth_noting_gone(reason) {
        log::line(format!("reply for id={request_id} — no pending request"));
    }
}

/// Whether a decline for a request that no longer waits is worth a line in the
/// log. The island's countdown ending (`expired`) a moment after ours did is
/// the normal course of things, not news.
fn worth_noting_gone(reason: &str) -> bool {
    reason != "expired"
}

/// How the history names why the island let a request go.
fn decline_reason(reason: &str) -> &'static str {
    match reason {
        "paused" => "paused",
        "busy" => "busy",
        "resolved" => "resolved",
        // The island's countdown ran out (its clock may have jumped, or the
        // machine slept): recorded like our own timeout.
        "expired" => "timeout",
        _ => "terminal",
    }
}

/// Where the press has to have landed: the Allow button (plus a few pixels of
/// slack). Without an anchor, the visible island. Never the whole transparent
/// panel — other windows show through it, and a real click on one of them must
/// not vouch for an invoke on our button.
///
/// Both come from the page, so neither is taken on trust: whatever it says is
/// cut to the island's own window, an anchor bigger than any button the island
/// draws (`MAX_ANCHOR`) is no anchor at all — the press then counts as made
/// elsewhere — and the button counts only as far as it lies inside the visible
/// island, the part of the window that takes clicks (`island::Gate`). A page
/// that lies can no longer make every real press on the screen, a long one
/// anywhere, or a click on another window behind the transparent panel count
/// as one on Allow.
fn anchor_rect(app: &AppHandle, anchor: Option<Anchor>) -> Option<inputguard::Rect> {
    let win = app.get_webview_window(WINDOW_LABEL)?;
    let scale = win.scale_factor().ok().filter(|s| *s > 0.0)?;
    let size = win.inner_size().ok()?;
    let window = (f64::from(size.width) / scale, f64::from(size.height) / scale);
    let r = *app.state::<crate::Shared>().gate.rect.lock().unwrap();
    let area = button_area(anchor, Area { x: r.x, y: r.y, w: r.w, h: r.h }, window);
    let Some(Area { x, y, w, h }) = area else {
        log::line(
            "click guard: the place the island gave for the button is not inside the island — counted as elsewhere",
        );
        return None;
    };
    inputguard::island_rect(&win, x, y, w, h)
}

/// A rectangle in the island window, logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// The largest button the island draws, with room to spare (its widest Allow
/// button is under 200 px): a bigger "button" is no button.
const MAX_ANCHOR: (f64, f64) = (480.0, 120.0);
/// Slack around the button, for a press on its very edge.
const ANCHOR_SLACK: f64 = 4.0;

/// Where a press backs the approval: the button the page named (`anchor`),
/// cut to the visible island, or without one the visible island itself — all
/// of it cut to the window (`width`, `height`). None when no part of it is left.
fn button_area(anchor: Option<Anchor>, visible: Area, window: (f64, f64)) -> Option<Area> {
    let visible = within(visible, Area { x: 0.0, y: 0.0, w: window.0, h: window.1 })?;
    match anchor {
        None => Some(visible),
        Some(a) => within(anchor_area(a)?, visible),
    }
}

/// The Allow button's area with its slack, if the page's anchor can be a button
/// of the island at all.
fn anchor_area(a: Anchor) -> Option<Area> {
    if !(a.w > 0.0 && a.h > 0.0 && a.w <= MAX_ANCHOR.0 && a.h <= MAX_ANCHOR.1) {
        return None;
    }
    let s = ANCHOR_SLACK;
    Some(Area { x: a.x - s, y: a.y - s, w: a.w + 2.0 * s, h: a.h + 2.0 * s })
}

/// `area` cut to `bounds`; None when nothing of it is in there, or either is
/// not a rectangle at all (NaN, infinite, empty).
fn within(area: Area, bounds: Area) -> Option<Area> {
    let real = |r: Area| [r.x, r.y, r.w, r.h].iter().all(|v| v.is_finite()) && r.w > 0.0 && r.h > 0.0;
    if !real(area) || !real(bounds) {
        return None;
    }
    let (left, top) = (area.x.max(bounds.x), area.y.max(bounds.y));
    let (right, bottom) = ((area.x + area.w).min(bounds.x + bounds.w), (area.y + area.h).min(bounds.y + bounds.h));
    (right > left && bottom > top).then_some(Area { x: left, y: top, w: right - left, h: bottom - top })
}

/// What a decision is allowed to mean for a request at this level. Errors are
/// codes the island turns into words. `holds`: whether this platform can vouch
/// for a physical hold (`inputguard::vouches_for_holds`).
fn resolve(
    decision: &str,
    level: Level,
    engine_level: Level,
    via: &str,
    holds: bool,
) -> Result<&'static str, &'static str> {
    match (decision, via) {
        ("deny", _) => Ok("deny"),
        // High and critical need a hold. Where nothing can vouch for one — on
        // Linux a program can press through the real mouse device (D23) — no
        // allow from the island stands, click, hold or key alike: the request
        // is decided in the terminal.
        ("allow" | "allow_confirmed", _) if level >= Level::High && !holds => Err("terminal_only"),
        // Keystrokes can be synthesised by any program and cannot be told apart
        // from real ones, so the allow hotkey only ever covers low risk — low as
        // scored now and as the engine scored it before a rule calmed it down.
        ("allow", "hotkey") if level == Level::Low && engine_level == Level::Low => Ok("allow"),
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

/// The card has not been in front long enough to have been read.
fn too_soon(since: Instant, now: Instant) -> bool {
    now.saturating_duration_since(since) < MIN_VIEW
}

/// The allow shortcut backs an approval when it was really pressed (`hotkeys`
/// records every press the OS reports), just now, while this card was in front.
fn hotkey_backs(press: Option<Instant>, since: Instant) -> Result<(), &'static str> {
    match press {
        None => Err("no_hotkey"),
        Some(at) if at < since => Err("too_soon"),
        Some(_) => Ok(()),
    }
}

/// What has to stand behind an allow.
enum Backing {
    /// A press of the allow shortcut.
    Hotkey,
    /// A click — or a hold of `hold` — on the island, checked by the click
    /// guard when it is on (and always for a hold).
    Click { hold: Duration, guard: bool, anchor: Option<Anchor> },
}

/// Checks an allow before it goes anywhere: the card has been in front for a
/// moment, and a person did it. Errors are codes the island turns into words;
/// `too_soon` it drops without a word, since it is a click meant for the card
/// before (the second half of a double click, the end of a hold).
fn back_allow(app: &AppHandle, what: &str, since: Instant, backing: Backing) -> Result<(), String> {
    if too_soon(since, Instant::now()) {
        log::line(format!("{what}: the card had only just come up — ignored"));
        return Err("too_soon".into());
    }
    let result = match backing {
        Backing::Hotkey => hotkey_backs(crate::hotkeys::take_allow_press(HOTKEY_WINDOW), since).inspect_err(|why| {
            if *why == "no_hotkey" {
                log::line(format!("SUSPICIOUS: {what} via the allow hotkey, but it was not pressed — refused"));
            }
        }),
        Backing::Click { guard: false, .. } => Ok(()),
        Backing::Click { hold, anchor, .. } => inputguard::check_and_consume(hold, since, anchor_rect(app, anchor))
            .inspect_err(|why| {
                if *why == "too_soon" {
                    log::line(format!("{what}: a click meant for the card before — ignored"));
                } else {
                    log::line(format!("SUSPICIOUS: {what} without a physical click ({why}) — refused"));
                }
            }),
    };
    result.map_err(|why| {
        match why {
            "too_soon" | "no_hotkey" | "hold_incomplete" | "guard_unavailable" | "terminal_only" => why,
            _ => "input_not_physical",
        }
        .to_string()
    })
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
    /// "Deny and stop": deny and end Claude's turn.
    pub stop: bool,
    /// Allow this exact request again for the rest of the session.
    pub remember: bool,
    /// "hotkey" when it came from a global shortcut.
    pub via: &'a str,
}

/// Called by the island's Allow / Deny controls and the global shortcuts.
pub fn answer(app: &AppHandle, request_id: &str, c: Choice) -> Result<(), String> {
    let (level, engine_level, grantable, since, session, tool, target, resolved, kind, agent) = {
        let pending = app.state::<Pending>();
        let map = pending.0.lock().unwrap();
        match map.get(request_id) {
            Some(w) => (
                w.level,
                w.engine_level,
                w.grantable,
                w.on_screen_since(),
                w.session.clone(),
                w.tool.clone(),
                w.target.clone(),
                w.resolved.clone(),
                w.kind,
                str_of(&w.payload, "agent_name").to_string(),
            ),
            None => return Err("not_pending".into()),
        }
    };
    // A question or plan is allowed only with its answer (`respond`).
    if kind != "permission" && c.decision != "deny" {
        return Err("needs_answer".into());
    }
    let word = resolve(c.decision, level, engine_level, c.via, inputguard::vouches_for_holds()).map_err(|why| {
        if why == "terminal_only" {
            log::line(format!(
                "decision id={request_id} rejected: terminal_only — {level:?} needs a hold, and this platform \
                 cannot tell a program's fake click from a real one; the request waits for the terminal or a deny"
            ));
        } else {
            log::line(format!("decision id={request_id} rejected: {why}"));
        }
        why.to_string()
    })?;
    let by: &'static str = if c.via == "hotkey" { "hotkey" } else { "user" };

    // An approval must be backed by a person: a real press of the allow shortcut,
    // or a real mouse press on the island's Allow button — not SendInput, not a
    // UI Automation invoke, not a click elsewhere a moment ago. A click is fresh
    // within seconds; a hold takes its own time.
    if word == "allow" {
        let backing = if by == "hotkey" {
            Backing::Hotkey
        } else {
            let settings = app.state::<crate::Shared>().settings.lock().unwrap().clone();
            let held = level >= Level::High;
            let hold_ms = if level == Level::Critical { settings.hold_critical_ms } else { settings.hold_ms };
            Backing::Click {
                hold: if held { Duration::from_millis(u64::from(hold_ms)) } else { Duration::ZERO },
                guard: settings.input_guard || held,
                anchor: c.anchor,
            }
        };
        back_allow(app, &format!("approval id={request_id}"), since, backing)?;
    }

    let (reply, message) = if word == "allow" {
        if c.remember && grantable && level <= Level::Medium {
            app.state::<SessionGrants>().grant(&session, &tool, &target, &resolved);
        }
        (json!({ "behavior": "allow" }), String::new())
    } else {
        let message = c
            .message
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .unwrap_or(pick(DEFAULT_DENY.0, DEFAULT_DENY.1))
            .chars()
            .take(500)
            .collect::<String>();
        // Codex and Cursor take a deny but no stop: their hooks have no way to
        // end the agent's turn. They get the plain deny (with the words, which
        // still ask the agent to stop), and the history says so.
        let stop = c.stop && can_stop(&agent);
        let recorded = if c.stop && !stop {
            log::line(format!("id={request_id}: {agent} cannot be stopped through its hook — a plain deny"));
            format!("{message} ({})", not_stopped(&agent))
        } else {
            message.clone()
        };
        (deny_reply(&message, stop), recorded)
    };
    send_or_note(
        app,
        request_id,
        Reply::Decision(Answer { reply: reply.to_string(), decision: word, by, message }),
        false,
    );
    Ok(())
}

/// Whether "Deny and stop" can end the agent's turn: Claude Code's hooks can
/// (`continue: false`), Codex's and Cursor's cannot — Codex refuses a hook
/// answer that asks to interrupt, and Cursor's permission answer has no field
/// for it.
fn can_stop(agent: &str) -> bool {
    !matches!(agent, "Codex" | "Cursor")
}

/// The history's note when an agent was only denied, not stopped.
fn not_stopped(agent: &str) -> String {
    if is_tr() {
        format!("{agent} hook'u üzerinden durdurulamıyor, yalnızca reddedildi")
    } else {
        format!("{agent} can't be stopped through its hook, so it was only denied")
    }
}

/// The line for a denial. A plain Deny — a person's, a rule's, a plan sent back
/// with a note — tells Claude why and lets it carry on; "Deny and stop" also ends
/// its turn. Both flags are always spelled out, so the relay never has to guess.
fn deny_reply(message: &str, stop: bool) -> Value {
    json!({ "behavior": "deny", "message": message, "interrupt": stop, "stop": stop })
}

/// The user's answer to a question or a plan.
pub enum Response {
    /// AskUserQuestion: question text → chosen label(s), or the user's own words.
    Answers(serde_json::Map<String, Value>),
    /// ExitPlanMode: go ahead with the plan.
    ApprovePlan,
    /// ExitPlanMode: keep planning, with this feedback for Claude.
    Revise(String),
}

/// Longest answer or feedback passed back to Claude.
const MAX_ANSWER: usize = 2_000;

fn clean_text(text: &str) -> String {
    text.chars().filter(|c| !c.is_control() || *c == '\n').take(MAX_ANSWER).collect::<String>().trim().to_string()
}

/// The question texts in an AskUserQuestion input.
fn question_texts(input: &Value) -> Vec<String> {
    input
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|q| q.get("question").and_then(Value::as_str).map(str::to_string))
        .collect()
}

/// The JSON line for a question's or plan's answer. Answers are kept only for
/// questions that were asked, and every question must have one.
fn response_reply(
    kind: &str,
    input: &Value,
    response: Response,
) -> Result<(Value, &'static str, String), &'static str> {
    match (kind, response) {
        ("question", Response::Answers(given)) => {
            let mut answers = serde_json::Map::new();
            for q in question_texts(input) {
                let a = given.get(&q).and_then(Value::as_str).map(clean_text).unwrap_or_default();
                if a.is_empty() {
                    return Err("unanswered");
                }
                answers.insert(q, Value::String(a));
            }
            if answers.is_empty() {
                return Err("unanswered");
            }
            let summary = answers.values().filter_map(Value::as_str).collect::<Vec<_>>().join(" · ");
            let mut updated = input.clone();
            updated["answers"] = Value::Object(answers);
            Ok((json!({ "behavior": "allow", "updatedInput": updated }), "allow", summary))
        }
        ("plan", Response::ApprovePlan) => {
            Ok((json!({ "behavior": "allow", "updatedInput": input.clone() }), "allow", String::new()))
        }
        ("plan", Response::Revise(feedback)) => {
            let feedback = clean_text(&feedback);
            if feedback.is_empty() {
                return Err("unanswered");
            }
            // No interrupt: Claude reads the feedback and keeps planning.
            Ok((deny_reply(&feedback, false), "deny", feedback))
        }
        _ => Err("wrong_kind"),
    }
}

/// Answers a question or a plan from the island. Backed by a real click on the
/// island like any approval when the click guard is on.
pub fn respond(app: &AppHandle, request_id: &str, response: Response, anchor: Option<Anchor>) -> Result<(), String> {
    let (kind, input, since) = {
        let pending = app.state::<Pending>();
        let map = pending.0.lock().unwrap();
        match map.get(request_id) {
            Some(w) => (w.kind, w.payload.get("tool_input").cloned().unwrap_or(Value::Null), w.on_screen_since()),
            None => return Err("not_pending".into()),
        }
    };
    let (reply, decision, message) = response_reply(kind, &input, response).map_err(str::to_string)?;
    if decision == "allow" {
        let guard = app.state::<crate::Shared>().settings.lock().unwrap().input_guard;
        let backing = Backing::Click { hold: Duration::ZERO, guard, anchor };
        back_allow(app, &format!("answer id={request_id}"), since, backing)?;
    }
    send_or_note(
        app,
        request_id,
        Reply::Decision(Answer { reply: reply.to_string(), decision, by: "user", message }),
        false,
    );
    Ok(())
}

/// Allows, with one click, the low-risk permission requests the island listed in
/// its batch row — those of them still waiting. Low means low twice over: as
/// scored now, and as the engine scored it before any rule calmed it down.
/// Medium and above, questions and plans are never part of it: they stay on their
/// cards. Returns how many were allowed.
pub fn allow_low(app: &AppHandle, anchor: Option<Anchor>, ids: &[String]) -> Result<usize, String> {
    let (chosen, newest) = {
        let pending = app.state::<Pending>();
        let map = pending.0.lock().unwrap();
        let mut chosen: Vec<String> = Vec::new();
        let mut newest: Option<Instant> = None;
        for id in ids.iter().take(64) {
            if chosen.contains(id) {
                continue;
            }
            if let Some(w) = map.get(id).filter(|w| w.batchable()) {
                newest = newest.max(Some(w.on_screen_since()));
                chosen.push(id.clone());
            }
        }
        (chosen, newest)
    };
    let Some(since) = newest else { return Ok(0) };
    // One press, after the newest of them came up.
    let guard = app.state::<crate::Shared>().settings.lock().unwrap().input_guard;
    back_allow(app, "batch approval", since, Backing::Click { hold: Duration::ZERO, guard, anchor })?;
    for id in &chosen {
        let reply = json!({ "behavior": "allow" }).to_string();
        send_or_note(
            app,
            id,
            Reply::Decision(Answer { reply, decision: "allow", by: "batch", message: String::new() }),
            false,
        );
    }
    log::line(format!("batch: allowed {} low-risk requests", chosen.len()));
    Ok(chosen.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn question_input() -> Value {
        json!({ "questions": [
            { "question": "Which framework?", "header": "Framework", "options": [{ "label": "React" }, { "label": "Vue" }] },
            { "question": "Tests?", "header": "Tests", "options": [{ "label": "Yes" }, { "label": "No" }], "multiSelect": true },
        ] })
    }

    #[test]
    fn answers_echo_the_questions_and_cover_every_one() {
        let mut given = serde_json::Map::new();
        given.insert("Which framework?".into(), json!("React"));
        given.insert("Tests?".into(), json!("Yes, No"));
        given.insert("Not asked".into(), json!("ignored"));
        let (reply, decision, summary) =
            response_reply("question", &question_input(), Response::Answers(given)).unwrap();
        assert_eq!(decision, "allow");
        assert_eq!(reply["updatedInput"]["questions"], question_input()["questions"]);
        assert_eq!(reply["updatedInput"]["answers"]["Tests?"], "Yes, No");
        assert!(reply["updatedInput"]["answers"].get("Not asked").is_none());
        assert_eq!(summary, "React · Yes, No");

        let mut partial = serde_json::Map::new();
        partial.insert("Which framework?".into(), json!("React"));
        assert_eq!(response_reply("question", &question_input(), Response::Answers(partial)).err(), Some("unanswered"));
        let mut blank = serde_json::Map::new();
        blank.insert("Which framework?".into(), json!("  "));
        blank.insert("Tests?".into(), json!("Yes"));
        assert_eq!(response_reply("question", &question_input(), Response::Answers(blank)).err(), Some("unanswered"));
    }

    #[test]
    fn plans_are_approved_with_their_input_or_sent_back_with_feedback() {
        let input = json!({ "plan": "## Plan\n1. Do it", "planFilePath": "/p.md" });
        let (reply, decision, _) = response_reply("plan", &input, Response::ApprovePlan).unwrap();
        assert_eq!((decision, &reply["updatedInput"]), ("allow", &input));
        let (reply, decision, message) =
            response_reply("plan", &input, Response::Revise(" Add tests ".into())).unwrap();
        assert_eq!(decision, "deny");
        assert_eq!((&reply["interrupt"], &reply["stop"]), (&json!(false), &json!(false)));
        assert_eq!(message, "Add tests");
        assert_eq!(response_reply("plan", &input, Response::Revise("".into())).err(), Some("unanswered"));
        assert_eq!(response_reply("question", &input, Response::ApprovePlan).err(), Some("wrong_kind"));
        assert_eq!(response_reply("permission", &input, Response::ApprovePlan).err(), Some("wrong_kind"));
    }

    #[test]
    fn a_plain_deny_lets_claude_carry_on_and_deny_and_stop_ends_the_turn() {
        let plain = deny_reply("Use the safe script", false);
        assert_eq!(
            plain,
            json!({ "behavior": "deny", "message": "Use the safe script", "interrupt": false, "stop": false })
        );
        let stop = deny_reply("Stop here", true);
        assert_eq!(stop, json!({ "behavior": "deny", "message": "Stop here", "interrupt": true, "stop": true }));
    }

    #[test]
    fn only_claudes_interactive_tools_are_questions_or_plans() {
        assert_eq!(interactive_kind("AskUserQuestion"), Some("question"));
        assert_eq!(interactive_kind("ExitPlanMode"), Some("plan"));
        assert_eq!(interactive_kind("Bash"), None);
    }

    #[test]
    fn relay_frames_must_be_terminated_and_bounded() {
        let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
        runtime.block_on(async {
            assert_eq!(read_frame(&mut &b"{}\nignored"[..]).await, Some(Frame::Line(b"{}".to_vec())));
            assert!(read_frame(&mut &b"{}"[..]).await.is_none());
            let mut limit = vec![b'x'; MAX_PAYLOAD];
            limit.push(b'\n');
            assert!(matches!(read_frame(&mut limit.as_slice()).await, Some(Frame::Line(l)) if l.len() == MAX_PAYLOAD));
            // One byte over: refused, but what arrived is kept to say what it was.
            limit.insert(0, b'x');
            match read_frame(&mut limit.as_slice()).await {
                Some(Frame::TooLong(start)) => assert!(!start.is_empty() && start.len() <= MAX_PAYLOAD),
                other => panic!("expected TooLong, got {:?}", other.map(|_| "a line")),
            }
        });
    }

    #[test]
    fn an_oversized_request_still_says_what_it_was() {
        // Claude Code's own key order, cut in the middle of the tool's input.
        let mut cut = br#"{"session_id":"s1","cwd":"C:\\Users\\dev\\proj","hook_event_name":"PermissionRequest","tool_name":"MultiEdit","tool_input":{"tool_name":"spoof","cwd":"/elsewhere","edits":[{"old_string":"aaa"#.to_vec();
        cut.extend(std::iter::repeat_n(b'a', 1000));
        let f = top_level_strings(&cut, &["hook_event_name", "session_id", "cwd", "tool_name"]);
        assert_eq!(f.get("hook_event_name").map(String::as_str), Some("PermissionRequest"));
        assert_eq!(f.get("session_id").map(String::as_str), Some("s1"));
        assert_eq!(f.get("cwd").map(String::as_str), Some(r"C:\Users\dev\proj"));
        assert_eq!(f.get("tool_name").map(String::as_str), Some("MultiEdit"), "never the nested one");
        // Sorted keys put the tool's name after its (huge) input: it is then
        // simply not known, never taken from inside the input.
        let sorted =
            br#"{"cwd":"/p","hook_event_name":"PermissionRequest","tool_input":{"tool_name":"spoof","content":"a\"b"#;
        let f = top_level_strings(sorted, &["hook_event_name", "tool_name", "cwd"]);
        assert_eq!(f.get("tool_name"), None);
        assert_eq!(f.get("cwd").map(String::as_str), Some("/p"));
        // Numbers, nested values and escapes do not throw the reader off.
        let mixed = br#"{"n":5,"o":{"cwd":"x"},"a":["cwd"],"cwd":"\u00e7\"q","hook_event_name":"Stop"}"#;
        let f = top_level_strings(mixed, &["cwd", "hook_event_name"]);
        assert_eq!(f.get("cwd").map(String::as_str), Some("ç\"q"));
        assert_eq!(f.get("hook_event_name").map(String::as_str), Some("Stop"));
        assert!(top_level_strings(b"", &["cwd"]).is_empty());
        assert!(top_level_strings(br#"{"cwd":"unterminated"#, &["cwd"]).is_empty());
    }

    /// Windows and macOS: the guard vouches for a hold.
    const HOLDS: bool = true;

    #[test]
    fn high_risk_needs_a_confirmed_allow() {
        use Level::*;
        assert_eq!(resolve("allow", Low, Low, "user", HOLDS), Ok("allow"));
        assert_eq!(resolve("allow", Medium, Medium, "user", HOLDS), Ok("allow"));
        assert_eq!(resolve("allow", High, High, "user", HOLDS), Err("hold_required"));
        assert_eq!(resolve("allow", Critical, Critical, "user", HOLDS), Err("hold_required"));
        assert_eq!(resolve("allow_confirmed", Critical, Critical, "user", HOLDS), Ok("allow"));
        assert_eq!(resolve("deny", Critical, Critical, "user", HOLDS), Ok("deny"));
        assert_eq!(resolve("always", Low, Low, "user", HOLDS), Err("unknown_decision"));
        // A rule that calmed a high request down to low makes it a plain click.
        assert_eq!(resolve("allow", Low, High, "user", HOLDS), Ok("allow"));
    }

    #[test]
    fn the_allow_hotkey_covers_low_risk_only() {
        use Level::*;
        assert_eq!(resolve("allow", Low, Low, "hotkey", HOLDS), Ok("allow"));
        assert_eq!(resolve("allow", Medium, Medium, "hotkey", HOLDS), Err("hotkey_low_only"));
        assert_eq!(resolve("allow_confirmed", Critical, Critical, "hotkey", HOLDS), Err("hotkey_low_only"));
        assert_eq!(resolve("deny", Critical, Critical, "hotkey", HOLDS), Ok("deny"));
        // "git push" → low must not let `git push --force` through on a keystroke.
        assert_eq!(resolve("allow", Low, High, "hotkey", HOLDS), Err("hotkey_low_only"));
        assert_eq!(resolve("allow", Low, Medium, "hotkey", HOLDS), Err("hotkey_low_only"));
    }

    /// D23 / C-25: where the guard cannot vouch for a hold (Linux), nothing
    /// that needs one is approved on the island; the request stays for the
    /// terminal, and deny still works. LOW and MEDIUM are as before.
    #[test]
    fn without_a_hold_to_trust_high_and_critical_are_for_the_terminal() {
        use Level::*;
        let holds = false;
        for (decision, via) in
            [("allow", "user"), ("allow_confirmed", "user"), ("allow", "hotkey"), ("allow_confirmed", "hotkey")]
        {
            for level in [High, Critical] {
                assert_eq!(
                    resolve(decision, level, level, via, holds),
                    Err("terminal_only"),
                    "{decision} {via} {level:?}"
                );
            }
        }
        assert_eq!(resolve("deny", Critical, Critical, "user", holds), Ok("deny"));
        assert_eq!(resolve("deny", High, High, "hotkey", holds), Ok("deny"));
        // LOW and MEDIUM: unchanged, the guard's speed bump still applies.
        assert_eq!(resolve("allow", Low, Low, "user", holds), Ok("allow"));
        assert_eq!(resolve("allow", Medium, Medium, "user", holds), Ok("allow"));
        assert_eq!(resolve("allow_confirmed", Medium, Medium, "user", holds), Ok("allow"));
        assert_eq!(resolve("allow", Low, Low, "hotkey", holds), Ok("allow"));
        assert_eq!(resolve("allow", Medium, Medium, "hotkey", holds), Err("hotkey_low_only"));
        // A rule that calmed a high request down to low makes it a plain click,
        // as everywhere — but never a keystroke.
        assert_eq!(resolve("allow", Low, High, "user", holds), Ok("allow"));
        assert_eq!(resolve("allow", Low, High, "hotkey", holds), Err("hotkey_low_only"));
        // The island learns which it is from the platform's own answer.
        assert_eq!(inputguard::vouches_for_holds(), !cfg!(target_os = "linux"));
    }

    #[test]
    fn the_button_s_place_is_a_button_inside_the_visible_island() {
        // approval-safety#5: the island window is 720×460; the island shows a
        // 640×300 card at the top centre, the rest is transparent and lets
        // clicks through to the windows behind it.
        let window = (720.0, 460.0);
        let visible = Area { x: 40.0, y: 0.0, w: 640.0, h: 300.0 };
        let anchor = |x, y, w, h| Some(Anchor { x, y, w, h });
        // An ordinary Allow button, with four pixels of slack around it.
        let allow = button_area(anchor(520.0, 230.0, 112.0, 32.0), visible, window);
        assert_eq!(allow, Some(Area { x: 516.0, y: 226.0, w: 120.0, h: 40.0 }));
        // On the island's edge: cut to the island, never past it.
        let edge = button_area(anchor(600.0, 280.0, 112.0, 32.0), visible, window);
        assert_eq!(edge, Some(Area { x: 596.0, y: 276.0, w: 84.0, h: 24.0 }));
        // A page that lies: a screen-sized "button", the whole window, a button
        // in the transparent part (over another window), one off the window, or
        // nonsense, vouches for nothing.
        for lie in [
            anchor(-5000.0, -5000.0, 20000.0, 20000.0),
            anchor(0.0, 0.0, 720.0, 460.0),
            anchor(100.0, 380.0, 112.0, 32.0),
            anchor(2000.0, 900.0, 100.0, 30.0),
            anchor(10.0, 10.0, 0.0, 30.0),
            anchor(f64::NAN, 10.0, 100.0, 30.0),
            anchor(10.0, 10.0, f64::INFINITY, 30.0),
        ] {
            assert_eq!(button_area(lie, visible, window), None, "{lie:?}");
        }
        // No anchor: the visible island, itself cut to the window.
        assert_eq!(button_area(None, visible, window), Some(visible));
        let huge = Area { x: -100.0, y: 0.0, w: 5000.0, h: 5000.0 };
        assert_eq!(button_area(None, huge, window), Some(Area { x: 0.0, y: 0.0, w: 720.0, h: 460.0 }));
        // A visible island the page placed off the window takes no press at all.
        let off = Area { x: 800.0, y: 0.0, w: 10.0, h: 10.0 };
        assert_eq!(button_area(None, off, window), None);
        assert_eq!(button_area(anchor(520.0, 230.0, 112.0, 32.0), off, window), None);
    }

    #[test]
    fn only_claude_code_can_be_stopped() {
        assert!(can_stop(""), "Claude Code sends no agent name");
        assert!(!can_stop("Codex"));
        assert!(!can_stop("Cursor"));
        let note = not_stopped("Cursor");
        assert!(note.contains("Cursor"), "{note}");
    }

    #[test]
    fn what_takes_over_is_named_in_the_history() {
        // A hand-back names the place that asks instead.
        assert_eq!(host_of("Cursor", ""), "cursor");
        assert_eq!(host_of("", "claude-desktop"), "app");
        assert_eq!(host_of("", "cli"), "terminal");
        assert_eq!(host_of("Codex", ""), "terminal");
        assert_eq!(taken_by("terminal", "cursor"), "cursor");
        assert_eq!(taken_by("terminal", "app"), "app");
        assert_eq!(taken_by("terminal", "terminal"), "terminal");
        // Other reasons say why, wherever it went.
        for reason in ["timeout", "unseen", "paused", "busy", "resolved"] {
            assert_eq!(taken_by(reason, "cursor"), reason);
        }
        assert_eq!(who_asks("Cursor", "cursor").0, "Cursor asked the user itself");
        assert_eq!(who_asks("", "app").1, "Claude uygulaması sordu");
        assert_eq!(who_asks("Codex", "terminal").0, "Codex asked in the terminal");
        assert_eq!(who_asks("", "terminal").0, "Claude Code asked in the terminal");
    }

    #[test]
    fn the_island_hears_of_an_answer_that_never_arrived() {
        assert_eq!(UNDELIVERED_EVENT, "approval-undelivered");
        assert_eq!(undelivered_notice("123-4"), json!({ "requestId": "123-4" }));
    }

    #[test]
    fn an_expired_card_after_our_own_timeout_is_no_news() {
        assert!(!worth_noting_gone("expired"));
        for reason in ["terminal", "paused", "busy", "resolved"] {
            assert!(worth_noting_gone(reason), "{reason}");
        }
    }

    #[test]
    fn a_card_must_be_in_front_for_a_moment() {
        let shown = Instant::now();
        assert!(too_soon(shown, shown));
        assert!(too_soon(shown, shown + MIN_VIEW - Duration::from_millis(1)));
        assert!(!too_soon(shown, shown + MIN_VIEW));
        // A clock that reads earlier than the card (it cannot, but) is not "later".
        if let Some(before) = shown.checked_sub(Duration::from_secs(1)) {
            assert!(too_soon(shown, before));
        }
    }

    #[test]
    fn the_hotkey_must_really_have_been_pressed_for_this_card() {
        let shown = Instant::now();
        assert_eq!(hotkey_backs(None, shown), Err("no_hotkey"));
        assert_eq!(hotkey_backs(Some(shown + Duration::from_millis(500)), shown), Ok(()));
        if let Some(before) = shown.checked_sub(Duration::from_millis(10)) {
            assert_eq!(hotkey_backs(Some(before), shown), Err("too_soon"), "pressed for the card before");
        }
    }

    fn waiting(kind: &'static str, level: Level, engine_level: Level) -> Waiting {
        let (tx, _rx) = mpsc::channel(1);
        Waiting {
            tx,
            level,
            engine_level,
            grantable: false,
            queued_at: Instant::now(),
            acked_at: None,
            shown_at: None,
            session: String::new(),
            tool: String::new(),
            target: String::new(),
            resolved: String::new(),
            kind,
            payload: Value::Null,
        }
    }

    #[test]
    fn a_batch_takes_low_and_low_before_any_rule_only() {
        use Level::*;
        assert!(waiting("permission", Low, Low).batchable());
        assert!(!waiting("permission", Low, High).batchable(), "re-scored down by a rule");
        assert!(!waiting("permission", Low, Medium).batchable());
        assert!(!waiting("permission", Medium, Medium).batchable());
        assert!(!waiting("question", Low, Low).batchable());
        assert!(!waiting("plan", Low, Low).batchable());
    }

    #[test]
    fn a_card_is_on_screen_from_when_the_island_showed_it() {
        let mut w = waiting("permission", Level::Low, Level::Low);
        assert_eq!(w.on_screen_since(), w.queued_at, "a click that beats the ack");
        let acked = w.queued_at + Duration::from_millis(20);
        w.acked_at = Some(acked);
        assert_eq!(w.on_screen_since(), acked, "queued behind another card: the ack");
        let shown = acked + Duration::from_secs(4);
        w.shown_at = Some(shown);
        assert_eq!(w.on_screen_since(), shown);
    }

    fn answer_of(decision: &'static str) -> Reply {
        Reply::Decision(Answer { reply: "{}".into(), decision, by: "user", message: String::new() })
    }

    #[test]
    fn acknowledging_again_does_not_end_the_wait() {
        let runtime = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        runtime.block_on(async {
            // A reloaded island puts its cards back and acknowledges them again.
            let (tx, mut rx) = mpsc::channel(4);
            for reply in [Reply::Ack, Reply::Ack, answer_of("deny")] {
                assert!(tx.try_send(reply).is_ok());
            }
            assert_eq!(wait_for_decision("t1", &mut rx).await.map(|a| a.decision).ok(), Some("deny"));

            let (tx, mut rx) = mpsc::channel(4);
            for reply in [Reply::Ack, Reply::Ack, Reply::Decline(decline_reason("expired"))] {
                assert!(tx.try_send(reply).is_ok());
            }
            assert_eq!(wait_for_decision("t2", &mut rx).await.err(), Some("timeout"));
        });
    }

    #[test]
    fn an_expired_card_is_recorded_as_a_timeout() {
        assert_eq!(decline_reason("expired"), "timeout");
        assert_eq!(decline_reason("paused"), "paused");
        assert_eq!(decline_reason("busy"), "busy");
        assert_eq!(decline_reason("resolved"), "resolved");
        assert_eq!(decline_reason("terminal"), "terminal");
        assert_eq!(decline_reason("anything else"), "terminal");
    }

    #[test]
    fn a_reloaded_island_gets_every_waiting_card_back_in_order() {
        let mut first = waiting("permission", Level::Low, Level::High);
        first.payload = json!({ "request_id": "a", "risk": { "level": "low", "engineLevel": "high" } });
        let mut second = waiting("question", Level::Low, Level::Low);
        second.queued_at = first.queued_at + Duration::from_millis(5);
        second.payload = json!({ "request_id": "b" });
        first.acked_at = Some(first.queued_at + Duration::from_secs(10));
        let now = first.queued_at + Duration::from_secs(30);
        let map = HashMap::from([("b".to_string(), second), ("a".to_string(), first)]);
        let back = payloads(&map, now);
        assert_eq!(back.iter().map(|p| p["request_id"].clone()).collect::<Vec<_>>(), [json!("a"), json!("b")]);
        assert_eq!(back[0]["risk"]["engineLevel"], "high", "what the hook event carried");
        assert_eq!(back[0]["nobi_waited_ms"], 20_000, "counted from the ack, like the long wait");
        assert_eq!(back[1]["nobi_waited_ms"], 29_995, "never acknowledged: from its arrival");
        assert!(payloads(&HashMap::new(), now).is_empty());
    }

    #[test]
    fn an_answer_the_relay_never_got_is_recorded_as_such() {
        let mut e = Entry { id: "x".into(), message: DEFAULT_DENY.0.into(), ..Entry::default() };
        undelivered(&mut e, "deny");
        assert_eq!((e.decision.as_str(), e.by.as_str()), ("none", "undelivered"));
        assert!(!e.message.contains('('), "the stock reason adds nothing: {}", e.message);
        let mut e = Entry { id: "y".into(), message: "Use the safe script".into(), ..Entry::default() };
        undelivered(&mut e, "deny");
        assert!(e.message.ends_with("(Use the safe script)"), "{}", e.message);
        let mut e = Entry { id: "z".into(), ..Entry::default() };
        undelivered(&mut e, "allow");
        assert_eq!(e.by, "undelivered");
        assert!(!e.message.is_empty());
    }

    #[test]
    fn folder_names() {
        assert_eq!(folder_name(r"C:\Users\dev\project\"), "project");
        assert_eq!(folder_name("/c/Users/dev/web"), "web");
        assert_eq!(folder_name(""), "");
    }
}
