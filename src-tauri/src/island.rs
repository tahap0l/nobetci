// Island window: placement on the chosen display, the two window sizes
// (full panel / invisible wake strip), click-through and the cursor poll.
//
// The island is a black shape drawn at the top of the chosen display inside a
// borderless, transparent, always-on-top window. On Windows it hangs from the top
// edge of the screen and never takes focus; on macOS it sits just below the menu
// bar, where a notch can't hide it — and there a click on it does make Nöbetçi
// the active app (see `make_non_activating`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Logical size of the full window — room for the tallest island view (the
/// approval card of a risky request). Everything outside the island is click-through.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 460.0;
/// Logical size of the invisible strip that wakes the island when it is hidden.
pub const STRIP_W: f64 = 240.0;
pub const STRIP_H: f64 = 6.0;

pub const WINDOW_LABEL: &str = "island";

/// Margin around the island that still counts as "on the island", in logical px.
/// Generous because a click must never be swallowed.
const HIT_MARGIN: f64 = 14.0;

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// The island shape in window-logical coordinates, pushed by the front end.
/// The poll thread owns the click-through decision so it lands in the same 16 ms
/// tick as the cursor read — an IPC round trip here loses clicks.
#[derive(Clone, Copy, Default)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Wakes / parks the cursor poll thread so a hidden island costs literally nothing.
pub struct PollGate {
    active: Mutex<bool>,
    cv: Condvar,
    pub collapsed: AtomicBool,
    pub rect: Mutex<IslandRect>,
    /// Mirrors the window flag so we only call into Win32 when it changes.
    ignoring: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            collapsed: AtomicBool::new(true),
            rect: Mutex::new(IslandRect::default()),
            ignoring: AtomicBool::new(false),
        }
    }

    pub fn set_rect(&self, rect: IslandRect) {
        *self.rect.lock().unwrap() = rect;
    }

    /// Forces the next poll tick to re-apply the flag (after a window resize).
    pub fn forget_ignore_state(&self) {
        self.ignoring.store(false, Ordering::Relaxed);
    }

    pub fn set_active(&self, on: bool) {
        let mut guard = self.active.lock().unwrap();
        *guard = on;
        self.cv.notify_all();
    }

    fn wait_until_active(&self) {
        let mut guard = self.active.lock().unwrap();
        while !*guard {
            guard = self.cv.wait(guard).unwrap();
        }
    }

    fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

// Pointer units: physical screen pixels on Windows, the space window and monitor
// positions use. On macOS tao scales the pointer by the main display but every
// position by its own display, so with mixed scales nothing lines up in pixels —
// points (pixels / scale) are the one space they all share.

#[cfg(windows)]
fn pointer(_app: &AppHandle, _main_scale: f64) -> Option<(f64, f64)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

#[cfg(not(windows))]
fn pointer(app: &AppHandle, main_scale: f64) -> Option<(f64, f64)> {
    let p = app.cursor_position().ok()?;
    Some((p.x / main_scale, p.y / main_scale))
}

/// A position or length in physical pixels of something shown at `scale`, in
/// pointer units.
fn units(v: f64, scale: f64) -> f64 {
    if cfg!(windows) {
        v
    } else {
        v / scale
    }
}

/// Scale of the main display: what tao measures the pointer against on macOS.
fn main_scale(app: &AppHandle) -> f64 {
    app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0)
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let (p, s, k) = (m.position(), m.size(), m.scale_factor());
    let (left, top) = (units(p.x as f64, k), units(p.y as f64, k));
    let (w, h) = (units(s.width as f64, k), units(s.height as f64, k));
    x >= left && x < left + w && y >= top && y < top + h
}

/// The pointer relative to the island window, in window-logical (CSS) pixels.
fn pointer_in(win: &WebviewWindow, (cx, cy): (f64, f64)) -> Option<(f64, f64)> {
    let origin = win.outer_position().ok()?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let (ox, oy) = (units(origin.x as f64, scale), units(origin.y as f64, scale));
    // Pointer units are already logical on macOS; on Windows they are pixels.
    let per_logical = if cfg!(windows) { scale } else { 1.0 };
    Some(((cx - ox) / per_logical, (cy - oy) / per_logical))
}

/// The display the island lives on: the primary one, or the one under the cursor.
fn target_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if pref == "cursor" {
        if let Some((cx, cy)) = pointer(app, main_scale(app)) {
            if let Some(m) = monitors.iter().find(|m| monitor_contains(m, cx, cy)) {
                return Some(m.clone());
            }
        }
    }
    app.primary_monitor().ok().flatten().or_else(|| monitors.into_iter().next())
}

pub fn screen_info(app: &AppHandle, pref: &str) -> ScreenInfo {
    match target_monitor(app, pref) {
        Some(m) => {
            let scale = m.scale_factor();
            let p = m.position();
            let s = m.size();
            ScreenInfo {
                x: p.x as f64 / scale,
                y: p.y as f64 / scale,
                width: s.width as f64 / scale,
                height: s.height as f64 / scale,
                scale,
            }
        }
        None => ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
    }
}

