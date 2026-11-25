// Claude Code hook installation.
//
// The rule from CLAUDE.md is strict and is followed to the letter:
// read ~/.claude/settings.json, take a dated backup, merge without touching
// anybody else's hooks, show the diff, and write only after an explicit click.
// What is written is exactly what the diff showed: a preview keeps the bytes it
// was made from and the bytes it would write, and applying writes those or
// nothing. The diff compares the file's own text with the text that replaces it,
// written in the file's own layout (indent, line endings, BOM), so whatever else
// a rewrite would change is visible too.
//
// Uninstall removes Nobi's own commands and nothing else: a matcher group
// shared with somebody else's hook keeps that hook, every other key keeps its
// place, and a settings.json that is a symlink stays one.
//
// The command is only the quoted relay path plus the event name. On Windows
// Claude Code runs hook commands through Git Bash, so the path uses forward
// slashes and anything with PowerShell or cmd in it breaks; on macOS and Linux it
// runs them through sh, and the path ("Application Support") may have a space.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::i18n::is_tr;
use crate::settings;

/// Every event the island reacts to, with the hook timeout written to settings.json.
/// PermissionRequest waits for a human, so it gets the decision timeout + 10 s.
/// So does PreToolUse: in the Claude desktop app, which never runs
/// PermissionRequest hooks, the relay asks the island from PreToolUse instead.
pub const HOOK_EVENTS: &[(&str, u64)] = &[
    ("SessionStart", 10),
    ("SessionEnd", 10),
    ("UserPromptSubmit", 10),
    ("PreToolUse", 120),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("PermissionRequest", 120),
    ("Notification", 10),
    ("Stop", 10),
    ("StopFailure", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
    ("PreCompact", 10),
    ("PostCompact", 10),
];

/// The relay's file name without `.exe`. A hook command whose program is this
/// file is Nobi's; one that merely mentions it is not.
const RELAY: &str = "nobi-hook";
/// The relay's name before 3.0 (Nöbetçi). Its entries are still ours: shown as
/// out of date, replaced by an update and taken out by a removal.
const LEGACY_RELAY: &str = "nobetci-hook";

/// Error for a write whose preview is unknown or no longer matches the file.
pub(crate) const STALE: &str = "stale_preview";
/// Error for an install while the relay the hooks would run is not in place.
pub(crate) const RELAY_MISSING: &str = "relay_missing";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    pub settings_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
    /// Events that currently have a Nobi entry.
    pub events: Vec<String>,
    /// Some entry points at a different relay path (an older install location).
    pub stale: bool,
    /// settings.json has a status line that is not ours; Nobi leaves it alone.
    pub foreign_status_line: bool,
    /// Windows: no spelling of the relay's path runs in both Git Bash and
    /// PowerShell, so the hooks run only where Claude Code uses Git Bash.
    pub git_bash_only: bool,
}

/// The pseudo-event that stands for Claude Code's `statusLine` setting.
pub const STATUS_LINE: &str = "StatusLine";

/// Who owns the `statusLine` setting.
#[derive(Debug, PartialEq)]
enum StatusLineOwner {
    None,
    Ours,
    Theirs,
}

fn status_line_owner(settings: &Value) -> StatusLineOwner {
    match settings.get("statusLine") {
        None | Some(Value::Null) => StatusLineOwner::None,
        Some(v) if v.get("command").and_then(Value::as_str).is_some_and(runs_relay) => StatusLineOwner::Ours,
        Some(_) => StatusLineOwner::Theirs,
    }
}

fn status_line_entry() -> Value {
    json!({ "type": "command", "command": hook_command("statusline"), "padding": 0 })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPreview {
    pub diff: String,
    /// Where the current file is copied before the write; null when there is no
    /// file yet, so there is nothing to back up.
    pub backup: Option<String>,
    pub settings_path: String,
    /// Names this exact preview: `apply` writes what it showed, or nothing.
    pub fingerprint: String,
}

/// Claude Code's user settings: ~/.claude/settings.json, or settings.json in
/// $CLAUDE_CONFIG_DIR when that names an absolute folder (Claude Code keeps its
/// whole configuration there then).
pub fn settings_path() -> PathBuf {
    claude_dir(std::env::var_os("CLAUDE_CONFIG_DIR")).join("settings.json")
}

fn claude_dir(config_dir: Option<std::ffi::OsString>) -> PathBuf {
    config_dir.map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| crate::sys::home().join(".claude"))
}

/// Reads `~/.claude/settings.json`.
///
/// The only error that means "start from nothing" is the file not being there.
/// Everything else — a lock held by another process, a permission problem, JSON
/// we cannot parse — is reported, because the alternative is treating somebody's
/// unreadable settings as an empty object and then writing that back over them.
fn read_settings() -> Result<Value, String> {
    snapshot(&settings_path()).map(|(value, _)| value)
}

fn snapshot(path: &Path) -> Result<(Value, Option<Vec<u8>>), String> {
    let bytes = settings_bytes(path)?;
    let value = parse_settings(bytes.as_deref().unwrap_or_default(), &path.display().to_string())?;
    Ok((value, bytes))
}

pub(crate) fn settings_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) if is_tr() => Err(format!("{} okunamadı: {err}", path.display())),
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

/// The parsing half of `read_settings`, split out so it can be tested without a
/// home directory.
fn parse_settings(bytes: &[u8], path: &str) -> Result<Value, String> {
    // PowerShell writes a UTF-8 BOM with `Set-Content -Encoding utf8`, and
    // serde_json refuses it. Stripping it is safe and well defined; guessing at
    // anything else is not. (A rewrite puts it back: see `Layout`.)
    let text = settings::strip_bom(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) if is_tr() => Err(format!("{path} bir JSON nesnesi değil — Nobi dokunmayacak.")),
        Ok(_) => Err(format!("{path} isn't a JSON object — Nobi won't touch it.")),
        Err(err) if is_tr() => Err(format!(
            "{path} geçerli bir JSON değil ({err}). Düzeltip ya da taşıyıp tekrar dene — Nobi üzerine yazmayacak."
        )),
        Err(err) => {
            Err(format!("{path} isn't valid JSON ({err}). Fix or move it, then try again — Nobi won't overwrite it."))
        }
    }
}

/// The settings as they are, or an empty object when we cannot tell. Only for
/// read-only paths like `status()`, which must never fail loudly; anything that
/// writes uses `read_settings()` and surfaces the error instead.
fn read_settings_lossy() -> Value {
    read_settings().unwrap_or_else(|_| json!({}))
}

fn hook_command(event: &str) -> String {
    command_for(&settings::hook_exe_path().to_string_lossy(), event)
}

/// Windows: Claude Code runs a hook in Git Bash, or in PowerShell when it cannot
/// find Git Bash. The Claude desktop app often cannot, even when the terminal can,
/// and in PowerShell a command that starts with a quoted path is only a string,
/// so the relay never ran. A bare path with forward slashes runs in both, so that
/// is written whenever the path allows it, trying the 8.3 short form for a path
/// with spaces. A path that fits neither gets Git Bash's single quotes, which
/// keep `$` and backticks literal (double quotes would expand them, and the
/// relay would never be found); `git_bash_only` says so in the status.
#[cfg(windows)]
fn command_for(exe: &str, event: &str) -> String {
    match both_shells_path(exe) {
        Some(bare) => format!("{bare} {event}"),
        None => single_quoted(&exe.replace('\\', "/"), event),
    }
}

/// The path as both Git Bash and PowerShell run it, if there is one.
fn both_shells_path(exe: &str) -> Option<String> {
    bare_path(exe).or_else(|| with_short_folders(exe, short_path))
}

/// `exe` with its folders in their 8.3 short form (`short`), when that is a
/// bare path. The file name stays as it is — `nobi-hook.exe` needs no
/// shortening — so the command still names the relay; its own short name
/// (`NOBETC~1.EXE`) would not, and older versions that wrote it left hooks
/// nothing recognised as Nobi's (see `short_alias`).
fn with_short_folders(exe: &str, short: impl Fn(&str) -> Option<String>) -> Option<String> {
    let (folders, name) = exe.rsplit_once(['/', '\\'])?;
    bare_path(&format!("{}/{name}", short(folders)?))
}

/// Whether the hooks can only run in Git Bash (Windows; never elsewhere).
pub fn git_bash_only() -> bool {
    cfg!(windows) && both_shells_path(&settings::hook_exe_path().to_string_lossy()).is_none()
}

/// `exe` with forward slashes, when no character in it means anything to Git
/// Bash or PowerShell: letters (any script), digits and `/ : . _ -`, with `~`
/// allowed after the start (8.3 names).
fn bare_path(exe: &str) -> Option<String> {
    let path = exe.replace('\\', "/");
    let plain =
        |(i, c): (usize, char)| c.is_alphanumeric() || matches!(c, '/' | ':' | '.' | '_' | '-') || (c == '~' && i > 0);
    (!path.is_empty() && path.char_indices().all(plain) && !path.starts_with('-')).then_some(path)
}

