// Preferences, stored as plain JSON in settings.json: %APPDATA%\Nobetci on
// Windows, ~/Library/Application Support/Nobetci on macOS, ~/.config/nobetci on
// Linux. Credentials are kept separately in the OS credential store, never in
// this file.
//
// Every field has a default (`#[serde(default)]`), so a file written by an older
// build — or edited by hand and missing half its keys — still loads. A file that
// is there but cannot be read is never written over during that run: it may be
// perfectly good (a lock, a network home), or the user may want to fix a typo.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};

/// Folder name under %APPDATA% and %LOCALAPPDATA% (Windows) or Application
/// Support (macOS). ASCII on purpose: the hook path lands in
/// ~/.claude/settings.json and is run through a shell (Git Bash on Windows).
#[cfg(not(target_os = "linux"))]
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
    // Not a hook: Claude Code's status line command, which carries context use and
    // plan limits. Opt-in, since it shows a line under the prompt (hooks.rs).
    "StatusLine",
];

/// Events chosen on a fresh install: every hook, but not the status line.
pub fn default_events() -> Vec<String> {
    ALL_EVENTS.iter().filter(|e| **e != "StatusLine").map(|s| s.to_string()).collect()
}

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
    /// Open the assistant (and hand it the keyboard).
    pub assistant: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            toggle: "Ctrl+Alt+N".into(),
            deny: "Ctrl+Alt+D".into(),
            // Off by default: any program can synthesise keystrokes.
            allow: String::new(),
            dnd: String::new(),
            assistant: "Ctrl+Alt+Space".into(),
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
    /// The desktop mascot's size, percent of the default (60–200).
    pub buddy_size: u32,
    /// Where the assistant sends a prompt: "here" or an AI app (assistant.rs).
    pub assistant_target: String,
    /// Open a target's desktop app, when installed, instead of the browser.
    pub assistant_use_apps: bool,
    /// Length of the island's focus timer, in minutes.
    pub focus_minutes: u32,
    /// Size of the mascot inside the island, in percent.
    pub island_mascot_size: u32,

    // ── Prompt review ────────────────────────────────────────────────────────
    /// "ollama" (local) or "openai" (only used after an explicit review click).
    pub prompt_provider: String,
    pub ollama_model: String,
    pub openai_model: String,

    // ── Claude Code ───────────────────────────────────────────────────────────
    pub hooks_installed: bool,
    /// Which events `Install hooks` writes. PermissionRequest is what approvals need.
    pub hook_events: Vec<String>,
    /// Answer Claude's questions and approve its plans on the island.
    pub island_questions: bool,

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
            buddy_size: 100,
            assistant_target: "chatgpt".into(),
            assistant_use_apps: true,
            focus_minutes: 25,
            island_mascot_size: 100,

            prompt_provider: "ollama".into(),
            ollama_model: "gemma4".into(),
            openai_model: "gpt-6-luna".into(),

            hooks_installed: false,
            hook_events: default_events(),
            island_questions: true,

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
        self.buddy_size = self.buddy_size.clamp(60, 200);
        self.focus_minutes = self.focus_minutes.clamp(1, 180);
        self.island_mascot_size = self.island_mascot_size.clamp(80, 130);
        if !crate::assistant::is_target(&self.assistant_target) {
            self.assistant_target = "chatgpt".into();
        }
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
        // Folders compare as written: a quoted or padded one (an import, a
        // hand-edited file, a path pasted from a terminal) would match nothing.
        for project in &mut self.projects {
            project.path = clean_path(&project.path);
        }
        for rule in &mut self.rules {
            rule.project = clean_path(&rule.project);
        }
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

/// A folder path without the whitespace and the matching quote pairs around it
/// ("Copy as path" in Explorer quotes, a terminal may add spaces), as the
/// settings window cleans it (`cleanPath` in kurallar.ts): quotes are peeled
/// one pair at a time, trimming in between. A quote inside the path stays.
fn clean_path(raw: &str) -> String {
    // What JavaScript's trim() removes: Unicode white space and the BOM.
    let blank = |c: char| c.is_whitespace() || c == '\u{FEFF}';
    let mut path = raw.trim_matches(blank);
    loop {
        let mut chars = path.chars();
        match (chars.next(), chars.next_back()) {
            (Some(open @ ('"' | '\'')), Some(close)) if open == close => path = chars.as_str().trim_matches(blank),
            _ => return path.to_string(),
        }
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

/// $XDG_CONFIG_HOME/nobetci (~/.config/nobetci) — the preferences.
#[cfg(target_os = "linux")]
pub fn config_dir() -> PathBuf {
    xdg("XDG_CONFIG_HOME", ".config").join("nobetci")
}

/// $XDG_DATA_HOME/nobetci (~/.local/share/nobetci) — the relay, the log and the history.
#[cfg(target_os = "linux")]
pub fn local_dir() -> PathBuf {
    xdg("XDG_DATA_HOME", ".local/share").join("nobetci")
}

/// An XDG base folder: the variable when it holds an absolute path, else under home.
#[cfg(target_os = "linux")]
fn xdg(var: &str, fallback: &str) -> PathBuf {
    std::env::var_os(var)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| crate::sys::home().join(fallback))
}

/// The relay's file name: what Claude Code runs on every hook event.
pub const HOOK_EXE: &str = if cfg!(windows) { "nobetci-hook.exe" } else { "nobetci-hook" };

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join(HOOK_EXE)
}

pub fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

// ── Loading ───────────────────────────────────────────────────────────────────

/// Why settings.json could not be used as it is at start.
#[derive(Clone, Debug, PartialEq)]
pub struct LoadProblem {
    pub kind: ProblemKind,
    /// The reader's own words: the OS error, or serde's "… at line 3 column 5".
    pub error: String,
    /// Values that could not be read and were left at their defaults (`Partial`).
    pub defaulted: Vec<String>,
    /// Where the file's bytes were kept, when a copy could be made.
    pub kept: Option<PathBuf>,
    /// What was held back for this run so that nothing the file restricted is
    /// let through on its own (`salvage`).
    pub held: Held,
}

/// What a partly read settings file has held back until it is fixed.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Held {
    /// A rule or project could not be read: allow rules and rules that lower
    /// the risk to LOW are off, and trusted projects count as normal.
    pub permissive: bool,
    /// The limit for automatic approvals could not be read: it is "none".
    pub auto_allow: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ProblemKind {
    /// The file could not be read at all (a lock, permissions, a failing disk).
    Read,
    /// It was read but is not a JSON object.
    Parse,
    /// A JSON object with some values of the wrong type: the rest was used.
    Partial,
}

