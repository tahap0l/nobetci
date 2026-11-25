// User-level hook installation for Codex and Cursor. Like Claude's installer,
// this previews a merge in the file's own layout, backs up the original and
// writes exactly the previewed bytes, only while the file still holds what the
// preview was made from, so unrelated settings are never silently overwritten.
// Removing takes out Nobi's own commands and nothing else.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::hooks::{self, Change};
use crate::i18n::is_tr;
use crate::settings;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Cursor,
}

impl Provider {
    pub fn name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Cursor => "cursor",
        }
    }

    pub(crate) fn events(self) -> &'static [(&'static str, u64)] {
        match self {
            Self::Codex => &[
                ("SessionStart", 10),
                ("SessionEnd", 3),
                ("UserPromptSubmit", 10),
                ("PreToolUse", 10),
                ("PostToolUse", 10),
                ("PreCompact", 10),
                ("PostCompact", 10),
                ("PermissionRequest", 120),
                ("Stop", 10),
                ("SubagentStart", 10),
                ("SubagentStop", 10),
            ],
            Self::Cursor => &[
                ("sessionStart", 10),
                ("sessionEnd", 10),
                ("beforeSubmitPrompt", 10),
                ("beforeShellExecution", 120),
                ("beforeMCPExecution", 120),
                ("afterShellExecution", 10),
                ("afterMCPExecution", 10),
                ("afterAgentResponse", 10),
            ],
        }
    }

    fn settings_path(self) -> PathBuf {
        if self == Self::Codex {
            if let Some(home) = std::env::var_os("CODEX_HOME").filter(|path| Path::new(path).is_absolute()) {
                return PathBuf::from(home).join("hooks.json");
            }
        }
        let dir = match self {
            Self::Codex => ".codex",
            Self::Cursor => ".cursor",
        };
        crate::sys::home().join(dir).join("hooks.json")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub provider: Provider,
    pub installed: bool,
    pub settings_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
    pub events: Vec<String>,
    pub stale: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub diff: String,
    /// Where the current file is copied before the write; null when there is no file yet.
    pub backup: Option<String>,
    pub settings_path: String,
    /// Names this exact preview: `apply` writes what it showed, or nothing.
    pub fingerprint: String,
}

fn command(provider: Provider, event: &str) -> String {
    let path = settings::hook_exe_path();
    let exe = path.to_string_lossy();
    #[cfg(windows)]
    let quoted = match provider {
        // Codex executes hooks through PowerShell on native Windows. A
        // quoted path by itself is a string expression, not a command.
        Provider::Codex => format!("& '{}'", exe.replace('\'', "''")),
        Provider::Cursor => format!("\"{}\"", exe.replace('\\', "/")),
    };
    #[cfg(not(windows))]
    let quoted = format!("'{}'", exe.replace('\'', r"'\''"));
    format!("{quoted} {} {event}", provider.name())
}

/// The hooks of one entry: a Codex matcher group's `hooks`, or Cursor's entry itself.
fn hooks_of(provider: Provider, entry: &Value) -> &[Value] {
    match provider {
        Provider::Codex => entry.get("hooks").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default(),
        Provider::Cursor => std::slice::from_ref(entry),
    }
}

fn entry_is_ours(provider: Provider, event: &str, entry: &Value) -> bool {
    hooks_of(provider, entry).iter().any(|hook| hook_is_ours(provider, event, hook))
}

/// Runs the relay (see `hooks::runs_relay`) for this agent and event.
fn hook_is_ours(provider: Provider, event: &str, hook: &Value) -> bool {
    hook.get("command").and_then(Value::as_str).is_some_and(|command| {
        hooks::runs_relay(command) && command.ends_with(&format!(" {} {event}", provider.name()))
    })
}

fn hook_is_stale(provider: Provider, event: &str, hook: &Value) -> bool {
    hook_is_ours(provider, event, hook)
        && (hook["command"].as_str() != Some(command(provider, event).as_str())
            || hook["timeout"].as_u64()
                != provider.events().iter().find_map(|(name, timeout)| (*name == event).then_some(*timeout)))
}

