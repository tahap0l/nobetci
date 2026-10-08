// Claude Code hook installation.
//
// The rule from CLAUDE.md is strict and is followed to the letter:
// read ~/.claude/settings.json, take a dated backup, merge without touching
// anybody else's hooks, show the diff, and write only after an explicit click.
// Uninstall removes Nöbetçi's entries and nothing else.
//
// The command is only the quoted relay path plus the event name. On Windows
// Claude Code runs hook commands through Git Bash, so the path uses forward
// slashes and anything with PowerShell or cmd in it breaks; on macOS it runs
// them through sh, and the path ("Application Support") has a space in it.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};

use crate::i18n::is_tr;
use crate::settings;

/// Every event the island reacts to, with the hook timeout written to settings.json.
/// PermissionRequest waits for a human, so it gets the decision timeout + 10 s.
pub const HOOK_EVENTS: &[(&str, u64)] = &[
    ("SessionStart", 10),
    ("SessionEnd", 10),
    ("UserPromptSubmit", 10),
    ("PreToolUse", 10),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("PermissionRequest", 120),
    ("Notification", 10),
    ("Stop", 10),
    ("StopFailure", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
];

/// Marker that identifies a Nöbetçi entry inside settings.json.
const MARKER: &str = "nobetci-hook";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    pub settings_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
    /// Events that currently have a Nöbetçi entry.
    pub events: Vec<String>,
    /// Some entry points at a different relay path (an older install location).
    pub stale: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPreview {
    pub diff: String,
    pub backup: String,
    pub settings_path: String,
    /// Identifies the bytes this diff was computed from; handed back to `write`
    /// so we only ever apply what the user actually looked at.
    pub fingerprint: String,
}

pub fn settings_path() -> PathBuf {
    crate::sys::home().join(".claude").join("settings.json")
}

/// Reads `~/.claude/settings.json`.
///
/// The only error that means "start from nothing" is the file not being there.
/// Everything else — a lock held by another process, a permission problem, JSON
/// we cannot parse — is reported, because the alternative is treating somebody's
/// unreadable settings as an empty object and then writing that back over them.
fn read_settings() -> Result<Value, String> {
    let path = settings_path();
    match std::fs::read(&path) {
        Ok(bytes) => parse_settings(&bytes, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        // A lock, a permission problem, a bad drive: all of them mean we do not
        // know what is in there, and not knowing is not the same as empty.
        Err(err) if is_tr() => Err(format!("{} okunamadı: {err}", path.display())),
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

/// The parsing half of `read_settings`, split out so it can be tested without a
/// home directory.
fn parse_settings(bytes: &[u8], path: &str) -> Result<Value, String> {
    // PowerShell writes a UTF-8 BOM with `Set-Content -Encoding utf8`, and
    // serde_json refuses it. Stripping it is safe and well defined; guessing at
    // anything else is not.
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) if is_tr() => Err(format!("{path} bir JSON nesnesi değil — Nöbetçi dokunmayacak.")),
        Ok(_) => Err(format!("{path} isn't a JSON object — Nöbetçi won't touch it.")),
        Err(err) if is_tr() => Err(format!(
            "{path} geçerli bir JSON değil ({err}). Düzeltip ya da taşıyıp tekrar dene — Nöbetçi üzerine yazmayacak."
        )),
        Err(err) => Err(format!(
            "{path} isn't valid JSON ({err}). Fix or move it, then try again — Nöbetçi won't overwrite it."
        )),
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

/// Git Bash on Windows: forward slashes in double quotes.
#[cfg(windows)]
fn command_for(exe: &str, event: &str) -> String {
    format!("\"{}\" {event}", exe.replace('\\', "/"))
}

/// sh on macOS: single quotes, so nothing in the path is ever read as syntax.
#[cfg(not(windows))]
fn command_for(exe: &str, event: &str) -> String {
    format!("'{}' {event}", exe.replace('\'', r"'\''"))
}

fn entry_is_ours(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| h.get("command").and_then(Value::as_str).map(|c| c.contains(MARKER)).unwrap_or(false))
        })
        .unwrap_or(false)
}

/// Settings with Nöbetçi's hooks for exactly `events`; our entries for any other
/// event are removed, and nothing that is not ours is touched.
fn merged(existing: &Value, events: &[String]) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = root.get("hooks").and_then(Value::as_object).cloned().unwrap_or_else(Map::new);

    for (event, timeout) in HOOK_EVENTS {
        let mut list = hooks.get(*event).and_then(Value::as_array).cloned().unwrap_or_default();
        list.retain(|entry| !entry_is_ours(entry));
        if events.iter().any(|e| e == event) {
            list.push(json!({
                "hooks": [{
                    "type": "command",
                    "command": hook_command(event),
                    "timeout": timeout,
                }]
            }));
        }
        if list.is_empty() {
            hooks.remove(*event);
        } else {
            hooks.insert((*event).to_string(), Value::Array(list));
        }
    }

    root.insert("hooks".into(), Value::Object(hooks));
    Value::Object(root)
}