/// What `load_from` found.
#[derive(Debug)]
pub struct Loaded {
    pub settings: Settings,
    pub problem: Option<LoadProblem>,
}

/// The problem with settings.json at start, if any. While there is one, nothing
/// is saved over the file until Nöbetçi restarts (`save` refuses).
static PROBLEM: OnceLock<LoadProblem> = OnceLock::new();

pub fn load() -> Settings {
    let loaded = load_from(&settings_path());
    if let Some(problem) = loaded.problem {
        let _ = PROBLEM.set(problem);
    }
    loaded.settings
}

/// Writes what went wrong reading settings.json at start to the log, if
/// anything did: called once the log's "started" line is written.
pub fn log_load_problem() {
    if let Some(problem) = PROBLEM.get() {
        crate::log::line(problem.log_line());
    }
}

/// What went wrong reading settings.json at start, in the UI language; None
/// when it was read (or there was no file yet).
pub fn load_problem() -> Option<String> {
    PROBLEM.get().map(|p| p.message(&settings_path(), crate::i18n::is_tr()))
}

impl LoadProblem {
    fn log_line(&self) -> String {
        let kept = match &self.kept {
            Some(path) => format!("a copy is kept as {}", path.display()),
            None => "no copy could be made".into(),
        };
        let used = match self.kind {
            ProblemKind::Partial => {
                format!("kept every other value, {} left at the default", self.defaulted.join(", "))
            }
            _ => "starting from defaults".into(),
        };
        let mut held = String::new();
        if self.held.permissive {
            held.push_str(
                "; allow rules and rules that lower a risk to LOW are off and trusted projects count as normal",
            );
        }
        if self.held.auto_allow {
            held.push_str("; nothing is approved automatically");
        }
        format!(
            "settings.json could not be read ({}); {used}{held}; {kept}; not saving over it until restart",
            self.error
        )
    }

    /// For the settings window, which already says that nothing is saved until
    /// a restart: what happened, what was used, and what to do about it.
    pub fn message(&self, path: &Path, tr: bool) -> String {
        let mut out = format!("{}: {}.", path.display(), self.error.trim_end_matches('.'));
        if self.kind == ProblemKind::Partial {
            let list = self.defaulted.join(", ");
            out.push(' ');
            out.push_str(&if tr {
                format!("Şunlar okunamadı ve varsayılan değerlerinde kaldı: {list}. Geri kalan her şey okundu.")
            } else {
                format!("These couldn't be read and kept their default values: {list}. Everything else was read.")
            });
        }
        if self.held.permissive {
            out.push(' ');
            out.push_str(if tr {
                "Dosya düzelene kadar izin kuralları ve riski DÜŞÜK'e indiren kurallar kapalı, güvenilir projeler normal \
                 sayılıyor: dosyanın kısıtladığı hiçbir şey kendiliğinden geçmez."
            } else {
                "Until the file is fixed, allow rules and rules that lower a risk to LOW are off and trusted projects \
                 count as normal, so nothing the file restricted is let through on its own."
            });
        }
        if self.held.auto_allow {
            out.push(' ');
            out.push_str(if tr {
                "Otomatik onay sınırı okunamadığı için hiçbir şey otomatik onaylanmıyor."
            } else {
                "The limit for automatic approvals couldn't be read, so nothing is approved automatically."
            });
        }
        out.push(' ');
        out.push_str(&match (&self.kept, tr) {
            (Some(kept), true) => format!("Dosyanın bir kopyası: {}.", kept.display()),
            (Some(kept), false) => format!("A copy of the file is at {}.", kept.display()),
            (None, true) => "Dosyanın kopyası alınamadı.".into(),
            (None, false) => "No copy of the file could be made.".into(),
        });
        out.push(' ');
        out.push_str(match (self.kind, tr) {
            (ProblemKind::Read, true) => "Dosya yeniden okunabilir olunca Nöbetçi'yi yeniden başlat.",
            (ProblemKind::Read, false) => "Restart Nöbetçi once the file can be read again.",
            (_, true) => {
                "Dosyayı düzelt ya da sıfırdan başlamak için başka bir yere taşı, sonra Nöbetçi'yi yeniden başlat."
            }
            (_, false) => "Fix the file, or move it elsewhere to start over, then restart Nöbetçi.",
        });
        out
    }
}

/// Reads the preferences at `path`; defaults when there is no file yet (or
/// an empty one: there is nothing in it to lose).
///
/// Anything else that keeps the file from loading as it is — it cannot be read,
/// it is not JSON, a value has the wrong type — is a `LoadProblem`, with a copy
/// of the file kept when one can be made. A value of the wrong type costs only
/// that value (or that one list item): every rule, project and deny reason that
/// can be read stays in force. A rule that does not read as a whole is dropped,
/// never applied with a field missing.
fn load_from(path: &Path) -> Loaded {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Loaded { settings: Settings::default(), problem: None };
        }
        // The file is there, and may be perfectly good: a lock held by another
        // program, a permission problem, a network home that failed to answer.
        Err(err) => {
            let kept = keep_unreadable(path, None);
            return Loaded {
                settings: returning_defaults(),
                problem: Some(LoadProblem {
                    kind: ProblemKind::Read,
                    error: err.to_string(),
                    defaulted: vec![],
                    kept,
                    held: Held::default(),
                }),
            };
        }
    };
    // Notepad and PowerShell 5 save UTF-8 with a BOM, which serde_json refuses.
    let text = strip_bom(&bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Loaded { settings: Settings::default(), problem: None };
    }
    let unreadable = |error: String| Loaded {
        settings: returning_defaults(),
        problem: Some(LoadProblem {
            kind: ProblemKind::Parse,
            error,
            defaulted: vec![],
            kept: keep_unreadable(path, Some(&bytes)),
            held: Held::default(),
        }),
    };
    let map = match serde_json::from_slice::<Value>(text) {
        Ok(Value::Object(map)) => map,
        Ok(_) => return unreadable("not a JSON object".into()),
        Err(err) => return unreadable(err.to_string()),
    };
    match serde_json::from_value::<Settings>(Value::Object(map.clone())) {
        Ok(settings) => Loaded { settings: settings.sanitized(), problem: None },
        Err(err) => {
            let (mut settings, defaulted, held) = salvage(&map);
            // Somebody who has a settings file has met the welcome already.
            settings.onboarded = true;
            Loaded {
                settings: settings.sanitized(),
                problem: Some(LoadProblem {
                    kind: ProblemKind::Partial,
                    error: err.to_string(),
                    defaulted,
                    kept: keep_unreadable(path, Some(&bytes)),
                    held,
                }),
            }
        }
    }
}

