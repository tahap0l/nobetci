// The desktop mascot: the island's mascot in a small window of its own that the
// user can drag anywhere on screen. It mirrors the island's mood and reacts to
// decisions, but it never decides anything: approvals still need the physical
// click on the island's card (`inputguard.rs`).
//
// The window is borderless, transparent, always on top and never takes focus,
// so grabbing it does not pull the keyboard away from the terminal. Where it was
// left is stored in settings.json, in physical pixels of the desktop, and put
// back on the next launch as long as a display is still there to show it.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::i18n::pick;
use crate::log;
use crate::settings::{self, Settings};
use crate::Shared;

pub const LABEL: &str = "buddy";

/// Logical size of the window at 100 %: the mascot plus room for its badges and
/// sparkles. The `buddy_size` setting scales both.
const W: f64 = 124.0;
const H: f64 = 156.0;

/// The window's logical size for a `buddy_size` percentage.
fn size_for(percent: u32) -> (f64, f64) {
    let k = f64::from(percent.clamp(60, 200)) / 100.0;
    ((W * k).round(), (H * k).round())
}
/// Distance from the screen corner where a first-time mascot appears.
const MARGIN: f64 = 28.0;
/// A move is written to disk once the window has been still for this long.
const SAVE_AFTER: Duration = Duration::from_millis(700);

/// Bumped on every move; a pending save only runs if nothing moved since.
static MOVES: AtomicU64 = AtomicU64::new(0);

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Where the mascot starts: the saved spot when a display still covers it,
/// otherwise the bottom-right corner of the primary display's work area.
fn start_position(app: &AppHandle, s: &Settings) -> Option<PhysicalPosition<i32>> {
    let monitors = app.available_monitors().ok()?;
    let (w, h) = size_for(s.buddy_size);
    if let Some([x, y]) = s.buddy_pos {
        let on_screen = monitors.iter().any(|m| {
            let (p, size, scale) = (m.position(), m.size(), m.scale_factor());
            // The middle of the mascot must be on a display, with room to grab it.
            let (cx, cy) = (x + (w * scale / 2.0) as i32, y + (h * scale / 2.0) as i32);
            cx >= p.x && cx < p.x + size.width as i32 && cy >= p.y && cy < p.y + size.height as i32
        });
        if on_screen {
            return Some(PhysicalPosition::new(x, y));
        }
        log::line("desktop mascot: its saved spot is off every display — back to the corner");
    }
    let m = app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())?;
    let scale = m.scale_factor();
    let area = m.work_area();
    let x = area.position.x + area.size.width as i32 - ((w + MARGIN) * scale) as i32;
    let y = area.position.y + area.size.height as i32 - ((h + MARGIN) * scale) as i32;
    Some(PhysicalPosition::new(x, y))
}

/// Created hidden at launch, next to the settings window and with the same
/// browser arguments (see `create_settings_window` for why), then only shown and
/// hidden.
pub fn create(app: &AppHandle, url: WebviewUrl, browser_args: &str, s: &Settings) {
    let built = WebviewWindowBuilder::new(app, LABEL, url)
        .additional_browser_args(browser_args)
        .title(pick("Nöbetçi mascot", "Nöbetçi maskotu"))
        .inner_size(size_for(s.buddy_size).0, size_for(s.buddy_size).1)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .accept_first_mouse(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .build();
    let win = match built {
        Ok(win) => win,
        Err(err) => {
            log::line(format!("desktop mascot window failed: {err}"));
            return;
        }
    };
    crate::island::make_non_activating(&win);
    if let Some(pos) = start_position(app, s) {
        let _ = win.set_position(pos);
    }

    let handle = app.clone();
    win.on_window_event(move |event| match event {
        tauri::WindowEvent::Moved(pos) => remember(&handle, *pos),
        // Only ever hidden, like the settings window: it is switched off in Settings.
        tauri::WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
        _ => {}
    });
    if s.buddy {
        show(app);
    }
}

/// Keeps the new spot in memory now and on disk once the dragging stops.
fn remember(app: &AppHandle, pos: PhysicalPosition<i32>) {
    let Some(win) = window(app) else { return };
    // Moves while hidden are the OS shuffling windows around, not the user.
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    app.state::<Shared>().settings.lock().unwrap().buddy_pos = Some([pos.x, pos.y]);
    let ticket = MOVES.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_AFTER);
        if MOVES.load(Ordering::Relaxed) != ticket {
            return;
        }
        let current = app.state::<Shared>().settings.lock().unwrap().clone();
        if let Err(err) = settings::save(&current) {
            log::line(format!("could not save the mascot's position: {err}"));
        }
    });
}

pub fn show(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    // The display it was on may be gone since it was hidden.
    let s = app.state::<Shared>().settings.lock().unwrap().clone();
    if let Some(pos) = start_position(app, &s) {
        let _ = win.set_position(pos);
    }
    fit(&win, s.buddy_size);
    let _ = win.show();
    let _ = win.set_always_on_top(true);
}

/// Sizes the window for `percent`, keeping its feet where they stand: the
/// bottom-centre of the window stays put as it grows or shrinks.
fn fit(win: &WebviewWindow, percent: u32) {
    let scale = win.scale_factor().unwrap_or(1.0);
    let (w, h) = size_for(percent);
    let (pw, ph) = ((w * scale).round() as i32, (h * scale).round() as i32);
    if let (Ok(pos), Ok(old)) = (win.outer_position(), win.outer_size()) {
        let (ow, oh) = (old.width as i32, old.height as i32);
        if (ow, oh) != (pw, ph) && ow > 0 {
            let _ = win.set_position(PhysicalPosition::new(pos.x + (ow - pw) / 2, pos.y + (oh - ph)));
        }
    }
    let _ = win.set_size(PhysicalSize::new(pw as u32, ph as u32));
}

/// Applies a new `buddy_size`.
pub fn resize(app: &AppHandle, percent: u32) {
    if let Some(win) = window(app) {
        fit(&win, percent);
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(win) = window(app) {
        let _ = win.hide();
    }
}

/// Applies the `buddy` setting after a change.
pub fn apply(app: &AppHandle, on: bool) {
    if on {
        show(app);
    } else {
        hide(app);
    }
}

/// Puts the mascot back in its corner of the primary display.
#[tauri::command]
pub fn buddy_reset_position(app: AppHandle) {
    app.state::<Shared>().settings.lock().unwrap().buddy_pos = None;
    let s = app.state::<Shared>().settings.lock().unwrap().clone();
    if let Err(err) = settings::save(&s) {
        log::line(format!("could not save settings: {err}"));
    }
    if s.buddy {
        show(&app);
    }
}

/// A click on the mascot: open the island (on the card, if a request waits).
#[tauri::command]
pub fn buddy_open_island(app: AppHandle) {
    use tauri::Emitter;
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "tray", "open".to_string());
}
