// Preferences, stored as plain JSON in settings.json: %APPDATA%\Nobetci on
// Windows, ~/Library/Application Support/Nobetci on macOS.
// Credentials are kept separately in the OS credential store, never in this file.
//
// Every field has a default (`#[serde(default)]`), so a file written by an older
// build — or edited by hand and missing half its keys — still loads.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Folder name under %APPDATA% and %LOCALAPPDATA% (Windows) or Application
/// Support (macOS). ASCII on purpose: the hook path lands in
/// ~/.claude/settings.json and is run through a shell (Git Bash on Windows).
const DIR: &str = "Nobetci";

/// Every hook event Nöbetçi understands, in the order Settings lists them.
pub const ALL_EVENTS: &[&str] = &[
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
    "Stop",
    "StopFailure",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
];

/// A user rule: when a request matches, decide or re-score it before anyone asks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct UserRule {
    pub id: String,
    pub enabled: bool,
    pub name: String,
    /// `*`, a tool name (`Bash`, `Write`…), or a prefix ending in `*` (`mcp__github__*`).
    pub tool: String,
    /// Matched against the request target (command, path or URL).
    pub pattern: String,
    /// `contains`, `prefix`, `exact`, `glob` or `regex`; case-insensitive.
    pub mode: String,
    /// Empty for every project, otherwise a folder the session's cwd must be inside.
    pub project: String,
    /// `allow`, `deny`, `ask`, `low`, `medium`, `high` or `critical`.
    pub action: String,
    /// What Claude is told when this rule denies.
    pub message: String,
}

impl Default for UserRule {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            name: String::new(),
            tool: "*".into(),
            pattern: String::new(),
            mode: "contains".into(),
            project: String::new(),
            action: "ask".into(),
            message: String::new(),
        }
    }
}

/// How much a project folder is trusted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectPolicy {
    pub path: String,
    /// `trusted` (low risk goes through on its own), `normal`, or `strict`
    /// (everything counts one level higher).
    pub mode: String,
    pub note: String,
}