/// Defaults for a run whose settings file could not be used. A file existed,
/// so this is not a first run: no welcome wizard over the problem.
fn returning_defaults() -> Settings {
    Settings { onboarded: true, ..Settings::default() }
}

/// Every value of `file` that fits on its own over the defaults: top-level
/// keys, list items and the keys of a nested object (hotkeys). Returns the
/// settings, what was left at its default, and what is held back.
///
/// Salvage must never widen what the file allowed. Rules are first-match and
/// the most specific project wins, so a deny rule or a strict project that is
/// dropped would hand its requests to an allow rule further down or a trusted
/// folder above. A rule or project that does not read whole is therefore read
/// field by field (`salvage_item`) and kept when everything that decides what
/// it does was read. One that cannot be kept turns off, for this run, every
/// allow rule and every rule that lowers a risk to LOW, and makes trusted
/// projects count as normal; only a rule that was off anyway, or a trusted
/// project, goes without that. An automatic-approval limit that cannot be
/// read is "none". Saving is refused meanwhile, so the file keeps them all.
fn salvage(file: &Map<String, Value>) -> (Settings, Vec<String>, Held) {
    let fits = |object: &Map<String, Value>| serde_json::from_value::<Settings>(Value::Object(object.clone())).is_ok();
    let mut merged = match serde_json::to_value(Settings::default()) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    };
    let mut defaulted = Vec::new();
    // A rule or project was lost that may have restricted something.
    let mut lost = false;
    for (key, value) in file {
        let with = |merged: &Map<String, Value>, value: Value| {
            let mut candidate = merged.clone();
            candidate.insert(key.clone(), value);
            candidate
        };
        let whole = with(&merged, value.clone());
        if fits(&whole) {
            merged = whole;
            continue;
        }
        // List items, and the keys of a nested object, do not depend on each
        // other: each is tried on its own, then the ones that fit together.
        let part = match value {
            Value::Array(items) => {
                let mut kept: Vec<Value> = Vec::new();
                for (i, item) in items.iter().enumerate() {
                    if fits(&with(&merged, Value::Array(vec![item.clone()]))) {
                        kept.push(item.clone());
                        continue;
                    }
                    match salvage_item(key, item) {
                        Some((item, fields)) => {
                            defaulted.extend(fields.into_iter().map(|field| format!("{key}[{i}].{field}")));
                            kept.push(item);
                        }
                        None => {
                            defaulted.push(format!("{key}[{i}]"));
                            lost |= restricts(key, item);
                        }
                    }
                }
                Some(Value::Array(kept))
            }
            Value::Object(inner) => {
                let base = merged.get(key).and_then(Value::as_object).cloned().unwrap_or_default();
                let mut kept = base.clone();
                for (name, inner_value) in inner {
                    let mut trial = base.clone();
                    trial.insert(name.clone(), inner_value.clone());
                    if fits(&with(&merged, Value::Object(trial))) {
                        kept.insert(name.clone(), inner_value.clone());
                    } else {
                        defaulted.push(format!("{key}.{name}"));
                    }
                }
                Some(Value::Object(kept))
            }
            _ => None,
        };
        match part.map(|part| with(&merged, part)).filter(|candidate| fits(candidate)) {
            Some(candidate) => merged = candidate,
            // Not even the shape fits (a list where a word belongs): the default stays.
            None => {
                defaulted.retain(|d| !d.starts_with(&format!("{key}[")) && !d.starts_with(&format!("{key}.")));
                defaulted.push(key.clone());
                lost |= matches!(key.as_str(), "rules" | "projects");
            }
        }
    }
    let mut settings: Settings = serde_json::from_value(Value::Object(merged)).unwrap_or_default();
    let mut held = Held::default();
    if lost {
        for rule in settings.rules.iter_mut().filter(|r| r.enabled && matches!(r.action.as_str(), "allow" | "low")) {
            rule.enabled = false;
            held.permissive = true;
        }
        for project in settings.projects.iter_mut().filter(|p| p.mode == "trusted") {
            project.mode = "normal".into();
            held.permissive = true;
        }
    }
    if defaulted.iter().any(|d| d == "autoAllowMax") {
        settings.auto_allow_max = "none".into();
        held.auto_allow = true;
    }
    (settings, defaulted, held)
}

/// A rule (`key` "rules") or project ("projects") that does not read whole,
/// read field by field over its defaults: kept, with the fields that fell
/// back listed, only when everything that decides what it does was read — a
/// rule's action, tool, pattern, mode and project, and whether it is on unless
/// it only ever restricts (deny, ask, critical); a project's path and mode.
/// Its id, name, message or note may fall back.
fn salvage_item(key: &str, item: &Value) -> Option<(Value, Vec<String>)> {
    fn fields_of<T: Serialize>(value: T) -> Map<String, Value> {
        serde_json::to_value(value).ok().and_then(|v| v.as_object().cloned()).unwrap_or_default()
    }
    let given = item.as_object()?;
    let (mut built, decides): (Map<String, Value>, &[&str]) = match key {
        "rules" => {
            let restricts =
                given.get("action").and_then(Value::as_str).is_some_and(|a| matches!(a, "deny" | "ask" | "critical"));
            let decides: &[&str] = if restricts {
                &["action", "tool", "pattern", "mode", "project"]
            } else {
                &["action", "tool", "pattern", "mode", "project", "enabled"]
            };
            (fields_of(UserRule::default()), decides)
        }
        "projects" => (fields_of(ProjectPolicy::default()), &["path", "mode"]),
        _ => return None,
    };
    let reads = |fields: &Map<String, Value>| {
        let value = Value::Object(fields.clone());
        match key {
            "rules" => serde_json::from_value::<UserRule>(value).is_ok(),
            _ => serde_json::from_value::<ProjectPolicy>(value).is_ok(),
        }
    };
    let mut fell_back = Vec::new();
    for (name, value) in given {
        let mut trial = built.clone();
        trial.insert(name.clone(), value.clone());
        if reads(&trial) {
            built = trial;
        } else {
            fell_back.push(name.clone());
        }
    }
    (!fell_back.iter().any(|name| decides.contains(&name.as_str()))).then_some((Value::Object(built), fell_back))
}