/// The 8.3 short form of `exe`, when the volume keeps one.
#[cfg(windows)]
fn short_path(exe: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;
    let long = HSTRING::from(exe);
    let mut buf = vec![0u16; 1024];
    let n = unsafe { GetShortPathNameW(&long, Some(&mut buf)) } as usize;
    (n > 0 && n < buf.len()).then(|| String::from_utf16_lossy(&buf[..n]))
}

#[cfg(not(windows))]
fn short_path(_exe: &str) -> Option<String> {
    None
}

/// sh (macOS, Linux) and Git Bash: single quotes, so nothing in the path is ever
/// read as syntax; a quote in the path ends the quoting, adds itself, reopens.
fn single_quoted(exe: &str, event: &str) -> String {
    format!("'{}' {event}", exe.replace('\'', r"'\''"))
}

#[cfg(not(windows))]
fn command_for(exe: &str, event: &str) -> String {
    single_quoted(exe, event)
}

/// Whether a hook command runs Nobi's relay: its program — quoted, bare, or
/// after PowerShell's `&` (Codex on Windows) — is a file named nobi-hook or
/// nobi-hook.exe. A command that only mentions the relay (a script named
/// after it, an `echo`) belongs to somebody else and is never touched.
pub(crate) fn runs_relay(command: &str) -> bool {
    let rest = command.trim_start();
    let rest = rest.strip_prefix('&').map(str::trim_start).unwrap_or(rest);
    let program = first_word(rest);
    let mut parts = program.rsplit(['/', '\\']);
    let name = parts.next().unwrap_or_default();
    [RELAY, LEGACY_RELAY]
        .iter()
        .any(|relay| name.eq_ignore_ascii_case(relay) || name.eq_ignore_ascii_case(&format!("{relay}.exe")))
        || short_alias(name, parts)
}

/// Whether `name`, in the folders `parents` (innermost first), is the relay
/// under its Windows 8.3 short name: an `XXXXXX~N.EXE` in Nobi's own
/// `Nobi\bin`. Versions up to 2.4.1 wrote `…/Nobi/bin/NOBETC~1.EXE` for
/// a profile path with spaces; nothing else lives in that folder.
fn short_alias<'a>(name: &str, mut parents: impl Iterator<Item = &'a str>) -> bool {
    let Some(stem) =
        name.len().checked_sub(4).filter(|_| name.to_ascii_lowercase().ends_with(".exe")).map(|n| &name[..n])
    else {
        return false;
    };
    let eight_three = stem.split_once('~').is_some_and(|(head, number)| {
        (1..=6).contains(&head.len())
            && head.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
            && !number.is_empty()
            && number.chars().all(|c| c.is_ascii_digit())
    });
    eight_three
        && parents.next().is_some_and(|folder| folder.eq_ignore_ascii_case("bin"))
        && parents
            .next()
            .is_some_and(|folder| folder.eq_ignore_ascii_case("nobi") || folder.eq_ignore_ascii_case("nobetci"))
}

/// The first shell word of `s` with its quoting removed: '…', "…", and `\'` or
/// `\"` outside quotes (the `'\''` idiom). Any other backslash is a Windows path
/// separator and stays.
fn first_word(s: &str) -> String {
    let mut out = String::new();
    let mut quote: Option<char> = None;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => out.push(c),
            None if c.is_whitespace() => break,
            None if c == '\'' || c == '"' => quote = Some(c),
            None if c == '\\' && matches!(chars.peek(), Some('\'' | '"')) => out.extend(chars.next()),
            None => out.push(c),
        }
    }
    out
}

fn hook_is_ours(hook: &Value) -> bool {
    hook.get("command").and_then(Value::as_str).is_some_and(runs_relay)
}

fn entry_is_ours(entry: &Value) -> bool {
    entry.get("hooks").and_then(Value::as_array).is_some_and(|hooks| hooks.iter().any(hook_is_ours))
}

/// `list` (one event's matcher groups) without Nobi's commands; None when
/// none was there. A group loses only our commands, and goes only when nothing
/// else was in it.
fn strip_ours(list: &[Value]) -> Option<Vec<Value>> {
    let mut found = false;
    let kept = list
        .iter()
        .filter_map(|entry| {
            let Some(hooks) = entry.get("hooks").and_then(Value::as_array) else { return Some(entry.clone()) };
            let others: Vec<Value> = hooks.iter().filter(|h| !hook_is_ours(h)).cloned().collect();
            if others.len() == hooks.len() {
                return Some(entry.clone());
            }
            found = true;
            if others.is_empty() {
                return None;
            }
            let mut entry = entry.clone();
            entry["hooks"] = Value::Array(others);
            Some(entry)
        })
        .collect();
    found.then_some(kept)
}

fn not_an_object(what: &str) -> String {
    if is_tr() {
        format!("{what} ayarı bir JSON nesnesi değil — Nobi dokunmayacak.")
    } else {
        format!("The {what} setting isn't a JSON object — Nobi won't touch it.")
    }
}

fn not_a_list(what: &str) -> String {
    if is_tr() {
        format!("{what} bir liste değil — Nobi bu ayarı ezmeyecek.")
    } else {
        format!("{what} isn't a list — Nobi won't overwrite it.")
    }
}

/// Settings with Nobi's entries for exactly `events` (none: every entry of
/// ours removed, whatever event it is under). Nothing that is not ours changes:
/// other hooks stay, in their groups; keys keep their order; a value that is not
/// the shape we would write into is refused, never overwritten.
fn with_events(existing: &Value, events: &[String]) -> Result<Value, String> {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let wanted = |event: &str| events.iter().any(|e| e == event);
    let adds_hooks = HOOK_EVENTS.iter().any(|(event, _)| wanted(event));

    match root.get("hooks").cloned() {
        Some(Value::Object(_)) | None | Some(Value::Null) => {
            let original = root.get("hooks").and_then(Value::as_object).cloned();
            let mut hooks = original.clone().unwrap_or_default();
            let mut touched: Vec<String> = Vec::new();
            // Ours out of every event, in place.
            let names: Vec<String> = hooks.keys().cloned().collect();
            for name in names {
                let stripped = hooks.get(&name).and_then(Value::as_array).and_then(|list| strip_ours(list));
                if let Some(list) = stripped {
                    hooks.insert(name.clone(), Value::Array(list));
                    touched.push(name);
                }
            }
            // Ours back for exactly the chosen events, at the end of each list.
            for (event, timeout) in HOOK_EVENTS.iter().filter(|(event, _)| wanted(event)) {
                let entry =
                    json!({ "hooks": [{ "type": "command", "command": hook_command(event), "timeout": timeout }] });
                match hooks.get_mut(*event) {
                    Some(Value::Array(list)) => list.push(entry),
                    None | Some(Value::Null) => {
                        hooks.insert((*event).to_string(), Value::Array(vec![entry]));
                    }
                    Some(_) => return Err(not_a_list(&format!("hooks.{event}"))),
                }
                touched.push((*event).to_string());
            }
            for name in touched {
                if hooks.get(&name).and_then(Value::as_array).is_some_and(Vec::is_empty) {
                    hooks.shift_remove(&name);
                }
            }
            match original {
                Some(before) if hooks.is_empty() && !before.is_empty() => {
                    root.shift_remove("hooks");
                }
                Some(before) if before == hooks => {}
                _ if hooks.is_empty() => {}
                _ => {
                    root.insert("hooks".into(), Value::Object(hooks));
                }
            }
        }
        // Somebody else's value; none of ours can be in it.
        Some(_) if !adds_hooks => {}
        Some(_) => return Err(not_an_object("hooks")),
    }

    // The status line is a single setting, not a list: take it only when nobody
    // else has, and give back only our own.
    match (status_line_owner(existing), wanted(STATUS_LINE)) {
        (StatusLineOwner::None | StatusLineOwner::Ours, true) => {
            root.insert("statusLine".into(), status_line_entry());
        }
        (StatusLineOwner::Ours, false) => {
            root.shift_remove("statusLine");
        }
        _ => {}
    }
    Ok(Value::Object(root))
}

/// Settings with every Nobi entry removed, and nothing else changed.
fn without_ours(existing: &Value) -> Result<Value, String> {
    with_events(existing, &[])
}

/// Down to the second: installing then uninstalling in the same minute must not
/// quietly overwrite the first backup (and a name already taken gets `-2`).
fn stamp() -> String {
    crate::sys::local_time().compact()
}