/// `list` without Nobi's commands; None when none was there. A Codex group
/// loses only our commands, and goes only when nothing else was in it.
fn strip_ours(provider: Provider, event: &str, list: &[Value]) -> Option<Vec<Value>> {
    let mut found = false;
    let kept = list
        .iter()
        .filter_map(|entry| match provider {
            Provider::Codex => {
                let Some(hooks) = entry.get("hooks").and_then(Value::as_array) else { return Some(entry.clone()) };
                let others: Vec<Value> = hooks.iter().filter(|h| !hook_is_ours(provider, event, h)).cloned().collect();
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
            }
            Provider::Cursor if hook_is_ours(provider, event, entry) => {
                found = true;
                None
            }
            Provider::Cursor => Some(entry.clone()),
        })
        .collect();
    found.then_some(kept)
}

/// The file with Nobi's entries for every event (`install`) or none. Other
/// entries stay where they are, keys keep their order, and a value that is not
/// the shape we would write into is refused, never overwritten.
fn merged(provider: Provider, existing: &Value, install: bool) -> Result<Value, String> {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let original = match root.get("hooks") {
        Some(Value::Object(map)) => Some(map.clone()),
        None | Some(Value::Null) => None,
        // Somebody else's value; none of ours can be in it.
        Some(_) if !install => return Ok(existing.clone()),
        Some(_) => {
            return Err(if is_tr() {
                "hooks ayarı bir JSON nesnesi değil — Nobi dokunmayacak.".into()
            } else {
                "The hooks setting isn't a JSON object — Nobi won't touch it.".into()
            })
        }
    };
    let mut hooks = original.clone().unwrap_or_default();
    let mut touched: Vec<String> = Vec::new();
    let names: Vec<String> = hooks.keys().cloned().collect();
    for name in names {
        let stripped = hooks.get(&name).and_then(Value::as_array).and_then(|list| strip_ours(provider, &name, list));
        if let Some(list) = stripped {
            hooks.insert(name.clone(), Value::Array(list));
            touched.push(name);
        }
    }
    if install {
        for (event, timeout) in provider.events() {
            let entry = match provider {
                Provider::Codex => json!({
                    "hooks": [{ "type": "command", "command": command(provider, event), "timeout": timeout }]
                }),
                Provider::Cursor => json!({
                    "command": command(provider, event),
                    "timeout": timeout,
                    // Permission hooks must never silently run the tool if the
                    // relay crashes or times out: they stay fail-closed. Whenever
                    // Nobi gives no decision (closed, paused, handed back,
                    // timed out, input it could not read) the relay answers
                    // `ask`, so Cursor asks the user itself instead of blocking.
                    "failClosed": *timeout == 120
                }),
            };
            match hooks.get_mut(*event) {
                Some(Value::Array(list)) => list.push(entry),
                None | Some(Value::Null) => {
                    hooks.insert((*event).to_string(), Value::Array(vec![entry]));
                }
                Some(_) => {
                    return Err(if is_tr() {
                        format!("hooks.{event} bir liste değil — Nobi bu ayarı ezmeyecek.")
                    } else {
                        format!("hooks.{event} isn't a list — Nobi won't overwrite it.")
                    });
                }
            }
            touched.push((*event).to_string());
        }
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
    if install && provider == Provider::Cursor {
        root.entry("version").or_insert(json!(1));
    }
    Ok(Value::Object(root))
}

fn parse(bytes: &[u8], path: &str) -> Result<Value, String> {
    let text = settings::strip_bom(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) if is_tr() => Err(format!("{path} bir JSON nesnesi değil — Nobi dokunmayacak.")),
        Ok(_) => Err(format!("{path} isn't a JSON object — Nobi won't touch it.")),
        Err(err) if is_tr() => Err(format!("{path} geçerli JSON değil ({err}) — Nobi üzerine yazmayacak.")),
        Err(err) => Err(format!("{path} isn't valid JSON ({err}) — Nobi won't overwrite it.")),
    }
}

fn snapshot(path: &Path) -> Result<(Value, Option<Vec<u8>>), String> {
    let bytes = hooks::settings_bytes(path)?;
    let value = parse(bytes.as_deref().unwrap_or_default(), &path.display().to_string())?;
    Ok((value, bytes))
}