/// Whether leaving out `item` of `key` could let something through that the
/// file restricted: anything but a rule that was off anyway or a trusted
/// project (losing one only takes trust away).
fn restricts(key: &str, item: &Value) -> bool {
    match key {
        "rules" => item.get("enabled") != Some(&Value::Bool(false)),
        "projects" => item.get("mode").and_then(Value::as_str) != Some("trusted"),
        _ => false,
    }
}

/// Keeps the bytes of a settings file that could not be used, next to it as
/// settings.json.unreadable-<stamp> (an identical copy kept earlier is reused,
/// so restarting with the same broken file does not pile up copies). `bytes`
/// is None when the file could not be read; a plain copy is tried then.
fn keep_unreadable(path: &Path, bytes: Option<&[u8]>) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let prefix = format!("{name}.unreadable-");
    if let (Some(bytes), Some(dir)) = (bytes, path.parent()) {
        let earlier = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
            p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&prefix))
                && std::fs::metadata(p).is_ok_and(|m| m.len() == bytes.len() as u64)
                && std::fs::read(p).is_ok_and(|have| have == bytes)
        });
        if earlier.is_some() {
            return earlier;
        }
    }
    let target = path.with_file_name(format!("{prefix}{}", crate::sys::local_time().compact()));
    match bytes {
        Some(bytes) => write_new_private(&target, bytes).ok(),
        None => {
            let copied = std::fs::read(path).ok()?;
            write_new_private(&target, &copied).ok()
        }
    }
}

// ── Saving ────────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum SaveError {
    /// settings.json could not be used at start; it is left alone until a restart.
    Unreadable,
    Io(std::io::Error),
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreadable => {
                f.write_str("settings.json could not be read at start, so it is left as it is until Nöbetçi restarts")
            }
            Self::Io(err) => err.fmt(f),
        }
    }
}

impl SaveError {
    /// The error the settings window understands: `settings_unreadable`, or
    /// `save_failed: <why>`.
    pub fn code(&self) -> String {
        match self {
            Self::Unreadable => "settings_unreadable".into(),
            Self::Io(err) => format!("save_failed: {err}"),
        }
    }
}

pub fn save(settings: &Settings) -> Result<(), SaveError> {
    save_checked(PROBLEM.get(), &settings_path(), settings)
}

/// `save`, given what was wrong with the file at start.
fn save_checked(problem: Option<&LoadProblem>, path: &Path, settings: &Settings) -> Result<(), SaveError> {
    if problem.is_some() {
        return Err(SaveError::Unreadable);
    }
    save_to(path, settings).map_err(SaveError::Io)
}

/// Writes the preferences to a temporary file and renames it into place, so a
/// crash or a full disk mid-write leaves the previous settings.json intact
/// instead of a truncated one that would load as defaults. One save at a time,
/// each with a temporary file of its own: two overlapping saves (the settings
/// window and the mascot's delayed one) can never splice their bytes together.
/// A settings.json that is a symlink stays one; the file it names is replaced.
fn save_to(path: &Path, settings: &Settings) -> std::io::Result<()> {
    static SAVING: Mutex<()> = Mutex::new(());
    let _one_at_a_time = SAVING.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
        private_dir(dir)?;
    }
    let mut json =
        serde_json::to_vec_pretty(settings).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    json.push(b'\n');
    let target = real_path(path);
    let temp = temp_beside(&target, "tmp");
    let written = write_private(&temp, &json).and_then(|_| std::fs::rename(&temp, &target));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

/// Keeps a dated copy of settings.json before something replaces all of it
/// (an import, a reset). None when there is no file, or no copy could be made.
pub fn keep_copy() -> Option<PathBuf> {
    let path = settings_path();
    let bytes = std::fs::read(&path).ok()?;
    write_new_private(&path.with_file_name(format!("settings.json.bak-{}", crate::sys::local_time().compact())), &bytes)
        .ok()
}

// ── Import and export ─────────────────────────────────────────────────────────

/// Every exported file carries this key, so an import can tell it apart from
/// other JSON (Claude Code's own settings.json above all).
pub const EXPORT_MARKER: &str = "nobetciSettings";

/// Top-level keys of Claude Code's settings.json. Nöbetçi's settings have none
/// of them, so a file that does is never imported.
const CLAUDE_KEYS: &[&str] = &["hooks", "permissions", "env", "model", "statusLine"];

/// The export file: the marker first, then every setting.
pub fn export_json(settings: &Settings) -> Result<String, String> {
    let mut body = Map::new();
    body.insert(EXPORT_MARKER.into(), Value::from(1));
    match serde_json::to_value(settings).map_err(|e| e.to_string())? {
        Value::Object(fields) => body.extend(fields),
        _ => return Err("settings did not serialise as an object".into()),
    }
    let mut text = serde_json::to_string_pretty(&Value::Object(body)).map_err(|e| e.to_string())?;
    text.push('\n');
    Ok(text)
}

/// Reads a file picked for import. Only Nöbetçi's own settings are accepted:
/// a file with the export marker, or at least three of Nöbetçi's keys, and in
/// either case none of Claude Code's (`not_nobetci_settings` otherwise). A BOM
/// is fine, as it is for settings.json itself.
pub fn parse_import(bytes: &[u8]) -> Result<Settings, String> {
    let invalid = |err: String| {
        if crate::i18n::is_tr() {
            format!("Geçerli bir Nöbetçi ayar dosyası değil: {err}")
        } else {
            format!("Not a valid Nöbetçi settings file: {err}")
        }
    };
    let value: Value = serde_json::from_slice(strip_bom(bytes)).map_err(|e| invalid(e.to_string()))?;
    let Value::Object(map) = value else { return Err("not_nobetci_settings".into()) };
    if !is_nobetci_settings(&map) {
        return Err("not_nobetci_settings".into());
    }
    serde_json::from_value::<Settings>(Value::Object(map)).map_err(|e| invalid(e.to_string()))
}

fn is_nobetci_settings(map: &Map<String, Value>) -> bool {
    if CLAUDE_KEYS.iter().any(|key| map.contains_key(*key)) {
        return false;
    }
    if map.get(EXPORT_MARKER).and_then(Value::as_u64).is_some_and(|v| v >= 1) {
        return true;
    }
    let known = match serde_json::to_value(Settings::default()) {
        Ok(Value::Object(fields)) => fields,
        _ => return false,
    };
    map.keys().filter(|key| known.contains_key(*key)).count() >= 3
}