/// `<file name>.bak-<stamp>` next to `path`.
fn backup_path(path: &Path) -> PathBuf {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "settings.json".into());
    path.with_file_name(format!("{name}.bak-{}", stamp()))
}

/// FNV-1a: plenty for telling apart the bytes of two previews.
pub(crate) fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Our entry has another command (an older install location, or the quoted form
/// before 2.3.3 that PowerShell cannot run), or another timeout (2.3.2 gave
/// PreToolUse the decision timeout).
fn entry_is_stale(event: &str, entry: &Value) -> bool {
    let expected = hook_command(event);
    let timeout = HOOK_EVENTS.iter().find(|(e, _)| *e == event).map(|(_, t)| *t);
    entry.get("hooks").and_then(Value::as_array).into_iter().flatten().filter(|h| hook_is_ours(h)).any(|h| {
        h.get("command").and_then(Value::as_str) != Some(expected.as_str())
            || (timeout.is_some() && h.get("timeout").and_then(Value::as_u64) != timeout)
    })
}

/// The events of `settings` with an entry of ours (StatusLine included), and
/// whether any of them is stale.
fn installed_events(settings: &Value) -> (Vec<String>, bool) {
    let mut events = Vec::new();
    let mut stale = false;
    if let Some(hooks) = settings.get("hooks").and_then(Value::as_object) {
        for (event, list) in hooks {
            let ours: Vec<&Value> = list.as_array().into_iter().flatten().filter(|e| entry_is_ours(e)).collect();
            if ours.is_empty() {
                continue;
            }
            events.push(event.clone());
            stale |= ours.iter().any(|e| entry_is_stale(event, e));
        }
    }
    if status_line_owner(settings) == StatusLineOwner::Ours {
        events.push(STATUS_LINE.to_string());
        stale |= settings.get("statusLine") != Some(&status_line_entry());
    }
    (events, stale)
}

pub fn status() -> HookStatus {
    let current = read_settings_lossy();
    let (events, stale) = installed_events(&current);
    let hook_path = settings::hook_exe_path();
    HookStatus {
        foreign_status_line: status_line_owner(&current) == StatusLineOwner::Theirs,
        installed: !events.is_empty(),
        settings_path: settings_path().to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
        events,
        stale,
        git_bash_only: git_bash_only(),
    }
}

/// The change an install (of exactly `events`) or a removal would make.
fn prepare(install: bool, events: &[String]) -> Result<Change, String> {
    let path = settings_path();
    let (current, before) = snapshot(&path)?;
    let next = if install { with_events(&current, events)? } else { without_ours(&current)? };
    let needs_relay = !installed_events(&next).0.is_empty();
    Ok(Change::new(path, before, &current, &next, install, needs_relay))
}

/// The diff the user has to look at before anything is written. Remembered
/// under its fingerprint, with the exact bytes it would write.
pub fn preview(install: bool, events: &[String]) -> Result<HookPreview, String> {
    let change = prepare(install, events)?;
    if change.needs_relay && !relay_ready() {
        return Err(RELAY_MISSING.into());
    }
    let (diff, backup, settings_path) = (change.diff.clone(), change.backup_text(), change.path_text());
    let fingerprint = remember(change);
    Ok(HookPreview { diff, backup, settings_path, fingerprint })
}

/// Writes exactly what the preview `fingerprint` showed, after taking a dated
/// backup; returns where the backup went (None when there was no file).
///
/// If the file changed in between — another tool, another window, the user's
/// own editor — nothing is written (`stale_preview`), because the only thing
/// worse than not installing the hooks is silently reverting somebody else's edit.
pub fn apply(install: bool, fingerprint: &str) -> Result<Option<String>, String> {
    apply_reviewed(fingerprint, install, &settings_path())
}

/// Removes every Nobi entry, with a dated backup, without a preview: the
/// uninstaller's `--remove-hooks`. None when there was nothing of ours.
pub fn remove_for_uninstall() -> Result<Option<String>, String> {
    let change = prepare(false, &[])?;
    write_change(&change)
        .map(|kept| kept.map(|p| p.to_string_lossy().into_owned()))
        .map_err(|e| e.describe(&change.path))
}

// ── Reviewed writes (shared with agent_hooks) ─────────────────────────────────

/// One change to an agent's settings file, exactly as the user reviews it: the
/// bytes the diff was made from and the bytes that will be written.
#[derive(Clone, Debug)]
pub(crate) struct Change {
    /// The file as the user knows it. A symlink stays one: the write goes to the
    /// file it names.
    pub path: PathBuf,
    /// None: there is no file yet.
    pub before: Option<Vec<u8>>,
    pub after: Vec<u8>,
    pub diff: String,
    /// Where the current file is copied first; None when there is none, or
    /// nothing changes.
    pub backup: Option<PathBuf>,
    pub install: bool,
    /// The new content runs the relay, so the relay must be in place first.
    pub needs_relay: bool,
}

impl Change {
    /// The change from `current` (parsed from `before`) to `next`, rendered in
    /// the file's own layout. When nothing changes, nothing is rewritten.
    pub(crate) fn new(
        path: PathBuf,
        before: Option<Vec<u8>>,
        current: &Value,
        next: &Value,
        install: bool,
        needs_relay: bool,
    ) -> Change {
        let same = current == next;
        let after = if same { before.clone().unwrap_or_default() } else { Layout::of(before.as_deref()).render(next) };
        let diff = unified_diff(&text_of(before.as_deref()), &text_of(Some(&after)));
        let backup = before.as_ref().filter(|_| !same).map(|_| backup_path(&path));
        Change { path, before, after, diff, backup, install, needs_relay }
    }

    /// Whether applying it writes anything.
    pub(crate) fn changes(&self) -> bool {
        match &self.before {
            Some(before) => *before != self.after,
            None => !self.after.is_empty(),
        }
    }

    pub(crate) fn backup_text(&self) -> Option<String> {
        self.backup.as_ref().map(|p| p.to_string_lossy().into_owned())
    }

    pub(crate) fn path_text(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    /// Identifies this exact change: the file, both sides, and the direction.
    fn key(&self) -> String {
        let mut bytes = Vec::new();
        let mut part = |data: &[u8]| {
            bytes.extend_from_slice(&(data.len() as u64).to_le_bytes());
            bytes.extend_from_slice(data);
        };
        part(self.path.to_string_lossy().as_bytes());
        part(if self.before.is_some() { b"file" } else { b"none" });
        part(self.before.as_deref().unwrap_or_default());
        part(&self.after);
        part(if self.install { b"install" } else { b"remove" });
        fingerprint(&bytes)
    }
}

/// Previews shown to the user, newest last: what `apply` may write.
static REVIEWED: Mutex<Vec<(String, Change)>> = Mutex::new(Vec::new());
const REVIEWS_KEPT: usize = 16;

/// Remembers a change the user is about to review; returns its fingerprint.
pub(crate) fn remember(change: Change) -> String {
    let key = change.key();
    let mut list = REVIEWED.lock().unwrap_or_else(PoisonError::into_inner);
    list.retain(|(k, _)| *k != key);
    list.push((key.clone(), change));
    let extra = list.len().saturating_sub(REVIEWS_KEPT);
    list.drain(..extra);
    key
}

fn reviewed(key: &str) -> Option<Change> {
    REVIEWED.lock().unwrap_or_else(PoisonError::into_inner).iter().find(|(k, _)| k == key).map(|(_, c)| c.clone())
}

fn forget(key: &str) {
    REVIEWED.lock().unwrap_or_else(PoisonError::into_inner).retain(|(k, _)| k != key);
}

/// Whether the relay the hooks run is in place.
pub(crate) fn relay_ready() -> bool {
    settings::hook_exe_path().is_file()
}

/// Writes the change previewed under `key`, if it is one for `file` and
/// `install` and the file still holds what it was made from.
pub(crate) fn apply_reviewed(key: &str, install: bool, file: &Path) -> Result<Option<String>, String> {
    let Some(change) = reviewed(key).filter(|c| c.install == install && c.path == file) else {
        return Err(STALE.into());
    };
    if change.needs_relay && !relay_ready() {
        return Err(RELAY_MISSING.into());
    }
    match write_change(&change) {
        Ok(kept) => {
            forget(key);
            Ok(kept.map(|p| p.to_string_lossy().into_owned()))
        }
        Err(WriteError::Stale) => {
            forget(key);
            Err(STALE.into())
        }
        Err(err) => Err(err.describe(&change.path)),
    }
}

#[derive(Debug)]
pub(crate) enum WriteError {
    /// The file no longer holds what the change was made from.
    Stale,
    Io(String),
}

impl WriteError {
    /// In words, for a log or a message (the settings window gets `stale_preview`).
    pub(crate) fn describe(&self, path: &Path) -> String {
        match (self, is_tr()) {
            (Self::Stale, true) => format!("{} bu sırada değişti; hiçbir şey yazılmadı.", path.display()),
            (Self::Stale, false) => format!("{} changed meanwhile; nothing was written.", path.display()),
            (Self::Io(err), _) => err.clone(),
        }
    }
}

fn io_failure(path: &Path, err: std::io::Error) -> WriteError {
    WriteError::Io(if is_tr() {
        format!("{} yazılamadı: {err}", path.display())
    } else {
        format!("Couldn't write {}: {err}", path.display())
    })
}

/// Writes `change.after` in place of the file — through a symlink, into the file
/// it names — after keeping `change.before` as the backup. Refuses when the file
/// no longer holds `change.before`. Returns where the backup went.
pub(crate) fn write_change(change: &Change) -> Result<Option<PathBuf>, WriteError> {
    if !change.changes() {
        return Ok(None);
    }
    static WRITE: Mutex<()> = Mutex::new(());
    let _one_at_a_time = WRITE.lock().unwrap_or_else(PoisonError::into_inner);
    let path = &change.path;
    let unchanged = || match settings_bytes(path) {
        Ok(now) if now == change.before => Ok(()),
        Ok(_) => Err(WriteError::Stale),
        Err(err) => Err(WriteError::Io(err)),
    };
    unchanged()?;
    let target = settings::real_path(path);
    if let Some(dir) = target.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| io_failure(path, e))?;
    }
    let temp = settings::temp_beside(&target, "nobi");
    let result = (|| {
        settings::write_private(&temp, &change.after).map_err(|e| io_failure(path, e))?;
        keep_mode(&target, &temp);
        let kept = match (&change.before, &change.backup) {
            (Some(bytes), Some(backup)) => {
                Some(settings::write_new_private(backup, bytes).map_err(|e| io_failure(backup, e))?)
            }
            _ => None,
        };
        unchanged()?;
        std::fs::rename(&temp, &target).map_err(|e| io_failure(path, e))?;
        Ok(kept)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Gives the new file the old one's permissions (a rewrite changes the
/// content, not who may read it); a new file stays owner-only.
fn keep_mode(old: &Path, new: &Path) {
    #[cfg(unix)]
    if let Ok(meta) = std::fs::metadata(old) {
        let _ = std::fs::set_permissions(new, meta.permissions());
    }
    #[cfg(not(unix))]
    let _ = (old, new);
}

/// Copies the relay (nobi-hook) into Nobi's data folder on launch:
/// %LOCALAPPDATA%\Nobi\bin on Windows, ~/Library/Application Support/Nobi/bin
/// on macOS, ~/.local/share/nobi/bin on Linux. In a bundled install it comes
/// from the app resources; in `tauri dev` it sits next to the app in the
/// workspace target directory.
///
/// Every candidate is tried rather than just the first, because getting this
/// wrong is silent and fatal: `resources` used to be a glob, which made NSIS
/// mirror the source path into `_up_\target\release\`, no candidate matched, and
/// the relay was simply never installed. It only looked healthy on a developer
/// machine, where a leftover copy from `tauri dev` was already sitting in bin/.
pub fn ensure_hook_exe(app: &AppHandle) {
    let dest = settings::hook_exe_path();
    if git_bash_only() {
        crate::log::line(format!(
            "the relay's path ({}) has characters no hook command can run in both Git Bash and PowerShell; \
             the hooks run only where Claude Code uses Git Bash",
            dest.display()
        ));
    }
    let Some(dir) = dest.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }

    let name = settings::HOOK_EXE;
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve(name, tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            // Installed build, then `tauri dev` (target/debug) next to the
            // release hook the pre-build step produces.
            candidates.push(parent.join(name));
            candidates.push(parent.join("../release").join(name));
            // Belt and braces: where the old glob form used to land it.
            candidates.push(parent.join("_up_/target/release").join(name));
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    let Some(src) = candidates.into_iter().find(|p| p.exists()) else {
        crate::log::line(format!("{name} not found — Claude Code hooks cannot work. Looked in: {}", tried.join(", ")));
        return;
    };
    install_relay(&src, &dest);
}

#[cfg(windows)]
fn install_relay(src: &Path, dest: &Path) {
    let same = match (std::fs::metadata(src), std::fs::metadata(dest)) {
        (Ok(a), Ok(b)) => a.len() == b.len() && a.modified().ok() == b.modified().ok(),
        _ => false,
    };
    if same {
        return;
    }
    // A hook may be running right now and hold the file open; keeping the old
    // copy is fine, it is the same relay.
    if let Err(err) = std::fs::copy(src, dest) {
        if !dest.exists() {
            crate::log::line(format!("could not install nobi-hook.exe: {err}"));
        }
    }
}

#[cfg(not(windows))]
fn install_relay(src: &Path, dest: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let bytes = match std::fs::read(src) {
        Ok(b) => b,
        Err(err) => {
            crate::log::line(format!("could not read the relay at {}: {err}", src.display()));
            return;
        }
    };
    if std::fs::read(dest).is_ok_and(|have| have == bytes) {
        return;
    }
    // A fresh file renamed over the old one: a hook running right now keeps the
    // copy it started from (rewriting a running binary in place can get it
    // killed), and the new file carries none of the app bundle's extended
    // attributes, so it runs from Claude Code like any program of yours.
    let temp = dest.with_extension(format!("new-{}", std::process::id()));
    let result = std::fs::write(&temp, &bytes)
        .and_then(|_| std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o755)))
        .and_then(|_| std::fs::rename(&temp, dest));
    if let Err(err) = result {
        let _ = std::fs::remove_file(&temp);
        crate::log::line(format!("could not install nobi-hook: {err}"));
    }
}

// ── The file's own layout ─────────────────────────────────────────────────────

/// How a JSON file is laid out, so a rewrite keeps the user's style: their
/// indent, line endings, BOM and final newline. What serde normalises anyway (a
/// duplicate key, the spelling of a number or an escape) shows in the diff,
/// which compares text, not parsed values.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Layout {
    bom: bool,
    crlf: bool,
    indent: String,
    final_newline: bool,
}

