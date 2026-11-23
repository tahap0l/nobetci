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
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

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
    let (w, h) = size_for(s.buddy_size);
    let builder = WebviewWindowBuilder::new(app, LABEL, url)
        .additional_browser_args(browser_args)
        .title(pick("Nöbetçi mascot", "Nöbetçi maskotu"))
        .inner_size(w, h)
        // Linux: GTK holds a window that cannot be resized at its web view's
        // natural size (it came up 200 × 200 whatever was asked); one that can,
        // with its smallest and largest size both the mascot's (`hold_size`),
        // takes exactly that size and still cannot be resized by hand.
        .resizable(cfg!(target_os = "linux"));
    #[cfg(target_os = "linux")]
    let builder = builder.min_inner_size(w, h).max_inner_size(w, h);
    let built = builder
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
    // What the island sends the mascot changes how it looks.
    #[cfg(target_os = "linux")]
    {
        use tauri::Listener;
        for event in ["buddy-mood", "buddy-emote", "buddy-accent"] {
            let handle = app.clone();
            app.listen_any(event, move |_| cut::again(&handle));
        }
    }
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
    // Dragged by the user: the next resize keeps its feet where they are now.
    if let Some(placed) = PLACED.lock().unwrap_or_else(PoisonError::into_inner).as_mut() {
        placed.moved((pos.x, pos.y), Instant::now());
    }
    #[cfg(target_os = "linux")]
    cut::again(app);
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
    // Where it starts is the top-left for its size, in pixels — or, on macOS,
    // in points, which `fit` measures from the window itself.
    let mut at = None;
    if let Some(pos) = start_position(app, &s) {
        if let Position::Physical(p) = pos {
            at = Some((p.x, p.y));
        }
        *PLACED.lock().unwrap_or_else(PoisonError::into_inner) = None;
        let _ = win.set_position(pos);
    }
    fit(&win, s.buddy_size, at);
    // Its panel can never become the key window on macOS, so tao's own show
    // (makeKeyAndOrderFront) just orders it in, after the moves above.
    crate::island::change_flags(&win, |w| {
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    });
    #[cfg(target_os = "linux")]
    cut::again(app);
}

/// Where the mascot stands and how big `fit` last made its window, in
/// physical pixels. Its feet — the middle of the window's bottom edge — stay
/// put while it grows and shrinks; only a drag moves them. They are kept
/// rather than measured, because the window reports a new size only once the
/// system has made it, and because rounding each step anew would walk it.
#[derive(Clone, Debug, PartialEq)]
struct Placed {
    /// Twice the feet's x (exact in whole pixels), and their y.
    feet: (i32, i32),
    size: (i32, i32),
    /// Top-left corners `fit` just moved the window from or to, each until
    /// when a report of it is the system catching up — X reports the new
    /// size at the old corner before the move, and quick steps overlap — and
    /// not the user dragging it there.
    recent: Vec<((i32, i32), Instant)>,
}

/// How long the system has to report the moves `fit` asked for.
const SETTLE: Duration = Duration::from_secs(1);

static PLACED: Mutex<Option<Placed>> = Mutex::new(None);

impl Placed {
    /// The window was reported with its top-left at `at`.
    fn moved(&mut self, at: (i32, i32), now: Instant) {
        self.recent.retain(|(_, until)| *until > now);
        if top_left(self.feet, self.size) == at || self.recent.iter().any(|(corner, _)| *corner == at) {
            return;
        }
        self.feet = feet_of(at, self.size);
    }
}

/// The feet of a window with its top-left at `pos`.
fn feet_of(pos: (i32, i32), size: (i32, i32)) -> (i32, i32) {
    (2 * pos.0 + size.0, pos.1 + size.1)
}

/// The top-left of a window of `size` standing on `feet`.
fn top_left(feet: (i32, i32), size: (i32, i32)) -> (i32, i32) {
    ((feet.0 - size.0).div_euclid(2), feet.1 - size.1)
}