impl Default for ProjectPolicy {
    fn default() -> Self {
        Self { path: String::new(), mode: "normal".into(), note: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Hotkeys {
    /// Open or fold the island.
    pub toggle: String,
    /// Deny the request on the card.
    pub deny: String,
    /// Allow the request on the card — only ever for low risk.
    pub allow: String,
    /// Toggle do-not-disturb.
    pub dnd: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            toggle: "Ctrl+Alt+N".into(),
            deny: "Ctrl+Alt+D".into(),
            // Off by default: any program can synthesise keystrokes.
            allow: String::new(),
            dnd: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    // ── General ───────────────────────────────────────────────────────────────
    /// "auto" follows the system display language; "tr" or "en" force one.
    pub language: String,
    pub mascot_theme: String,
    pub island_media: bool,
    pub island_weather_city: String,
    /// The first-run welcome has been completed or skipped.
    pub onboarded: bool,
    pub autostart: bool,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    /// Where along the top edge the island sits: "center", "left" or "right".
    pub position: String,
    /// Seconds before an open island folds back once the mouse leaves.
    pub auto_close_interval: f64,
    /// Minutes of silence before a session drops off the list.
    pub stale_minutes: u32,
    /// Open the island when a session finishes (otherwise just a compact flash).
    pub expand_on_finish: bool,
    /// The desktop mascot: a copy of the island's mascot that can be dragged anywhere.
    pub buddy: bool,
    /// Where the desktop mascot was left, physical desktop pixels; null = the corner.
    /// Kept by Rust as the window moves; the settings window never edits it.
    pub buddy_pos: Option<[i32; 2]>,

    // ── Prompt review ────────────────────────────────────────────────────────
    /// "ollama" (local) or "openai" (only used after an explicit review click).
    pub prompt_provider: String,
    pub ollama_model: String,
    pub openai_model: String,

    // ── Claude Code ───────────────────────────────────────────────────────────
    pub hooks_installed: bool,
    /// Which events `Install hooks` writes. PermissionRequest is what approvals need.
    pub hook_events: Vec<String>,

    // ── Safety ────────────────────────────────────────────────────────────────
    /// How long Allow must be held for a high-risk request, ms.
    pub hold_ms: u32,
    /// …and for a critical one.
    pub hold_critical_ms: u32,
    /// Approvals must come from a physical mouse click; synthesised input
    /// (SendInput, UI Automation) is refused. Off only for accessibility tools.
    pub input_guard: bool,
    /// Highest level a rule or a trusted project may approve on its own:
    /// "none", "low" or "medium". High and critical never are.
    pub auto_allow_max: String,
    /// Risk categories switched off.
    pub disabled_categories: Vec<String>,
    pub rules: Vec<UserRule>,
    pub projects: Vec<ProjectPolicy>,
    /// Ready-made reasons offered when denying from the card.
    pub deny_reasons: Vec<String>,

    // ── Notifications ─────────────────────────────────────────────────────────
    pub sound_enabled: bool,
    pub sound_volume: f64,
    /// Sounds switched off individually (approval, danger, finish, error…).
    pub muted_sounds: Vec<String>,
    pub toast_enabled: bool,
    /// Which moments raise a desktop notification: approval, finished, error, waiting.
    pub toast_events: Vec<String>,
    /// Only notify when the island is not already showing it.
    pub toast_only_when_hidden: bool,
    pub dnd: bool,
    pub quiet_enabled: bool,
    /// "HH:MM", local time; may wrap past midnight.
    pub quiet_from: String,
    pub quiet_to: String,
    /// Quiet while a full-screen app, game or presentation is in front.
    pub quiet_fullscreen: bool,
    pub hotkeys: Hotkeys,

    // ── History ───────────────────────────────────────────────────────────────
    pub audit_enabled: bool,
    /// The log rolls over past this size.
    pub audit_max_mb: u32,
}

impl Default for Settings {
    fn default() -> Self {
        let tr = crate::i18n::is_tr();
        Self {
            language: "auto".into(),
            mascot_theme: "owl".into(),
            island_media: false,
            island_weather_city: String::new(),
            onboarded: false,
            autostart: false,
            screen: "primary".into(),
            position: "center".into(),
            auto_close_interval: 15.0,
            stale_minutes: 45,
            expand_on_finish: false,
            buddy: true,
            buddy_pos: None,

            prompt_provider: "ollama".into(),
            ollama_model: "gemma4".into(),
            openai_model: "gpt-6-luna".into(),

            hooks_installed: false,
            hook_events: ALL_EVENTS.iter().map(|s| s.to_string()).collect(),

            hold_ms: 1200,
            hold_critical_ms: 2400,
            input_guard: true,
            auto_allow_max: "low".into(),
            disabled_categories: Vec::new(),
            rules: Vec::new(),
            projects: Vec::new(),
            deny_reasons: if tr {
                vec![
                    "Bunu yapma.".into(),
                    "Önce ne yapacağını açıkla, sonra tekrar sor.".into(),
                    "Başka, daha güvenli bir yol dene.".into(),
                    "Bu dosyaya/klasöre dokunma.".into(),
                ]
            } else {
                vec![
                    "Don't do this.".into(),
                    "Explain what you are about to do first, then ask again.".into(),
                    "Try a different, safer approach.".into(),
                    "Don't touch this file or folder.".into(),
                ]
            },

            sound_enabled: true,
            sound_volume: 0.35,
            muted_sounds: Vec::new(),
            toast_enabled: true,
            toast_events: vec!["approval".into(), "error".into(), "waiting".into()],
            toast_only_when_hidden: true,
            dnd: false,
            quiet_enabled: false,
            quiet_from: "23:00".into(),
            quiet_to: "08:00".into(),
            quiet_fullscreen: true,
            hotkeys: Hotkeys::default(),

            audit_enabled: true,
            audit_max_mb: 10,
        }
    }
}

impl Settings {
    /// Clamps whatever came from disk or the settings window into sane ranges, so
    /// a hand-edited file cannot, say, set a zero-length hold.
    pub fn sanitized(mut self) -> Self {
        let d = Settings::default();
        self.hold_ms = self.hold_ms.clamp(400, 10_000);
        self.hold_critical_ms = self.hold_critical_ms.clamp(self.hold_ms, 20_000);
        if !["none", "low", "medium"].contains(&self.auto_allow_max.as_str()) {
            self.auto_allow_max = d.auto_allow_max;
        }
        if !["owl", "wolf", "hawk", "octopus", "lion", "canary", "eagle"].contains(&self.mascot_theme.as_str()) {
            self.mascot_theme = d.mascot_theme;
        }
        if crate::widgets::city(&self.island_weather_city).is_none() {
            self.island_weather_city.clear();
        }
        if !["auto", "tr", "en"].contains(&self.language.as_str()) {
            self.language = d.language;
        }
        if !["center", "left", "right"].contains(&self.position.as_str()) {
            self.position = d.position;
        }
        if !["primary", "cursor"].contains(&self.screen.as_str()) {
            self.screen = d.screen;
        }
        self.auto_close_interval = self.auto_close_interval.clamp(3.0, 600.0);
        self.stale_minutes = self.stale_minutes.clamp(5, 24 * 60);
        self.sound_volume = self.sound_volume.clamp(0.0, 1.0);
        self.audit_max_mb = self.audit_max_mb.clamp(1, 200);
        if !["ollama", "openai"].contains(&self.prompt_provider.as_str()) {
            self.prompt_provider = d.prompt_provider;
        }
        self.ollama_model = clean_model(&self.ollama_model, &d.ollama_model);
        self.openai_model = clean_model(&self.openai_model, &d.openai_model);
        self.hook_events.retain(|e| ALL_EVENTS.contains(&e.as_str()));
        self.deny_reasons.retain(|r| !r.trim().is_empty());
        self.deny_reasons.truncate(12);
        // The settings window finds a rule by its id, so every rule needs one of
        // its own: a hand-written or imported file may have none, or repeats.
        let stamp = crate::audit::now_ms();
        let mut seen = std::collections::HashSet::new();
        for (i, r) in self.rules.iter_mut().enumerate() {
            if r.id.is_empty() || !seen.insert(r.id.clone()) {
                let mut n = i;
                r.id = loop {
                    let id = format!("r{stamp:x}-{n}");
                    if seen.insert(id.clone()) {
                        break id;
                    }
                    n += 1;
                };
            }
        }
        self
    }
}

fn clean_model(model: &str, default: &str) -> String {
    let clean = model.trim();
    if clean.is_empty() || clean.chars().count() > 120 || clean.chars().any(char::is_control) {
        default.into()
    } else {
        clean.into()
    }
}

/// %APPDATA%\Nobetci — preferences.
#[cfg(windows)]
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join(DIR)
}

/// %LOCALAPPDATA%\Nobetci — where nobetci-hook.exe, the log and the history live.
#[cfg(windows)]
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join(DIR)
}

/// ~/Library/Application Support/Nobetci — everything: preferences, the relay,
/// the log, the history and the relay socket.
#[cfg(target_os = "macos")]
pub fn config_dir() -> PathBuf {
    crate::sys::home().join("Library").join("Application Support").join(DIR)
}

#[cfg(target_os = "macos")]
pub fn local_dir() -> PathBuf {
    config_dir()
}

/// The relay's file name: what Claude Code runs on every hook event.
pub const HOOK_EXE: &str = if cfg!(windows) { "nobetci-hook.exe" } else { "nobetci-hook" };

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join(HOOK_EXE)
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    load_from(&settings_path(), crate::log::line)
}

