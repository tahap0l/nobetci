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
//   * Linux (`inputguard/x11.rs`): XInput 2 names the device behind every press;
//     XTEST, the way X11 programs fake input, has devices of its own.
// An accessibility "press" produces no mouse event at all on either.
//
// An approval is only accepted when the last press was physical, recent, on the
// Allow button, made after the card came up, and not already spent on another
// approval. Recording stops as soon as nothing is waiting.
//
// Limits, stated plainly: touchscreens, remote-control software and
// accessibility tools (on-screen keyboards, speech control) produce synthesised
// or non-mouse input and will be refused — hence the setting to switch the guard
// off. So may a precision touchpad on some Windows laptops, whose clicks can
// arrive without a device handle (the log says so when it happens).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, WebviewWindow};

#[cfg(target_os = "macos")]
mod appkit;
#[cfg(windows)]
mod raw_input;
#[cfg(target_os = "linux")]
mod x11;

#[cfg(target_os = "macos")]
use appkit as imp;
#[cfg(windows)]
use raw_input as imp;
#[cfg(target_os = "linux")]
use x11 as imp;

/// One left-button press.
///
/// Coordinates are in the platform's "guard space", the same one `Rect` uses:
/// physical screen pixels on Windows and Linux; on macOS, points inside the island window
/// measured from its bottom-left corner (NaN when the press was in another window).
#[derive(Clone, Copy, Debug)]
pub struct Press {
    pub at: Instant,
    /// Came from a real device, not from a program.
    pub physical: bool,
    pub released_at: Option<Instant>,
    pub x: f64,
    pub y: f64,
    /// Already backed an approval; kept so a click meant for the card before
    /// can be told from no click at all.
    pub used: bool,
}

/// A click is fresh for this long after the mouse button was let go (or, while
/// it is still held, after the hold it was meant for).
const FRESH: Duration = Duration::from_secs(3);
/// A press that ended this recently, before the card it would approve came up,
/// is the tail of a click meant for the card before.
const JUST_ENDED: Duration = Duration::from_secs(1);

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

/// Called by the platform half for every primary-button press while armed.
fn record(physical: bool, x: f64, y: f64) {
    *GUARD.last.lock().unwrap() = Some(Press { at: Instant::now(), physical, released_at: None, x, y, used: false });
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

/// Keep a released press for ordinary clicks, which reach the app on mouse up.
fn release() {
    if let Some(press) = GUARD.last.lock().unwrap().as_mut() {
        press.released_at.get_or_insert_with(Instant::now);
    }
}

pub fn available() -> bool {
    GUARD.available.load(Ordering::Acquire)
}

/// A rectangle given in island-window logical pixels (CSS pixels), in guard space.
pub fn island_rect(win: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) -> Option<Rect> {
    imp::island_rect(win, x, y, w, h)
}

/// Verify and consume the press atomically so it can back only one approval.
/// `since` is when the card came up: the press must not be older.
pub fn check_and_consume(minimum: Duration, since: Instant, on: Option<Rect>) -> Result<(), &'static str> {
    if !available() {
        return if minimum.is_zero() { Ok(()) } else { Err("guard_unavailable") };
    }
    let mut last = GUARD.last.lock().unwrap();
    judge(*last, Instant::now(), since, minimum, on)?;
    if let Some(press) = last.as_mut() {
        press.used = true;
    }
    Ok(())
}

