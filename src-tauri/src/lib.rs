// Nöbetçi — app wiring and the commands the two windows call.
//
// Nothing here reaches the network and there are no secrets to hold. Decisions
// that matter for safety (risk, rules, the hold requirement) are made in Rust;
// the windows only ask.

mod audit;
mod focus;
mod hooks;
mod hotkeys;
mod i18n;
mod inputguard;
mod island;
mod log;
mod pipe;
mod quiet;
mod redact;
mod risk;
mod rules;
mod settings;
mod sys;
mod tray;
#[cfg(windows)]
mod win_user;

use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

use hooks::{HookPreview, HookStatus};
use hotkeys::HotkeyStatus;
use i18n::{is_tr, pick};
use island::{PollGate, ScreenInfo};
use pipe::{Health, Pending};
use rules::SessionGrants;
use settings::Settings;

/// Keeps spawned helpers from flashing a console window (Windows only; there is
/// nothing to flash elsewhere).
fn quiet_spawn(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
    pub hotkeys: Mutex<Vec<HotkeyStatus>>,
}

fn current(app: &AppHandle) -> Settings {
    app.state::<Shared>().settings.lock().unwrap().clone()
}

fn apply_geometry(app: &AppHandle, s: &Settings, collapsed: bool) {
    island::apply_geometry(app, &s.screen, &s.position, collapsed);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    system_lang: &'static str,
    /// Hooks were installed the last time Nöbetçi saved its settings, but are not
    /// in ~/.claude/settings.json now (removed by hand, by an uninstall, by another tool).
    hooks_lost: bool,
    screen: ScreenInfo,
    version: String,
    hook_path: String,
    /// "windows" or "macos": the front end words a few things differently.
    platform: &'static str,
    /// Whether "quiet in full screen" can work on this OS.
    fullscreen_supported: bool,
}

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    let mut settings = shared.settings.lock().unwrap().clone();
    // The real state of ~/.claude/settings.json wins over whatever we stored.
    let installed = hooks::status().installed;
    let hooks_lost = settings.hooks_installed && !installed;
    settings.hooks_installed = installed;
    let screen = island::screen_info(&app, &settings.screen);
    BootInfo {
        settings,
        system_lang: i18n::system_lang(),
        hooks_lost,
        screen,
        version: env!("CARGO_PKG_VERSION").to_string(),
        hook_path: settings::hook_exe_path().to_string_lossy().to_string(),
        platform: sys::PLATFORM,
        fullscreen_supported: sys::FULLSCREEN_SUPPORTED,
    }
}

/// Stores new preferences and applies whatever they change.
fn store(app: &AppHandle, next: Settings) -> Settings {
    let next = next.sanitized();
    let shared = app.state::<Shared>();
    let prev = {
        let mut cur = shared.settings.lock().unwrap();
        std::mem::replace(&mut *cur, next.clone())
    };
    if let Err(err) = settings::save(&next) {
        log::line(format!("could not save settings: {err}"));
    }
    if prev.autostart != next.autostart {
        let manager = app.autolaunch();
        let result = if next.autostart { manager.enable() } else { manager.disable() };
        if let Err(err) = result {
            log::line(format!("autostart: {err}"));
        }
    }
    if prev.screen != next.screen || prev.position != next.position {
        let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
        apply_geometry(app, &next, collapsed);
    }
    if prev.language != next.language {
        i18n::apply(&next.language);
        tray::relabel(app);
        if let Some(win) = settings_window(app) {
            let _ = win.set_title(pick("Nöbetçi — Settings", "Nöbetçi — Ayarlar"));
        }
    }
    if prev.hotkeys != next.hotkeys || prev.language != next.language {
        *shared.hotkeys.lock().unwrap() = hotkeys::apply(app, &next.hotkeys);
    }
    // Keep both windows in step.
    let _ = app.emit("settings-changed", next.clone());
    next
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Settings {
    store(&app, settings)
}

/// Flips do-not-disturb (island button, tray, or its hotkey).
pub fn toggle_dnd(app: &AppHandle) {
    let mut s = current(app);
    s.dnd = !s.dnd;
    store(app, s);
}

#[tauri::command]
fn set_dnd(app: AppHandle, on: bool) {
    let mut s = current(&app);
    if s.dnd != on {
        s.dnd = on;
        store(&app, s);
    }
}

/// Why the island should stay quiet right now: "dnd", "hours", "fullscreen" or null.
#[tauri::command]
fn quiet_state(app: AppHandle) -> Option<&'static str> {
    quiet::reason(&current(&app))
}

