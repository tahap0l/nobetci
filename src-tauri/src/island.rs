// Island window: placement on the chosen display, the two window sizes
// (full panel / invisible wake strip), click-through, the cursor poll, and what
// keeps the island and the desktop mascot from taking focus.
//
// The island is a black shape drawn at the top of the chosen display inside a
// borderless, transparent, always-on-top window. It never takes the keyboard
// unless the user is typing into it (`set_typing`):
//   * Windows: WS_EX_NOACTIVATE and WS_EX_TOOLWINDOW (out of Alt-Tab), put back
//     after every tao call that rewrites the window's style (`change_flags`).
//   * macOS: a non-activating NSPanel just below the menu bar, where a notch
//     can't hide it (`mac_panel.rs`).
//   * Linux: X11 (XWayland under Wayland), a window that does not accept focus.
// The island window is declared `"focusable": false` in tauri.conf.json so that
// tao itself keeps it unfocusable (on Linux tao would otherwise switch focus
// back on at the window's first draw).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewWindow};

#[cfg(windows)]
mod win;

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

/// The cursor poll's two rates. Near the island, or while it is open, the
/// click-through flag has to follow the cursor within a frame; far from the
/// compact pill nothing depends on the cursor but the owl's gaze.
const FAST: Duration = Duration::from_millis(16);
const SLOW: Duration = Duration::from_millis(100);
/// How far around the island the poll keeps its fast rate, in logical px. At
/// the slow rate a cursor needs well over 100 ms to come this far, and a click
/// follows the hand slowing down on its target, so the flag is ready in time.
const NEAR: f64 = 200.0;
/// The compact pill is 34 px tall; anything taller is the island open.
const COMPACT_MAX_H: f64 = 60.0;
/// How often displays are checked for changes while the poll runs.
const DISPLAY_CHECK: Duration = Duration::from_millis(500);

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
/// The poll thread owns the click-through decision so it lands in the same tick
/// as the cursor read — an IPC round trip here loses clicks.
#[derive(Clone, Copy, Default, Debug, PartialEq)]
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
    /// Read anywhere (the click guard checks presses against it); written only
    /// through `set_rect`, which wakes the poll.
    pub rect: Mutex<IslandRect>,
    /// Bumped on every new rect: a sleeping poll wakes for it.
    rect_version: AtomicU64,
    /// Mirrors the window flag so we only call into the OS when it changes.
    ignoring: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            collapsed: AtomicBool::new(true),
            rect: Mutex::new(IslandRect::default()),
            rect_version: AtomicU64::new(0),
            ignoring: AtomicBool::new(false),
        }
    }

    /// A new island shape. Wakes the poll, so a card opening under a cursor
    /// that does not move still takes the mouse at once.
    pub fn set_rect(&self, rect: IslandRect) {
        *self.rect.lock().unwrap() = rect;
        self.rect_version.fetch_add(1, Ordering::Relaxed);
        let _woken = self.active.lock().unwrap();
        self.cv.notify_all();
    }

    fn rect(&self) -> (IslandRect, u64) {
        let version = self.rect_version.load(Ordering::Relaxed);
        (*self.rect.lock().unwrap(), version)
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

    /// Sleeps until the next tick: `wait`, or less when the island changed
    /// shape since rect version `seen` or the poll was parked. False once parked.
    fn nap(&self, wait: Duration, seen: u64) -> bool {
        let guard = self.active.lock().unwrap();
        let (guard, _) = self
            .cv
            .wait_timeout_while(guard, wait, |active| *active && self.rect_version.load(Ordering::Relaxed) == seen)
            .unwrap();
        *guard
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

#[cfg(target_os = "macos")]
fn pointer(app: &AppHandle, main_scale: f64) -> Option<(f64, f64)> {
    let p = app.cursor_position().ok()?;
    Some((p.x / main_scale, p.y / main_scale))
}

/// X11 reports the pointer in root-window pixels, like every window position.
#[cfg(target_os = "linux")]
fn pointer(app: &AppHandle, _main_scale: f64) -> Option<(f64, f64)> {
    let p = app.cursor_position().ok()?;
    Some((p.x, p.y))
}

/// Pointer units are physical pixels everywhere but on macOS.
const PIXEL_POINTER: bool = cfg!(not(target_os = "macos"));

/// A position or length in physical pixels of something shown at `scale`, in
/// pointer units.
fn units(v: f64, scale: f64) -> f64 {
    if PIXEL_POINTER {
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
    let per_logical = if PIXEL_POINTER { scale } else { 1.0 };
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

/// Where the window goes and how big it is, all in pixels of the target display:
/// `(x, y, width, height)`. `left` and `width` are the display's, `top` the y
/// the window hangs from.
fn placement(left: i32, width: u32, scale: f64, top: i32, position: &str, collapsed: bool) -> (i32, i32, u32, u32) {
    let (lw, lh) = if collapsed { (STRIP_W, STRIP_H) } else { (PANEL_W, PANEL_H) };
    let pw = (lw * scale).round().max(1.0) as u32;
    let ph = (lh * scale).round().max(1.0) as u32;
    let gap = (EDGE_GAP * scale).round() as i32;
    let x = match position {
        "left" => left + gap,
        "right" => left + width as i32 - pw as i32 - gap,
        _ => left + (width as i32 - pw as i32) / 2,
    };
    (x, top, pw, ph)
}

/// Places and sizes the window. `collapsed` picks the wake strip instead of the
/// panel; `position` ("center", "left", "right") picks where along the top edge.
/// Off-centre, the front end draws the island against the panel's matching side.
pub fn apply_geometry(app: &AppHandle, pref: &str, position: &str, collapsed: bool) {
    let Some(win) = window(app) else { return };
    let Some(m) = target_monitor(app, pref) else { return };

    let scale = m.scale_factor();
    let (mp, ms) = (*m.position(), *m.size());
    // macOS: below the menu bar (and the notch). The work area starts there.
    let top = if cfg!(target_os = "macos") { m.work_area().position.y } else { mp.y };
    let (x, y, pw, ph) = placement(mp.x, ms.width, scale, top, position, collapsed);

    // macOS: tao turns a physical value into points with the scale of the
    // display the window is on *now*, not the one it is going to, so a move
    // between a Retina and a 1x display would land at the wrong spot and size.
    // Points mean the same on every display.
    #[cfg(target_os = "macos")]
    {
        use tauri::{LogicalPosition, LogicalSize};
        let size = LogicalSize::new(pw as f64 / scale, ph as f64 / scale);
        let _ = win.set_size(size);
        let _ = win.set_position(LogicalPosition::new(x as f64 / scale, y as f64 / scale));
        let _ = win.set_size(size);
    }
    #[cfg(not(target_os = "macos"))]
    {
        use tauri::{PhysicalPosition, PhysicalSize};
        let _ = win.set_size(PhysicalSize::new(pw, ph));
        let _ = win.set_position(PhysicalPosition::new(x, y));
        // Moving across displays can rescale the window: re-assert the physical size.
        let _ = win.set_size(PhysicalSize::new(pw, ph));
    }
    change_flags(&win, |w| {
        let _ = w.set_always_on_top(true);
    });
}

// ── Never taking focus ───────────────────────────────────────────────────────

/// Which floating window: the island takes the keyboard while the user types
/// into it; the desktop mascot never does.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Floating {
    Island,
    Mascot,
}

/// The island holds the keyboard because the user is typing into it.
static TYPING: AtomicBool = AtomicBool::new(false);

/// Extended-style bits (winuser.h) the floating windows keep on Windows;
/// `island/win.rs` checks them against the windows crate.
#[cfg_attr(not(windows), allow(dead_code))]
const WS_EX_NOACTIVATE: isize = 0x0800_0000;
#[cfg_attr(not(windows), allow(dead_code))]
const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
#[cfg_attr(not(windows), allow(dead_code))]
const WS_EX_APPWINDOW: isize = 0x0004_0000;

/// The extended style a floating window keeps, given the one it has: never
/// activated by a click unless the island is taking the keyboard for typing,
/// and out of Alt-Tab (a tool window, never an app window).
#[cfg_attr(not(windows), allow(dead_code))]
fn ex_style(ex: isize, typing: bool) -> isize {
    let mut want = (ex | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
    if typing {
        want &= !WS_EX_NOACTIVATE;
    } else {
        want |= WS_EX_NOACTIVATE;
    }
    want
}

/// Puts the extended style back the way `ex_style` wants it.
#[cfg(windows)]
fn keep_out_of_the_way(w: &WebviewWindow) {
    if let Ok(hwnd) = w.hwnd() {
        let typing = w.label() == WINDOW_LABEL && TYPING.load(Ordering::Relaxed);
        win::restyle(hwnd.0, typing);
    }
}

/// Runs `change`, a tao call that can change the window's flags (click-through,
/// visibility, focusable, always on top). On Windows tao then rewrites the
/// whole extended style, dropping WS_EX_TOOLWINDOW and adding WS_EX_APPWINDOW
/// (and WS_EX_NOACTIVATE, but for a window declared unfocusable), so the call
/// and the repair run together on the main thread, before the window handles
/// any input. Elsewhere `change` just runs.
pub fn change_flags(win: &WebviewWindow, change: impl FnOnce(&WebviewWindow) + Send + 'static) {
    #[cfg(windows)]
    {
        let w = win.clone();
        let _ = win.run_on_main_thread(move || {
            change(&w);
            keep_out_of_the_way(&w);
        });
    }
    #[cfg(not(windows))]
    change(win);
}

/// Windows: no activation on click, not in Alt-Tab. The rest of the
/// non-activating behaviour comes from the window being declared unfocusable.
#[cfg(windows)]
pub fn make_non_activating(win: &WebviewWindow, _kind: Floating) {
    keep_out_of_the_way(win);
}

/// macOS: Nöbetçi runs as an accessory app (no Dock icon, not in Cmd-Tab, see
/// `lib.rs`), and the floating windows follow you to every Space as
/// non-activating panels: a click on them leaves the terminal the active app.
/// Only the island's panel can become the key window, when the user types into
/// it; the mascot's never can. The window is ordered out while its class
/// changes; `show` brings it back without making it key.
#[cfg(target_os = "macos")]
pub fn make_non_activating(win: &WebviewWindow, kind: Floating) {
    let _ = win.set_visible_on_all_workspaces(true);
    crate::mac_panel::make_panel(win, kind == Floating::Island);
}

/// Linux: never focused, on every workspace, kept out of the taskbar and pager.
#[cfg(target_os = "linux")]
pub fn make_non_activating(win: &WebviewWindow, _kind: Floating) {
    let _ = win.set_focusable(false);
    let _ = win.set_visible_on_all_workspaces(true);
    let _ = win.set_skip_taskbar(true);
}

/// Shows a floating window without giving it the keyboard.
pub fn show(win: &WebviewWindow) {
    // macOS: tao's show is makeKeyAndOrderFront, which would hand the island's
    // panel the keyboard. Ordering it in is all it needs.
    #[cfg(target_os = "macos")]
    {
        let w = win.clone();
        let _ = win.run_on_main_thread(move || crate::mac_panel::order_front(&w));
    }
    #[cfg(not(target_os = "macos"))]
    change_flags(win, |w| {
        let _ = w.show();
    });
}

/// Windows: the window that was in front before the island took the
/// keyboard (an HWND as a number; 0 = none).
#[cfg(windows)]
static BEFORE: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/// Lets the island take the keyboard (`on`), remembering the window that was
/// in front, or go back to never taking focus — and give that window the
/// foreground again if the island still has it, so keys meant for it do not
/// land in a field nobody sees (C-20).
#[cfg(windows)]
pub fn set_typing(win: &WebviewWindow, on: bool) {
    TYPING.store(on, Ordering::Relaxed);
    let island = win.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    if on {
        let front = win::foreground();
        if front != 0 && front != island {
            BEFORE.store(front, Ordering::Relaxed);
        }
    }
    change_flags(win, move |w| {
        let _ = w.set_focusable(on);
        if on {
            // The user just clicked the island, so Windows lets it come forward.
            let _ = w.set_focus();
        } else {
            win::give_back(BEFORE.swap(0, Ordering::Relaxed), island);
        }
    });
}

/// macOS: the panel becomes the key window without activating the app. Must
/// run on the main thread (the island's commands do).
#[cfg(target_os = "macos")]
pub fn set_typing(win: &WebviewWindow, on: bool) {
    TYPING.store(on, Ordering::Relaxed);
    if on {
        crate::mac_panel::make_key(win);
    }
}

/// Linux: the window that had the keyboard before the island took it.
#[cfg(target_os = "linux")]
static BEFORE: Mutex<Option<std::os::raw::c_ulong>> = Mutex::new(None);

/// Linux (C-20): `on` makes the island focusable and focused and gives its web
/// view GTK's focus too — a window that holds the X focus without a focus
/// widget drops every key, so the assistant opened by its hotkey would take no
/// typing until clicked. The window that had the keyboard is remembered.
/// `!on` makes the island unfocusable again and, if it still holds the
/// keyboard (X does not move it away from a window that stops accepting it),
/// gives it back to that window through the window manager.
#[cfg(target_os = "linux")]
pub fn set_typing(win: &WebviewWindow, on: bool) {
    TYPING.store(on, Ordering::Relaxed);
    let island = island_xid(win);
    if on {
        if let Some(active) = crate::x11::active_window().filter(|&w| Some(w) != island) {
            *BEFORE.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(active);
        }
        let _ = win.set_focusable(true);
        let _ = win.set_focus();
        let webview: &tauri::Webview = win.as_ref();
        let _ = webview.set_focus();
    } else {
        let _ = win.set_focusable(false);
        let before = BEFORE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take();
        if let Some(island) = island.filter(|&island| crate::x11::focus_within(island)) {
            crate::x11::give_focus(before, island);
        }
    }
}

/// Linux: the island's own X window, found once.
#[cfg(target_os = "linux")]
fn island_xid(win: &WebviewWindow) -> Option<std::os::raw::c_ulong> {
    // Asked before taking the lock: window getters go through the main thread.
    let title = win.title().unwrap_or_default();
    let mut shape = SHAPE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if shape.xid.is_none() {
        shape.xid = crate::x11::own_window(&title);
    }
    shape.xid
}

// ── Click-through and the cursor poll ────────────────────────────────────────

/// The cursor is on the island, or close enough that a click there must land.
fn on_island(r: IslandRect, x: f64, y: f64) -> bool {
    r.w > 0.0
        && x >= r.x - HIT_MARGIN
        && x <= r.x + r.w + HIT_MARGIN
        && y >= r.y - HIT_MARGIN
        && y <= r.y + r.h + HIT_MARGIN
}

/// Whether the next tick should come at the fast rate: the island is open,
/// the cursor is near it, or the front end has not said where it is yet.
fn poll_fast(r: IslandRect, x: f64, y: f64) -> bool {
    if r.w <= 0.0 || r.h > COMPACT_MAX_H {
        return true;
    }
    x >= r.x - NEAR && x <= r.x + r.w + NEAR && y >= r.y - NEAR && y <= r.y + r.h + NEAR
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

/// Whether the window ignores the mouse, given what the poll asked for: never
/// while the island is folded into the wake strip or the poll is parked — the
/// strip is how a hidden island wakes up.
fn click_through(requested: bool, active: bool, collapsed: bool) -> bool {
    requested && active && !collapsed
}

/// Turns click-through on or off from the poll thread. Applied on the main
/// thread, where `set_collapsed` runs too: if the island folded into the wake
/// strip after this tick decided, the strip keeps taking the mouse.
fn set_click_through(app: &AppHandle, gate: &Arc<PollGate>, ignore: bool) {
    let (handle, gate) = (app.clone(), gate.clone());
    let _ = app.run_on_main_thread(move || {
        let ignore = click_through(ignore, gate.is_active(), gate.collapsed.load(Ordering::Relaxed));
        if let Some(win) = window(&handle) {
            change_flags(&win, move |w| {
                let _ = w.set_ignore_cursor_events(ignore);
            });
        }
    });
}

/// Emits `cursor` (window-logical coordinates) while the island is visible:
/// every 16 ms near the island or while it is open, every 100 ms when the
/// cursor is far from the compact pill. Parked on a condvar the rest of the time.
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    let _ = std::thread::Builder::new().name("cursor-poll".into()).spawn(move || {
        // Remembered across wakes so a display change while hidden is noticed the
        // moment the island comes back.
        let mut last_screen: Option<(i32, i32, u32, u32, u64)> = None;
        loop {
            gate.wait_until_active();
            let mut last = (f64::MIN, f64::MIN);
            // Forces the first tick after a wake to decide afresh.
            let mut seen = u64::MAX;
            let mut checked = Instant::now();
            let mut wait = FAST;
            // Refreshed with the display check below rather than on every tick.
            let mut scale_of_main = if PIXEL_POINTER { 1.0 } else { main_scale(&app) };
            while gate.nap(wait, seen) {
                // Monitors get plugged in, unplugged, rearranged and rescaled, and
                // an island pinned to coordinates that no longer exist is an island
                // nobody can reach. Checked twice a second while the poll runs.
                if checked.elapsed() >= DISPLAY_CHECK {
                    checked = Instant::now();
                    if !PIXEL_POINTER {
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
                    // A compositor started or stopped since: the main thread
                    // re-cuts the window (Linux without one, K-4).
                    #[cfg(target_os = "linux")]
                    {
                        let (handle, g) = (app.clone(), gate.clone());
                        let _ = app.run_on_main_thread(move || fit_shape(&handle, &g));
                    }
                }

                let (r, version) = gate.rect();
                let reshaped = version != seen;
                seen = version;
                let Some(win) = window(&app) else { continue };
                let Some(at) = pointer(&app, scale_of_main) else {
                    wait = SLOW;
                    continue;
                };
                let Some((x, y)) = pointer_in(&win, at) else {
                    wait = SLOW;
                    continue;
                };
                let moved = (x - last.0).abs() >= 1.0 || (y - last.1).abs() >= 1.0;
                if !moved && !reshaped {
                    continue;
                }
                last = (x, y);
                wait = if poll_fast(r, x, y) { FAST } else { SLOW };

                // Click-through: the window only takes the mouse over the island
                // shape. A small entry margin means the flag is already off by the
                // time a moving cursor reaches a button.
                let accept = on_island(r, x, y);
                if gate.ignoring.load(Ordering::Relaxed) == accept {
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    set_click_through(&app, &gate, !accept);
                }

                if moved {
                    let _ = win.emit("cursor", CursorPayload { x, y });
                }
            }
        }
    });
}

/// Click-through on or off, from the main thread (`set_collapsed`).
pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    if let Some(win) = window(app) {
        change_flags(&win, move |w| {
            let _ = w.set_ignore_cursor_events(ignore);
        });
    }
}

// ── Linux without a compositing manager ──────────────────────────────────────

/// What the island's window is cut to on an X display without a compositing
/// manager, where its transparent pixels show black: the whole 720 × 460
/// panel would be a black box over the top of the screen. The window is cut
/// down to the island itself instead (square corners, no shadow), and gets its
/// whole area back once a compositor runs. `None` = the whole window.
#[cfg(any(target_os = "linux", test))]
fn cut_to(composited: bool, collapsed: bool, rect: IslandRect, scale: f64) -> Option<(i32, i32, u32, u32)> {
    // The wake strip must always take the mouse, and a compositor draws the
    // transparent parts as they are.
    if composited || collapsed {
        return None;
    }
    if rect.w <= 0.0 || rect.h <= 0.0 {
        // Nothing to show yet (the page has not said where the island is), or
        // the island is sliding away: nothing drawn, nothing in the way.
        return Some((0, 0, 0, 0));
    }
    let left = (rect.x * scale).floor();
    let top = (rect.y * scale).floor();
    let right = ((rect.x + rect.w) * scale).ceil();
    let bottom = ((rect.y + rect.h) * scale).ceil();
    Some((left as i32, top as i32, (right - left) as u32, (bottom - top) as u32))
}

#[cfg(target_os = "linux")]
struct Shape {
    /// When compositing was last asked about, and the answer.
    checked: Option<(Instant, bool)>,
    /// The island's X window, once found.
    xid: Option<std::os::raw::c_ulong>,
    /// What the window is cut to now (`cut_to`); None = its whole area.
    applied: Option<(i32, i32, u32, u32)>,
}

#[cfg(target_os = "linux")]
static SHAPE: Mutex<Shape> = Mutex::new(Shape { checked: None, xid: None, applied: None });

/// How long an answer about compositing is trusted.
#[cfg(target_os = "linux")]
const COMPOSITOR_CHECK: Duration = Duration::from_secs(3);

/// Keeps the island's window cut to the island while no compositing manager
/// runs (K-4). Runs on the main thread: when the island changes shape or folds
/// away, and now and then from the cursor poll, so a compositor started or
/// stopped later is noticed. Under Wayland, XWayland's windows are always
/// composited.
#[cfg(target_os = "linux")]
pub fn fit_shape(app: &AppHandle, gate: &PollGate) {
    let Some(win) = window(app) else { return };
    // Asked before taking the lock: window getters go through the main thread.
    let scale = win.scale_factor().unwrap_or(1.0);
    let title = win.title().unwrap_or_default();
    let mut shape = SHAPE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let composited = match shape.checked {
        Some((at, answer)) if at.elapsed() < COMPOSITOR_CHECK => answer,
        previous => {
            // An X server that cannot be asked cannot be shaped either.
            let answer = std::env::var_os("WAYLAND_DISPLAY").is_some() || crate::x11::compositing().unwrap_or(true);
            if previous.map(|(_, before)| before) != Some(answer) && (previous.is_some() || !answer) {
                crate::log::line(if answer {
                    "island: a compositing manager is running again — the island's window is transparent"
                } else {
                    "island: no compositing manager on this X display — the island's window is cut to the island \
                     (square corners, no shadow). A compositor (the desktop's own, picom or xcompmgr) gives the full look."
                });
                // The desktop mascot's window follows suit.
                crate::buddy::cut::again(app);
            }
            shape.checked = Some((Instant::now(), answer));
            answer
        }
    };
    let (rect, _) = gate.rect();
    let want = cut_to(composited, gate.collapsed.load(Ordering::Relaxed), rect, scale);
    if shape.applied == want {
        return;
    }
    if shape.xid.is_none() {
        shape.xid = crate::x11::own_window(&title);
    }
    let Some(xid) = shape.xid else { return };
    if crate::x11::set_shape(xid, want) {
        shape.applied = want;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PILL: IslandRect = IslandRect { x: 210.0, y: 0.0, w: 300.0, h: 34.0 };
    const OPEN: IslandRect = IslandRect { x: 40.0, y: 0.0, w: 640.0, h: 300.0 };

    #[test]
    fn the_island_takes_the_mouse_only_over_itself_and_its_margin() {
        assert!(on_island(PILL, 220.0, 20.0));
        assert!(on_island(PILL, 210.0 - HIT_MARGIN, 34.0 + HIT_MARGIN), "the margin counts");
        assert!(!on_island(PILL, 150.0, 20.0));
        assert!(!on_island(PILL, 300.0, 120.0));
        assert!(!on_island(IslandRect::default(), 0.0, 0.0), "no island pushed yet: nothing to hit");
    }

    #[test]
    fn the_wake_strip_always_takes_the_mouse() {
        assert!(click_through(true, true, false));
        assert!(!click_through(false, true, false));
        // A tick that decided just before the island folded into the strip.
        assert!(!click_through(true, true, true));
        // Or before the poll was parked.
        assert!(!click_through(true, false, false));
    }

    #[test]
    fn the_poll_slows_down_only_far_from_the_compact_pill() {
        // Far from the pill: the slow rate.
        assert!(!poll_fast(PILL, 30.0, 400.0));
        assert!(!poll_fast(PILL, 210.0 - NEAR - 1.0, 10.0));
        // Near it, on it, or anywhere while the island is open: the fast rate.
        assert!(poll_fast(PILL, 210.0 - NEAR + 1.0, 10.0));
        assert!(poll_fast(PILL, 400.0, 34.0 + NEAR - 1.0));
        assert!(poll_fast(PILL, 300.0, 10.0));
        assert!(poll_fast(OPEN, 700.0, 450.0));
        // Before the page has pushed its shape, stay quick.
        assert!(poll_fast(IslandRect::default(), 5000.0, 5000.0));
        // The hidden island (zero height) is compact too.
        assert!(!poll_fast(IslandRect { x: 268.0, y: 0.0, w: 184.0, h: 0.0 }, 30.0, 400.0));
    }

    #[test]
    fn a_sleeping_poll_wakes_for_a_new_shape_and_stops_when_parked() {
        let gate = Arc::new(PollGate::new());
        gate.set_active(true);
        let (_, seen) = gate.rect();
        // Nothing new: the nap lasts its full length.
        let start = Instant::now();
        assert!(gate.nap(Duration::from_millis(40), seen));
        assert!(start.elapsed() >= Duration::from_millis(35));
        // A new shape cuts a long nap short.
        let pusher = gate.clone();
        let push = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            pusher.set_rect(PILL);
        });
        let start = Instant::now();
        assert!(gate.nap(Duration::from_secs(5), seen));
        assert!(start.elapsed() < Duration::from_secs(2), "woken by the new rect");
        push.join().unwrap();
        assert_eq!(gate.rect().0, PILL);
        // Parking ends the nap with false.
        let (_, seen) = gate.rect();
        let parker = gate.clone();
        let park = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            parker.set_active(false);
        });
        assert!(!gate.nap(Duration::from_secs(5), seen));
        park.join().unwrap();
    }

    #[test]
    fn windows_floating_windows_stay_out_of_alt_tab_and_never_activate_unless_typing() {
        // What tao writes after a flag change for a focusable, unowned window.
        let rewritten = WS_EX_APPWINDOW | 0x0000_0100 /* WS_EX_WINDOWEDGE */;
        let kept = ex_style(rewritten, false);
        assert_eq!(kept & WS_EX_APPWINDOW, 0, "an app window shows in Alt-Tab");
        assert_ne!(kept & WS_EX_TOOLWINDOW, 0);
        assert_ne!(kept & WS_EX_NOACTIVATE, 0);
        assert_ne!(kept & 0x0000_0100, 0, "other bits are left alone");
        // While the user types into the island it may be activated.
        let typing = ex_style(rewritten | WS_EX_NOACTIVATE, true);
        assert_eq!(typing & WS_EX_NOACTIVATE, 0);
        assert_ne!(typing & WS_EX_TOOLWINDOW, 0);
        // Already right: unchanged.
        assert_eq!(ex_style(kept, false), kept);
    }

    #[test]
    fn the_panel_is_placed_in_target_display_pixels() {
        // A 1x display to the right of another one.
        assert_eq!(placement(1512, 1920, 1.0, 0, "center", false), (2112, 0, 720, 460));
        assert_eq!(placement(1512, 1920, 1.0, 0, "left", false), (1524, 0, 720, 460));
        assert_eq!(placement(1512, 1920, 1.0, 0, "right", false), (1512 + 1920 - 720 - 12, 0, 720, 460));
        // A Retina display: twice the pixels, and below a 37 pt menu bar.
        let (x, y, w, h) = placement(0, 3024, 2.0, 74, "center", false);
        assert_eq!((x, y, w, h), (792, 74, 1440, 920));
        // In points, which is what macOS gets: the same size on every display,
        // whatever the scale of the display the window comes from (shell#2).
        assert_eq!((x as f64 / 2.0, y as f64 / 2.0, w as f64 / 2.0, h as f64 / 2.0), (396.0, 37.0, 720.0, 460.0));
        // The wake strip.
        assert_eq!(placement(0, 1920, 1.0, 0, "center", true), (840, 0, 240, 6));
    }

    #[test]
    fn without_a_compositor_the_window_is_cut_to_the_island() {
        assert_eq!(cut_to(true, false, PILL, 1.0), None, "a compositor draws transparency itself");
        assert_eq!(cut_to(false, true, PILL, 1.0), None, "the wake strip always takes the mouse");
        assert_eq!(cut_to(false, false, PILL, 1.0), Some((210, 0, 300, 34)));
        assert_eq!(cut_to(false, false, PILL, 2.0), Some((420, 0, 600, 68)));
        let odd = IslandRect { x: 10.4, y: 0.0, w: 100.2, h: 33.5 };
        assert_eq!(cut_to(false, false, odd, 1.0), Some((10, 0, 101, 34)), "rounded outwards");
        assert_eq!(cut_to(false, false, IslandRect::default(), 1.0), Some((0, 0, 0, 0)));
        assert_eq!(cut_to(false, false, IslandRect { x: 268.0, y: 0.0, w: 184.0, h: 0.0 }, 1.0), Some((0, 0, 0, 0)));
    }
}
