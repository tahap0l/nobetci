// The desktop mascot: the island's mascot in a small window of its own that the
// user can drag anywhere on screen. It mirrors the island's mood and reacts to
// decisions, but it never decides anything: approvals still need the physical
// click on the island's card (`inputguard.rs`), and its window may call only
// `boot` and its own commands (capabilities/buddy.json).
//
// The window is borderless, transparent, always on top and never takes focus,
// so grabbing it does not pull the keyboard away from the terminal. Where it was
// left is stored in settings.json and put back on the next launch as long as a
// display is still there to show it: in physical pixels of the desktop on
// Windows and Linux, in points on macOS, where every display has a scale of its
// own and tao converts pixels with the scale of the display the window is on.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::i18n::pick;
use crate::island::Floating;
use crate::log;
use crate::settings::Settings;
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

/// Saved positions are points on macOS, physical pixels elsewhere.
const IN_POINTS: bool = cfg!(target_os = "macos");

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// A display's rectangle in the unit positions are saved in, and its scale.
#[derive(Clone, Copy, Debug)]
struct Area {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    scale: f64,
}

/// `(x, y, width, height)` in physical pixels of a display at `scale`, in the
/// saved unit (`points`: divided by the display's own scale).
fn area(x: f64, y: f64, w: f64, h: f64, scale: f64, points: bool) -> Area {
    let k = if points { scale } else { 1.0 };
    Area { x: x / k, y: y / k, w: w / k, h: h / k, scale }
}

fn display_areas(app: &AppHandle) -> Vec<Area> {
    let monitors = app.available_monitors().unwrap_or_default();
    monitors
        .iter()
        .map(|m| {
            let (p, s) = (m.position(), m.size());
            area(p.x as f64, p.y as f64, s.width as f64, s.height as f64, m.scale_factor(), IN_POINTS)
        })
        .collect()
}

/// The middle of a mascot of logical size `size` saved at `pos` is on one of
/// the displays, with room to grab it.
fn on_a_display(areas: &[Area], pos: [i32; 2], (w, h): (f64, f64), points: bool) -> bool {
    areas.iter().any(|a| {
        let k = if points { 1.0 } else { a.scale };
        let (cx, cy) = (pos[0] as f64 + w * k / 2.0, pos[1] as f64 + h * k / 2.0);
        cx >= a.x && cx < a.x + a.w && cy >= a.y && cy < a.y + a.h
    })
}

/// A saved position as the window wants it.
fn saved_at(pos: [i32; 2]) -> Position {
    if IN_POINTS {
        tauri::LogicalPosition::new(pos[0] as f64, pos[1] as f64).into()
    } else {
        PhysicalPosition::new(pos[0], pos[1]).into()
    }
}

