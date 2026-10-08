// Preferences, stored as plain JSON in settings.json: %APPDATA%\Nobetci on
// Windows, ~/Library/Application Support/Nobetci on macOS.
// Nöbetçi holds no secrets at all: no API keys, no tokens.
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
    /// Allow the request on the card — only ever for low or medium risk.
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
            onboarded: false,
            autostart: false,
            screen: "primary".into(),
            position: "center".into(),
            auto_close_interval: 15.0,
            stale_minutes: 45,
            expand_on_finish: false,

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
        self.hook_events.retain(|e| ALL_EVENTS.contains(&e.as_str()));
        self.deny_reasons.retain(|r| !r.trim().is_empty());
        self.deny_reasons.truncate(12);
        for r in &mut self.rules {
            if r.id.is_empty() {
                r.id = format!("r{:x}", crate::audit::now_ms());
            }
        }
        self
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
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice::<Settings>(&bytes).unwrap_or_default().sanitized(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json =
        serde_json::to_vec_pretty(settings).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
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
}