// ── Files ─────────────────────────────────────────────────────────────────────

const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

pub(crate) fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(BOM).unwrap_or(bytes)
}

/// Creates one of Nöbetçi's own folders, private to the user on Unix (0700),
/// and tightens one that already exists (`tighten`).
pub(crate) fn private_dir(dir: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
        let meta = std::fs::metadata(dir)?;
        tighten(dir, &meta, || std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)))
    }
    #[cfg(not(unix))]
    std::fs::create_dir_all(dir)
}

/// Folders and files of the user's that could not be made private, each named
/// once in the log (`take_loose`), and what the log has yet to say about them.
static LOOSE: Mutex<(Vec<PathBuf>, Vec<String>)> = Mutex::new((Vec::new(), Vec::new()));

/// Makes `path` (described by `meta`) the user's alone with `change` when
/// others may read it. Where that is refused for one of the user's own folders
/// or files — a file system without Unix modes (vfat, exFAT, some network
/// shares), or a mode pinned by an attribute — it is used as it is, because
/// what goes into it (every decision in the history) matters more; files
/// created in it are still 0600, and the log says so once. One that belongs to
/// another account is refused, as before.
#[cfg(unix)]
pub(crate) fn tighten(
    path: &Path,
    meta: &std::fs::Metadata,
    change: impl FnOnce() -> std::io::Result<()>,
) -> std::io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    if meta.permissions().mode() & 0o077 == 0 {
        return Ok(());
    }
    match change() {
        Ok(()) => Ok(()),
        // SAFETY: geteuid has no preconditions and cannot fail.
        Err(err) if meta.uid() == unsafe { libc::geteuid() } => {
            let mut loose = LOOSE.lock().unwrap_or_else(PoisonError::into_inner);
            if !loose.0.iter().any(|p| p == path) {
                loose.0.push(path.to_path_buf());
                loose.1.push(format!(
                    "{} could not be made private ({err}); it is used as it is, so other accounts may be able to \
                     read it — check the file system it is on",
                    path.display()
                ));
            }
            Ok(())
        }
        Err(err) => Err(err),
    }
}

/// What the log has not yet said about folders and files left readable (`tighten`).
pub(crate) fn take_loose() -> Vec<String> {
    std::mem::take(&mut LOOSE.lock().unwrap_or_else(PoisonError::into_inner).1)
}

/// Writes a whole file only the user can read (0600 on Unix), flushed to disk.
pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Like `write_private`, but never over an existing file: `path` when it is
/// free, else `path-2`, `path-3`… Returns where it went.
pub(crate) fn write_new_private(path: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    for n in 1..100 {
        let candidate = if n == 1 { path.to_path_buf() } else { path.with_file_name(format!("{name}-{n}")) };
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(mut file) => {
                file.write_all(bytes)?;
                file.sync_all()?;
                return Ok(candidate);
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, format!("{} and 98 more exist", path.display())))
}

/// The file `path` names once symlinks are followed (a dotfiles setup links
/// settings.json into a repository). Replacing that file keeps the link a link
/// instead of turning it into a plain file the repository never sees.
pub(crate) fn real_path(path: &Path) -> PathBuf {
    let mut current = path.to_path_buf();
    for _ in 0..32 {
        match std::fs::symlink_metadata(&current) {
            Ok(meta) if meta.file_type().is_symlink() => match std::fs::read_link(&current) {
                Ok(target) if target.is_absolute() => current = target,
                Ok(target) => current = current.parent().unwrap_or(Path::new("")).join(target),
                Err(_) => break,
            },
            _ => break,
        }
    }
    current
}