/// Hidden island → shrink the window to the invisible wake strip and park the
/// cursor poll; anything else → full panel and 60 Hz polling.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let s = shared.settings.lock().unwrap().clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    apply_geometry(&app, &s, collapsed);
    // The wake strip must always take the mouse, and a resize invalidates the flag.
    island::set_ignore_cursor(&app, false);
    shared.gate.forget_ignore_state();
    shared.gate.set_active(!collapsed);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    let s = shared.settings.lock().unwrap().clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    apply_geometry(&app, &s, collapsed);
}

/// Opens a session's working folder in VS Code when it is installed, and in
/// Explorer / Finder otherwise.
#[tauri::command]
fn open_folder(path: Option<String>) -> bool {
    // No shell anywhere near this. The path is a project folder chosen by whoever
    // is using Claude Code, and cmd would happily read `&`, `^` and `%` in a
    // folder name as syntax. Finding the launcher ourselves and handing the path
    // over as a separate argument keeps it a path.
    let Some(p) = path.filter(|p| !p.is_empty() && std::path::Path::new(p).is_dir()) else {
        return false;
    };
    open_folder_in_editor(&p)
}

#[cfg(windows)]
fn open_folder_in_editor(p: &str) -> bool {
    if let Some(code) = find_on_path("code") {
        if quiet_spawn(Command::new(code).arg(p)).spawn().is_ok() {
            return true;
        }
    }
    Command::new("explorer").arg(p).spawn().is_ok()
}

#[cfg(target_os = "macos")]
fn open_folder_in_editor(p: &str) -> bool {
    // `open -b` fails at once when no app has VS Code's bundle id, but waits while
    // VS Code starts — so the waiting happens off the main thread.
    let dir = p.to_string();
    std::thread::Builder::new()
        .name("open-folder".into())
        .spawn(move || {
            let vscode = Command::new("/usr/bin/open").args(["-b", "com.microsoft.VSCode"]).arg(&dir).status();
            if !vscode.is_ok_and(|s| s.success()) {
                let _ = Command::new("/usr/bin/open").arg(&dir).status();
            }
        })
        .is_ok()
}

/// Raises the terminal or editor window a session runs in.
#[tauri::command]
fn focus_session(pids: Vec<u32>) -> bool {
    focus::focus_chain(&pids)
}

/// Our own `where`: walks %PATH% against %PATHEXT%, no shell involved.
/// Rust quotes arguments correctly for `.cmd`/`.bat` targets since 1.77, so
/// spawning `code.cmd` directly is safe.
#[cfg(windows)]
fn find_on_path(stem: &str) -> Option<std::path::PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let dirs = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&dirs) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{stem}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Shows a file or folder of ours in Explorer / Finder.
#[tauri::command]
fn open_location(what: String) -> bool {
    let (path, select) = match what.as_str() {
        "log" => (settings::local_dir().join("nobetci.log"), true),
        "audit" => (settings::local_dir().join("audit.jsonl"), true),
        "settings" => (settings::settings_path(), true),
        "claude" => (hooks::settings_path(), true),
        _ => (settings::local_dir(), false),
    };
    reveal(&path, select)
}

#[cfg(windows)]
fn reveal(path: &std::path::Path, select: bool) -> bool {
    let mut cmd = Command::new("explorer");
    if select && path.exists() {
        cmd.arg(format!("/select,{}", path.display()));
    } else {
        cmd.arg(path.parent().filter(|_| select).unwrap_or(path));
    }
    cmd.spawn().is_ok()
}

