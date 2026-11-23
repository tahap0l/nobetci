// Nöbetçi — app wiring and the commands the two windows call.
//
// Network access is limited to the explicit prompt-review provider call and the
// opt-in weather card (widgets.rs). Optional API credentials use the OS vault.
// Safety decisions (risk, rules, hold) stay in Rust; the windows only ask.

mod agenda;
mod agent_hooks;
mod assistant;
mod audit;
mod buddy;
mod focus;
mod hooks;
mod hotkeys;
mod i18n;
mod inputguard;
mod island;
mod log;
#[cfg(target_os = "macos")]
mod mac_fullscreen;
#[cfg(target_os = "macos")]
mod mac_panel;
mod pipe;
mod prompts;
mod quiet;
mod redact;
mod risk;
mod rules;
mod settings;
mod sys;
mod tray;
mod widgets;
#[cfg(windows)]
mod win_user;
#[cfg(target_os = "linux")]
mod x11;

use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, PoisonError};
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
    /// "windows", "macos" or "linux": the front end words a few things differently.
    platform: &'static str,
    /// Whether "quiet in full screen" can work on this OS.
    fullscreen_supported: bool,
    /// settings.json was there but could not be used at start: what happened and
    /// what to do. Defaults (or every value that could be read) are in use, and
    /// nothing is saved over the file until Nöbetçi restarts. Null otherwise.
    settings_load_error: Option<String>,
    /// Whether the island may approve a request that needs a hold (HIGH and
    /// CRITICAL). False on Linux, where a program's fake click cannot be told
    /// from a real one: there such requests are decided in the terminal, and
    /// Rust refuses an island approval with `terminal_only` (D23).
    hold_approvals: bool,
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
        settings_load_error: settings::load_problem(),
        hold_approvals: inputguard::vouches_for_holds(),
    }
}

/// Stores go one at a time, so the preferences in memory and settings.json
/// change in the same order and the file never ends up older than memory.
static STORING: Mutex<()> = Mutex::new(());

/// Stores new preferences and applies whatever they change. They take effect
/// even when settings.json cannot be written (a full disk, or a file that could
/// not be read at start); the second half says whether it was, as the error the
/// settings window understands (`save_failed: …`, `settings_unreadable`).
///
/// Starting at login is the exception: when the OS refuses the change, the
/// setting keeps its old value and a `settings-warning` says why, instead of a
/// switch that shows on while nothing starts at login.
fn apply_settings(app: &AppHandle, next: Settings, autostart_is_the_os_state: bool) -> (Settings, Result<(), String>) {
    let mut next = next.sanitized();
    let shared = app.state::<Shared>();
    let (prev, saved, refused) = {
        let _in_order = STORING.lock().unwrap_or_else(PoisonError::into_inner);
        let prev = shared.settings.lock().unwrap().clone();
        let mut refused = None;
        if prev.autostart != next.autostart && !autostart_is_the_os_state {
            if let Err(err) = set_autostart(app, next.autostart) {
                log::line(format!("autostart: {err}"));
                next.autostart = prev.autostart;
                refused = Some(err);
            }
        }
        {
            let mut cur = shared.settings.lock().unwrap();
            // Only the mascot's window moves it; a settings window opened before the
            // last drag must not put it back where it was.
            next.buddy_pos = cur.buddy_pos;
            *cur = next.clone();
        }
        let saved = settings::save(&next).map_err(|err| {
            log::line(format!("could not save settings: {err}"));
            err.code()
        });
        (prev, saved, refused)
    };
    if prev.buddy != next.buddy {
        buddy::apply(app, next.buddy);
    } else if prev.buddy_size != next.buddy_size {
        buddy::resize(app, next.buddy_size);
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
    if let Some(detail) = refused {
        let _ = app.emit("settings-warning", serde_json::json!({ "code": "autostart_failed", "detail": detail }));
    }
    (next, saved)
}

/// `apply_settings` for callers with nobody to show a failed save to (the
/// island's buttons, the tray, the mascot): it is logged.
fn store(app: &AppHandle, next: Settings) -> Settings {
    apply_settings(app, next, false).0
}

/// `apply_settings` for the settings window, which shows a failed save.
fn try_store(app: &AppHandle, next: Settings) -> Result<Settings, String> {
    let (stored, saved) = apply_settings(app, next, false);
    saved.map(|()| stored)
}

/// Writes the preferences in memory to settings.json, in turn with `store`, so
/// an older snapshot never lands after a newer one (the mascot's moves and its
/// reset change memory first and save here).
fn persist(app: &AppHandle) {
    let _in_order = STORING.lock().unwrap_or_else(PoisonError::into_inner);
    if let Err(err) = settings::save(&current(app)) {
        log::line(format!("could not save settings: {err}"));
    }
}

fn set_autostart(app: &AppHandle, on: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if on { manager.enable() } else { manager.disable() }.map_err(|e| e.to_string())
}

/// At start, the "Start at login" switch follows the OS. A login entry removed
/// outside Nöbetçi (Task Manager, Login Items, the desktop's autostart settings,
/// a cleanup tool) turns the setting off instead of being put back over that
/// choice. On Linux the desktop may switch the entry off instead of removing it
/// (`Hidden=true`, `X-GNOME-Autostart-enabled=false`), which counts the same;
/// an entry that is on gets its `Exec=` line brought up to date — it names the
/// program by path, and an AppImage replaced by a newer file has a new one —
/// and nothing else of it is touched.
fn reconcile_autostart(app: &AppHandle) {
    if !current(app).autostart {
        return;
    }
    let Some(manager) = app.try_state::<tauri_plugin_autostart::AutoLaunchManager>() else { return };
    let switched_off = |how: &str| {
        log::line(format!("autostart: the login entry is {how} (changed outside Nöbetçi); the setting follows it"));
        let mut s = current(app);
        s.autostart = false;
        // A failed save is logged inside; the switch shows the truth meanwhile.
        let _ = apply_settings(app, s, true);
    };
    match manager.is_enabled() {
        Ok(true) =>
        {
            #[cfg(target_os = "linux")]
            if refresh_login_entry(app) == LoginEntry::SwitchedOff {
                switched_off("switched off");
            }
        }
        Ok(false) => switched_off("gone"),
        Err(err) => log::line(format!("autostart: could not check the login entry: {err}")),
    }
}

#[cfg(target_os = "linux")]
#[derive(PartialEq)]
enum LoginEntry {
    On,
    SwitchedOff,
}

/// Linux: reads Nöbetçi's XDG autostart entry, says whether the desktop
/// switched it off, and points its `Exec=` at the program running now — the
/// program alone: what the user wrote around it stays (`sys::login_entry_for`).
#[cfg(target_os = "linux")]
fn refresh_login_entry(app: &AppHandle) -> LoginEntry {
    // Where the autostart plugin keeps it, under the name it gives it.
    let file = sys::home().join(".config").join("autostart").join(format!("{}.desktop", app.package_info().name));
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(err) => {
            log::line(format!("autostart: could not read the login entry {}: {err}", file.display()));
            return LoginEntry::On;
        }
    };
    if sys::login_entry_switched_off(&text) {
        return LoginEntry::SwitchedOff;
    }
    // The program the plugin names: the AppImage when there is one.
    let program = app
        .env()
        .appimage
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .map(|p| p.display().to_string());
    let exists = |path: &str| std::path::Path::new(path).exists();
    if let Some(updated) = program.and_then(|program| sys::login_entry_for(&text, &program, exists)) {
        match std::fs::write(&file, updated) {
            Ok(()) => log::line("autostart: the login entry now starts this copy of Nöbetçi"),
            Err(err) => log::line(format!("autostart: could not refresh the login entry: {err}")),
        }
    }
    LoginEntry::On
}