/// A temporary file next to `target`, with a name no other write of this
/// process uses: `<name>.<tag>-<pid>-<n>`.
pub(crate) fn temp_beside(target: &Path, tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    target.with_file_name(format!("{name}.{tag}-{}-{n}", std::process::id()))
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
        assert_eq!(s.hook_events.len(), ALL_EVENTS.len() - 1);
        assert!(!s.hook_events.iter().any(|e| e == "StatusLine"), "the status line is opt-in");
        assert!(s.island_questions);
        assert_eq!(s.hotkeys.deny, "Ctrl+Alt+D");
        assert!(s.buddy, "the desktop mascot is on for people upgrading");
        assert_eq!(s.buddy_pos, None, "and starts in its corner");
        let placed: Settings = serde_json::from_str(r#"{"buddyPos":[1530,812]}"#).unwrap();
        assert_eq!(placed.sanitized().buddy_pos, Some([1530, 812]));
        assert_eq!(s.buddy_size, 100);
        assert_eq!((s.focus_minutes, s.island_mascot_size), (25, 100));
        assert!(s.assistant_use_apps);
        let huge: Settings = serde_json::from_str(r#"{"buddySize":900}"#).unwrap();
        assert_eq!(huge.sanitized().buddy_size, 200);
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
    fn folder_paths_lose_the_quotes_and_spaces_around_them() {
        // settings-tabs#11: an import or a hand-edited file, cleaned the way the
        // settings window cleans what is typed (kurallar.ts cleanPath).
        let paths = [
            "\"C:\\work\\prod\"",
            "  \"C:\\work\\prod\"\t",
            "'/srv/app'",
            "\" '/home/dev/x' \"",
            "\u{FEFF}/opt/app\n",
            "\"/half/open",
            "/home/dev/it's",
            "\"",
            "\"\"",
            "",
        ];
        let s = Settings {
            projects: paths.iter().map(|p| ProjectPolicy { path: (*p).into(), ..ProjectPolicy::default() }).collect(),
            rules: paths.iter().map(|p| UserRule { project: (*p).into(), ..UserRule::default() }).collect(),
            ..Settings::default()
        }
        .sanitized();
        let expected = [
            "C:\\work\\prod",
            "C:\\work\\prod",
            "/srv/app",
            "/home/dev/x",
            "/opt/app",
            "\"/half/open",
            "/home/dev/it's",
            "\"",
            "",
            "",
        ];
        assert_eq!(s.projects.iter().map(|p| p.path.as_str()).collect::<Vec<_>>(), expected);
        assert_eq!(s.rules.iter().map(|r| r.project.as_str()).collect::<Vec<_>>(), expected);
        // Cleaned, the folder is the session's again.
        let trusted = Settings {
            projects: vec![ProjectPolicy {
                path: "\"C:\\work\\prod\"".into(),
                mode: "trusted".into(),
                note: "".into(),
            }],
            ..Settings::default()
        };
        assert!(crate::rules::policy_for(&trusted.projects, "C:\\work\\prod\\api").is_none(), "quoted: no match");
        let trusted = trusted.sanitized();
        assert_eq!(crate::rules::policy_for(&trusted.projects, "C:\\work\\prod\\api").unwrap().mode, "trusted");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nobetci-settings-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn files_starting(dir: &Path, prefix: &str) -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(prefix)))
            .collect();
        found.sort();
        found
    }

    /// Loads a file that must load cleanly.
    fn clean(path: &Path) -> Settings {
        let loaded = load_from(path);
        assert_eq!(loaded.problem, None, "nothing to report");
        loaded.settings
    }

    #[test]
    fn saving_and_loading_round_trips_and_survives_a_bom() {
        let dir = scratch("roundtrip");
        let path = dir.join("settings.json");

        assert_eq!(clean(&path).hold_ms, Settings::default().hold_ms, "no file yet: defaults");
        assert!(!clean(&path).onboarded, "and a first run");

        let wanted = Settings {
            hold_ms: 900,
            rules: vec![UserRule { id: "r1".into(), pattern: "npm".into(), ..UserRule::default() }],
            ..Settings::default()
        };
        save_to(&path, &wanted).unwrap();
        let back = clean(&path);
        assert_eq!((back.hold_ms, &back.rules), (900, &wanted.rules));
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "no temporary file stays behind: {leftovers:?}");

        // Saved by Notepad or PowerShell 5: UTF-8 with a BOM.
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(br#"{"holdMs":700}"#);
        std::fs::write(&path, bom).unwrap();
        assert_eq!(clean(&path).hold_ms, 700);

        // An empty file holds nothing to lose: like no file at all.
        std::fs::write(&path, b" \n").unwrap();
        assert!(!clean(&path).onboarded);

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_that_is_not_json_is_kept_once_and_reported() {
        let dir = scratch("bad");
        let path = dir.join("settings.json");
        let broken = br#"{"holdMs": 900, "rules": [ { "pattern": "npm" "#;
        std::fs::write(&path, broken).unwrap();

        let loaded = load_from(&path);
        assert_eq!(loaded.settings.hold_ms, Settings::default().hold_ms);
        assert!(loaded.settings.onboarded, "a settings file existed: no welcome wizard over the problem");
        let problem = loaded.problem.expect("reported");
        assert_eq!(problem.kind, ProblemKind::Parse);
        let kept = files_starting(&dir, "settings.json.unreadable-");
        assert_eq!(kept.len(), 1, "the unreadable file must be kept");
        assert_eq!(std::fs::read(&kept[0]).unwrap(), broken);
        assert_eq!(problem.kept.as_deref(), Some(kept[0].as_path()));
        assert!(problem.log_line().contains("settings.json.unreadable-"), "{}", problem.log_line());
        assert_eq!(std::fs::read(&path).unwrap(), broken, "the file itself is left alone");

        // The next start with the same file: the same copy, not another one.
        let again = load_from(&path).problem.unwrap();
        assert_eq!(again.kept, problem.kept);
        assert_eq!(files_starting(&dir, "settings.json.unreadable-").len(), 1);

        // Both languages say what to do about it.
        let en = problem.message(&path, false);
        let tr = problem.message(&path, true);
        assert!(en.contains("Fix the file") && en.contains(&kept[0].display().to_string()), "{en}");
        assert!(tr.contains("Dosyayı düzelt") && tr.contains("kopyası"), "{tr}");

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_file_that_cannot_be_read_gives_defaults_and_a_problem_not_silence() {
        // A folder where the file should be: reading fails with something other
        // than NotFound on every OS, like a lock or a permission problem would.
        let dir = scratch("unreadable");
        let path = dir.join("settings.json");
        std::fs::create_dir_all(&path).unwrap();
        let loaded = load_from(&path);
        let problem = loaded.problem.expect("a read error is never mistaken for a missing file");
        assert_eq!(problem.kind, ProblemKind::Read);
        assert_eq!(problem.kept, None, "nothing could be read, so nothing could be copied");
        assert!(loaded.settings.onboarded);
        assert!(problem.message(&path, false).contains("No copy"), "{}", problem.message(&path, false));
        assert!(problem.message(&path, true).contains("yeniden başlat"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_value_of_the_wrong_type_costs_only_that_value() {
        let dir = scratch("partial");
        let path = dir.join("settings.json");
        let file = r#"{
            "holdMs": "900",
            "inputGuard": false,
            "language": ["tr"],
            "rules": [
                { "id": "deny-rm", "tool": "Bash", "pattern": "rm -rf", "action": "deny" },
                { "id": "half", "tool": "Bash", "pattern": 5, "action": "allow" },
                { "id": "ok", "enabled": false, "pattern": "npm test", "action": "allow" }
            ],
            "projects": [{ "path": "/srv/app", "mode": "strict" }],
            "hotkeys": { "toggle": 7, "deny": "Ctrl+Alt+X" },
            "denyReasons": ["Stop.", 3, "Ask first."],
            "onboarded": "yes"
        }"#;
        std::fs::write(&path, file).unwrap();

        let loaded = load_from(&path);
        let s = loaded.settings;
        // What could be read is in force: the deny rule, the strict project, the guard setting.
        assert_eq!(s.rules.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["deny-rm", "ok"]);
        assert_eq!(s.rules[0].action, "deny");
        assert_eq!(s.projects[0].mode, "strict");
        assert!(!s.input_guard);
        assert_eq!(s.hotkeys.deny, "Ctrl+Alt+X");
        assert_eq!(s.hotkeys.toggle, Hotkeys::default().toggle);
        assert_eq!(s.deny_reasons, ["Stop.", "Ask first."]);
        // What could not be read keeps its default, and nothing is half-applied:
        // the rule with a broken pattern is gone, not an allow-everything rule.
        assert_eq!(s.hold_ms, Settings::default().hold_ms);
        assert_eq!(s.language, "auto");
        assert!(s.onboarded);
        let problem = loaded.problem.expect("reported");
        assert_eq!(problem.kind, ProblemKind::Partial);
        for key in ["holdMs", "language", "rules[1]", "hotkeys.toggle", "denyReasons[1]", "onboarded"] {
            assert!(problem.defaulted.iter().any(|d| d == key), "{key} missing from {:?}", problem.defaulted);
        }
        assert!(!problem.defaulted.iter().any(|d| d.starts_with("language[")), "{:?}", problem.defaulted);
        assert_eq!(std::fs::read(problem.kept.as_ref().unwrap()).unwrap(), file.as_bytes());
        assert!(problem.message(&path, false).contains("rules[1]"));
        let _ = std::fs::remove_dir_all(dir);
    }

    /// What a request comes to under `s`, in `cwd`.
    fn decide(s: &Settings, cwd: &str, command: &str) -> crate::rules::Outcome {
        let input = serde_json::json!({ "command": command });
        let grants = crate::rules::SessionGrants::default();
        let request = crate::rules::Request { tool: "Bash", input: &input, cwd, session: "s", truncated: false };
        crate::rules::evaluate(&request, s, &grants).outcome
    }

    fn load_text(name: &str, text: &str) -> Loaded {
        let dir = scratch(name);
        let path = dir.join("settings.json");
        std::fs::write(&path, text).unwrap();
        let loaded = load_from(&path);
        let _ = std::fs::remove_dir_all(dir);
        loaded
    }

    /// hooks-settings#1: a broken field in a deny rule or a strict project
    /// costs that field, not the rule — the file's restrictions stay in force.
    #[test]
    fn a_restriction_with_a_broken_note_still_restricts() {
        use crate::rules::Outcome;
        let loaded = load_text(
            "keep-deny",
            r#"{
                "autoAllowMax": "medium",
                "rules": [
                    { "id": "no-push", "tool": "Bash", "pattern": "git push", "mode": "prefix", "action": "deny", "message": null },
                    { "id": "git-ok", "tool": "Bash", "pattern": "git", "mode": "prefix", "action": "allow", "name": 3 }
                ],
                "projects": [
                    { "path": "/work", "mode": "trusted" },
                    { "path": "/work/prod", "mode": "strict", "note": null }
                ]
            }"#,
        );
        let s = &loaded.settings;
        assert_eq!(
            s.rules.iter().map(|r| (r.id.as_str(), r.enabled)).collect::<Vec<_>>(),
            [("no-push", true), ("git-ok", true)]
        );
        assert_eq!((s.rules[0].message.as_str(), s.rules[1].name.as_str()), ("", ""));
        assert_eq!(s.projects.iter().map(|p| p.mode.as_str()).collect::<Vec<_>>(), ["trusted", "strict"]);
        let problem = loaded.problem.unwrap();
        for field in ["rules[0].message", "rules[1].name", "projects[1].note"] {
            assert!(problem.defaulted.iter().any(|d| d == field), "{field}: {:?}", problem.defaulted);
        }
        assert_eq!(problem.held, Held::default(), "nothing was lost, nothing is held back");
        assert_eq!(decide(s, "/srv/app", "git push origin main"), Outcome::Deny, "what the file meant");
        assert_eq!(decide(s, "/srv/app", "git status"), Outcome::Allow);
        assert_eq!(decide(s, "/work/prod/api", "ls"), Outcome::Ask, "strict, as the file meant");
        assert_eq!(decide(s, "/work/api", "ls"), Outcome::Allow, "trusted, as the file meant");
    }

    /// hooks-settings#1: a rule or project that cannot be kept turns off what
    /// could let its requests through instead: allow and lower-to-LOW rules,
    /// and trust.
    #[test]
    fn a_lost_restriction_holds_back_what_could_let_its_requests_through() {
        use crate::rules::Outcome;
        let text = r#"{
            "autoAllowMax": "medium",
            "rules": [
                { "id": "no-push", "tool": "Bash", "pattern": 5, "action": "deny" },
                { "id": "git-ok", "tool": "Bash", "pattern": "git", "mode": "prefix", "action": "allow" },
                { "id": "calm", "tool": "Bash", "pattern": "ls", "mode": "prefix", "action": "low" },
                { "id": "loud", "tool": "Bash", "pattern": "curl", "mode": "prefix", "action": "high" }
            ],
            "projects": [{ "path": "/work", "mode": "trusted" }, { "path": 7, "mode": "strict" }]
        }"#;
        let loaded = load_text("lost", text);
        let s = &loaded.settings;
        let on: Vec<(&str, bool)> = s.rules.iter().map(|r| (r.id.as_str(), r.enabled)).collect();
        assert_eq!(on, [("git-ok", false), ("calm", false), ("loud", true)], "a rule that raises the risk stays");
        assert_eq!(s.projects.iter().map(|p| p.mode.as_str()).collect::<Vec<_>>(), ["normal"]);
        assert_eq!(decide(s, "/srv/app", "git push origin main"), Outcome::Ask, "asked, never allowed");
        assert_eq!(decide(s, "/work/api", "ls"), Outcome::Ask, "no trust while it is held back");
        let problem = loaded.problem.unwrap();
        assert_eq!(problem.held, Held { permissive: true, auto_allow: false });
        assert!(
            problem.defaulted.iter().any(|d| d == "rules[0]") && problem.defaulted.iter().any(|d| d == "projects[1]")
        );
        let (en, tr) =
            (problem.message(Path::new("settings.json"), false), problem.message(Path::new("settings.json"), true));
        assert!(en.contains("allow rules and rules that lower a risk to LOW are off"), "{en}");
        assert!(tr.contains("izin kuralları ve riski DÜŞÜK'e indiren kurallar kapalı"), "{tr}");
        assert!(problem.log_line().contains("trusted projects count as normal"));

        // A whole list that is not a list is lost too.
        let loaded =
            load_text("lost-list", r#"{ "rules": "oops", "projects": [{ "path": "/work", "mode": "trusted" }] }"#);
        assert_eq!(loaded.settings.projects[0].mode, "normal");
        assert!(loaded.problem.unwrap().held.permissive);
    }

    /// Losing a rule that was off anyway, or a trusted project, takes nothing
    /// away from what the file restricted: nothing is held back.
    #[test]
    fn losing_an_unused_rule_or_a_trusted_project_holds_nothing_back() {
        let loaded = load_text(
            "harmless",
            r#"{
                "rules": [
                    { "id": "off", "enabled": false, "pattern": 5, "action": "deny" },
                    { "id": "git-ok", "tool": "Bash", "pattern": "git", "mode": "prefix", "action": "allow" }
                ],
                "projects": [{ "path": 7, "mode": "trusted" }, { "path": "/work", "mode": "trusted" }]
            }"#,
        );
        assert!(loaded.settings.rules.iter().all(|r| r.enabled));
        assert_eq!(loaded.settings.projects[0].mode, "trusted");
        assert_eq!(loaded.problem.unwrap().held, Held::default());
    }

    /// An automatic-approval limit that cannot be read approves nothing on its own.
    #[test]
    fn an_unreadable_auto_allow_limit_is_none() {
        let loaded = load_text("auto", r#"{ "autoAllowMax": 5, "holdMs": 900 }"#);
        assert_eq!(loaded.settings.auto_allow_max, "none");
        let problem = loaded.problem.unwrap();
        assert!(problem.held.auto_allow);
        assert!(problem.message(Path::new("s.json"), false).contains("nothing is approved automatically"));
    }

    #[test]
    fn nothing_is_saved_over_a_file_that_could_not_be_read() {
        let dir = scratch("refuse");
        let path = dir.join("settings.json");
        std::fs::write(&path, b"{ broken").unwrap();
        let problem = load_from(&path).problem.unwrap();
        let err = save_checked(Some(&problem), &path, &Settings::default()).unwrap_err();
        assert_eq!(err.code(), "settings_unreadable");
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");
        save_checked(None, &path, &Settings::default()).unwrap();
        assert_eq!(clean(&path).hold_ms, Settings::default().hold_ms);
        let io = SaveError::Io(std::io::Error::other("disk full"));
        assert_eq!(io.code(), "save_failed: disk full");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn overlapping_saves_never_splice_the_file() {
        let dir = scratch("race");
        let path = dir.join("settings.json");
        let short = Settings::default();
        let long = Settings { deny_reasons: vec!["x".repeat(4000); 12], ..Settings::default() };
        std::thread::scope(|scope| {
            for i in 0..8 {
                let (path, s) = (&path, if i % 2 == 0 { &short } else { &long });
                scope.spawn(move || {
                    for _ in 0..25 {
                        save_to(path, s).unwrap();
                    }
                });
            }
        });
        let text = std::fs::read(&path).unwrap();
        assert!(serde_json::from_slice::<Settings>(&text).is_ok(), "the file must always be one whole save");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1, "no temporary files left");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_settings_file_stays_a_link_and_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("link");
        let dotfiles = dir.join("dotfiles");
        let config = dir.join("config");
        std::fs::create_dir_all(&dotfiles).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        std::fs::set_permissions(&config, std::fs::Permissions::from_mode(0o755)).unwrap();
        let real = dotfiles.join("nobetci.json");
        std::fs::write(&real, br#"{"holdMs":800}"#).unwrap();
        let link = config.join("settings.json");
        std::os::unix::fs::symlink("../dotfiles/nobetci.json", &link).unwrap();

        save_to(&link, &Settings { hold_ms: 1500, ..Settings::default() }).unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink(), "the link must stay a link");
        assert_eq!(clean(&real).hold_ms, 1500, "the file it names got the new settings");
        assert_eq!(std::fs::read_dir(&dotfiles).unwrap().count(), 1, "no temporary file left next to it");
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&config), 0o700, "the config folder is tightened to the user");
        assert_eq!(mode(&real), 0o600);

        let plain = config.join("plain.json");
        save_to(&plain, &Settings::default()).unwrap();
        assert_eq!(mode(&plain), 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_copy_never_overwrites_another() {
        let dir = scratch("copies");
        let path = dir.join("settings.json.bak-20261121-101500");
        assert_eq!(write_new_private(&path, b"one").unwrap(), path);
        let second = write_new_private(&path, b"two").unwrap();
        assert_ne!(second, path);
        assert_eq!(std::fs::read(&path).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_export_is_marked_and_imports_back() {
        let s = Settings {
            hold_ms: 1700,
            rules: vec![UserRule { id: "r1".into(), action: "deny".into(), ..UserRule::default() }],
            ..Settings::default()
        };
        let text = export_json(&s).unwrap();
        assert!(text.starts_with("{\n  \"nobetciSettings\": 1,"), "{}", text.chars().take(60).collect::<String>());
        let back = parse_import(text.as_bytes()).unwrap();
        assert_eq!((back.hold_ms, &back.rules), (1700, &s.rules));
        // With a BOM, as Notepad or PowerShell 5 would save an edited copy.
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(text.as_bytes());
        assert_eq!(parse_import(&bom).unwrap().hold_ms, 1700);
        // Nöbetçi's own settings.json (no marker) has every key.
        let plain = serde_json::to_string(&s).unwrap();
        assert_eq!(parse_import(plain.as_bytes()).unwrap().hold_ms, 1700);
        // An older or hand-made file with a few of Nöbetçi's keys.
        assert_eq!(parse_import(br#"{"holdMs":900,"inputGuard":true,"language":"tr"}"#).unwrap().hold_ms, 900);
    }

    #[test]
    fn an_import_refuses_anything_that_is_not_nobetci_settings() {
        for foreign in [
            // Claude Code's own settings.json, the file most likely picked by mistake.
            &br#"{"model":"opus","permissions":{"allow":[]},"hooks":{}}"#[..],
            br#"{"env":{"A":"1"}}"#,
            br#"{"statusLine":{"type":"command","command":"x"}}"#,
            // Even with the marker and Nöbetçi's keys, a Claude key gives it away.
            br#"{"nobetciSettings":1,"holdMs":900,"hooks":{}}"#,
            // Codex / Cursor hook files.
            br#"{"version":1,"hooks":{"stop":[]}}"#,
            b"{}",
            br#"{"name":"some-package","version":"1.0.0"}"#,
            br#"{"holdMs":900,"language":"tr"}"#,
            b"[1,2,3]",
            b"\"settings\"",
        ] {
            assert_eq!(
                parse_import(foreign).unwrap_err(),
                "not_nobetci_settings",
                "{}",
                String::from_utf8_lossy(foreign)
            );
        }
        // A Nöbetçi file with a broken value: Rust's own words, not a silent default.
        let err = parse_import(br#"{"nobetciSettings":1,"holdMs":"slow"}"#).unwrap_err();
        assert!(err.contains("holdMs") || err.contains("invalid type"), "{err}");
        assert!(
            err.starts_with("Not a valid Nöbetçi settings file") || err.starts_with("Geçerli bir Nöbetçi"),
            "{err}"
        );
        let err = parse_import(b"{ not json").unwrap_err();
        assert!(err.contains("Nöbetçi"), "{err}");
    }
}
