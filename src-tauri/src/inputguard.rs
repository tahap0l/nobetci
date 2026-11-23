// Physical-click guard for approvals.
//
// The threat: an agent that already got one harmless-looking command approved
// starts a background script, then asks for something dangerous — and the script
// "clicks" Allow for it, with synthesised mouse input or by pressing the button
// through the accessibility API (UI Automation on Windows, AXPress on macOS).
// Both look like an ordinary click to the page.
//
// Each platform half records the last press on its own terms:
//   * Windows (`inputguard/raw_input.rs`): raw input carries the handle of the
//     device a press came from; SendInput has none.
//   * macOS (`inputguard/appkit.rs`): a mouse event carries the process id of
//     whoever posted it; a real mouse's events come from the HID system, pid 0.
//   * Linux (`inputguard/x11.rs`): XInput 2 names the device behind every press.
//     That catches the usual way X11 programs fake input (xdotool and the like
//     press through an XTEST device), but not all of it: a program may also
//     have the X server press through the real mouse device itself, and nothing
//     in the event tells such a press from a hand on the mouse.
// An accessibility "press" produces no mouse event at all on any of them.
//
// So the guard says whether its platform can vouch for a physical hold
// (`vouches_for_holds`). Windows and macOS can. On Linux it cannot: there the
// island approves nothing that needs a hold — HIGH and CRITICAL requests are
// decided in the terminal (`terminal_only`) — and for LOW and MEDIUM the check
// is a speed bump that stops the common tools, not a proof.
//
// An approval is only accepted when the last press was physical, recent, on the
// Allow button, made after the card came up, and not already spent on another
// approval — and no button a program pressed was still down when it began: a
// program that holds the button on Allow while the user clicks elsewhere must
// not have its own release judged by that real press. Every button a program
// holds is followed until it is let go (`program_down` / `program_up`), not
// just the newest, so a second, quick press cannot hide the one still held.
// Recording stops as soon as nothing is waiting.
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
    /// A button a program pressed was still down when this press began: the
    /// click the page gets may be the program's, made when it lets go.
    pub amid_program: bool,
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

/// The most buttons a program is followed holding at once. More than that is
/// no hand at work: from then on, until the next card, every press counts as
/// made while a program holds one (`Presses::overflow`).
const MAX_HELD: usize = 32;

/// What the guard has seen since it was armed.
#[derive(Clone, Default)]
struct Presses {
    /// The last press, whoever made it.
    last: Option<Press>,
    /// The buttons a program holds down right now, by the platform half's own
    /// key for each (device and button on Linux, the button on Windows and macOS).
    program_held: Vec<u64>,
    /// A program held more buttons than are followed (`MAX_HELD`).
    overflow: bool,
}

impl Presses {
    /// Whether a button a program pressed is down right now.
    fn program_holds(&self) -> bool {
        self.overflow || !self.program_held.is_empty()
    }
}

struct Guard {
    /// The platform could listen; if not, the guard stands down rather than
    /// refusing every approval.
    available: AtomicBool,
    presses: Mutex<Presses>,
}

static GUARD: LazyLock<Guard> =
    LazyLock::new(|| Guard { available: AtomicBool::new(false), presses: Mutex::new(Presses::default()) });

/// Called by the platform half for every press that may be a click while armed:
/// a real press of the primary button, and a program's press of any button.
fn record(physical: bool, x: f64, y: f64) {
    let mut presses = GUARD.presses.lock().unwrap();
    let amid_program = presses.program_holds();
    presses.last = Some(Press { at: Instant::now(), physical, released_at: None, x, y, used: false, amid_program });
}

/// A program pressed the button the platform half calls `key`: it counts as
/// held until `program_up` with the same key (or the next card).
fn program_down(key: u64) {
    let mut presses = GUARD.presses.lock().unwrap();
    if presses.program_held.contains(&key) {
        return;
    }
    if presses.program_held.len() >= MAX_HELD {
        presses.overflow = true;
    } else {
        presses.program_held.push(key);
    }
}