/// Settings with every Nöbetçi entry removed, and nothing else changed.
fn without_ours(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let Some(hooks) = root.get("hooks").and_then(Value::as_object).cloned() else {
        return Value::Object(root);
    };
    let mut out = Map::new();
    for (event, value) in hooks {
        match value.as_array() {
            Some(list) => {
                let kept: Vec<Value> = list.iter().filter(|e| !entry_is_ours(e)).cloned().collect();
                if !kept.is_empty() {
                    out.insert(event, Value::Array(kept));
                }
            }
            None => {
                out.insert(event, value);
            }
        }
    }
    if out.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(out));
    }
    Value::Object(root)
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

/// Down to the second: installing then uninstalling in the same minute must not
/// quietly overwrite the first backup.
fn stamp() -> String {
    crate::sys::local_time().compact()
}

fn backup_path() -> PathBuf {
    let p = settings_path();
    p.with_file_name(format!("settings.json.bak-{}", stamp()))
}

/// Identifies the exact bytes a preview was computed from. FNV-1a is plenty:
/// the question is only "is this still the file I showed the user?".
fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn current_fingerprint() -> String {
    match std::fs::read(settings_path()) {
        Ok(bytes) => fingerprint(&bytes),
        Err(_) => fingerprint(b""),
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn status() -> HookStatus {
    let current = read_settings_lossy();
    let mut events = Vec::new();
    let mut stale = false;
    if let Some(hooks) = current.get("hooks").and_then(Value::as_object) {
        for (event, list) in hooks {
            let ours: Vec<&Value> = list.as_array().into_iter().flatten().filter(|e| entry_is_ours(e)).collect();
            if ours.is_empty() {
                continue;
            }
            events.push(event.clone());
            let expected = hook_command(event);
            stale |= ours.iter().any(|e| {
                e.get("hooks")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|h| h.get("command").and_then(Value::as_str))
                    .filter(|c| c.contains(MARKER))
                    .any(|c| c != expected)
            });
        }
    }
    let hook_path = settings::hook_exe_path();
    HookStatus {
        installed: !events.is_empty(),
        settings_path: settings_path().to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
        events,
        stale,
    }
}

pub fn preview(install: bool, events: &[String]) -> Result<HookPreview, String> {
    let current = read_settings()?;
    let next = if install { merged(&current, events) } else { without_ours(&current) };
    Ok(HookPreview {
        diff: unified_diff(&pretty(&current), &pretty(&next)),
        backup: backup_path().to_string_lossy().to_string(),
        settings_path: settings_path().to_string_lossy().to_string(),
        fingerprint: current_fingerprint(),
    })
}

/// Writes the merged (or cleaned) settings after taking a dated backup.
///
/// `fingerprint` is the one the preview was computed from. If the file changed
/// in between — another tool, another window, the user's own editor — we stop
/// and make them look at a fresh diff, because the only thing worse than not
/// installing the hooks is silently reverting somebody else's edit.
pub fn write(install: bool, fingerprint: &str, events: &[String]) -> Result<String, String> {
    let path = settings_path();
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // Read before the backup: an unreadable file must abort before we touch
    // anything at all.
    let current = read_settings()?;
    if current_fingerprint() != fingerprint {
        return Err(if is_tr() {
            format!("{} önizlemeden sonra değişti. Hiçbir şey yazılmadı — yeni farkı incele.", path.display())
        } else {
            format!("{} changed since the preview. Nothing was written — review the new diff.", path.display())
        });
    }
    replace_with(&path, &current, install, events)
}

/// Removes every Nöbetçi entry, with a dated backup — no preview. Only for the
/// uninstaller: the user asked for Nöbetçi to go, and hooks pointing at a relay
/// that no longer exists would make Claude Code report an error on every event.
pub fn remove_for_uninstall() -> Result<Option<String>, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(None);
    }
    let current = read_settings()?;
    if !status().installed {
        return Ok(None);
    }
    replace_with(&path, &current, false, &[]).map(Some)
}