/// Where the mascot starts: the saved spot when a display still covers it,
/// otherwise the bottom-right corner of the primary display's work area.
fn start_position(app: &AppHandle, s: &Settings) -> Option<Position> {
    let size = size_for(s.buddy_size);
    if let Some(pos) = s.buddy_pos {
        if on_a_display(&display_areas(app), pos, size, IN_POINTS) {
            return Some(saved_at(pos));
        }
        log::line("desktop mascot: its saved spot is off every display — back to the corner");
    }
    let m = app.primary_monitor().ok().flatten().or_else(|| app.available_monitors().ok()?.into_iter().next())?;
    let scale = m.scale_factor();
    let work = m.work_area();
    let a = area(
        work.position.x as f64,
        work.position.y as f64,
        work.size.width as f64,
        work.size.height as f64,
        scale,
        IN_POINTS,
    );
    // The margin and the mascot are logical sizes: points on macOS, pixels at
    // the display's scale elsewhere.
    let k = if IN_POINTS { 1.0 } else { scale };
    let x = (a.x + a.w - (size.0 + MARGIN) * k).round() as i32;
    let y = (a.y + a.h - (size.1 + MARGIN) * k).round() as i32;
    Some(saved_at([x, y]))
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
    crate::island::make_non_activating(&win, Floating::Mascot);
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

/// A position the window reported, in the unit it is saved in.
fn to_saved(win: &WebviewWindow, pos: PhysicalPosition<i32>) -> [i32; 2] {
    if IN_POINTS {
        // tao made these pixels from points with the window's current scale.
        let scale = win.scale_factor().unwrap_or(1.0);
        [(pos.x as f64 / scale).round() as i32, (pos.y as f64 / scale).round() as i32]
    } else {
        [pos.x, pos.y]
    }
}

/// Keeps the new spot in memory now and on disk once the dragging stops.
fn remember(app: &AppHandle, pos: PhysicalPosition<i32>) {
    let Some(win) = window(app) else { return };
    // Moves while hidden are the OS shuffling windows around, not the user.
    if !win.is_visible().unwrap_or(false) {
        return;
    }
    app.state::<Shared>().settings.lock().unwrap().buddy_pos = Some(to_saved(&win, pos));
    let ticket = MOVES.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SAVE_AFTER);
        if MOVES.load(Ordering::Relaxed) == ticket {
            crate::persist(&app);
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
    // Its panel can never become the key window on macOS, so tao's own show
    // (makeKeyAndOrderFront) just orders it in, after the moves above.
    crate::island::change_flags(&win, |w| {
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    });
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
    crate::persist(&app);
    if crate::current(&app).buddy {
        show(&app);
    }
}

/// A click on the mascot: open the island (on the card, if a request waits).
#[tauri::command]
pub fn buddy_open_island(app: AppHandle) {
    use tauri::Emitter;
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "tray", "open".to_string());
}

/// The mascot's page is listening: the island sends it its mood and colour.
/// (What the page can use instead of emitting `buddy-ready` itself, so the
/// mascot's window needs no right to emit events at all.)
#[tauri::command]
pub fn buddy_ready(app: AppHandle) {
    use tauri::Emitter;
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "buddy-ready", ());
}

/// Ctrl + wheel on the mascot: grows or shrinks it by `step` percent.
#[tauri::command]
pub fn buddy_resize_by(app: AppHandle, step: i32) {
    let mut s = crate::current(&app);
    let next = (s.buddy_size as i32 + step.clamp(-50, 50)).clamp(60, 200) as u32;
    if next != s.buddy_size {
        s.buddy_size = next;
        crate::store(&app, s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_spot_counts_when_its_middle_is_on_a_display() {
        // Windows / Linux: physical pixels; a 1x display and a 2x one to its right.
        let areas = [area(0.0, 0.0, 1920.0, 1080.0, 1.0, false), area(1920.0, 0.0, 3840.0, 2160.0, 2.0, false)];
        assert!(on_a_display(&areas, [100, 100], (124.0, 156.0), false));
        assert!(on_a_display(&areas, [5000, 1800], (124.0, 156.0), false));
        assert!(!on_a_display(&areas, [8000, 100], (124.0, 156.0), false));
        assert!(!on_a_display(&areas, [-200, 100], (124.0, 156.0), false));
    }

    #[test]
    fn on_macos_spots_are_points_on_every_display() {
        // A Retina laptop (2x, 1512 × 982 pt) as the main display and a 1x
        // monitor to its right at x = 1512 pt (shell#3).
        let areas = [area(0.0, 0.0, 3024.0, 1964.0, 2.0, true), area(1512.0, 0.0, 1920.0, 1080.0, 1.0, true)];
        assert_eq!((areas[0].w, areas[0].h), (1512.0, 982.0));
        // A mascot parked on the external monitor, saved in points, is still
        // found there — not on the laptop at half the coordinates.
        assert!(on_a_display(&areas, [2000, 600], (124.0, 156.0), true));
        assert!(on_a_display(&areas, [1000, 300], (124.0, 156.0), true));
        // Beyond every display.
        assert!(!on_a_display(&areas, [5400, 1600], (124.0, 156.0), true));
    }
}
