// User-level hook installation for Codex and Cursor. Like Claude's installer,
// this previews a merge, backs up the original file and checks its fingerprint
// before writing so unrelated settings are never silently overwritten.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::i18n::is_tr;
use crate::settings;

const MARKER: &str = "nobetci-hook";

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

    fn events(self) -> &'static [(&'static str, u64)] {
        match self {
            Self::Codex => &[
                ("SessionStart", 10),
                ("SessionEnd", 10),
                ("UserPromptSubmit", 10),
                ("PreToolUse", 10),
                ("PostToolUse", 10),
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub diff: String,
    pub backup: String,
    pub settings_path: String,
    pub fingerprint: String,
}

fn command(provider: Provider, event: &str) -> String {
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let quoted = format!("\"{exe}\"");
    #[cfg(not(windows))]
    let quoted = format!("'{}'", exe.replace('\'', r"'\''"));
    format!("{quoted} {} {event}", provider.name())
}

fn entry_is_ours(provider: Provider, event: &str, entry: &Value) -> bool {
    let commands = match provider {
        Provider::Codex => entry.get("hooks").and_then(Value::as_array).map(Vec::as_slice),
        Provider::Cursor => Some(std::slice::from_ref(entry)),
    };
    commands.into_iter().flatten().any(|h| {
        h.get("command")
            .and_then(Value::as_str)
            .map(|c| c.contains(MARKER) && c.contains(provider.name()) && c.ends_with(event))
            .unwrap_or(false)
    })
}

fn merged(provider: Provider, existing: &Value, install: bool) -> Result<Value, String> {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = match root.get("hooks") {
        Some(value) => value.as_object().cloned().ok_or_else(|| {
            if is_tr() {
                "hooks ayarı bir JSON nesnesi değil — Nöbetçi dokunmayacak."
            } else {
                "The hooks setting isn't a JSON object — Nöbetçi won't touch it."
            }
        })?,
        None => Default::default(),
    };
    for (event, timeout) in provider.events() {
        let mut list = match hooks.get(*event) {
            Some(value) => match value.as_array() {
                Some(list) => list.clone(),
                None if install => {
                    return Err(if is_tr() {
                        format!("hooks.{event} bir liste değil — Nöbetçi bu ayarı ezmeyecek.")
                    } else {
                        format!("hooks.{event} isn't a list — Nöbetçi won't overwrite it.")
                    });
                }
                None => continue,
            },
            None => Vec::new(),
        };
        list.retain(|entry| !entry_is_ours(provider, event, entry));
        if install {
            match provider {
                Provider::Codex => list.push(json!({
                    "hooks": [{ "type": "command", "command": command(provider, event), "timeout": timeout }]
                })),
                Provider::Cursor => list.push(json!({
                    "command": command(provider, event),
                    "timeout": timeout,
                    // Permission hooks must never silently run the tool if the
                    // relay crashes or times out. The relay returns an explicit
                    // deny if the app is unavailable.
                    "failClosed": *timeout == 120
                })),
            }
        }
        if list.is_empty() {
            hooks.remove(*event);
        } else {
            hooks.insert((*event).to_string(), Value::Array(list));
        }
    }
    if hooks.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(hooks));
    }
    if provider == Provider::Cursor {
        root.entry("version").or_insert(json!(1));
    }
    Ok(Value::Object(root))
}

fn parse(bytes: &[u8], path: &str) -> Result<Value, String> {
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) if is_tr() => Err(format!("{path} bir JSON nesnesi değil — Nöbetçi dokunmayacak.")),
        Ok(_) => Err(format!("{path} isn't a JSON object — Nöbetçi won't touch it.")),
        Err(err) if is_tr() => Err(format!("{path} geçerli JSON değil ({err}) — Nöbetçi üzerine yazmayacak.")),
        Err(err) => Err(format!("{path} isn't valid JSON ({err}) — Nöbetçi won't overwrite it.")),
    }
}