impl Layout {
    /// The layout of `bytes`; two spaces, LF and a final newline for a new file.
    pub(crate) fn of(bytes: Option<&[u8]>) -> Layout {
        let fresh = Layout { bom: false, crlf: false, indent: "  ".into(), final_newline: true };
        let Some(bytes) = bytes else { return fresh };
        let bom = bytes.len() != settings::strip_bom(bytes).len();
        let text = String::from_utf8_lossy(settings::strip_bom(bytes));
        if text.trim().is_empty() {
            return Layout { bom, ..fresh };
        }
        let crlf = text.find('\n').is_some_and(|i| text[..i].ends_with('\r'));
        let indent = text
            .lines()
            .skip(1)
            .find_map(|line| {
                let lead: String = line.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
                (!lead.is_empty() && lead.len() < line.trim_end().len()).then_some(lead)
            })
            .map(|lead| if lead.starts_with('\t') { "\t".to_string() } else { " ".repeat(lead.len().min(8)) })
            .unwrap_or(fresh.indent);
        Layout { bom, crlf, indent, final_newline: text.ends_with('\n') }
    }

    pub(crate) fn render(&self, value: &Value) -> Vec<u8> {
        let mut json = Vec::new();
        let formatter = serde_json::ser::PrettyFormatter::with_indent(self.indent.as_bytes());
        let mut serializer = serde_json::Serializer::with_formatter(&mut json, formatter);
        if value.serialize(&mut serializer).is_err() {
            json = serde_json::to_vec_pretty(value).unwrap_or_default();
        }
        let mut text = String::from_utf8(json).unwrap_or_default();
        if self.final_newline {
            text.push('\n');
        }
        if self.crlf {
            // Raw newlines only ever separate JSON tokens; inside strings they are `\n`.
            text = text.replace('\n', "\r\n");
        }
        let mut out = if self.bom { vec![0xEF, 0xBB, 0xBF] } else { Vec::new() };
        out.extend_from_slice(text.as_bytes());
        out
    }
}

/// The text of a file for the diff (its BOM, kept either way, left out).
fn text_of(bytes: Option<&[u8]>) -> String {
    String::from_utf8_lossy(settings::strip_bom(bytes.unwrap_or_default())).into_owned()
}

// ── Minimal unified diff (LCS) ────────────────────────────────────────────────

/// The longest-common-subsequence table is (n+1)·(m+1) cells; past this many,
/// the changed middle is shown as one block instead.
const LCS_CELLS: usize = 4_000_000;

/// Which line endings a text uses: (CRLF, bare LF).
fn endings(text: &str) -> (bool, bool) {
    let crlf = text.matches("\r\n").count();
    (crlf > 0, text.matches('\n').count() > crlf)
}