#[cfg(target_os = "macos")]
fn reveal(path: &std::path::Path, select: bool) -> bool {
    let mut cmd = Command::new("/usr/bin/open");
    if select && path.exists() {
        cmd.arg("-R").arg(path);
    } else {
        cmd.arg(path.parent().filter(|_| select).unwrap_or(path));
    }
    cmd.spawn().is_ok()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ── Claude Code hooks ─────────────────────────────────────────────────────────

#[tauri::command]
fn hooks_status() -> HookStatus {
    hooks::status()
}

/// Returns the diff the user has to look at before anything is written.
#[tauri::command]
fn hooks_preview(app: AppHandle, install: bool) -> Result<HookPreview, String> {
    hooks::preview(install, &current(&app).hook_events)
}

/// Only ever called from an explicit click in the settings window.
#[tauri::command]
fn hooks_apply(app: AppHandle, install: bool, fingerprint: String) -> Result<String, String> {
    // The fingerprint comes from the preview the user actually looked at, so a
    // settings.json that changed in between is refused rather than overwritten.
    let mut s = current(&app);
    let backup = hooks::write(install, &fingerprint, &s.hook_events)?;
    s.hooks_installed = install;
    store(&app, s);
    log::line(format!("hooks {}", if install { "installed" } else { "removed" }));
    Ok(backup)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthReport {
    installed: bool,
    relay_path: String,
    relay_exists: bool,
    settings_path: String,
    events_installed: Vec<String>,
    events_missing: Vec<String>,
    stale: bool,
    /// Time for a ping through the real relay and pipe; null when it never arrived.
    roundtrip_ms: Option<u64>,
    /// The physical-click guard could register for raw mouse input.
    input_guard: bool,
    error: Option<String>,
}

/// Checks the whole path: settings.json entries, the relay on disk, and a real
/// round trip — the relay is run exactly as Claude Code would run it.
#[tauri::command]
async fn hooks_health(app: AppHandle) -> HealthReport {
    let status = hooks::status();
    let wanted = current(&app).hook_events;
    let events_missing: Vec<String> = wanted.iter().filter(|e| !status.events.contains(e)).cloned().collect();
    let exe = settings::hook_exe_path();
    let mut report = HealthReport {
        installed: status.installed,
        relay_path: exe.to_string_lossy().to_string(),
        relay_exists: exe.exists(),
        settings_path: status.settings_path.clone(),
        events_installed: status.events.clone(),
        events_missing,
        stale: status.stale,
        roundtrip_ms: None,
        input_guard: inputguard::available(),
        error: None,
    };
    if !report.relay_exists {
        report.error = Some(
            pick(
                "The relay is missing; restarting Nöbetçi puts it back.",
                "Relay bulunamadı; uygulamayı yeniden başlatmak onu tekrar yerleştirir.",
            )
            .into(),
        );
        return report;
    }

    let nonce = format!("{:x}-{}", audit::now_ms(), std::process::id());
    let payload = serde_json::json!({ "hook_event_name": pipe::PING_EVENT, "nonce": nonce, "cwd": "." }).to_string();
    let started = Instant::now();
    let spawned = quiet_spawn(
        Command::new(&exe).arg(pipe::PING_EVENT).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()),
    )
    .spawn();
    match spawned {
        Ok(mut child) => {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(payload.as_bytes());
            }
            let deadline = started + Duration::from_secs(3);
            while Instant::now() < deadline {
                let arrived = app.state::<Health>().0.lock().unwrap().as_ref().is_some_and(|(n, _)| *n == nonce);
                if arrived {
                    report.roundtrip_ms = Some(started.elapsed().as_millis() as u64);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            let _ = child.wait();
            if report.roundtrip_ms.is_none() {
                report.error = Some(
                    pick(
                        "The relay ran, but the ping never reached the pipe.",
                        "Relay çalıştı ama ping pipe'a ulaşmadı.",
                    )
                    .into(),
                );
            }
        }
        Err(err) => {
            report.error = Some(if is_tr() {
                format!("Relay başlatılamadı: {err}")
            } else {
                format!("Couldn't start the relay: {err}")
            })
        }
    }
    report
}

// ── Permission requests ───────────────────────────────────────────────────────

/// How a decision was made, beyond allow/deny.
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct DecisionOptions {
    /// Told to Claude on a denial.
    message: Option<String>,
    /// Deny and end the turn.
    stop: bool,
    /// Allow this exact request again for the rest of the session.
    remember: bool,
    /// "user" (a click on the island) or "hotkey".
    via: Option<String>,
    /// Where the Allow button was, for the physical-click check.
    anchor: Option<pipe::Anchor>,
}

/// `allow`, `allow_confirmed` (held, for a risky request) or `deny`.
#[tauri::command]
fn approval_decision(
    app: AppHandle,
    request_id: String,
    decision: String,
    opts: DecisionOptions,
) -> Result<(), String> {
    pipe::answer(
        &app,
        &request_id,
        pipe::Choice {
            decision: &decision,
            anchor: opts.anchor,
            message: opts.message.as_deref(),
            stop: opts.stop,
            remember: opts.remember,
            via: opts.via.as_deref().unwrap_or("user"),
        },
    )
}

/// The card is on screen or queued, so the long wait for a person may begin.
#[tauri::command]
fn approval_ack(app: AppHandle, request_id: String) {
    pipe::acknowledge(&app, &request_id);
}

/// Nobody will act on this request here; Claude Code asks in the terminal now.
#[tauri::command]
fn approval_decline(app: AppHandle, request_id: String, reason: Option<String>) {
    pipe::decline(&app, &request_id, reason.as_deref().unwrap_or("terminal"));
}

// ── Risk and rules ────────────────────────────────────────────────────────────

/// Scores and rule-checks a request without anyone waiting on it — the "try it"
/// boxes in Settings. Uses the saved settings, or `draft` if given.
#[tauri::command]
fn rules_test(app: AppHandle, tool: String, input: Value, cwd: String, draft: Option<Settings>) -> rules::Evaluation {
    let s = draft.map(Settings::sanitized).unwrap_or_else(|| current(&app));
    let grants = SessionGrants::default();
    rules::evaluate(
        &rules::Request { tool: &tool, input: &input, cwd: &cwd, session: "", truncated: false },
        &s,
        &grants,
    )
}

#[tauri::command]
fn risk_categories() -> Vec<risk::CategoryInfo> {
    risk::categories()
}

// ── History ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn audit_query(log: State<audit::Log>, filter: audit::Filter) -> audit::Page {
    log.query(&filter)
}

#[tauri::command]
fn audit_stats(log: State<audit::Log>, days: u32, tz_offset_min: i32) -> audit::Stats {
    log.stats(days, tz_offset_min)
}

/// Every project in the history, most frequent first — for filters and suggestions.
#[tauri::command]
fn audit_projects(log: State<audit::Log>) -> Vec<(String, usize)> {
    log.projects()
}

#[tauri::command]
fn audit_clear(app: AppHandle, log: State<audit::Log>) -> Result<(), String> {
    log.clear().map_err(|e| e.to_string())?;
    log::line("history cleared");
    let _ = app.emit("history-changed", ());
    Ok(())
}

fn settings_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("settings")
}