fn judge(
    last: Option<Press>,
    now: Instant,
    since: Instant,
    minimum: Duration,
    on: Option<Rect>,
) -> Result<(), &'static str> {
    let Some(p) = last else { return Err("no_click") };
    if p.at < since || p.used {
        // The press began before this card came up, or already approved
        // something: the second half of a double click, or the release that ends
        // a hold, meant for the card before. A real press just let go (or still
        // held) is plainly that — refused without crying wolf. Anything else is
        // as good as no click at all.
        let just_ended = p.released_at.is_none_or(|up| now.saturating_duration_since(up) <= JUST_ENDED);
        return Err(if p.physical && just_ended { "too_soon" } else { "no_click" });
    }
    if !p.physical {
        return Err("synthetic_click");
    }
    // Fresh from when the mouse button was let go — a slow click is still a
    // click — or, for a button still held, from when the hold began.
    let stale = match p.released_at {
        Some(up) => now.saturating_duration_since(up) > FRESH,
        None => now.saturating_duration_since(p.at) > minimum + FRESH,
    };
    if stale {
        return Err("stale_click");
    }
    if !minimum.is_zero() && p.released_at.unwrap_or(now).saturating_duration_since(p.at) < minimum {
        return Err("hold_incomplete");
    }
    // A real click somewhere else does not vouch for an invoke on our button.
    // (NaN — a press in another window — is never inside anything.)
    if !on.is_some_and(|r| r.contains(p.x, p.y)) {
        return Err("click_elsewhere");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISLAND: Option<Rect> = Some(Rect { left: 100.0, top: 0.0, right: 820.0, bottom: 460.0 });

    fn press(at: Instant, physical: bool, x: f64, y: f64) -> Press {
        Press { at, physical, released_at: None, x, y, used: false }
    }

    /// A moment well before `now`, for the card's arrival.
    fn earlier(now: Instant, secs: u64) -> Option<Instant> {
        now.checked_sub(Duration::from_secs(secs))
    }

    #[test]
    fn only_a_recent_physical_press_on_the_island_counts() {
        let now = Instant::now();
        let Some(since) = earlier(now, 20) else { return };
        let click = Duration::ZERO;
        assert_eq!(judge(None, now, since, click, ISLAND), Err("no_click"));
        let minimum = Duration::from_secs(1);
        let down = press(now, true, 300.0, 100.0);
        assert_eq!(judge(Some(down), now, since, minimum, ISLAND), Err("hold_incomplete"));
        assert_eq!(judge(Some(down), now + minimum, since, minimum, ISLAND), Ok(()));
        let released = Press { released_at: Some(now), ..down };
        assert_eq!(judge(Some(released), now + minimum, since, minimum, ISLAND), Err("hold_incomplete"));
        assert_eq!(judge(Some(released), now + minimum, since, click, ISLAND), Ok(()));
        let completed = Press { released_at: Some(now + minimum), ..down };
        assert_eq!(judge(Some(completed), now + minimum, since, minimum, ISLAND), Ok(()));
        assert_eq!(judge(Some(press(now, false, 300.0, 100.0)), now, since, click, ISLAND), Err("synthetic_click"));
        if let Some(old) = earlier(now, 9) {
            assert_eq!(judge(Some(press(old, true, 300.0, 100.0)), now, since, click, ISLAND), Err("stale_click"));
        }
        assert_eq!(judge(Some(press(now, true, 1500.0, 900.0)), now, since, click, ISLAND), Err("click_elsewhere"));
        let nowhere = press(now, true, f64::NAN, f64::NAN);
        assert_eq!(judge(Some(nowhere), now, since, click, ISLAND), Err("click_elsewhere"));
        assert_eq!(judge(Some(press(now, true, 300.0, 100.0)), now, since, click, ISLAND), Ok(()));
        // An unknown rectangle cannot establish that the press landed on the button.
        assert_eq!(judge(Some(press(now, true, 1500.0, 900.0)), now, since, click, None), Err("click_elsewhere"));
    }

    #[test]
    fn a_slow_click_is_fresh_from_its_release() {
        // Pressed, held for five seconds while re-reading, then let go: the click
        // reaches the app on release, and that is what freshness counts from.
        let now = Instant::now();
        let (Some(since), Some(pressed)) = (earlier(now, 20), earlier(now, 5)) else { return };
        let slow = Press { released_at: Some(now), ..press(pressed, true, 300.0, 100.0) };
        assert_eq!(judge(Some(slow), now, since, Duration::ZERO, ISLAND), Ok(()));
        assert_eq!(judge(Some(slow), now + FRESH, since, Duration::ZERO, ISLAND), Ok(()));
        let later = now + FRESH + Duration::from_millis(1);
        assert_eq!(judge(Some(slow), later, since, Duration::ZERO, ISLAND), Err("stale_click"));
        // Still held, no release seen: measured from the press as before.
        let held = press(pressed, true, 300.0, 100.0);
        assert_eq!(judge(Some(held), now, since, Duration::ZERO, ISLAND), Err("stale_click"));
        assert_eq!(judge(Some(held), now, since, Duration::from_secs(4), ISLAND), Ok(()));
    }

    #[test]
    fn a_press_from_before_the_card_is_too_soon_or_nothing() {
        let now = Instant::now();
        let (Some(pressed), Some(old)) = (earlier(now, 1), earlier(now, 30)) else { return };
        let since = pressed + Duration::from_millis(400);
        // The end of a hold that approved the card before: still down, or let go
        // a moment ago — the next card ignores it without the alarm.
        let held = press(pressed, true, 300.0, 100.0);
        assert_eq!(judge(Some(held), now, since, Duration::ZERO, ISLAND), Err("too_soon"));
        let let_go = Press { released_at: Some(now), ..held };
        assert_eq!(judge(Some(let_go), now, since, Duration::ZERO, ISLAND), Err("too_soon"));
        // Let go long ago, or not physical at all: that is no click.
        let long_ago = Press { at: old, released_at: Some(old), ..held };
        assert_eq!(judge(Some(long_ago), now, old + Duration::from_secs(1), Duration::ZERO, ISLAND), Err("no_click"));
        let fake = press(pressed, false, 300.0, 100.0);
        assert_eq!(judge(Some(fake), now, since, Duration::ZERO, ISLAND), Err("no_click"));
        // A press that already approved something backs nothing else — the second
        // half of a double click, even though it came after this card.
        let spent = Press { used: true, released_at: Some(now), ..press(since, true, 300.0, 100.0) };
        assert_eq!(judge(Some(spent), now, since, Duration::ZERO, ISLAND), Err("too_soon"));
        let spent_long_ago = Press { used: true, released_at: Some(pressed), ..spent };
        let much_later = now + Duration::from_secs(5);
        assert_eq!(judge(Some(spent_long_ago), much_later, since, Duration::ZERO, ISLAND), Err("no_click"));
    }

    #[test]
    fn a_press_is_spent_by_the_approval_it_backs() {
        set_available(true);
        arm(true);
        record(true, 300.0, 100.0);
        release();
        let since = GUARD.last.lock().unwrap().map(|p| p.at).unwrap();
        assert_eq!(check_and_consume(Duration::ZERO, since, ISLAND), Ok(()));
        assert_eq!(check_and_consume(Duration::ZERO, since, ISLAND), Err("too_soon"), "one press, one approval");
        arm(false);
    }
}