/// A line of the diff, its carriage return (if it is shown) as a visible ␍.
fn shown(line: &str) -> std::borrow::Cow<'_, str> {
    match line.strip_suffix('\r') {
        Some(rest) => format!("{rest}\u{240D}").into(),
        None => line.into(),
    }
}

/// A line diff with three lines of context: `  ` kept, `- ` removed, `+ ` added.
/// Settings files are short, so a plain LCS over the lines between the common
/// head and tail is the simplest honest diff.
///
/// A rewrite writes one kind of line ending throughout (`Layout`). When that
/// changes any line's ending — a file that mixes CRLF and LF — line endings
/// count as part of the lines, a carriage return shows as ␍, and a note on
/// top says so: no byte changes behind a line shown as unchanged.
pub(crate) fn unified_diff(before: &str, after: &str) -> String {
    let (was, now) = (endings(before), endings(after));
    let mixed = |e: (bool, bool)| e.0 && e.1;
    let endings_change = mixed(was) || mixed(now) || (was != (false, false) && now != (false, false) && was != now);
    fn lines(text: &str, with_endings: bool) -> Vec<&str> {
        if with_endings {
            text.split_inclusive('\n').map(|l| l.strip_suffix('\n').unwrap_or(l)).collect()
        } else {
            text.lines().collect()
        }
    }
    let a: Vec<&str> = lines(before, endings_change);
    let b: Vec<&str> = lines(after, endings_change);
    let head = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let tail = a[head..].iter().rev().zip(b[head..].iter().rev()).take_while(|(x, y)| x == y).count();
    let (mid_a, mid_b) = (&a[head..a.len() - tail], &b[head..b.len() - tail]);

    let mut out: Vec<String> = a[..head].iter().map(|l| format!("  {}", shown(l))).collect();
    let (n, m) = (mid_a.len(), mid_b.len());
    if (n + 1).saturating_mul(m + 1) > LCS_CELLS {
        out.extend(mid_a.iter().map(|l| format!("- {}", shown(l))));
        out.extend(mid_b.iter().map(|l| format!("+ {}", shown(l))));
    } else {
        let mut lcs = vec![vec![0u32; m + 1]; n + 1];
        for i in (0..n).rev() {
            for j in (0..m).rev() {
                lcs[i][j] = if mid_a[i] == mid_b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
            }
        }
        let (mut i, mut j) = (0usize, 0usize);
        while i < n && j < m {
            if mid_a[i] == mid_b[j] {
                out.push(format!("  {}", shown(mid_a[i])));
                i += 1;
                j += 1;
            } else if lcs[i + 1][j] >= lcs[i][j + 1] {
                out.push(format!("- {}", shown(mid_a[i])));
                i += 1;
            } else {
                out.push(format!("+ {}", shown(mid_b[j])));
                j += 1;
            }
        }
        out.extend(mid_a[i..].iter().map(|l| format!("- {}", shown(l))));
        out.extend(mid_b[j..].iter().map(|l| format!("+ {}", shown(l))));
    }
    out.extend(a[a.len() - tail..].iter().map(|l| format!("  {}", shown(l))));

    // Keep three lines of context around each change so the panel stays readable.
    let changed: Vec<usize> =
        out.iter().enumerate().filter(|(_, l)| l.starts_with('+') || l.starts_with('-')).map(|(i, _)| i).collect();
    if changed.is_empty() {
        return if is_tr() { "Değişiklik yok.".into() } else { "No change.".into() };
    }
    let mut keep = vec![false; out.len()];
    for idx in changed {
        let lo = idx.saturating_sub(3);
        let hi = (idx + 4).min(out.len());
        keep[lo..hi].fill(true);
    }
    let mut result = String::new();
    if endings_change {
        let note = match (now.0, is_tr()) {
            (true, true) => "Satır sonları baştan sona CRLF olacak; \u{240D} bir CR'yi gösterir.",
            (true, false) => "Line endings become CRLF throughout; \u{240D} marks a CR.",
            (false, true) => "Satır sonları baştan sona LF olacak; \u{240D} bir CR'yi gösterir.",
            (false, false) => "Line endings become LF throughout; \u{240D} marks a CR.",
        };
        result.push_str(&format!("@@ {note} @@\n"));
    }
    let mut gap = false;
    for (idx, line) in out.iter().enumerate() {
        if keep[idx] {
            result.push_str(line);
            result.push('\n');
            gap = false;
        } else if !gap {
            result.push_str("  …\n");
            gap = true;
        }
    }
    result
}

/// Held by tests that point the home folder somewhere else, and by tests that
/// build the relay's command twice and compare: that path follows the home folder.
#[cfg(test)]
pub(crate) static HOME_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub(crate) fn home_lock() -> std::sync::MutexGuard<'static, ()> {
    HOME_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A fresh home folder for a test: home, the relay's folder (%LOCALAPPDATA% on
/// Windows) and Claude's and Codex's folders all point into it until it is
/// dropped, which puts the environment back. Holds `HOME_LOCK` meanwhile.
#[cfg(test)]
pub(crate) struct TempHome {
    pub dir: PathBuf,
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
    _lock: std::sync::MutexGuard<'static, ()>,
}

#[cfg(test)]
impl TempHome {
    pub(crate) fn new(name: &str) -> TempHome {
        let lock = home_lock();
        let dir = std::env::temp_dir().join(format!("nobi-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let vars = ["HOME", "USERPROFILE", "LOCALAPPDATA", "XDG_DATA_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"];
        let saved = vars.iter().map(|v| (*v, std::env::var_os(v))).collect();
        std::env::set_var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }, &dir);
        std::env::set_var("LOCALAPPDATA", &dir);
        for var in ["XDG_DATA_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"] {
            std::env::remove_var(var);
        }
        TempHome { dir, saved, _lock: lock }
    }
}