/// Reads the preferences at `path`; defaults when there is no file yet.
///
/// A file that is there but cannot be parsed — a typo from a hand edit, a write
/// cut short — also gives defaults, but a copy of it is kept first: the next
/// save replaces settings.json, and with it would go every rule and project
/// policy the user had. `report` gets one line saying so.
fn load_from(path: &std::path::Path, report: impl FnOnce(String)) -> Settings {
    let Ok(bytes) = std::fs::read(path) else { return Settings::default() };
    // Notepad and PowerShell 5 save UTF-8 with a BOM, which serde_json refuses.
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    match serde_json::from_slice::<Settings>(text) {
        Ok(settings) => settings.sanitized(),
        Err(err) => {
            let kept = path.with_file_name(format!("settings.json.unreadable-{}", crate::sys::local_time().compact()));
            report(match std::fs::copy(path, &kept) {
                Ok(_) => format!(
                    "settings.json could not be read ({err}); starting from defaults, the file is kept as {}",
                    kept.display()
                ),
                Err(copy) => {
                    format!("settings.json could not be read ({err}); starting from defaults (no copy kept: {copy})")
                }
            });
            Settings::default()
        }
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    save_to(&settings_path(), settings)
}

/// Writes the preferences to a temporary file and renames it into place, so a
/// crash or a full disk mid-write leaves the previous settings.json intact
/// instead of a truncated one that would load as defaults.
fn save_to(path: &std::path::Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json =
        serde_json::to_vec_pretty(settings).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let temp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    let written = std::fs::write(&temp, json).and_then(|_| std::fs::rename(&temp, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_old_file_still_loads_with_defaults() {
        let old = r#"{"soundEnabled":false,"soundVolume":0.2,"holdMs":900}"#;
        let s: Settings = serde_json::from_str::<Settings>(old).unwrap().sanitized();
        assert!(!s.sound_enabled);
        assert_eq!(s.hold_ms, 900);
        assert_eq!(s.hook_events.len(), ALL_EVENTS.len());
        assert_eq!(s.hotkeys.deny, "Ctrl+Alt+D");
        assert!(s.buddy, "the desktop mascot is on for people upgrading");
        assert_eq!(s.buddy_pos, None, "and starts in its corner");
        let placed: Settings = serde_json::from_str(r#"{"buddyPos":[1530,812]}"#).unwrap();
        assert_eq!(placed.sanitized().buddy_pos, Some([1530, 812]));
    }

    #[test]
    fn nonsense_is_clamped() {
        let s = Settings {
            hold_ms: 0,
            hold_critical_ms: 1,
            auto_allow_max: "high".into(),
            position: "middle".into(),
            hook_events: vec!["Stop".into(), "Bogus".into()],
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(s.hold_ms, 400);
        assert!(s.hold_critical_ms >= s.hold_ms);
        assert_eq!(s.auto_allow_max, "low", "high can never be auto-allowed");
        assert_eq!(s.position, "center");
        assert_eq!(s.hook_events, vec!["Stop".to_string()]);
    }

    #[test]
    fn every_rule_gets_an_id_of_its_own() {
        let rule = |id: &str| UserRule { id: id.into(), ..UserRule::default() };
        let s =
            Settings { rules: vec![rule(""), rule("keep"), rule(""), rule("keep"), rule("")], ..Settings::default() }
                .sanitized();
        let ids: std::collections::HashSet<&str> = s.rules.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids.len(), 5, "ids must be unique: {ids:?}");
        assert!(s.rules.iter().all(|r| !r.id.is_empty()));
        assert_eq!(s.rules[1].id, "keep", "an id that is already unique stays");
    }

    #[test]
    fn saving_and_loading_round_trips_and_survives_a_bom() {
        let dir = std::env::temp_dir().join(format!("nobetci-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("settings.json");

        let load_from = |path: &std::path::Path| load_from(path, |line| panic!("nothing to report, got: {line}"));
        assert_eq!(load_from(&path).hold_ms, Settings::default().hold_ms, "no file yet: defaults");

        let wanted = Settings {
            hold_ms: 900,
            rules: vec![UserRule { id: "r1".into(), pattern: "npm".into(), ..UserRule::default() }],
            ..Settings::default()
        };
        save_to(&path, &wanted).unwrap();
        let back = load_from(&path);
        assert_eq!((back.hold_ms, &back.rules), (900, &wanted.rules));
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "no temporary file stays behind: {leftovers:?}");

        // Saved by Notepad or PowerShell 5: UTF-8 with a BOM.
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(br#"{"holdMs":700}"#);
        std::fs::write(&path, bom).unwrap();
        assert_eq!(load_from(&path).hold_ms, 700);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_unreadable_file_is_kept_before_defaults_take_over() {
        let dir = std::env::temp_dir().join(format!("nobetci-settings-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let broken = br#"{"holdMs": 900, "rules": [ { "pattern": "npm" "#;
        std::fs::write(&path, broken).unwrap();

        let mut reported = String::new();
        assert_eq!(load_from(&path, |line| reported = line).hold_ms, Settings::default().hold_ms);
        assert!(reported.contains("settings.json.unreadable-"), "the log must say where the file went: {reported}");
        let kept: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("settings.json.unreadable-")))
            .collect();
        assert_eq!(kept.len(), 1, "the unreadable file must be kept");
        assert_eq!(std::fs::read(&kept[0]).unwrap(), broken);

        let _ = std::fs::remove_dir_all(dir);
    }
}