/// Saves the filtered history as CSV or JSON where the user picks.
#[tauri::command]
async fn audit_export(
    app: AppHandle,
    filter: audit::Filter,
    format: String,
    tz_offset_min: i32,
) -> Result<Option<String>, String> {
    let json = format == "json";
    let entries = {
        let log = app.state::<audit::Log>();
        log.query_up_to(&audit::Filter { offset: 0, ..filter }, usize::MAX).entries
    };
    let name = format!(
        "{}-{}.{}",
        pick("nobetci-history", "nobetci-gecmis"),
        audit::local_stamp(audit::now_ms(), tz_offset_min).replace([' ', ':'], "-"),
        if json { "json" } else { "csv" }
    );
    let mut dialog = app.dialog().file().set_title(pick("Export history", "Geçmişi dışa aktar")).set_file_name(&name);
    dialog = if json { dialog.add_filter("JSON", &["json"]) } else { dialog.add_filter("CSV", &["csv"]) };
    if let Some(win) = settings_window(&app) {
        dialog = dialog.set_parent(&win);
    }
    let Some(path) = dialog.blocking_save_file().and_then(|p| p.into_path().ok()) else { return Ok(None) };
    audit::write_export(&path, &entries, if json { "json" } else { "csv" }, tz_offset_min)
        .map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// A folder picker for rule and project paths.
#[tauri::command]
async fn pick_folder(app: AppHandle, start: Option<String>) -> Option<String> {
    let mut dialog = app.dialog().file().set_title(pick("Choose a folder", "Klasör seç"));
    if let Some(dir) = start.filter(|d| std::path::Path::new(d).is_dir()) {
        dialog = dialog.set_directory(dir);
    }
    if let Some(win) = settings_window(&app) {
        dialog = dialog.set_parent(&win);
    }
    dialog.blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

// ── Settings file ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn settings_export(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title(pick("Export settings", "Ayarları dışa aktar"))
        .set_file_name(pick("nobetci-settings.json", "nobetci-ayarlar.json"))
        .add_filter("JSON", &["json"]);
    if let Some(win) = settings_window(&app) {
        dialog = dialog.set_parent(&win);
    }
    let Some(path) = dialog.blocking_save_file().and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let body = serde_json::to_string_pretty(&current(&app)).map_err(|e| e.to_string())?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Loads preferences from a file. Everything is re-validated; whether hooks are
/// installed always comes from ~/.claude/settings.json, never from the file.
#[tauri::command]
async fn settings_import(app: AppHandle) -> Result<Option<Settings>, String> {
    let mut dialog =
        app.dialog().file().set_title(pick("Import settings", "Ayarları içe aktar")).add_filter("JSON", &["json"]);
    if let Some(win) = settings_window(&app) {
        dialog = dialog.set_parent(&win);
    }
    let Some(path) = dialog.blocking_pick_file().and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut imported: Settings = serde_json::from_slice(&bytes).map_err(|e| {
        if is_tr() {
            format!("Geçerli bir Nöbetçi ayar dosyası değil: {e}")
        } else {
            format!("Not a valid Nöbetçi settings file: {e}")
        }
    })?;
    imported.hooks_installed = hooks::status().installed;
    Ok(Some(store(&app, imported)))
}

#[tauri::command]
fn settings_reset(app: AppHandle) -> Settings {
    let fresh = Settings { hooks_installed: hooks::status().installed, ..Settings::default() };
    store(&app, fresh)
}

// ── Notifications and hotkeys ─────────────────────────────────────────────────

/// A desktop notification for `kind` (approval, finished, error, waiting), if the
/// settings want one right now. Returns whether it was shown.
#[tauri::command]
fn notify(app: AppHandle, kind: String, title: String, body: String, island_visible: bool) -> bool {
    let s = current(&app);
    if !s.toast_enabled || !s.toast_events.contains(&kind) || quiet::reason(&s).is_some() {
        return false;
    }
    if s.toast_only_when_hidden && island_visible {
        return false;
    }
    // Notifications linger in the action centre and can show on the lock screen:
    // no live tokens in them.
    app.notification()
        .builder()
        .title(redact::redact(&title).chars().take(80).collect::<String>())
        .body(redact::redact(&body).chars().take(240).collect::<String>())
        .show()
        .map_err(|e| log::line(format!("notification failed: {e}")))
        .is_ok()
}

#[tauri::command]
fn hotkeys_status(shared: State<Shared>) -> Vec<HotkeyStatus> {
    shared.hotkeys.lock().unwrap().clone()
}

/// Lets the windows write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── Settings window ───────────────────────────────────────────────────────────

/// WebView2 allows exactly one browser environment per app, and its options are
/// fixed by whichever webview is created first. Every window must therefore ask
/// for the *same* arguments as the island (see `additionalBrowserArgs` in
/// tauri.conf.json) — a mismatch makes the second window come up blank, with no
/// error anywhere.
const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn settings_page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/settings.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. A WebView2 window created later silently comes up blank,
/// so the window that works is the one that exists before the island's webview.
fn create_settings_window(app: &AppHandle) {
    let url = settings_page_url(app);
    match WebviewWindowBuilder::new(app, "settings", url)
        .additional_browser_args(BROWSER_ARGS)
        .title(pick("Nöbetçi — Settings", "Nöbetçi — Ayarlar"))
        .inner_size(1000.0, 740.0)
        .min_inner_size(760.0, 520.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            let hidden = win.clone();
            let handle = app.clone();
            win.on_window_event(move |event| match event {
                // Closing it must only hide it, or it could never be reopened.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
                // The island is always on top and, open, covers the top-centre of
                // the screen — right where a centred window keeps its title bar and
                // close button. Whenever the settings window is in use, the island
                // folds away (unless a request is waiting on it).
                tauri::WindowEvent::Focused(true) => {
                    let _ = handle.emit_to(island::WINDOW_LABEL, "settings-focused", ());
                }
                _ => {}
            });
        }
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
}

/// Shows the settings window, optionally on a given tab (genel, claude, guvenlik,
/// kurallar, bildirimler, gecmis, hakkinda).
pub fn show_settings_window(app: &AppHandle, tab: Option<&str>) {
    let Some(win) = settings_window(app) else {
        log::line("settings window missing");
        return;
    };
    if let Some(tab) = tab {
        let _ = app.emit_to("settings", "settings-tab", tab.to_string());
    }
    let _ = app.emit_to(island::WINDOW_LABEL, "settings-focused", ());
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn open_settings_window(app: AppHandle, tab: Option<String>) {
    show_settings_window(&app, tab.as_deref());
}

/// The settings page's own close button.
#[tauri::command]
fn close_settings_window(app: AppHandle) {
    if let Some(win) = settings_window(&app) {
        let _ = win.hide();
    }
}

/// Command-line jobs that run instead of the app. Returns an exit code when one ran.
///
/// `--remove-hooks` is what the uninstaller calls: it removes Nöbetçi's entries
/// from ~/.claude/settings.json (with a dated backup), because hooks pointing at
/// a relay that no longer exists make Claude Code report an error on every event.
pub fn cli() -> Option<i32> {
    if !std::env::args().any(|a| a == "--remove-hooks") {
        return None;
    }
    i18n::apply("auto");
    Some(match hooks::remove_for_uninstall() {
        Ok(Some(backup)) => {
            log::line(format!("uninstall: hooks removed (backup {backup})"));
            0
        }
        Ok(None) => 0,
        Err(err) => {
            log::line(format!("uninstall: could not remove hooks: {err}"));
            1
        }
    })
}

pub fn run() {
    // Language first: default settings (deny reasons) depend on it.
    i18n::apply("auto");
    let loaded = settings::load();
    i18n::apply(&loaded.language);
    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Shared { settings: Mutex::new(loaded.clone()), gate: gate.clone(), hotkeys: Mutex::new(Vec::new()) })
        .manage(Pending::default())
        .manage(Health::default())
        .manage(SessionGrants::default())
        .manage(audit::Log::new(settings::local_dir()))
        .invoke_handler(tauri::generate_handler![
            boot,
            save_settings,
            set_dnd,
            quiet_state,
            set_collapsed,
            set_island_rect,
            reposition,
            open_folder,
            focus_session,
            open_location,
            quit_app,
            hooks_status,
            hooks_preview,
            hooks_apply,
            hooks_health,
            approval_decision,
            approval_ack,
            approval_decline,
            rules_test,
            risk_categories,
            audit_query,
            audit_stats,
            audit_clear,
            audit_export,
            audit_projects,
            pick_folder,
            settings_export,
            settings_import,
            settings_reset,
            notify,
            hotkeys_status,
            log_line,
            open_settings_window,
            close_settings_window,
        ])
        .setup(move |app| {
            // macOS: a menu-bar app — no Dock icon, not in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            tray::build(&handle)?;
            // Before the island: see create_settings_window.
            create_settings_window(&handle);

            if let Some(win) = island::window(&handle) {
                island::make_non_activating(&win);
                apply_geometry(&handle, &loaded, false);
                let _ = win.show();
            }
            gate.collapsed.store(false, Ordering::Relaxed);
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            log::line(format!("--- Nöbetçi {} started ---", env!("CARGO_PKG_VERSION")));
            *handle.state::<Shared>().hotkeys.lock().unwrap() = hotkeys::apply(&handle, &loaded.hotkeys);
            hooks::ensure_hook_exe(&handle);
            inputguard::start(&handle);
            pipe::start(handle.clone());

            // First run: the welcome wizard, once the owl has said hello.
            if !loaded.onboarded {
                let welcome = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(4500));
                    let app = welcome.clone();
                    let _ = welcome.run_on_main_thread(move || show_settings_window(&app, Some("hosgeldin")));
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nöbetçi");
}