/// Saves new preferences; rejects with `save_failed: …` or `settings_unreadable`
/// when settings.json could not be written (the change is in effect until a restart).
#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    try_store(&app, settings)
}

/// Shows or hides the desktop mascot (tray menu).
pub fn toggle_buddy(app: &AppHandle) {
    let mut s = current(app);
    s.buddy = !s.buddy;
    store(app, s);
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
/// cursor poll; anything else → full panel and the cursor poll running.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let s = shared.settings.lock().unwrap().clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    apply_geometry(&app, &s, collapsed);
    // The wake strip must always take the mouse, and a resize invalidates the
    // flag. A last poll tick that decided otherwise checks `collapsed` again on
    // this thread before it applies anything (`island::set_click_through`).
    island::set_ignore_cursor(&app, false);
    shared.gate.forget_ignore_state();
    shared.gate.set_active(!collapsed);
    #[cfg(target_os = "linux")]
    island::fit_shape(&app, &shared.gate);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(app: AppHandle, shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
    #[cfg(target_os = "linux")]
    island::fit_shape(&app, &shared.gate);
    #[cfg(not(target_os = "linux"))]
    let _ = app;
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

/// Linux: VS Code when it is on PATH, the file manager otherwise.
#[cfg(target_os = "linux")]
fn open_folder_in_editor(p: &str) -> bool {
    if sys::command("code").arg(p).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().is_ok() {
        return true;
    }
    sys::command("xdg-open").arg(p).spawn().is_ok()
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

/// The ChatGPT Web guide: its Turkish page for a Turkish interface, otherwise
/// the folder, whose page is the English README.md.
fn chatgpt_web_guide(turkish: bool) -> &'static str {
    if turkish {
        "https://github.com/tahap0l/nobetci/blob/main/integrations/chatgpt-web/README.tr.md"
    } else {
        "https://github.com/tahap0l/nobetci/tree/main/integrations/chatgpt-web"
    }
}

/// Shows a file or folder of ours in Explorer / Finder; "chatgpt-web" opens the
/// ChatGPT Web guide, in Turkish when the interface is.
#[tauri::command]
fn open_location(what: String) -> bool {
    if what == "chatgpt-web" {
        return sys::open_url(chatgpt_web_guide(is_tr()));
    }
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

/// Linux: the file manager, on the folder (selecting a file needs a D-Bus
/// FileManager1 call not every desktop answers; the folder always opens).
#[cfg(target_os = "linux")]
fn reveal(path: &std::path::Path, select: bool) -> bool {
    let dir = if select { path.parent().unwrap_or(path) } else { path };
    sys::command("xdg-open").arg(dir).spawn().is_ok()
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

/// Returns the diff the user has to look at before anything is written, for the
/// chosen events (`install`) or for taking every entry of ours out. Rejects with
/// `relay_missing` when the hooks would point at a relay that is not there.
#[tauri::command]
fn hooks_preview(app: AppHandle, install: bool) -> Result<HookPreview, String> {
    hooks::preview(install, &current(&app).hook_events)
}

/// Only ever called from an explicit click in the settings window. Writes
/// exactly what the preview `fingerprint` showed — not a fresh merge of whatever
/// the settings say now — and rejects with `stale_preview` when settings.json
/// changed in between. Returns the backup path, null when there was no file.
#[tauri::command]
fn hooks_apply(app: AppHandle, install: bool, fingerprint: String) -> Result<Option<String>, String> {
    let backup = hooks::apply(install, &fingerprint)?;
    // What the file holds now, not the button that was pressed: an update with
    // every event unticked removed them all.
    let status = hooks::status();
    let mut s = current(&app);
    s.hooks_installed = status.installed;
    store(&app, s);
    log::line(format!("hooks written: {}", if status.installed { status.events.join(", ") } else { "none".into() }));
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
    codex_activity: Option<pipe::AgentActivity>,
    /// The physical-click guard could register for raw mouse input.
    input_guard: bool,
    error: Option<String>,
    /// Claude Code only: whose status line settings.json has, "ours", "foreign"
    /// or "none". A foreign one is never counted as missing: Nöbetçi leaves it be.
    #[serde(skip_serializing_if = "Option::is_none")]
    status_line: Option<&'static str>,
}

/// Checks hook entries and sends a ping through the installed relay.
#[tauri::command]
async fn hooks_health(app: AppHandle, provider: Option<agent_hooks::Provider>) -> HealthReport {
    let (installed, settings_path, events_installed, stale, wanted, status_line) = match provider {
        Some(provider) => {
            let status = agent_hooks::status(provider);
            let wanted = provider.events().iter().map(|(event, _)| (*event).to_string()).collect();
            (status.installed, status.settings_path, status.events, status.stale, wanted, None)
        }
        None => {
            let status = hooks::status();
            let ours = status.events.iter().any(|e| e == hooks::STATUS_LINE);
            let line = if status.foreign_status_line {
                "foreign"
            } else if ours {
                "ours"
            } else {
                "none"
            };
            let mut wanted = current(&app).hook_events;
            if status.foreign_status_line {
                wanted.retain(|e| e != hooks::STATUS_LINE);
            }
            (status.installed, status.settings_path, status.events, status.stale, wanted, Some(line))
        }
    };
    let events_missing = wanted.into_iter().filter(|event| !events_installed.contains(event)).collect();
    let exe = settings::hook_exe_path();
    let mut report = HealthReport {
        installed,
        relay_path: exe.to_string_lossy().to_string(),
        relay_exists: exe.exists(),
        settings_path,
        events_installed,
        events_missing,
        stale,
        roundtrip_ms: None,
        codex_activity: None,
        input_guard: inputguard::available(),
        error: None,
        status_line,
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
    let mut command = sys::command(&exe);
    if let Some(provider) = provider {
        command.arg(provider.name());
    }
    command.arg(pipe::PING_EVENT).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    let spawned = quiet_spawn(&mut command).spawn();
    match spawned {
        Ok(mut child) => {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(payload.as_bytes());
            }
            let deadline = started + Duration::from_secs(3);
            while Instant::now() < deadline {
                let arrived = app.state::<Health>().ping.lock().unwrap().as_deref() == Some(nonce.as_str());
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
    if provider == Some(agent_hooks::Provider::Codex) {
        report.codex_activity = app.state::<Health>().codex_activity.lock().unwrap().clone();
    }
    report
}

#[tauri::command]
fn agent_hooks_status(provider: agent_hooks::Provider) -> agent_hooks::Status {
    agent_hooks::status(provider)
}

/// Like `hooks_preview`, for Codex's or Cursor's hooks.json.
#[tauri::command]
fn agent_hooks_preview(provider: agent_hooks::Provider, install: bool) -> Result<agent_hooks::Preview, String> {
    agent_hooks::preview(provider, install)
}

/// Like `hooks_apply`: exactly the previewed content, or `stale_preview`.
#[tauri::command]
fn agent_hooks_apply(
    provider: agent_hooks::Provider,
    install: bool,
    fingerprint: String,
) -> Result<Option<String>, String> {
    let backup = agent_hooks::apply(provider, install, &fingerprint)?;
    log::line(format!("{} hooks {}", provider.name(), if install { "installed" } else { "removed" }));
    Ok(backup)
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
    /// "user" (a click on the island) or "hotkey". An allow via the hotkey only
    /// counts right after a real press of the allow shortcut (`hotkeys.rs`).
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

/// The user's answer to one of Claude's questions, or a verdict on its plan.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum ResponseIn {
    Answers { answers: serde_json::Map<String, Value> },
    ApprovePlan,
    Revise { feedback: String },
}

#[tauri::command]
fn approval_respond(
    app: AppHandle,
    request_id: String,
    response: ResponseIn,
    anchor: Option<pipe::Anchor>,
) -> Result<(), String> {
    let response = match response {
        ResponseIn::Answers { answers } => pipe::Response::Answers(answers),
        ResponseIn::ApprovePlan => pipe::Response::ApprovePlan,
        ResponseIn::Revise { feedback } => pipe::Response::Revise(feedback),
    };
    pipe::respond(&app, &request_id, response, anchor)
}

/// Allows, with one click, the low-risk requests the island listed in its batch
/// row (`ids`) that are still waiting; returns how many.
#[tauri::command]
fn approval_allow_low(app: AppHandle, anchor: Option<pipe::Anchor>, ids: Vec<String>) -> Result<usize, String> {
    pipe::allow_low(&app, anchor, &ids)
}

/// The card is on screen or queued, so the long wait for a person may begin.
#[tauri::command]
fn approval_ack(app: AppHandle, request_id: String) {
    pipe::acknowledge(&app, &request_id);
}

/// The card became the island's front, interactive card: approvals for it count
/// from now (a moment later, and with a press made after this).
#[tauri::command]
fn approval_shown(app: AppHandle, request_id: String) {
    pipe::shown(&app, &request_id);
}

/// Every request still waiting, as its `hook` event carried it — for an island
/// that reloaded and has to put its cards back.
#[tauri::command]
fn approval_pending(app: AppHandle) -> Vec<Value> {
    pipe::pending(&app)
}

/// Nobody will act on this request here; Claude Code asks in the terminal now.
/// `expired`: the island's countdown ran out (recorded as a timeout).
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

/// Whether a rule's pattern compiles exactly as the rules will compile it; the
/// regex engine's own message when it does not.
#[tauri::command]
fn rule_pattern_check(mode: String, pattern: String) -> Result<(), String> {
    rules::pattern_error(&mode, &pattern).map_or(Ok(()), Err)
}

#[tauri::command]
fn risk_categories() -> Vec<risk::CategoryInfo> {
    risk::categories()
}

// ── History ───────────────────────────────────────────────────────────────────
//
// Reading the history can take a moment on a long one, so these run off the
// main thread (`async`): the island keeps drawing meanwhile.

#[tauri::command(async)]
fn audit_query(log: State<'_, audit::Log>, filter: audit::Filter) -> audit::Page {
    log.query(&filter)
}

/// Totals per day. `day_starts` (optional, C-18) are the viewer's local
/// midnights, `days + 1` of them; without valid ones, days break at local
/// midnight by today's `tz_offset_min`.
#[tauri::command(async)]
fn audit_stats(
    log: State<'_, audit::Log>,
    days: u32,
    tz_offset_min: i32,
    day_starts: Option<Vec<f64>>,
) -> audit::Stats {
    log.stats(days, tz_offset_min, day_starts.as_deref())
}

/// Every project in the history, most frequent first — for filters and suggestions.
#[tauri::command(async)]
fn audit_projects(log: State<'_, audit::Log>) -> Vec<(String, usize)> {
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

/// Saves the filtered history as CSV or JSON where the user picks. A CSV is
/// comma-separated unless `separator` is ";" (what Excel expects where a comma
/// is the decimal mark, Turkish among them).
#[tauri::command]
async fn audit_export(
    app: AppHandle,
    filter: audit::Filter,
    format: String,
    tz_offset_min: i32,
    separator: Option<String>,
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
    let sep = audit::separator(separator.as_deref());
    audit::write_export(&path, &entries, if json { "json" } else { "csv" }, tz_offset_min, sep)
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
    // Marked as Nöbetçi's, so an import can tell it from other JSON.
    let body = settings::export_json(&current(&app))?;
    std::fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Loads preferences from a file. Only Nöbetçi's own settings are accepted
/// (`not_nobetci_settings` for Claude Code's settings.json and any other JSON),
/// and everything is re-validated. Whether hooks are installed always comes
/// from ~/.claude/settings.json, never from the file, and an import never brings
/// the welcome wizard back. The settings it replaces are kept in a dated copy.
#[tauri::command]
async fn settings_import(app: AppHandle) -> Result<Option<Settings>, String> {
    let mut dialog =
        app.dialog().file().set_title(pick("Import settings", "Ayarları içe aktar")).add_filter("JSON", &["json"]);
    if let Some(win) = settings_window(&app) {
        dialog = dialog.set_parent(&win);
    }
    let Some(path) = dialog.blocking_pick_file().and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut imported = settings::parse_import(&bytes)?;
    imported.hooks_installed = hooks::status().installed;
    imported.onboarded |= current(&app).onboarded;
    if let Some(copy) = settings::keep_copy() {
        log::line(format!(
            "settings imported from {}; the previous ones are kept as {}",
            path.display(),
            copy.display()
        ));
    }
    try_store(&app, imported).map(Some)
}

/// Everything back to the defaults, except what is a fact rather than a
/// preference: whether hooks are installed, and that the welcome was seen (a
/// reset must not bring the first-run wizard back). The settings it replaces
/// are kept in a dated copy.
#[tauri::command]
fn settings_reset(app: AppHandle) -> Result<Settings, String> {
    let fresh = Settings {
        hooks_installed: hooks::status().installed,
        onboarded: current(&app).onboarded,
        ..Settings::default()
    };
    if let Some(copy) = settings::keep_copy() {
        log::line(format!("settings reset; the previous ones are kept as {}", copy.display()));
    }
    try_store(&app, fresh)
}

// ── Notifications and hotkeys ─────────────────────────────────────────────────

/// Whether a desktop notification of `kind` may show now. Claude's session
/// events (approval, finished, error, waiting) follow the chosen event list;
/// `focus`, the end of the island's own focus timer, is the user's timer like
/// an agenda reminder and needs no entry there. Never while notifications are
/// off or it is quiet, nor while the open island already shows it if the
/// settings say so.
fn notification_wanted(s: &Settings, kind: &str, island_visible: bool, quiet: bool) -> bool {
    let listed = kind == "focus" || s.toast_events.iter().any(|event| event == kind);
    s.toast_enabled && listed && !quiet && !(s.toast_only_when_hidden && island_visible)
}

/// The island puts at most the first 160 UTF-16 units of a command or a
/// question into a notification (`src/island/hooks.ts`): a body that long may
/// have been cut there, in the middle of a secret.
const ISLAND_NOTIFY_CUT: usize = 160;

/// How much of a body is read at most: far more than a notification shows.
const NOTIFY_READ: usize = 4000;

/// What a notification shows of `body`. Notifications linger in the action
/// centre and can show on the lock screen: no live tokens in them — nor, in a
/// body that may have been cut (by the island, or here), the first part of
/// one the cut left at the end. Masked first, then cut to 240 characters, so
/// that cut splits no secret.
fn notification_body(body: &str) -> String {
    let (body, cut) = match body.char_indices().nth(NOTIFY_READ) {
        Some((at, _)) => (&body[..at], true),
        None => (body, false),
    };
    let masked = if cut || body.encode_utf16().count() >= ISLAND_NOTIFY_CUT {
        redact::redact_cut(body)
    } else {
        redact::redact(body)
    };
    masked.chars().take(240).collect()
}

/// A desktop notification for `kind` (approval, finished, error, waiting, or
/// focus), if the settings want one right now. Returns whether it was shown.
/// Off the main thread: on Linux the first one asks the notification server
/// what it reads.
#[tauri::command(async)]
fn notify(app: AppHandle, kind: String, title: String, body: String, island_visible: bool) -> bool {
    let s = current(&app);
    if !notification_wanted(&s, &kind, island_visible, quiet::reason(&s).is_some()) {
        return false;
    }
    let body = notification_body(&body);
    // The body carries the command, path or URL Claude asked for. Where the
    // server reads markup, it must show that text as written, not as links.
    #[cfg(target_os = "linux")]
    let body = if sys::notifications_read_markup() { sys::escape_markup(&body) } else { body };
    app.notification()
        .builder()
        .title(redact::redact(&title).chars().take(80).collect::<String>())
        .body(body)
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
/// fixed by whichever webview is created first — the island's, which Tauri
/// builds from tauri.conf.json before `setup` runs. Every later window must
/// therefore ask for the *same* arguments (see `additionalBrowserArgs` there) —
/// a mismatch makes it come up blank, with no error anywhere.
const BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn page_url(app: &AppHandle, page: &str) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path(&format!("/{page}"));
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App(page.into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. It comes after the island's webview, which Tauri creates
/// first from tauri.conf.json; what keeps it from coming up blank on Windows
/// is asking for the island's exact browser arguments (`BROWSER_ARGS`), not
/// the order.
fn create_settings_window(app: &AppHandle) {
    let url = page_url(app, "settings.html");
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
                    handle.state::<audit::Log>().forget();
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
    // The History tab is the only reader of the parsed history.
    app.state::<audit::Log>().forget();
}

/// Command-line jobs that run instead of the app. Returns an exit code when one ran.
///
/// `--remove-hooks` is what the Windows uninstaller calls (and what anybody can
/// run by hand): it takes Nöbetçi's own entries out of Claude Code's
/// settings.json and Codex's and Cursor's hooks.json, each with a dated backup,
/// and leaves every other setting and every other tool's hooks as they are.
/// Hooks pointing at a relay that no longer exists make each tool report an
/// error on every event (Cursor's would refuse every command).
///
/// Exit code 0: none of the three files has an entry of ours left (or it never
/// had one). 1: at least one could not be cleaned — unreadable, changed while
/// being written, a shape Nöbetçi will not overwrite — so the uninstaller keeps
/// the relay those entries still point at. Each file's outcome goes to stderr
/// and nobetci.log.
pub fn cli() -> Option<i32> {
    if !std::env::args_os().skip(1).any(|a| a == "--remove-hooks") {
        return None;
    }
    i18n::apply("auto");
    Some(remove_all_hooks(&mut std::io::stderr()))
}

fn remove_all_hooks(out: &mut impl Write) -> i32 {
    let mut failed = false;
    for (name, result) in [
        ("Claude Code", hooks::remove_for_uninstall()),
        ("Codex", agent_hooks::remove_for_uninstall(agent_hooks::Provider::Codex)),
        ("Cursor", agent_hooks::remove_for_uninstall(agent_hooks::Provider::Cursor)),
    ] {
        let line = match result {
            Ok(Some(backup)) => {
                log::line(format!("uninstall: {name} hooks removed (backup {backup})"));
                if is_tr() {
                    format!("{name}: Nöbetçi'nin hook'ları kaldırıldı (yedek: {backup})")
                } else {
                    format!("{name}: Nöbetçi's hooks removed (backup: {backup})")
                }
            }
            Ok(None) if is_tr() => format!("{name}: kaldırılacak Nöbetçi hook'u yok"),
            Ok(None) => format!("{name}: no Nöbetçi hooks to remove"),
            Err(err) => {
                failed = true;
                log::line(format!("uninstall: could not remove the {name} hooks: {err}"));
                if is_tr() {
                    format!("{name}: Nöbetçi'nin hook'ları kaldırılamadı: {err}")
                } else {
                    format!("{name}: couldn't remove Nöbetçi's hooks: {err}")
                }
            }
        };
        let _ = writeln!(out, "{line}");
    }
    i32::from(failed)
}

pub fn run() {
    // Linux: X11 (XWayland under Wayland) for Nöbetçi itself; the programs it
    // starts keep the desktop's own choice (`sys::command`).
    #[cfg(target_os = "linux")]
    sys::use_x11();

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
            agent_hooks_status,
            widgets::island_weather,
            widgets::stats::island_stats,
            widgets::island_media,
            widgets::island_media_control,
            agent_hooks_preview,
            agent_hooks_apply,
            prompts::rewrite_prompt,
            prompts::openai_api_key_status,
            prompts::set_openai_api_key,
            prompts::delete_openai_api_key,
            approval_decision,
            approval_ack,
            approval_shown,
            approval_pending,
            approval_decline,
            approval_respond,
            approval_allow_low,
            rules_test,
            rule_pattern_check,
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
            buddy::buddy_reset_position,
            buddy::buddy_resize_by,
            buddy::buddy_ready,
            assistant::assistant_open,
            assistant::assistant_ask,
            assistant::assistant_apps,
            agenda::agenda_list,
            agenda::agenda_put,
            agenda::agenda_delete,
            assistant::assistant_dictate,
            assistant::island_keyboard,
            assistant::set_assistant_target,
            buddy::buddy_open_island,
        ])
        .setup(move |app| {
            // macOS: a menu-bar app — no Dock icon, not in Cmd-Tab.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // The run's first lines in the log: what follows belongs to it.
            log::line(format!("--- Nöbetçi {} started ---", env!("CARGO_PKG_VERSION")));
            settings::log_load_problem();

            let handle = app.handle().clone();
            tray::build(&handle)?;
            // The island's webview exists already (tauri.conf.json); these two
            // ask for its browser arguments: see create_settings_window.
            create_settings_window(&handle);
            buddy::create(&handle, page_url(&handle, "buddy.html"), BROWSER_ARGS, &loaded);

            gate.collapsed.store(false, Ordering::Relaxed);
            if let Some(win) = island::window(&handle) {
                island::make_non_activating(&win, island::Floating::Island);
                apply_geometry(&handle, &loaded, false);
                island::show(&win);
                // Linux without a compositor: nothing drawn until the page says
                // where the island is, instead of a black 720 × 460 box.
                #[cfg(target_os = "linux")]
                island::fit_shape(&handle, &gate);
            }
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            *handle.state::<Shared>().hotkeys.lock().unwrap() = hotkeys::apply(&handle, &loaded.hotkeys);
            hooks::ensure_hook_exe(&handle);
            inputguard::start(&handle);
            pipe::start(handle.clone());
            agenda::spawn_reminders(handle.clone());
            let reconcile = handle.clone();
            std::thread::spawn(move || reconcile_autostart(&reconcile));

            // First run: the welcome wizard, once the owl has said hello — unless
            // it was finished or skipped meanwhile (the settings page opens it
            // itself, and the tray can show that page sooner). A settings file
            // that could not be read is shown instead: until a restart, nothing
            // is saved over it.
            let unreadable = settings::load_problem().is_some();
            if !loaded.onboarded || unreadable {
                let welcome = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(4500));
                    let app = welcome.clone();
                    let _ = welcome.run_on_main_thread(move || {
                        if unreadable {
                            show_settings_window(&app, None);
                        } else if !current(&app).onboarded {
                            show_settings_window(&app, Some("hosgeldin"));
                        }
                    });
                });
            }
            Ok(())
        })
        .run(context())
        .expect("error while running Nöbetçi");
}

/// The app's configuration, assets and ACL. Expanded in this one place: on
/// macOS the macro embeds Info.plist under a fixed symbol, so a second
/// expansion (the ACL test) would not link.
fn context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The commands `run()` registers, read from this file.
    fn registered_commands() -> Vec<String> {
        let src = include_str!("lib.rs");
        let open = "generate_handler![";
        let start = src.find(open).expect("run() registers its commands") + open.len();
        let end = start + src[start..].find(']').expect("the list ends");
        src[start..end]
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.rsplit("::").next().unwrap_or(s).to_string())
            .collect()
    }

    const WINDOWS: [&str; 3] = ["island", "settings", "buddy"];

    /// Who may call each registered command (C-13). Every command must be
    /// listed here: a new one fails this test until it is given a window.
    fn expected_callers(command: &str) -> Option<&'static [&'static str]> {
        const ISLAND: &[&str] = &["island"];
        const SETTINGS: &[&str] = &["settings"];
        const BUDDY: &[&str] = &["buddy"];
        const ISLAND_AND_SETTINGS: &[&str] = &["island", "settings"];
        const ALL: &[&str] = &["island", "settings", "buddy"];
        const NOBODY: &[&str] = &[];
        Some(match command {
            "boot" => ALL,
            "save_settings" | "quiet_state" | "notify" => ISLAND_AND_SETTINGS,
            "set_dnd"
            | "log_line"
            | "set_collapsed"
            | "set_island_rect"
            | "reposition"
            | "open_folder"
            | "focus_session"
            | "open_settings_window"
            | "approval_ack"
            | "approval_shown"
            | "approval_pending"
            | "approval_decision"
            | "approval_respond"
            | "approval_allow_low"
            | "approval_decline"
            | "island_keyboard"
            | "island_media"
            | "island_media_control"
            | "island_stats"
            | "island_weather"
            | "assistant_open"
            | "assistant_ask"
            | "assistant_apps"
            | "assistant_dictate"
            | "set_assistant_target"
            | "agenda_list"
            | "agenda_put"
            | "agenda_delete" => ISLAND,
            "hotkeys_status"
            | "open_location"
            | "pick_folder"
            | "close_settings_window"
            | "buddy_reset_position"
            | "hooks_status"
            | "hooks_preview"
            | "hooks_apply"
            | "hooks_health"
            | "agent_hooks_status"
            | "agent_hooks_preview"
            | "agent_hooks_apply"
            | "rules_test"
            | "rule_pattern_check"
            | "risk_categories"
            | "audit_query"
            | "audit_stats"
            | "audit_projects"
            | "audit_clear"
            | "audit_export"
            | "settings_export"
            | "settings_import"
            | "settings_reset"
            | "rewrite_prompt"
            | "openai_api_key_status"
            | "set_openai_api_key"
            | "delete_openai_api_key" => SETTINGS,
            "buddy_resize_by" | "buddy_open_island" | "buddy_ready" => BUDDY,
            // No page calls it; the tray quits.
            "quit_app" => NOBODY,
            _ => return None,
        })
    }

    #[test]
    fn the_command_list_is_read_from_run() {
        let commands = registered_commands();
        assert!(commands.len() > 50, "{commands:?}");
        for c in ["boot", "approval_decision", "approval_pending", "buddy_ready", "rule_pattern_check"] {
            assert!(commands.iter().any(|x| x == c), "{c} is registered");
        }
    }

    /// C-25: the island learns at boot whether it may approve a request that
    /// needs a hold — never on Linux (D23).
    #[test]
    fn boot_says_whether_the_island_may_approve_holds() {
        let info = BootInfo {
            settings: Settings::default(),
            system_lang: "en",
            hooks_lost: false,
            screen: ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
            version: String::new(),
            hook_path: String::new(),
            platform: sys::PLATFORM,
            fullscreen_supported: sys::FULLSCREEN_SUPPORTED,
            settings_load_error: None,
            hold_approvals: inputguard::vouches_for_holds(),
        };
        let sent = serde_json::to_value(&info).unwrap();
        assert_eq!(sent["holdApprovals"], serde_json::json!(!cfg!(target_os = "linux")));
    }

    #[test]
    fn each_window_reaches_only_its_own_commands() {
        // The ACL exactly as it is built into the app from capabilities/ and permissions/.
        let mut context = context();
        let acl = context.runtime_authority_mut();
        let can = |window: &str, command: &str| {
            acl.resolve_access(command, window, window, &tauri::ipc::Origin::Local).is_some()
        };

        for command in registered_commands() {
            let expected = expected_callers(&command)
                .unwrap_or_else(|| panic!("{command}: say which window may call it (permissions/windows.toml)"));
            let callers: Vec<&str> = WINDOWS.into_iter().filter(|w| can(w, &command)).collect();
            assert_eq!(callers, expected, "who may call {command}");
        }
        // Answering a request is the island's alone (and no page can claim a
        // hotkey press: that is checked in Rust, C-12).
        for command in ["approval_decision", "approval_respond", "approval_allow_low", "approval_shown"] {
            assert!(!can("buddy", command) && !can("settings", command), "{command}");
        }
        // A window that is not one of ours gets nothing.
        assert!(!can("intruder", "boot"));

        // Tauri's own commands: events for all three, sending events only from
        // the island (the mascot's mood; the mascot says it is ready through
        // buddy_ready, so a script in its page cannot forge a card or any other
        // event), dragging only for the mascot, and nothing that builds windows,
        // trays, menus or images, or changes a window behind Rust's back.
        for w in WINDOWS {
            assert!(can(w, "plugin:event|listen") && can(w, "plugin:event|unlisten"), "{w} listens");
            for command in [
                "plugin:event|emit_to",
                "plugin:webview|create_webview_window",
                "plugin:window|create",
                "plugin:window|set_ignore_cursor_events",
                "plugin:window|set_focus",
                "plugin:window|set_position",
                "plugin:window|close",
                "plugin:image|from_path",
                "plugin:tray|new",
                "plugin:menu|new",
                "plugin:app|app_hide",
                "plugin:path|resolve_directory",
            ] {
                assert!(!can(w, command), "{w} must not call {command}");
            }
        }
        assert!(can("island", "plugin:event|emit"));
        assert!(!can("settings", "plugin:event|emit") && !can("buddy", "plugin:event|emit"));
        assert!(can("buddy", "plugin:window|start_dragging"));
        assert!(!can("island", "plugin:window|start_dragging") && !can("settings", "plugin:window|start_dragging"));
        // Plugins are driven from Rust only.
        for w in WINDOWS {
            for command in ["plugin:dialog|open", "plugin:notification|notify", "plugin:autostart|enable"] {
                assert!(!can(w, command), "{w} must not call {command}");
            }
        }
    }

    #[test]
    fn notifications_follow_the_settings_and_a_focus_run_needs_no_event_entry() {
        let s = Settings::default();
        assert!(notification_wanted(&s, "approval", false, false));
        assert!(!notification_wanted(&s, "finished", false, false), "not in the default list");
        assert!(notification_wanted(&s, "focus", false, false), "the user's own timer");
        assert!(!notification_wanted(&s, "unknown", false, false));
        for kind in ["approval", "focus"] {
            assert!(!notification_wanted(&s, kind, false, true), "{kind}: quiet");
            assert!(!notification_wanted(&s, kind, true, false), "{kind}: the open island shows it");
            let off = Settings { toast_enabled: false, ..Settings::default() };
            assert!(!notification_wanted(&off, kind, false, false), "{kind}: notifications off");
            let always = Settings { toast_only_when_hidden: false, ..Settings::default() };
            assert!(notification_wanted(&always, kind, true, false), "{kind}: wanted even when shown");
        }
    }

    /// redaction-history#4: the island cuts the command to 160 UTF-16 units
    /// before it asks for a notification; what that cut leaves of a secret
    /// is not shown, and short bodies keep their ordinary endings.
    #[test]
    fn a_notification_shows_no_part_of_a_secret_the_island_cut() {
        let command = format!("echo {} && export DB_PASSWORD=\"correct horse battery staple\"", "x".repeat(120));
        let cut: String =
            String::from_utf16(&command.encode_utf16().take(ISLAND_NOTIFY_CUT).collect::<Vec<_>>()).unwrap();
        assert!(cut.ends_with("DB_PASSWORD=\"correct hor"), "{cut}");
        let body = notification_body(&format!("Çalıştırıyor: {cut}"));
        assert!(body.ends_with("DB_PASSWORD=\"•••"), "{body}");
        let command = format!("cd {} && git clone https://admin:SuperSecretPassword1@github.com/a/b", "x".repeat(113));
        let cut: String = command.chars().take(ISLAND_NOTIFY_CUT).collect();
        assert!(cut.ends_with("https://admin:SuperSecretPassw"), "{cut}");
        assert!(notification_body(&format!("Bash: {cut}")).ends_with("https://admin:•••"));
        // A question cut the same way (no label before it).
        let question = format!("{} Should I use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?", "a".repeat(130));
        let cut: String = question.chars().take(ISLAND_NOTIFY_CUT).collect();
        assert!(notification_body(&cut).ends_with("use •••"), "{cut}");
        // Too short to have been cut: an ending that looks like a token's
        // start is a word.
        for same in [
            "Bash: rm -rf sk-dir",
            "Bash: cat SG.txt",
            "Bash: python train.py --model hf_model_large",
            "Bash: echo sk-",
        ] {
            assert_eq!(notification_body(same), same);
        }
        // Long bodies are masked whole, then cut to 240 characters.
        let long = format!("Bash: export DB_PASSWORD=hunter2hunter2 && {}", "y".repeat(400));
        let body = notification_body(&long);
        assert_eq!(body.chars().count(), 240);
        assert!(body.starts_with("Bash: export DB_PASSWORD=••• && yyy"), "{body}");
        // A body sent whole, however long, is read as far as it matters: a
        // private key that runs past that is masked all the same.
        let key =
            format!("-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----", "Ab1".repeat(3000));
        assert_eq!(notification_body(&format!("Write: {key}")), "Write: •••");
    }

    #[test]
    fn the_chatgpt_web_guide_opens_in_the_interface_language() {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let tr = chatgpt_web_guide(true);
        let en = chatgpt_web_guide(false);
        assert!(tr.ends_with("/integrations/chatgpt-web/README.tr.md"), "{tr}");
        assert!(en.ends_with("/integrations/chatgpt-web"), "{en}");
        for url in [tr, en] {
            assert!(url.starts_with("https://github.com/tahap0l/nobetci/"), "{url}");
        }
        // The pages they show are in the tree.
        assert!(repo.join("integrations/chatgpt-web/README.tr.md").is_file());
        assert!(repo.join("integrations/chatgpt-web/README.md").is_file());
    }

    #[test]
    fn remove_hooks_cleans_what_it_can_and_exits_1_for_what_it_cannot() {
        let home = hooks::TempHome::new("cli");
        let claude = home.dir.join(".claude").join("settings.json");
        let codex = home.dir.join(".codex").join("hooks.json");
        std::fs::create_dir_all(claude.parent().unwrap()).unwrap();
        std::fs::create_dir_all(codex.parent().unwrap()).unwrap();
        // Claude Code's file cannot be read as JSON: it is left alone and reported.
        std::fs::write(&claude, b"{ broken").unwrap();
        let ours = "'/opt/nobetci/bin/nobetci-hook' codex Stop";
        std::fs::write(
            &codex,
            serde_json::to_vec_pretty(&serde_json::json!({
                "hooks": { "Stop": [{ "hooks": [
                    { "type": "command", "command": ours, "timeout": 10 },
                    { "type": "command", "command": "notify-send done" }
                ] }] }
            }))
            .unwrap(),
        )
        .unwrap();

        let mut out = Vec::new();
        assert_eq!(remove_all_hooks(&mut out), 1, "a file that could not be cleaned must fail the run");
        let said = String::from_utf8(out).unwrap();
        assert!(said.contains("Claude Code") && said.contains("Codex") && said.contains("Cursor"), "{said}");
        assert_eq!(std::fs::read(&claude).unwrap(), b"{ broken");
        let left: Value = serde_json::from_slice(&std::fs::read(&codex).unwrap()).unwrap();
        assert_eq!(
            left["hooks"]["Stop"][0]["hooks"],
            serde_json::json!([{ "type": "command", "command": "notify-send done" }]),
            "only our command goes; the other one in the same group stays"
        );

        // Once every file can be read, the same run succeeds (nothing of ours left anywhere).
        std::fs::write(&claude, b"{}").unwrap();
        assert_eq!(remove_all_hooks(&mut Vec::new()), 0);
        assert_eq!(std::fs::read(&claude).unwrap(), b"{}", "nothing of ours there: not rewritten");
        drop(home);
    }
}