/// Backs up `path`, then writes `current` with our hooks added or removed.
fn replace_with(path: &Path, current: &Value, install: bool, events: &[String]) -> Result<String, String> {
    let backup = backup_path();
    if path.exists() {
        std::fs::copy(path, &backup).map_err(|e| {
            if is_tr() {
                format!("yedek alınamadı: {e}")
            } else {
                format!("backup failed: {e}")
            }
        })?;
    }

    let next = if install { merged(current, events) } else { without_ours(current) };
    let mut text = pretty(&next);
    text.push('\n');

    // Write beside the target and rename over it: a crash or a full disk leaves
    // the original settings.json intact rather than half a file.
    let temp = path.with_extension(format!("json.nobetci-{}", std::process::id()));
    let failed = |e: std::io::Error| if is_tr() { format!("yazılamadı: {e}") } else { format!("write failed: {e}") };
    std::fs::write(&temp, text.as_bytes()).map_err(failed)?;
    if let Err(err) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(failed(err));
    }
    Ok(backup.to_string_lossy().to_string())
}

/// Copies the relay (nobetci-hook) into Nöbetçi's data folder on launch:
/// %LOCALAPPDATA%\Nobetci\bin on Windows, ~/Library/Application Support/Nobetci/bin
/// on macOS. In a bundled install it comes from the app resources; in `tauri dev`
/// it sits next to the app in the workspace target directory.
///
/// Every candidate is tried rather than just the first, because getting this
/// wrong is silent and fatal: `resources` used to be a glob, which made NSIS
/// mirror the source path into `_up_\target\release\`, no candidate matched, and
/// the relay was simply never installed. It only looked healthy on a developer
/// machine, where a leftover copy from `tauri dev` was already sitting in bin/.
pub fn ensure_hook_exe(app: &AppHandle) {
    let dest = settings::hook_exe_path();
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
            crate::log::line(format!("could not install nobetci-hook.exe: {err}"));
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
        crate::log::line(format!("could not install nobetci-hook: {err}"));
    }
}

// ── Minimal unified diff (LCS) ────────────────────────────────────────────────