/// The events of `settings` with an entry of ours, and whether one is stale.
fn installed_events(provider: Provider, settings: &Value) -> (Vec<String>, bool) {
    let mut events = Vec::new();
    let mut stale = false;
    if let Some(hooks) = settings.get("hooks").and_then(Value::as_object) {
        for (event, list) in hooks {
            let ours: Vec<&Value> =
                list.as_array().into_iter().flatten().filter(|entry| entry_is_ours(provider, event, entry)).collect();
            if ours.is_empty() {
                continue;
            }
            events.push(event.clone());
            stale |= ours
                .iter()
                .any(|entry| hooks_of(provider, entry).iter().any(|hook| hook_is_stale(provider, event, hook)));
        }
    }
    (events, stale)
}

pub fn status(provider: Provider) -> Status {
    let current = snapshot(&provider.settings_path()).map(|(value, _)| value).unwrap_or_else(|_| json!({}));
    let (events, mut stale) = installed_events(provider, &current);
    if !events.is_empty() {
        stale |=
            provider.events().iter().any(|(event, _)| !events.iter().any(|installed| installed.as_str() == *event));
    }
    let hook_path = settings::hook_exe_path();
    Status {
        provider,
        installed: !events.is_empty(),
        settings_path: provider.settings_path().to_string_lossy().to_string(),
        hook_path: hook_path.to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        events,
        stale,
    }
}

fn prepare(provider: Provider, install: bool) -> Result<Change, String> {
    let path = provider.settings_path();
    let (current, before) = snapshot(&path)?;
    let next = merged(provider, &current, install)?;
    let needs_relay = !installed_events(provider, &next).0.is_empty();
    Ok(Change::new(path, before, &current, &next, install, needs_relay))
}

/// The diff to review before anything is written, remembered with the exact
/// bytes it would write.
pub fn preview(provider: Provider, install: bool) -> Result<Preview, String> {
    let change = prepare(provider, install)?;
    if change.needs_relay && !hooks::relay_ready() {
        return Err(hooks::RELAY_MISSING.into());
    }
    let (diff, backup, settings_path) = (change.diff.clone(), change.backup_text(), change.path_text());
    let fingerprint = hooks::remember(change);
    Ok(Preview { diff, backup, settings_path, fingerprint })
}

/// Writes exactly what the preview `fingerprint` showed (`stale_preview` when
/// the file changed since); returns the backup path, None when there was no file.
pub fn apply(provider: Provider, install: bool, fingerprint: &str) -> Result<Option<String>, String> {
    hooks::apply_reviewed(fingerprint, install, &provider.settings_path())
}