/// What `fit` keeps for the window's `new` size: the feet where `at` (a
/// top-left for that size) puts them, where they were kept, or else under the
/// window as the system last reported it (`now`: top-left and size); and the
/// corners it moves the window from and to. None while nothing says where
/// the window is.
fn refit(
    old: Option<Placed>,
    at: Option<(i32, i32)>,
    now: Option<((i32, i32), (i32, i32))>,
    new: (i32, i32),
    t: Instant,
) -> Option<Placed> {
    let feet = match (at, &old, now) {
        (Some(at), _, _) => feet_of(at, new),
        (None, Some(old), _) => old.feet,
        (None, None, Some((pos, size))) => feet_of(pos, size),
        (None, None, None) => return None,
    };
    let mut recent = old.map(|old| old.recent).unwrap_or_default();
    recent.retain(|(_, until)| *until > t);
    recent.extend(now.map(|(pos, _)| (pos, t + SETTLE)));
    recent.push((top_left(feet, new), t + SETTLE));
    Some(Placed { feet, size: new, recent })
}

/// Sizes the window for `percent` with its top-left at `at`, or, without
/// one, standing where it stands as it grows or shrinks.
fn fit(win: &WebviewWindow, percent: u32, at: Option<(i32, i32)>) {
    let scale = win.scale_factor().unwrap_or(1.0);
    let (w, h) = size_for(percent);
    let new = ((w * scale).round() as i32, (h * scale).round() as i32);
    let now =
        win.outer_position().ok().map(|p| (p.x, p.y)).zip(
            win.outer_size().ok().filter(|s| s.width > 0 && s.height > 0).map(|s| (s.width as i32, s.height as i32)),
        );
    let mut placed = PLACED.lock().unwrap_or_else(PoisonError::into_inner);
    *placed = refit(placed.take(), at, now, new, Instant::now());
    hold_size(win, (w, h));
    let _ = win.set_size(PhysicalSize::new(new.0 as u32, new.1 as u32));
    if let Some(placed) = placed.as_ref() {
        let (x, y) = top_left(placed.feet, placed.size);
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

/// Linux: the window's smallest and largest size are the mascot's, so GTK
/// gives it that size and nobody can drag it to another (see `create`).
#[cfg(target_os = "linux")]
fn hold_size(win: &WebviewWindow, (w, h): (f64, f64)) {
    let unit = |v: f64| Some(tauri::PixelUnit::from(tauri::LogicalUnit::new(v)));
    let _ = win.set_size_constraints(tauri::WindowSizeConstraints {
        min_width: unit(w),
        min_height: unit(h),
        max_width: unit(w),
        max_height: unit(h),
    });
}

#[cfg(not(target_os = "linux"))]
fn hold_size(_win: &WebviewWindow, _size: (f64, f64)) {}

/// Applies a new `buddy_size`.
pub fn resize(app: &AppHandle, percent: u32) {
    if let Some(win) = window(app) {
        fit(&win, percent, None);
        #[cfg(target_os = "linux")]
        cut::again(app);
    }
}

/// Linux without a compositing manager, where a window's transparent pixels
/// show black: the mascot's window is cut to what the mascot draws, read from
/// its pixels' alpha (`x11::painted`), so it shows the mascot and not a black
/// square, and a click beside it reaches the window below. It is read for a
/// few seconds after anything that changes the drawing — a mood or reaction
/// from the island, a drag, a new size, showing it — and the cut covers every
/// pose seen meanwhile, with room around it (`Seen`), so a blink, a breath or
/// a turn of the head is not clipped; a still mascot costs nothing. Reading
/// waits for the page (`ready`): until it paints, the window holds whatever X
/// gave it. With a compositor the window keeps its whole area.
#[cfg(target_os = "linux")]
pub mod cut {
    use std::os::raw::c_ulong;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Condvar, Mutex, Once, PoisonError};
    use std::time::{Duration, Instant};

    use tauri::AppHandle;

    /// How long the cut is read again after something changed.
    const FOR: Duration = Duration::from_secs(8);
    /// How often meanwhile.
    const EVERY: Duration = Duration::from_millis(400);

    /// Until when the cut is to be read again.
    static UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
    static WAKE: Condvar = Condvar::new();
    /// Whether the mascot's page has said it is there (`buddy_ready`).
    static READY: AtomicBool = AtomicBool::new(false);
    /// Whether the next read starts the cut afresh.
    static FRESH: AtomicBool = AtomicBool::new(false);

    /// Something may have changed the mascot's drawing.
    pub fn again(app: &AppHandle) {
        static STARTED: Once = Once::new();
        *UNTIL.lock().unwrap_or_else(PoisonError::into_inner) = Some(Instant::now() + FOR);
        WAKE.notify_all();
        STARTED.call_once(|| {
            let app = app.clone();
            let _ = std::thread::Builder::new().name("mascot-cut".into()).spawn(move || run(&app));
        });
    }

    /// The mascot's page is there and draws from now on: what was read before
    /// it — the window as X made it — does not count.
    pub fn ready(app: &AppHandle) {
        READY.store(true, Ordering::Relaxed);
        FRESH.store(true, Ordering::Relaxed);
        again(app);
    }

    fn run(app: &AppHandle) {
        let mut cut = Cut::default();
        loop {
            {
                let mut until = UNTIL.lock().unwrap_or_else(PoisonError::into_inner);
                if until.is_none_or(|t| Instant::now() >= t) {
                    // Each stretch of reading starts from what is drawn then,
                    // so a read gone wrong does not stay in the cut for good.
                    FRESH.store(true, Ordering::Relaxed);
                    while until.is_none_or(|t| Instant::now() >= t) {
                        *until = None;
                        until = WAKE.wait(until).unwrap_or_else(PoisonError::into_inner);
                    }
                }
            }
            cut.apply(app);
            std::thread::sleep(EVERY);
        }
    }

    /// Rectangles in the window: x, y, width, height.
    type Rects = Vec<(i32, i32, u32, u32)>;

    #[derive(Default)]
    struct Cut {
        /// The mascot's X window, once found.
        xid: Option<c_ulong>,
        /// What it is cut to now, once cut: None = its whole area.
        applied: Option<Option<Rects>>,
        /// Whether the log has said the mascot is cut.
        told: bool,
        /// What the mascot drew while it was read.
        seen: super::Seen,
    }

    impl Cut {
        fn apply(&mut self, app: &AppHandle) {
            let Some(win) = super::window(app) else { return };
            if !win.is_visible().unwrap_or(false) {
                return;
            }
            if self.xid.is_none() {
                self.xid = crate::x11::own_window(&win.title().unwrap_or_default());
            }
            let Some(xid) = self.xid else { return };
            if FRESH.swap(false, Ordering::Relaxed) {
                self.seen.forget();
            }
            // Under Wayland, XWayland's windows are always composited.
            let composited = std::env::var_os("WAYLAND_DISPLAY").is_some() || crate::x11::compositing().unwrap_or(true);
            let want = if composited {
                self.seen.forget();
                None
            } else {
                // Before the page is there, the window shows what X gave it.
                if !READY.load(Ordering::Relaxed) {
                    return;
                }
                let Some(now) = crate::x11::painted(xid) else { return };
                // A read that tells nothing keeps the shape the window has.
                let Some(mask) = self.seen.add(now.width, now.height, &now.mask) else { return };
                Some(crate::x11::Painted { mask, ..now }.rects())
            };
            if self.applied.as_ref() == Some(&want) {
                return;
            }
            if crate::x11::set_shape_rects(xid, want.as_deref()) {
                if want.is_some() && !self.told {
                    self.told = true;
                    crate::log::line(
                        "desktop mascot: no compositing manager — its window is cut to the mascot it draws",
                    );
                }
                self.applied = Some(want);
            }
        }
    }
}

/// Every pixel the mascot drew at its window's present size while the cut
/// was read (see `cut`), row by row.
#[cfg(any(target_os = "linux", test))]
#[derive(Default)]
struct Seen {
    size: (usize, usize),
    mask: Vec<bool>,
}

#[cfg(any(target_os = "linux", test))]
impl Seen {
    /// Only what is drawn from now on counts.
    fn forget(&mut self) {
        self.mask.clear();
    }

    /// Adds a read of the window's pixels (`now`, `width` × `height`) and
    /// returns what to cut the window to: every pixel drawn so far, with
    /// room around it. None when the read tells nothing, and the window
    /// keeps the shape it has: nothing is drawn (the page is still loading;
    /// a cut to nothing would hide the mascot until the next change), or
    /// nearly everything is — the window as X made it, before the page
    /// painted, which no pose of the mascot fills.
    fn add(&mut self, width: usize, height: usize, now: &[bool]) -> Option<Vec<bool>> {
        let drawn = now.iter().filter(|drawn| **drawn).count();
        if drawn == 0 || drawn * 10 >= now.len() * 9 || now.len() != width * height {
            return None;
        }
        if self.size == (width, height) && self.mask.len() == now.len() {
            self.mask.iter_mut().zip(now).for_each(|(was, is)| *was |= *is);
        } else {
            self.size = (width, height);
            self.mask = now.to_vec();
        }
        Some(grown(&self.mask, width, height, (width / 16).max(4)))
    }
}

/// `mask` (`width` × `height`, row by row) grown by `by` pixels in every
/// direction: the mascot's cut leaves it room to move (see `cut`).
#[cfg(any(target_os = "linux", test))]
fn grown(mask: &[bool], width: usize, height: usize, by: usize) -> Vec<bool> {
    // One line at a time, with a running count of drawn pixels: whether any
    // lies within `by` of each pixel. Rows first, then columns.
    let line = |len: usize, drawn: &dyn Fn(usize) -> bool| -> Vec<bool> {
        let mut count = vec![0u32; len + 1];
        for i in 0..len {
            count[i + 1] = count[i] + u32::from(drawn(i));
        }
        (0..len).map(|i| count[(i + by + 1).min(len)] > count[i.saturating_sub(by)]).collect()
    };
    let mut rows = Vec::with_capacity(width * height);
    for y in 0..height {
        rows.extend(line(width, &|x| mask[y * width + x]));
    }
    let mut out = vec![false; width * height];
    for x in 0..width {
        for (y, drawn) in line(height, &|y| rows[y * width + x]).into_iter().enumerate() {
            out[y * width + x] = drawn;
        }
    }
    out
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
    // The page draws from now on: the cut follows what it draws.
    #[cfg(target_os = "linux")]
    cut::ready(&app);
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

    /// The window follows the size (live: it stayed 200 × 200 while the
    /// setting changed), and each resize keeps the mascot's feet where they
    /// stand instead of walking it toward the corner.
    #[test]
    fn a_resize_keeps_the_mascots_feet_where_they_stand() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let px = |percent| {
                let (w, h) = size_for(percent);
                ((w * scale).round() as i32, (h * scale).round() as i32)
            };
            let start = (1435, 652);
            let feet = feet_of(start, px(100));
            // Ctrl + wheel up four notches and back down, then the settings
            // slider all the way and back: the feet never move by more than
            // the half pixel a window can be off.
            for percent in [110, 120, 130, 140, 130, 120, 110, 100, 200, 60, 100] {
                let size = px(percent);
                let pos = top_left(feet, size);
                let now = feet_of(pos, size);
                assert!(feet.0 - now.0 <= 1 && now.0 <= feet.0 && now.1 == feet.1, "{scale}x {percent} %: {now:?}");
                if percent == 100 {
                    assert_eq!(pos, start, "{scale}x: back where it started");
                }
            }
        }
        // A drag moves the feet; a resize after it stands on the new spot.
        let dragged = feet_of((40, 900), (124, 156));
        assert_eq!(top_left(dragged, (136, 172)), (34, 884));
        // What it measures from: 124 × 156 at 100 %, not the 200 × 200 GTK chose.
        assert_eq!(size_for(100), (124.0, 156.0));
        assert_eq!(size_for(110), (136.0, 172.0));
    }

    /// Without a compositor the mascot's cut leaves it room: every drawn pixel
    /// grows by the margin, clipped at the window's edges.
    #[test]
    fn the_cut_leaves_the_mascot_room_to_move() {
        let (w, h) = (9, 7);
        let mut mask = vec![false; w * h];
        mask[3 * w + 4] = true; // one pixel in the middle
        mask[w - 1] = true; // and one in the top-right corner
        let out = grown(&mask, w, h, 2);
        for y in 0..h {
            for x in 0..w {
                let near_middle = x.abs_diff(4) <= 2 && y.abs_diff(3) <= 2;
                let near_corner = x >= w - 3 && y <= 2;
                assert_eq!(out[y * w + x], near_middle || near_corner, "({x}, {y})");
            }
        }
        assert_eq!(grown(&mask, w, h, 0), mask, "no margin: the same pixels");
        assert!(grown(&vec![false; w * h], w, h, 3).iter().all(|d| !d), "nothing drawn: nothing kept");
    }

    /// item 7 (repair): live without a window manager, the first read came
    /// before the page painted — the window opaque from edge to edge — and
    /// the cut stayed the whole window. Such a read, like an empty one, says
    /// nothing; the mascot's real pose makes the cut.
    #[test]
    fn a_window_the_page_has_not_painted_yet_is_not_the_cut() {
        let (w, h) = (24, 30);
        let block = |w: usize, h: usize, xs: std::ops::Range<usize>, ys: std::ops::Range<usize>| -> Vec<bool> {
            (0..w * h).map(|i| xs.contains(&(i % w)) && ys.contains(&(i / w))).collect()
        };
        let mut seen = Seen::default();
        assert_eq!(seen.add(w, h, &vec![true; w * h]), None, "opaque from edge to edge");
        let mut nearly = vec![true; w * h];
        nearly[..w].fill(false);
        assert_eq!(seen.add(w, h, &nearly), None, "all but a line");
        assert_eq!(seen.add(w, h, &vec![false; w * h]), None, "nothing drawn yet");
        let pose = block(w, h, 8..16, 10..26);
        assert_eq!(seen.add(w, h, &pose), Some(grown(&pose, w, h, 4)));
        // Another pose while it is read adds to the cut; an opaque read
        // later changes nothing.
        let wings = block(w, h, 2..22, 14..18);
        let both: Vec<bool> = pose.iter().zip(&wings).map(|(a, b)| *a || *b).collect();
        assert_eq!(seen.add(w, h, &wings), Some(grown(&both, w, h, 4)));
        assert_eq!(seen.add(w, h, &vec![true; w * h]), None);
        assert_eq!(seen.add(w, h, &pose), Some(grown(&both, w, h, 4)));
        // Reading anew starts from what is drawn then.
        seen.forget();
        assert_eq!(seen.add(w, h, &pose), Some(grown(&pose, w, h, 4)));
        // Another size: only what is drawn at it counts.
        let small = block(16, 20, 4..12, 6..18);
        assert_eq!(seen.add(16, 20, &small), Some(grown(&small, 16, 20, 4)));
        assert_eq!(seen.add(16, 21, &small), None, "a read that does not match its size");
    }

    /// X reports each new size at the old top-left before the move, and quick
    /// Ctrl + wheel steps overlap: none of those reports is a drag. A real
    /// drag afterwards is.
    #[test]
    fn reports_of_a_resize_on_its_way_are_not_a_drag() {
        let t = Instant::now();
        let ms = |n| Duration::from_millis(n);
        let (s100, s110, s120) = ((124, 156), (136, 172), (149, 187));
        let start = (1435, 652);
        let feet = feet_of(start, s100);
        let placed = refit(None, Some(start), None, s100, t).unwrap();
        assert_eq!((placed.feet, top_left(placed.feet, placed.size)), (feet, start));
        // Two notches 30 ms apart; the system still says `start` for the second.
        let placed = refit(Some(placed), None, Some((start, s100)), s110, t + ms(10)).unwrap();
        let p110 = top_left(feet, s110);
        let mut placed = refit(Some(placed), None, Some((start, s100)), s120, t + ms(40)).unwrap();
        let p120 = top_left(feet, s120);
        for (at, when) in [(start, 60), (p110, 70), (start, 80), (p120, 90)] {
            placed.moved(at, t + ms(when));
            assert_eq!(placed.feet, feet, "a report of {at:?}");
        }
        // Long after, a report of the spot it was resized from is the user.
        placed.moved(start, t + ms(5000));
        assert_eq!(placed.feet, feet_of(start, s120));
        // So is any other spot, at once.
        let mut placed = refit(Some(placed), None, Some((start, s120)), s110, t + ms(6000)).unwrap();
        placed.moved((40, 900), t + ms(6100));
        assert_eq!(placed.feet, feet_of((40, 900), s110));
        // Nothing known about the window: nothing to keep.
        assert_eq!(refit(None, None, None, s100, t), None);
        assert_eq!(
            refit(None, None, Some(((10, 20), (200, 200))), s100, t).unwrap().feet,
            feet_of((10, 20), (200, 200))
        );
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