/// settings.json is short, so a plain O(n·m) LCS is the simplest honest diff.
fn unified_diff(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let (n, m) = (a.len(), b.len());

    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] { lcs[i + 1][j + 1] + 1 } else { lcs[i + 1][j].max(lcs[i][j + 1]) };
        }
    }

    let mut out: Vec<String> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if a[i] == b[j] {
            out.push(format!("  {}", a[i]));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            out.push(format!("- {}", a[i]));
            i += 1;
        } else {
            out.push(format!("+ {}", b[j]));
            j += 1;
        }
    }
    while i < n {
        out.push(format!("- {}", a[i]));
        i += 1;
    }
    while j < m {
        out.push(format!("+ {}", b[j]));
        j += 1;
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn all_events() -> Vec<String> {
        HOOK_EVENTS.iter().map(|(e, _)| e.to_string()).collect()
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
        // file containing nothing but Nöbetçi's hooks, and the write replaced
        // everything the user had.
        for bad in [&b"{ not json"[..], &b"[1,2,3]"[..], &b"\"a string\""[..]] {
            assert!(parse_settings(bad, WHERE).is_err(), "content we cannot use must refuse, not come back empty");
        }
    }

    #[test]
    fn empty_and_whitespace_files_start_from_nothing() {
        assert_eq!(parse_settings(b"", WHERE).unwrap(), json!({}));
        assert_eq!(
            parse_settings(
                b"  
	 ", WHERE
            )
            .unwrap(),
            json!({})
        );
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

        // And removing ours puts it back exactly as it was.
        let cleaned = without_ours(&after);
        assert_eq!(cleaned, existing);
    }

    #[cfg(windows)]
    #[test]
    fn the_command_suits_git_bash() {
        assert_eq!(
            command_for(r"C:\Users\a b\AppData\Local\Nobetci\bin\nobetci-hook.exe", "Stop"),
            r#""C:/Users/a b/AppData/Local/Nobetci/bin/nobetci-hook.exe" Stop"#
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn the_command_quotes_the_path_for_sh() {
        assert_eq!(
            command_for("/Users/a/Library/Application Support/Nobetci/bin/nobetci-hook", "Stop"),
            "'/Users/a/Library/Application Support/Nobetci/bin/nobetci-hook' Stop"
        );
        // A quote in the path cannot end the quoting early.
        assert_eq!(command_for("/Users/o'neil/nobetci-hook", "Stop"), r"'/Users/o'\''neil/nobetci-hook' Stop");
    }

    #[test]
    fn a_fingerprint_notices_any_change() {
        assert_eq!(fingerprint(b"{}"), fingerprint(b"{}"));
        assert_ne!(fingerprint(b"{}"), fingerprint(b"{ }"));
        assert_ne!(fingerprint(b""), fingerprint(b"{}"));
    }

    /// Everything filesystem-shaped lives in one test on purpose: it points the
    /// home folder (USERPROFILE / HOME) at a temp directory, and that is
    /// process-wide.
    #[test]
    fn writing_backs_up_preserves_and_refuses_a_changed_file() {
        let tmp = std::env::temp_dir().join(format!("nobetci-hooks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".claude")).unwrap();
        std::env::set_var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }, &tmp);

        let path = settings_path();
        assert!(path.starts_with(&tmp), "the test must not touch the real home");

        // A real-shaped file, written the way PowerShell 5 would: UTF-8 with BOM.
        let original = r#"{"model":"claude-opus-5","theme":"dark","tui":{"x":1},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"other-tool.exe"}]}]}}"#;
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(original.as_bytes());
        std::fs::write(&path, &bytes).unwrap();

        // Install.
        let plan = preview(true, &all_events()).expect("a BOM must not stop the preview");
        assert!(plan.diff.contains("nobetci-hook"), "the diff must show what changes");
        let backup = write(true, &plan.fingerprint, &all_events()).expect("install should succeed");

        // The backup holds the original bytes, BOM and all.
        assert_eq!(std::fs::read(&backup).unwrap(), bytes);

        // Everything else survived, and so did the other tool's hook.
        let after: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["tui"]["x"], 1);
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other-tool.exe")));
        assert!(status().installed);

        // A file that moved since the preview is refused, and left alone.
        let stale = preview(false, &[]).unwrap();
        std::fs::write(&path, br#"{"model":"someone-else-edited-this"}"#).unwrap();
        let err = write(false, &stale.fingerprint, &[]).unwrap_err();
        assert!(err.contains("önizlemeden sonra değişti") || err.contains("changed since the preview"), "got: {err}");
        let untouched: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(untouched["model"], "someone-else-edited-this");

        // Content we cannot parse is refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(preview(true, &all_events()).is_err());
        assert!(write(true, "whatever", &all_events()).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