/// Removes every Nobi entry without a preview (the uninstaller). None when
/// there was nothing of ours.
pub fn remove_for_uninstall(provider: Provider) -> Result<Option<String>, String> {
    let change = prepare(provider, false)?;
    hooks::write_change(&change)
        .map(|kept| kept.map(|p| p.to_string_lossy().into_owned()))
        .map_err(|e| e.describe(&change.path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_merge_keeps_other_hooks_and_installs_prompt_and_permission_events() {
        let existing =
            json!({"notify": ["keep"], "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "other"}]}]}});
        let result = merged(Provider::Codex, &existing, true).unwrap();
        assert_eq!(result["notify"][0], "keep");
        assert_eq!(result["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert!(result["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"].as_str().unwrap().contains("codex"));
        assert!(result["hooks"]["PermissionRequest"].is_array());
    }

    #[test]
    fn codex_session_end_repair_detects_old_timeout_and_keeps_sibling_hooks() {
        let _home = hooks::home_lock();
        let old = json!({"command": command(Provider::Codex, "SessionEnd"), "timeout": 10});
        let foreign = json!({"command": "other"});
        assert!(hook_is_stale(Provider::Codex, "SessionEnd", &old));
        let existing = json!({"hooks": {"SessionEnd": [{"matcher": "*", "hooks": [old, foreign.clone()]}]}});
        let result = merged(Provider::Codex, &existing, true).unwrap();
        assert_eq!(result["hooks"]["SessionEnd"][0]["hooks"], json!([foreign]));
        assert_eq!(result["hooks"]["SessionEnd"][0]["matcher"], "*");
        let repaired = &result["hooks"]["SessionEnd"][1]["hooks"][0];
        assert_eq!(repaired["timeout"], 3);
        assert!(!hook_is_stale(Provider::Codex, "SessionEnd", repaired));
        // Removal keeps the sibling, in its group.
        let removed = merged(Provider::Codex, &result, false).unwrap();
        assert_eq!(removed["hooks"]["SessionEnd"], json!([{"matcher": "*", "hooks": [foreign]}]));
    }

    #[cfg(windows)]
    #[test]
    fn codex_repair_replaces_the_legacy_windows_command() {
        let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
        let old = json!({ "type": "command", "command": format!("\"{exe}\" codex Stop"), "timeout": 10 });
        assert!(hook_is_stale(Provider::Codex, "Stop", &old));
        let existing = json!({ "hooks": { "Stop": [{ "hooks": [old] }] } });
        let repaired = merged(Provider::Codex, &existing, true).unwrap();
        let hooks = repaired["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(hooks.len(), 1);
        let command = hooks[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(command.starts_with("& '"));
        assert!(command.ends_with("' codex Stop"));
        assert_eq!(merged(Provider::Codex, &repaired, true).unwrap(), repaired);
    }

    #[test]
    fn cursor_merge_preserves_foreign_hooks_and_sets_schema_version() {
        let existing = json!({"version": 1, "hooks": {"stop": [{"command": "other"}]}});
        let result = merged(Provider::Cursor, &existing, true).unwrap();
        assert_eq!(result["hooks"]["stop"].as_array().unwrap().len(), 1);
        assert!(result["hooks"]["beforeSubmitPrompt"][0]["command"].as_str().unwrap().contains("cursor"));
        assert_eq!(result["hooks"]["beforeShellExecution"][0]["failClosed"], true);
        assert_eq!(result["hooks"]["beforeSubmitPrompt"][0]["failClosed"], false);
        assert_eq!(result["version"], 1);
    }

    #[test]
    fn remove_only_drops_nobi_events() {
        let installed = merged(Provider::Cursor, &json!({"hooks":{"stop":[{"command":"other"}]}}), true).unwrap();
        let removed = merged(Provider::Cursor, &installed, false).unwrap();
        assert_eq!(removed["hooks"]["stop"].as_array().unwrap().len(), 1);
        assert!(removed["hooks"]["beforeSubmitPrompt"].is_null());
    }

    #[test]
    fn removal_keeps_key_order_and_foreign_commands_that_mention_the_relay() {
        let start =
            json!({ "a": 1, "hooks": { "stop": [{ "command": "~/bin/nobi-hook-log.sh cursor stop" }] }, "z": 2 });
        let installed = merged(Provider::Cursor, &start, true).unwrap();
        let removed = merged(Provider::Cursor, &installed, false).unwrap();
        // The same text: key order included, and the look-alike command kept.
        assert_eq!(
            serde_json::to_string(&removed).unwrap(),
            serde_json::to_string(&json!({
                "a": 1,
                "hooks": { "stop": [{ "command": "~/bin/nobi-hook-log.sh cursor stop" }] },
                "z": 2,
                "version": 1
            }))
            .unwrap()
        );
        // A file with nothing of ours is left exactly as it is, no "version" added.
        let theirs = json!({ "hooks": { "stop": [{ "command": "other" }] } });
        assert_eq!(merged(Provider::Cursor, &theirs, false).unwrap(), theirs);
        assert!(merged(Provider::Cursor, &theirs, false).unwrap().get("version").is_none());
    }

    #[test]
    fn invalid_hook_shapes_are_never_overwritten() {
        assert!(merged(Provider::Codex, &json!({"hooks": "someone else's value"}), true).is_err());
        assert!(merged(Provider::Codex, &json!({"hooks": {"SessionStart": "keep this"}}), true).is_err());
        // Removal leaves them alone instead of failing.
        let odd = json!({"hooks": {"SessionStart": "keep this"}});
        assert_eq!(merged(Provider::Codex, &odd, false).unwrap(), odd);
        let odder = json!({"hooks": "someone else's value"});
        assert_eq!(merged(Provider::Codex, &odder, false).unwrap(), odder);
    }
}