fn read(provider: Provider) -> Result<Value, String> {
    let path = provider.settings_path();
    match std::fs::read(&path) {
        Ok(bytes) => parse(&bytes, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(err) if is_tr() => Err(format!("{} okunamadı: {err}", path.display())),
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn current_fingerprint(provider: Provider) -> String {
    fingerprint(&std::fs::read(provider.settings_path()).unwrap_or_default())
}

fn stamp() -> String {
    crate::sys::local_time().compact()
}

fn backup_path(provider: Provider) -> PathBuf {
    let path = provider.settings_path();
    path.with_file_name(format!("hooks.json.bak-{}", stamp()))
}

pub fn status(provider: Provider) -> Status {
    let current = read(provider).unwrap_or_else(|_| json!({}));
    let mut events = Vec::new();
    let mut stale = false;
    if let Some(hooks) = current.get("hooks").and_then(Value::as_object) {
        for (event, list) in hooks {
            let ours: Vec<&Value> =
                list.as_array().into_iter().flatten().filter(|entry| entry_is_ours(provider, event, entry)).collect();
            if ours.is_empty() {
                continue;
            }
            events.push(event.clone());
            let expected = command(provider, event);
            stale |= ours.iter().any(|entry| {
                match provider {
                    Provider::Codex => entry.get("hooks").and_then(Value::as_array).map(Vec::as_slice),
                    Provider::Cursor => Some(std::slice::from_ref(*entry)),
                }
                .into_iter()
                .flatten()
                .filter_map(|h| h.get("command").and_then(Value::as_str))
                .any(|c| c != expected)
            });
        }
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

pub fn preview(provider: Provider, install: bool) -> Result<Preview, String> {
    let current = read(provider)?;
    let next = merged(provider, &current, install)?;
    let mut current_text = serde_json::to_string_pretty(&current).unwrap_or_else(|_| "{}".into());
    let mut next_text = serde_json::to_string_pretty(&next).unwrap_or_else(|_| "{}".into());
    current_text.push('\n');
    next_text.push('\n');
    Ok(Preview {
        diff: unified_diff(&current_text, &next_text),
        backup: backup_path(provider).to_string_lossy().to_string(),
        settings_path: provider.settings_path().to_string_lossy().to_string(),
        fingerprint: current_fingerprint(provider),
    })
}

pub fn write(provider: Provider, install: bool, expected_fingerprint: &str) -> Result<String, String> {
    let path = provider.settings_path();
    let current = read(provider)?;
    if current_fingerprint(provider) != expected_fingerprint {
        return Err(if is_tr() {
            format!("{} önizlemeden sonra değişti. Yeni farkı incele.", path.display())
        } else {
            format!("{} changed since the preview. Review the new diff.", path.display())
        });
    }
    let next = merged(provider, &current, install)?;
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let backup = backup_path(provider);
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| {
            if is_tr() {
                format!("Yedek alınamadı: {e}")
            } else {
                format!("Backup failed: {e}")
            }
        })?;
    }
    let mut text = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    text.push('\n');
    let temp = path.with_extension(format!("json.nobetci-{}", std::process::id()));
    std::fs::write(&temp, text).map_err(|e| e.to_string())?;
    if let Err(err) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(err.to_string());
    }
    Ok(backup.to_string_lossy().to_string())
}

pub fn remove_for_uninstall(provider: Provider) -> Result<Option<String>, String> {
    if !status(provider).installed {
        return Ok(None);
    }
    let fingerprint = current_fingerprint(provider);
    write(provider, false, &fingerprint).map(Some)
}

fn unified_diff(before: &str, after: &str) -> String {
    let old: Vec<&str> = before.lines().collect();
    let new: Vec<&str> = after.lines().collect();
    let mut out = String::from("--- mevcut\n+++ Nöbetçi\n");
    let mut prefix = 0;
    while prefix < old.len().min(new.len()) && old[prefix] == new[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < old.len().saturating_sub(prefix).min(new.len().saturating_sub(prefix))
        && old[old.len() - suffix - 1] == new[new.len() - suffix - 1]
    {
        suffix += 1;
    }
    let old_end = old.len().saturating_sub(suffix);
    let new_end = new.len().saturating_sub(suffix);
    out.push_str(&format!("@@ -{},{} +{},{} @@\n", prefix + 1, old_end - prefix, prefix + 1, new_end - prefix));
    for line in &old[prefix..old_end] {
        out.push('-');
        out.push_str(line);
        out.push('\n');
    }
    for line in &new[prefix..new_end] {
        out.push('+');
        out.push_str(line);
        out.push('\n');
    }
    out
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
    fn remove_only_drops_nobetci_events() {
        let installed = merged(Provider::Cursor, &json!({"hooks":{"stop":[{"command":"other"}]}}), true).unwrap();
        let removed = merged(Provider::Cursor, &installed, false).unwrap();
        assert_eq!(removed["hooks"]["stop"].as_array().unwrap().len(), 1);
        assert!(removed["hooks"]["beforeSubmitPrompt"].is_null());
    }

    #[test]
    fn invalid_hook_shapes_are_never_overwritten() {
        assert!(merged(Provider::Codex, &json!({"hooks": "someone else's value"}), true).is_err());
        assert!(merged(Provider::Codex, &json!({"hooks": {"SessionStart": "keep this"}}), true).is_err());
    }
}