/// Gap between the island and a side edge of the screen when it is not centred.
const EDGE_GAP: f64 = 12.0;

/// Places and sizes the window. `collapsed` picks the wake strip instead of the
/// panel; `position` ("center", "left", "right") picks where along the top edge.
/// Off-centre, the front end draws the island against the panel's matching side.
pub fn apply_geometry(app: &AppHandle, pref: &str, position: &str, collapsed: bool) {
    let Some(win) = window(app) else { return };
    let Some(m) = target_monitor(app, pref) else { return };

    let scale = m.scale_factor();
    let mp = *m.position();
    let ms = *m.size();

    let (lw, lh) = if collapsed { (STRIP_W, STRIP_H) } else { (PANEL_W, PANEL_H) };
    let pw = (lw * scale).round().max(1.0) as u32;
    let ph = (lh * scale).round().max(1.0) as u32;
    let gap = (EDGE_GAP * scale).round() as i32;
    let x = match position {
        "left" => mp.x + gap,
        "right" => mp.x + ms.width as i32 - pw as i32 - gap,
        _ => mp.x + (ms.width as i32 - pw as i32) / 2,
    };
    // macOS: below the menu bar (and the notch). The work area starts there.
    let y = if cfg!(target_os = "macos") { m.work_area().position.y } else { mp.y };

    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Moving across displays can rescale the window: re-assert the physical size.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
}

/// WS_EX_NOACTIVATE keeps clicks from stealing focus; WS_EX_TOOLWINDOW keeps the
/// island out of Alt-Tab.
#[cfg(windows)]
pub fn make_non_activating(win: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    let Ok(raw) = win.hwnd() else { return };
    if raw.0.is_null() {
        return;
    }
    let hwnd = HWND(raw.0);
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// macOS: Nöbetçi runs as an accessory app (no Dock icon, not in Cmd-Tab, see
/// `lib.rs`), and the island follows you to every Space.
///
/// Known gap: an ordinary NSWindow can't refuse activation the way
/// WS_EX_NOACTIVATE does, so clicking the island makes Nöbetçi the active app and
/// the terminal loses keyboard focus until you switch back. The fix is a
/// non-activating NSPanel, which needs to be tried on a real Mac first.
#[cfg(target_os = "macos")]
pub fn make_non_activating(win: &WebviewWindow) {
    let _ = win.set_visible_on_all_workspaces(true);
}

/// Position, size and scale of the monitor the island lives on. Any change here
/// means the island has to be placed again.
fn current_screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, u64)> {
    let pref = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| "primary".into());
    let m = target_monitor(app, &pref)?;
    let p = m.position();
    let size = m.size();
    Some((p.x, p.y, size.width, size.height, m.scale_factor().to_bits()))
}

/// Emits `cursor` (window-logical coordinates) at ~60 Hz while the island is
/// visible. Parked on a condvar the rest of the time.
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    std::thread::spawn(move || {
        // Remembered across wakes so a display change while hidden is noticed the
        // moment the island comes back.
        let mut last_screen: Option<(i32, i32, u32, u32, u64)> = None;
        loop {
            gate.wait_until_active();
            let mut last = (f64::MIN, f64::MIN);
            let mut ticks: u32 = 0;
            // Refreshed with the display check below rather than on every tick.
            let mut scale_of_main = if cfg!(windows) { 1.0 } else { main_scale(&app) };
            while gate.is_active() {
                std::thread::sleep(Duration::from_millis(16));

                // Monitors get plugged in, unplugged, rearranged and rescaled, and
                // an island pinned to coordinates that no longer exist is an island
                // nobody can reach. Checked about twice a second — the cursor poll
                // is already running, so this costs one monitor query.
                ticks = ticks.wrapping_add(1);
                if ticks.is_multiple_of(30) {
                    if !cfg!(windows) {
                        scale_of_main = main_scale(&app);
                    }
                    let now = current_screen_key(&app);
                    if now.is_some() && now != last_screen {
                        let first = last_screen.is_none();
                        last_screen = now;
                        if !first {
                            crate::log::line("display layout changed — repositioning");
                            let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                        }
                    }
                }

                let Some(win) = window(&app) else { continue };
                let Some(at) = pointer(&app, scale_of_main) else { continue };
                let Some((x, y)) = pointer_in(&win, at) else { continue };
                if (x - last.0).abs() < 1.0 && (y - last.1).abs() < 1.0 {
                    continue;
                }
                last = (x, y);

                // Click-through: the window only takes the mouse over the island
                // shape. A small entry margin means the flag is already off by the
                // time a moving cursor reaches a button.
                let r = *gate.rect.lock().unwrap();
                let on_island = r.w > 0.0
                    && x >= r.x - HIT_MARGIN
                    && x <= r.x + r.w + HIT_MARGIN
                    && y >= r.y - HIT_MARGIN
                    && y <= r.y + r.h + HIT_MARGIN;

                let accept = on_island;
                if gate.ignoring.load(Ordering::Relaxed) == accept {
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    let _ = win.set_ignore_cursor_events(!accept);
                }

                let _ = win.emit("cursor", CursorPayload { x, y });
            }
        }
    });
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}
