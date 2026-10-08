// Physical-click guard for approvals.
//
// The threat: an agent that already got one harmless-looking command approved
// starts a background script, then asks for something dangerous — and the script
// "clicks" Allow for it, with synthesised mouse input or by pressing the button
// through the accessibility API (UI Automation on Windows, AXPress on macOS).
// Both look like an ordinary click to the page.
//
// The OS can tell them apart, and each platform half records the last left-button
// press on its own terms:
//   * Windows (`inputguard/raw_input.rs`): raw input carries the handle of the
//     device a press came from; SendInput has none.
//   * macOS (`inputguard/appkit.rs`): a mouse event carries the process id of
//     whoever posted it; a real mouse's events come from the HID system, pid 0.
// An accessibility "press" produces no mouse event at all on either.
//
// An approval is only accepted when the last press was physical, recent and on
// the Allow button. Recording stops as soon as nothing is waiting.
//
// Limits, stated plainly: touchscreens, remote-control software and
// accessibility tools (on-screen keyboards, speech control) produce synthesised
// or non-mouse input and will be refused — hence the setting to switch the guard
// off.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, WebviewWindow};

#[cfg(target_os = "macos")]
mod appkit;
#[cfg(windows)]
mod raw_input;

#[cfg(target_os = "macos")]
use appkit as imp;
#[cfg(windows)]
use raw_input as imp;

/// One left-button press.
///
/// Coordinates are in the platform's "guard space", the same one `Rect` uses:
/// physical screen pixels on Windows; on macOS, points inside the island window
/// measured from its bottom-left corner (NaN when the press was in another window).
#[derive(Clone, Copy, Debug)]
pub struct Press {
    pub at: Instant,
    /// Came from a real device, not from a program.
    pub physical: bool,
    pub x: f64,
    pub y: f64,
}

/// A rectangle in guard space: left, top, right, bottom, with top < bottom.
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl Rect {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }
}

struct Guard {
    /// The platform could listen; if not, the guard stands down rather than
    /// refusing every approval.
    available: AtomicBool,
    last: Mutex<Option<Press>>,
}

static GUARD: LazyLock<Guard> = LazyLock::new(|| Guard { available: AtomicBool::new(false), last: Mutex::new(None) });

/// Called by the platform half for every left-button press while armed.
fn record(physical: bool, x: f64, y: f64) {
    *GUARD.last.lock().unwrap() = Some(Press { at: Instant::now(), physical, x, y });
}

fn set_available(ok: bool) {
    GUARD.available.store(ok, Ordering::Release);
}

/// Starts the platform listener (idle until `arm(true)`).
pub fn start(app: &AppHandle) {
    imp::start(app);
}

/// Listen while requests wait; stop when none do.
pub fn arm(on: bool) {
    if on {
        // A press from before the card appeared must not count.
        *GUARD.last.lock().unwrap() = None;
    }
    imp::arm(on);
}

/// Forgets the last press: one real click backs one approval, not the next card
/// in the queue as well.
pub fn consume() {
    *GUARD.last.lock().unwrap() = None;
}

pub fn available() -> bool {
    GUARD.available.load(Ordering::Acquire)
}

/// A rectangle given in island-window logical pixels (CSS pixels), in guard space.
pub fn island_rect(win: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) -> Option<Rect> {
    imp::island_rect(win, x, y, w, h)
}

/// Whether an approval arriving now is backed by a recent physical click on the
/// island. `window` is how far back the press may be (a click: a few seconds; a
/// hold: the hold time plus slack); `on` is where it has to have landed.
pub fn check(window: Duration, on: Option<Rect>) -> Result<(), &'static str> {
    if !available() {
        return Ok(());
    }
    judge(*GUARD.last.lock().unwrap(), Instant::now(), window, on)
}

fn judge(last: Option<Press>, now: Instant, window: Duration, on: Option<Rect>) -> Result<(), &'static str> {
    match last {
        None => Err("no_click"),
        Some(p) if !p.physical => Err("synthetic_click"),
        Some(p) if now.saturating_duration_since(p.at) > window => Err("stale_click"),
        // A real click somewhere else does not vouch for an invoke on our button.
        // (NaN — a press in another window — is never inside anything.)
        Some(p) if on.is_some_and(|r| !r.contains(p.x, p.y)) => Err("click_elsewhere"),
        Some(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_recent_physical_press_on_the_island_counts() {
        let now = Instant::now();
        let window = Duration::from_secs(5);
        let island = Some(Rect { left: 100.0, top: 0.0, right: 820.0, bottom: 460.0 });
        let press = |at, physical, x, y| Some(Press { at, physical, x, y });
        assert_eq!(judge(None, now, window, island), Err("no_click"));
        assert_eq!(judge(press(now, false, 300.0, 100.0), now, window, island), Err("synthetic_click"));
        if let Some(old) = now.checked_sub(Duration::from_secs(9)) {
            assert_eq!(judge(press(old, true, 300.0, 100.0), now, window, island), Err("stale_click"));
        }
        assert_eq!(judge(press(now, true, 1500.0, 900.0), now, window, island), Err("click_elsewhere"));
        assert_eq!(judge(press(now, true, f64::NAN, f64::NAN), now, window, island), Err("click_elsewhere"));
        assert_eq!(judge(press(now, true, 300.0, 100.0), now, window, island), Ok(()));
        // Without a known rectangle only time and origin count.
        assert_eq!(judge(press(now, true, 1500.0, 900.0), now, window, None), Ok(()));
    }
}