/// A program let go of the button `key` (nothing happens for one it does not hold).
fn program_up(key: u64) {
    GUARD.presses.lock().unwrap().program_held.retain(|held| *held != key);
}

fn set_available(ok: bool) {
    GUARD.available.store(ok, Ordering::Release);
}

/// Whether this platform can vouch that a hold on the Allow button was a hand
/// on the mouse. False on Linux, where a program can press through the real
/// mouse device: the island then approves nothing that needs a hold.
pub fn vouches_for_holds() -> bool {
    imp::VOUCHES_FOR_HOLDS
}

/// Starts the platform listener (idle until `arm(true)`).
pub fn start(app: &AppHandle) {
    imp::start(app);
}

/// Listen while requests wait; stop when none do.
pub fn arm(on: bool) {
    if on {
        // A press from before the card appeared must not count.
        *GUARD.presses.lock().unwrap() = Presses::default();
    }
    imp::arm(on);
}

/// The button behind the last press was let go. A released press is kept for
/// ordinary clicks, which reach the app on mouse up.
#[cfg(target_os = "linux")]
fn release_last() {
    if let Some(press) = GUARD.presses.lock().unwrap().last.as_mut() {
        press.released_at.get_or_insert_with(Instant::now);
    }
}

/// The primary button was let go by a real device (`physical`), or a button by
/// a program — for a platform that does not follow which press a release
/// ends: it ends the last press if the same kind of hand made it.
#[cfg(not(target_os = "linux"))]
fn release(physical: bool) {
    if let Some(press) = GUARD.presses.lock().unwrap().last.as_mut().filter(|p| p.physical == physical) {
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
/// `since` is when the card came up: the press must not be older. A hold
/// (`minimum` above zero) is refused outright with `terminal_only` where the
/// platform cannot vouch for one (`vouches_for_holds`).
pub fn check_and_consume(minimum: Duration, since: Instant, on: Option<Rect>) -> Result<(), &'static str> {
    if !minimum.is_zero() && !vouches_for_holds() {
        return Err("terminal_only");
    }
    if !available() {
        return if minimum.is_zero() { Ok(()) } else { Err("guard_unavailable") };
    }
    let mut presses = GUARD.presses.lock().unwrap();
    judge(presses.last, Instant::now(), since, minimum, on)?;
    if let Some(press) = presses.last.as_mut() {
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
    // A button a program pressed was still down when this real press began:
    // the click the page got may be the program's own, made by letting go on
    // our button, while the hand on the mouse pressed somewhere else. (A
    // program's press made after this one is the last press itself, above.)
    if p.amid_program {
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
        Press { at, physical, released_at: None, x, y, used: false, amid_program: false }
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
    fn a_real_press_made_while_a_program_holds_a_button_vouches_for_nothing() {
        let now = Instant::now();
        let Some(since) = earlier(now, 2) else { return };
        let user = Press { released_at: Some(now), ..press(since + Duration::from_millis(500), true, 300.0, 100.0) };
        assert_eq!(judge(Some(user), now, since, Duration::ZERO, ISLAND), Ok(()));
        let amid = Press { amid_program: true, ..user };
        assert_eq!(judge(Some(amid), now, since, Duration::ZERO, ISLAND), Err("synthetic_click"));
    }

    /// The tests that use the guard itself take turns: it is one for the process.
    static TURN: Mutex<()> = Mutex::new(());

    fn take_turn() -> std::sync::MutexGuard<'static, ()> {
        TURN.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Lets go of the button behind the last press, as the platform half would.
    fn let_go_of_the_last_press() {
        #[cfg(target_os = "linux")]
        release_last();
        #[cfg(not(target_os = "linux"))]
        release(true);
    }

    /// What the guard would answer for an approval of the card that came up at
    /// `since`, without spending the press.
    fn verdict_now(since: Instant) -> Result<(), &'static str> {
        judge(GUARD.presses.lock().unwrap().last, Instant::now(), since, Duration::ZERO, ISLAND)
    }

    #[test]
    fn a_program_s_held_press_is_not_vouched_for_by_a_real_one() {
        // approval-safety#2: a program presses on Allow and keeps the button
        // down; the user clicks somewhere else (the program moves the pointer
        // onto Allow before the guard reads it); the program lets go on Allow,
        // and the page gets its click. The real press must not stand behind it.
        let _turn = take_turn();
        set_available(true);
        arm(true);
        let since = Instant::now();
        program_down(1);
        record(false, 300.0, 100.0);
        record(true, 300.0, 100.0);
        let_go_of_the_last_press();
        assert_eq!(verdict_now(since), Err("synthetic_click"), "the program still holds its button");
        program_up(1);
        assert_eq!(verdict_now(since), Err("synthetic_click"), "it held it when the real press began");

        // The way around a guard that follows only the newest program press: a
        // second, quick press of another button, let go before the user's press.
        arm(true);
        let since = Instant::now();
        program_down(1);
        record(false, 300.0, 100.0);
        program_down(3);
        record(false, 300.0, 100.0);
        program_up(3);
        record(true, 300.0, 100.0);
        let_go_of_the_last_press();
        assert_eq!(verdict_now(since), Err("synthetic_click"), "button 1 is still the program's");

        // Every button a program held was let go before the real press: the
        // real click counts.
        arm(true);
        let since = Instant::now();
        program_down(1);
        record(false, 300.0, 100.0);
        program_up(1);
        record(true, 300.0, 100.0);
        let_go_of_the_last_press();
        assert_eq!(verdict_now(since), Ok(()));
        arm(false);
    }

    #[test]
    fn a_program_holding_too_many_buttons_taints_every_press_until_the_next_card() {
        let _turn = take_turn();
        set_available(true);
        arm(true);
        let since = Instant::now();
        for key in 0..(MAX_HELD as u64 + 1) {
            program_down(key);
        }
        for key in 0..(MAX_HELD as u64 + 1) {
            program_up(key);
        }
        record(true, 300.0, 100.0);
        let_go_of_the_last_press();
        assert_eq!(verdict_now(since), Err("synthetic_click"), "one button went unfollowed");
        arm(true);
        let since = Instant::now();
        record(true, 300.0, 100.0);
        let_go_of_the_last_press();
        assert_eq!(verdict_now(since), Ok(()), "a new card starts afresh");
        arm(false);
    }

    #[test]
    fn a_press_is_spent_by_the_approval_it_backs() {
        let _turn = take_turn();
        set_available(true);
        arm(true);
        record(true, 300.0, 100.0);
        let_go_of_the_last_press();
        let since = GUARD.presses.lock().unwrap().last.map(|p| p.at).unwrap();
        assert_eq!(check_and_consume(Duration::ZERO, since, ISLAND), Ok(()));
        assert_eq!(check_and_consume(Duration::ZERO, since, ISLAND), Err("too_soon"), "one press, one approval");
        arm(false);
    }

    /// D23: on Linux a program can press through the real mouse device, so the
    /// guard cannot vouch for a hold there and refuses one outright, whatever
    /// it saw; Windows and macOS vouch as before.
    #[test]
    fn only_a_platform_that_can_tell_a_hand_from_a_program_vouches_for_holds() {
        let _turn = take_turn();
        set_available(true);
        arm(true);
        let since = Instant::now();
        record(true, 300.0, 100.0);
        let hold = Duration::from_millis(1);
        std::thread::sleep(Duration::from_millis(5));
        if cfg!(target_os = "linux") {
            assert!(!vouches_for_holds());
            assert_eq!(check_and_consume(hold, since, ISLAND), Err("terminal_only"));
            // A plain click (LOW, MEDIUM) is still judged by the guard.
            let_go_of_the_last_press();
            assert_eq!(check_and_consume(Duration::ZERO, since, ISLAND), Ok(()));
        } else {
            assert!(vouches_for_holds());
            assert_eq!(check_and_consume(hold, since, ISLAND), Ok(()));
        }
        arm(false);
    }
}