#[cfg(test)]
impl Drop for TempHome {
    fn drop(&mut self) {
        for (var, value) in self.saved.drain(..) {
            match value {
                Some(value) => std::env::set_var(var, value),
                None => std::env::remove_var(var),
            }
        }
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_events() -> Vec<String> {
        HOOK_EVENTS.iter().map(|(e, _)| e.to_string()).collect()
    }

    fn merged(existing: &Value, events: &[String]) -> Value {
        with_events(existing, events).unwrap()
    }

    #[test]
    fn only_the_chosen_events_are_written() {
        let existing = serde_json::json!({
            "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "other.exe" }] }] }
        });
        let first = merged(&existing, &all_events());
        let chosen = vec!["PermissionRequest".to_string(), "Stop".to_string()];
        let after = merged(&first, &chosen);
        let hooks = after["hooks"].as_object().unwrap();
        assert!(hooks.contains_key("PermissionRequest"));
        assert!(!hooks.contains_key("PreToolUse"), "unchosen events lose our entry");
        let stop = hooks["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "someone else's Stop hook stays, ours is added");
    }

    const WHERE: &str = "settings.json";

    #[test]
    fn a_utf8_bom_is_stripped_not_treated_as_corruption() {
        // PowerShell 5's `Set-Content -Encoding utf8` produces exactly this.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"{"model":"opus","hooks":{}}"#);
        let parsed = parse_settings(&bytes, WHERE).expect("a BOM must not defeat the parser");
        assert_eq!(parsed["model"], "opus");
    }

    #[test]
    fn unreadable_content_is_an_error_never_an_empty_object() {
        // This is the whole bug: returning {} here meant `merged()` produced a
        // file containing nothing but Nobi's hooks, and the write replaced
        // everything the user had.
        for bad in [&b"{ not json"[..], &b"[1,2,3]"[..], &b"\"a string\""[..]] {
            assert!(parse_settings(bad, WHERE).is_err(), "content we cannot use must refuse, not come back empty");
        }
    }

    #[test]
    fn empty_and_whitespace_files_start_from_nothing() {
        assert_eq!(parse_settings(b"", WHERE).unwrap(), json!({}));
        assert_eq!(parse_settings(b"  \n\t ", WHERE).unwrap(), json!({}));
    }

    #[test]
    fn merging_keeps_every_other_setting_and_every_foreign_hook() {
        let existing = serde_json::json!({
            "model": "claude-opus-5",
            "theme": "dark",
            "enabledPlugins": ["a", "b"],
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "someone-elses-tool.exe" }] }
                ],
                "SomeEventWeDoNotTouch": [
                    { "hooks": [{ "type": "command", "command": "keep-me.exe" }] }
                ]
            }
        });

        let after = merged(&existing, &all_events());
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["enabledPlugins"], serde_json::json!(["a", "b"]));

        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("someone-elses-tool.exe")),
            "another tool's hook was dropped"
        );
        assert!(pre.iter().any(entry_is_ours), "our own hook was not added");
        assert!(after["hooks"]["SomeEventWeDoNotTouch"].is_array());

        // And removing ours puts it back exactly as it was — the same text, so
        // the same key order too (Map equality alone would not notice a swap).
        let cleaned = without_ours(&after).unwrap();
        assert_eq!(serde_json::to_string_pretty(&cleaned).unwrap(), serde_json::to_string_pretty(&existing).unwrap());
    }

    #[test]
    fn a_foreign_hook_sharing_a_group_with_ours_survives_update_and_removal() {
        let ours = json!({ "type": "command", "command": hook_command("Stop"), "timeout": 10 });
        let theirs = json!({ "type": "command", "command": "~/bin/notify-done.sh" });
        let existing = json!({
            "hooks": { "Stop": [{ "matcher": "", "hooks": [ours, theirs.clone()] }] }
        });
        let removed = without_ours(&existing).unwrap();
        assert_eq!(removed["hooks"]["Stop"], json!([{ "matcher": "", "hooks": [theirs.clone()] }]));
        // An update moves ours into a group of its own and leaves theirs where it was.
        let updated = merged(&existing, &["Stop".to_string()]);
        let stop = updated["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop[0], json!({ "matcher": "", "hooks": [theirs] }));
        assert_eq!(stop.len(), 2);
        assert!(entry_is_ours(&stop[1]));
    }

    #[test]
    fn removal_keeps_every_other_key_where_it_was() {
        let _home = home_lock();
        // Map::remove is a swap_remove under preserve_order: `model` used to jump
        // into the place of `hooks`, and the reviewed diff showed it as changed.
        let installed = merged(&json!({ "permissions": {}, "model": "opus", "env": {} }), &all_events());
        let existing: Value = serde_json::from_str(&format!(
            r#"{{"permissions":{{"allow":[]}},"hooks":{},"model":"opus","env":{{"A":"1"}},"statusLine":{}}}"#,
            installed["hooks"],
            status_line_entry()
        ))
        .unwrap();
        let removed = without_ours(&existing).unwrap();
        let keys: Vec<&String> = removed.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["permissions", "model", "env"]);
        // Unticking one event keeps the order of the others.
        let mut events = all_events();
        events.retain(|e| e != "Notification");
        let fewer = merged(&installed, &events);
        let before: Vec<&String> =
            installed["hooks"].as_object().unwrap().keys().filter(|k| *k != "Notification").collect();
        let after: Vec<&String> = fewer["hooks"].as_object().unwrap().keys().collect();
        assert_eq!(before, after);
    }

    #[test]
    fn a_foreign_command_that_only_mentions_the_relay_is_not_ours() {
        for ours in [
            "'/Users/a/Library/Application Support/Nobi/bin/nobi-hook' Stop",
            r"'/Users/o'\''neil/nobi-hook' Stop",
            "C:/Users/afrap/AppData/Local/Nobi/bin/nobi-hook.exe Stop",
            r#""C:/Users/a b/AppData/Local/Nobi/bin/nobi-hook.exe" Stop"#,
            r"& 'C:\Users\x\AppData\Local\Nobi\bin\nobi-hook.exe' codex Stop",
            r"& 'C:\Users\o''neil\AppData\Local\Nobi\bin\nobi-hook.exe' codex Stop",
            "/home/dev/.local/share/nobi/bin/nobi-hook statusline",
            "nobi-hook Stop",
        ] {
            assert!(runs_relay(ours), "{ours}");
        }
        for theirs in [
            "~/bin/notify-nobi-hook-events.sh",
            "echo nobi-hook",
            "bash -c 'nobi-hook Stop'",
            "/opt/nobi-hook-wrapper Stop",
            "",
        ] {
            assert!(!runs_relay(theirs), "{theirs}");
        }
        let theirs =
            json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "~/bin/log-nobi-hook.sh" }] }] } });
        assert_eq!(without_ours(&theirs).unwrap(), theirs);
        assert!(installed_events(&theirs).0.is_empty());
    }

    /// hooks-settings#0: with a space in the profile path, versions up to 2.4.1
    /// wrote the relay under its 8.3 name (…/Nobi/bin/NOBETC~1.EXE). Those
    /// entries are Nobi's for status, update and removal; new ones keep
    /// the file's own name and shorten only the folders.
    #[test]
    fn a_relay_written_with_its_short_name_is_still_ours() {
        let old = "C:/Users/JOHNDO~1/AppData/Local/Nobetci/bin/NOBETC~1.EXE";
        for ours in [
            format!("{old} Stop"),
            format!("\"{old}\" PermissionRequest"),
            "C:/Users/JOHNDO~1/AppData/Local/nobetci/BIN/nobetc~2.exe Stop".to_string(),
            r"C:\Users\JOHNDO~1\AppData\Local\Nobetci\bin\NOBETC~1.EXE Stop".to_string(),
            "C:/Users/JOHNDO~1/AppData/Local/Nobi/bin/NOBI-H~1.EXE Stop".to_string(),
            // Nöbetçi's relay under its own name, before 3.0.
            "C:/Users/dev/AppData/Local/Nobetci/bin/nobetci-hook.exe Stop".to_string(),
            "/home/dev/.local/share/nobetci/bin/nobetci-hook PreToolUse".to_string(),
        ] {
            assert!(runs_relay(&ours), "{ours}");
        }
        for theirs in [
            "C:/tools/NOBETC~1.EXE Stop",
            "C:/Users/x/Nobetci/NOBETC~1.EXE Stop",
            "/usr/bin/nobetci-hook-wrapper.sh Stop",
            "C:/Users/x/Nobi/bin/notes~1.txt Stop",
            "C:/Users/x/Nobi/bin/NOBIHOOK.EXE Stop",
            "C:/Users/x/Nobi/bin/TOOLONGNAME~1.EXE Stop",
            "C:/Users/x/Nobi/bin/AB~X.EXE Stop",
        ] {
            assert!(!runs_relay(theirs), "{theirs}");
        }
        // Status, update and removal all see it.
        let installed = serde_json::json!({
            "model": "opus",
            "hooks": {
                "Stop": [{ "hooks": [
                    { "type": "command", "command": format!("{old} Stop"), "timeout": 10 },
                    { "type": "command", "command": "other.exe" }
                ] }],
                "PermissionRequest": [{ "hooks": [{ "type": "command", "command": format!("{old} PermissionRequest") }] }]
            },
            "statusLine": { "type": "command", "command": format!("{old} statusline"), "padding": 0 }
        });
        let (events, stale) = installed_events(&installed);
        assert_eq!(events, ["Stop", "PermissionRequest", STATUS_LINE], "{events:?}");
        assert!(stale, "an update rewrites them in the current form");
        assert_eq!(status_line_owner(&installed), StatusLineOwner::Ours);
        let updated = merged(&installed, &["Stop".to_string()]);
        let stop: Vec<&str> = updated["hooks"]["Stop"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|group| group["hooks"].as_array().unwrap())
            .filter_map(|h| h["command"].as_str())
            .collect();
        assert_eq!(stop.iter().filter(|c| runs_relay(c)).count(), 1, "replaced, not doubled: {stop:?}");
        assert!(stop.contains(&"other.exe"));
        let removed = without_ours(&installed).unwrap();
        assert!(installed_events(&removed).0.is_empty(), "{removed}");
        assert_eq!(removed["hooks"]["Stop"][0]["hooks"][0]["command"], "other.exe");
        assert_eq!(removed["model"], "opus");
    }

    #[test]
    fn only_the_folders_are_shortened() {
        let short = |folders: &str| Some(folders.replace("John Doe", "JOHNDO~1"));
        assert_eq!(
            with_short_folders(r"C:\Users\John Doe\AppData\Local\Nobi\bin\nobi-hook.exe", short).as_deref(),
            Some("C:/Users/JOHNDO~1/AppData/Local/Nobi/bin/nobi-hook.exe")
        );
        let command = format!("{} Stop", with_short_folders(r"C:\Users\John Doe\x\nobi-hook.exe", short).unwrap());
        assert!(runs_relay(&command), "{command}");
        // No short form, or one that still needs quotes: no bare path.
        assert_eq!(with_short_folders(r"C:\Users\John Doe\nobi-hook.exe", |_| None), None);
        assert_eq!(with_short_folders(r"C:\Users\a&b\nobi-hook.exe", |f| Some(f.to_string())), None);
        assert_eq!(with_short_folders("nobi-hook.exe", short), None);
    }

    /// hooks-settings#3: a file whose lines end in CRLF and LF alike is written
    /// with one of them throughout, and the diff shows every line that changes.
    #[test]
    fn a_line_ending_that_changes_shows_in_the_diff() {
        let before = "{\r\n  \"model\": \"opus\",\n  \"theme\": \"dark\"\n}\n";
        let current: Value = serde_json::from_str(before).unwrap();
        let next = merged(&current, &["Stop".to_string()]);
        let change =
            Change::new(PathBuf::from("settings.json"), Some(before.as_bytes().to_vec()), &current, &next, true, true);
        let after = String::from_utf8(change.after.clone()).unwrap();
        assert_eq!(after.matches("\r\n").count(), after.matches('\n').count(), "CRLF throughout");
        let diff = &change.diff;
        assert!(diff.starts_with("@@ "), "{diff}");
        assert!(diff.contains("CRLF"), "{diff}");
        assert!(diff.contains("-   \"model\": \"opus\",\n"), "{diff}");
        assert!(diff.contains("+   \"model\": \"opus\",\u{240D}\n"), "{diff}");
        assert!(diff.contains("-   \"theme\": \"dark\"\n"), "{diff}");
        // A file that is CRLF throughout stays CRLF and diffs as before.
        let uniform = before.replace("\r\n", "\n").replace('\n', "\r\n");
        let current: Value = serde_json::from_str(&uniform).unwrap();
        let next = merged(&current, &["Stop".to_string()]);
        let change =
            Change::new(PathBuf::from("settings.json"), Some(uniform.into_bytes()), &current, &next, true, true);
        assert!(!change.diff.contains('\u{240D}') && !change.diff.starts_with("@@"), "{}", change.diff);
        assert!(
            change.diff.contains("    \"theme\": \"dark\"") || change.diff.contains("  \"theme\""),
            "{}",
            change.diff
        );
        assert_eq!(unified_diff("a\r\nb\n", "a\r\nb\n"), if is_tr() { "Değişiklik yok." } else { "No change." });
    }

    #[test]
    fn values_of_another_shape_are_refused_never_overwritten() {
        let odd = json!({ "hooks": { "Stop": "keep this" } });
        assert!(with_events(&odd, &["Stop".to_string()]).is_err());
        // Not chosen: left as it is.
        assert_eq!(merged(&odd, &["PreToolUse".to_string()])["hooks"]["Stop"], "keep this");
        assert_eq!(without_ours(&odd).unwrap(), odd);
        let not_an_object = json!({ "hooks": "someone else's value" });
        assert!(with_events(&not_an_object, &all_events()).is_err());
        assert_eq!(without_ours(&not_an_object).unwrap(), not_an_object);
        // Nothing to add and nothing to take: an empty install leaves no `hooks: {}` behind.
        assert_eq!(merged(&json!({ "model": "x" }), &[]), json!({ "model": "x" }));
    }

    #[cfg(windows)]
    #[test]
    fn the_command_runs_in_git_bash_and_powershell() {
        assert_eq!(
            command_for(r"C:\Users\afrap\AppData\Local\Nobi\bin\nobi-hook.exe", "Stop"),
            "C:/Users/afrap/AppData/Local/Nobi/bin/nobi-hook.exe Stop"
        );
        // A path that does not exist has no short form; it gets Git Bash's quoting.
        assert_eq!(
            command_for(r"C:\Users\a b\NoSuchFolder\nobi-hook.exe", "Stop"),
            r"'C:/Users/a b/NoSuchFolder/nobi-hook.exe' Stop"
        );
        assert_eq!(
            command_for(r"C:\Users\ca$h\NoSuchFolder\nobi-hook.exe", "Stop"),
            r"'C:/Users/ca$h/NoSuchFolder/nobi-hook.exe' Stop"
        );
    }

    #[test]
    fn git_bash_quoting_keeps_dollars_and_backticks_literal() {
        // What the Windows fallback writes: single quotes, where Git Bash expands
        // nothing (double quotes would turn C:/Users/ca$h into C:/Users/ca).
        assert_eq!(
            single_quoted("C:/Users/ca$h/AppData/Local/Nobi/bin/nobi-hook.exe", "Stop"),
            "'C:/Users/ca$h/AppData/Local/Nobi/bin/nobi-hook.exe' Stop"
        );
        assert_eq!(single_quoted("C:/Users/a`b/x.exe", "Stop"), "'C:/Users/a`b/x.exe' Stop");
        assert!(runs_relay(&single_quoted("C:/Users/o'neil/AppData/Local/Nobi/bin/nobi-hook.exe", "Stop")));
    }

    #[test]
    fn a_bare_path_is_written_only_when_no_shell_reads_anything_in_it() {
        assert_eq!(
            bare_path(r"C:\Users\afrap\AppData\Local\Nobi\bin\nobi-hook.exe").as_deref(),
            Some("C:/Users/afrap/AppData/Local/Nobi/bin/nobi-hook.exe")
        );
        assert_eq!(bare_path(r"C:\Users\Şükrü\nobi-hook.exe").as_deref(), Some("C:/Users/Şükrü/nobi-hook.exe"));
        assert_eq!(bare_path(r"C:\Users\JOHNDO~1\nobi-hook.exe").as_deref(), Some("C:/Users/JOHNDO~1/nobi-hook.exe"));
        for odd in [
            r"C:\Users\a b\x.exe",
            r"C:\Users\o'neil\x.exe",
            r"C:\Users\a,b\x.exe",
            r"C:\Users\a$b\x.exe",
            r"C:\Users\a&b\x.exe",
            r"C:\Users\(x)\x.exe",
            r"C:\Users\a;b\x.exe",
            r"C:\Users\a`b\x.exe",
            r"C:\Users\a@b\x.exe",
            r"C:\Users\a#b\x.exe",
            "~/x.exe",
            "-x.exe",
            "",
        ] {
            assert_eq!(bare_path(odd), None, "{odd}");
        }
    }

    #[cfg(not(windows))]
    #[test]
    fn the_command_quotes_the_path_for_sh() {
        assert_eq!(
            command_for("/Users/a/Library/Application Support/Nobi/bin/nobi-hook", "Stop"),
            "'/Users/a/Library/Application Support/Nobi/bin/nobi-hook' Stop"
        );
        // A quote in the path cannot end the quoting early.
        assert_eq!(command_for("/Users/o'neil/nobi-hook", "Stop"), r"'/Users/o'\''neil/nobi-hook' Stop");
        assert!(!git_bash_only());
    }

    #[test]
    fn a_fingerprint_notices_any_change() {
        assert_eq!(fingerprint(b"{}"), fingerprint(b"{}"));
        assert_ne!(fingerprint(b"{}"), fingerprint(b"{ }"));
        assert_ne!(fingerprint(b""), fingerprint(b"{}"));
    }

    #[test]
    fn claude_config_dir_moves_the_settings_file_when_absolute() {
        let abs = std::env::temp_dir().join("claude-config");
        assert_eq!(claude_dir(Some(abs.clone().into_os_string())), abs);
        assert_eq!(claude_dir(Some("relative/dir".into())), crate::sys::home().join(".claude"));
        assert_eq!(claude_dir(Some("~/claude".into())), crate::sys::home().join(".claude"));
        assert_eq!(claude_dir(None), crate::sys::home().join(".claude"));
    }

    #[test]
    fn a_rewrite_keeps_the_files_own_layout() {
        let value = json!({ "model": "opus", "hooks": { "Stop": [] } });
        // Tabs, CRLF, a BOM and no final newline: all kept.
        let tabbed = "\u{FEFF}{\r\n\t\"model\": \"opus\"\r\n}".as_bytes();
        let layout = Layout::of(Some(tabbed));
        assert_eq!(layout, Layout { bom: true, crlf: true, indent: "\t".into(), final_newline: false });
        let out = String::from_utf8(layout.render(&value)).unwrap();
        assert_eq!(out, "\u{FEFF}{\r\n\t\"model\": \"opus\",\r\n\t\"hooks\": {\r\n\t\t\"Stop\": []\r\n\t}\r\n}");
        // Four spaces.
        let four = Layout::of(Some(b"{\n    \"a\": 1\n}\n"));
        assert_eq!(four.indent, "    ");
        assert!(four.final_newline && !four.crlf && !four.bom);
        // A new file, an empty one and a one-line one get two spaces.
        assert_eq!(Layout::of(None).indent, "  ");
        assert_eq!(Layout::of(Some(b"")).indent, "  ");
        assert_eq!(Layout::of(Some(br#"{"a":{"b":1}}"#)).indent, "  ");
    }

    #[test]
    fn the_diff_shows_what_a_rewrite_normalises() {
        // A duplicated key keeps only its last value once parsed; the diff is of
        // the text, so the line that disappears is shown.
        let before = "{\n  \"model\": \"sonnet\",\n  \"model\": \"opus\"\n}\n";
        let value = parse_settings(before.as_bytes(), WHERE).unwrap();
        let next = merged(&value, &["Stop".to_string()]);
        let change = Change::new(PathBuf::from("x/settings.json"), Some(before.into()), &value, &next, true, true);
        assert!(change.diff.contains("-   \"model\": \"sonnet\","), "{}", change.diff);
        assert!(change.diff.contains("+   \"hooks\": {"), "{}", change.diff);
        // Nothing to change: nothing rewritten, no backup, "No change."
        let same = Change::new(PathBuf::from("x/settings.json"), Some(before.into()), &value, &value, true, false);
        assert!(!same.changes());
        assert_eq!(same.backup, None);
        assert!(!same.diff.contains("\n+") && !same.diff.starts_with('+'));
    }

    #[test]
    fn a_huge_change_is_shown_without_a_huge_table() {
        let a: String = (0..3000).map(|i| format!("a{i}\n")).collect();
        let b: String = (0..3000).map(|i| format!("b{i}\n")).collect();
        let diff = unified_diff(&a, &b);
        assert_eq!(diff.lines().filter(|l| l.starts_with("- ")).count(), 3000);
        assert_eq!(diff.lines().filter(|l| l.starts_with("+ ")).count(), 3000);
        let small = unified_diff("a\nb\nc\n", "a\nx\nc\n");
        assert_eq!(small, "  a\n- b\n+ x\n  c\n");
    }

    /// Everything filesystem-shaped lives in one test on purpose: it points the
    /// home folder (USERPROFILE / HOME) at a temp directory, and that is
    /// process-wide.
    #[test]
    fn writing_backs_up_preserves_and_refuses_a_changed_file() {
        let home = TempHome::new("hooks");
        let tmp = home.dir.clone();
        std::fs::create_dir_all(tmp.join(".claude")).unwrap();

        let path = settings_path();
        assert!(path.starts_with(&tmp), "the test must not touch the real home");

        // Without the relay in place, an install is refused before anything is shown.
        assert!(!relay_ready());
        assert_eq!(preview(true, &all_events()).unwrap_err(), RELAY_MISSING);
        let relay = settings::hook_exe_path();
        assert!(relay.starts_with(&tmp));
        std::fs::create_dir_all(relay.parent().unwrap()).unwrap();
        std::fs::write(&relay, b"relay").unwrap();

        // A real-shaped file, written the way PowerShell 5 would: UTF-8 with BOM.
        let original = r#"{"model":"claude-opus-5","theme":"dark","tui":{"x":1},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"other-tool.exe"}]}]}}"#;
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(original.as_bytes());
        std::fs::write(&path, &bytes).unwrap();

        // Install.
        let plan = preview(true, &all_events()).expect("a BOM must not stop the preview");
        assert!(plan.diff.contains("nobi-hook"), "the diff must show what changes");
        let shown_backup = plan.backup.clone().expect("there is a file to back up");
        assert_eq!(apply(false, &plan.fingerprint).unwrap_err(), STALE, "a preview applies only to its direction");
        let backup = apply(true, &plan.fingerprint).expect("install should succeed").expect("a backup");
        assert_eq!(apply(true, &plan.fingerprint).unwrap_err(), STALE, "a preview is written once");
        assert!(
            backup == shown_backup || backup.starts_with(&shown_backup),
            "the backup is the one the preview named ({shown_backup} vs {backup})"
        );

        // The backup holds the original bytes, BOM and all.
        assert_eq!(std::fs::read(&backup).unwrap(), bytes);

        // Everything else survived, and so did the other tool's hook; the BOM too.
        let written = std::fs::read(&path).unwrap();
        assert!(written.starts_with(&[0xEF, 0xBB, 0xBF]), "the file keeps its BOM");
        let after = parse_settings(&written, WHERE).unwrap();
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["tui"]["x"], 1);
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other-tool.exe")));
        assert!(status().installed);

        // What is written is what was previewed, even if the chosen events
        // change between the preview and the click.
        let only_stop = preview(true, &["Stop".to_string()]).unwrap();
        let _later = preview(true, &all_events()).unwrap();
        apply(true, &only_stop.fingerprint).unwrap();
        assert_eq!(status().events, ["Stop"]);

        // A file that moved since the preview is refused, and left alone.
        let stale = preview(false, &[]).unwrap();
        std::fs::write(&path, br#"{"model":"someone-else-edited-this"}"#).unwrap();
        assert_eq!(apply(false, &stale.fingerprint).unwrap_err(), STALE);
        let untouched: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(untouched["model"], "someone-else-edited-this");
        assert_eq!(apply(true, "never-previewed").unwrap_err(), STALE);

        // No file yet: nothing to back up, and the preview says so.
        std::fs::remove_file(&path).unwrap();
        let fresh = preview(true, &all_events()).unwrap();
        assert_eq!(fresh.backup, None);
        assert_eq!(apply(true, &fresh.fingerprint).unwrap(), None);
        assert!(status().installed);

        // The uninstall path: ours out, theirs kept, a backup made.
        let mut value: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        value["hooks"]["Stop"][0]["hooks"]
            .as_array_mut()
            .unwrap()
            .push(json!({ "type": "command", "command": "~/bin/notify-done.sh" }));
        std::fs::write(&path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
        let removed = remove_for_uninstall().unwrap().expect("a backup");
        assert!(Path::new(&removed).exists());
        let left: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(installed_events(&left).0.is_empty());
        assert_eq!(
            left["hooks"]["Stop"][0]["hooks"],
            json!([{ "type": "command", "command": "~/bin/notify-done.sh" }])
        );
        assert_eq!(remove_for_uninstall().unwrap(), None, "nothing of ours left: nothing written");

        // A symlinked settings.json stays a link; the file it names gets the hooks.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dotfiles = tmp.join("dotfiles");
            std::fs::create_dir_all(&dotfiles).unwrap();
            let real = dotfiles.join("claude-settings.json");
            std::fs::write(&real, b"{\n  \"model\": \"opus\"\n}\n").unwrap();
            std::fs::set_permissions(&real, std::fs::Permissions::from_mode(0o644)).unwrap();
            std::fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink(&real, &path).unwrap();
            let plan = preview(true, &["Stop".to_string()]).unwrap();
            apply(true, &plan.fingerprint).unwrap();
            assert!(std::fs::symlink_metadata(&path).unwrap().file_type().is_symlink(), "still a link");
            assert!(String::from_utf8(std::fs::read(&real).unwrap()).unwrap().contains("nobi-hook"));
            assert_eq!(std::fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o644, "mode kept");
            assert_eq!(std::fs::read_dir(&dotfiles).unwrap().count(), 1, "no temporary file left there");
            std::fs::remove_file(&path).unwrap();
        }

        // Content we cannot parse is refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(preview(true, &all_events()).is_err());
        assert!(remove_for_uninstall().is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");
        drop(home);
    }

    #[test]
    fn an_old_pre_tool_use_timeout_counts_as_stale() {
        let _home = home_lock();
        let fresh = json!({ "hooks": [{ "type": "command", "command": hook_command("PreToolUse"), "timeout": 120 }] });
        assert!(!entry_is_stale("PreToolUse", &fresh));
        let old = json!({ "hooks": [{ "type": "command", "command": hook_command("PreToolUse"), "timeout": 10 }] });
        assert!(entry_is_stale("PreToolUse", &old), "the desktop app's approvals need the long timeout");
        let moved = json!({ "hooks": [{ "type": "command", "command": "C:/old/nobi-hook.exe Stop", "timeout": 10 }] });
        assert!(entry_is_stale("Stop", &moved));
    }

    #[test]
    fn the_status_line_is_taken_only_when_free_and_given_back_only_when_ours() {
        let _home = home_lock();
        let events = vec!["Stop".to_string(), STATUS_LINE.to_string()];
        let free = merged(&json!({}), &events);
        assert_eq!(free["statusLine"], status_line_entry());
        assert_eq!(status_line_owner(&free), StatusLineOwner::Ours);
        // Unticked: ours goes away.
        let off = merged(&free, &["Stop".to_string()]);
        assert!(off.get("statusLine").is_none());
        // Somebody else's is never replaced or removed.
        let theirs = json!({ "statusLine": { "type": "command", "command": "~/bin/my-line.sh" } });
        assert_eq!(merged(&theirs, &events)["statusLine"], theirs["statusLine"]);
        assert_eq!(without_ours(&theirs).unwrap()["statusLine"], theirs["statusLine"]);
        assert!(without_ours(&free).unwrap().get("statusLine").is_none());
        // Nor one that merely mentions the relay.
        let wrapper = json!({ "statusLine": { "type": "command", "command": "~/bin/wrap-nobi-hook.sh" } });
        assert_eq!(status_line_owner(&wrapper), StatusLineOwner::Theirs);
    }
}
