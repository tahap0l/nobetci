// "Leave me alone" states: do-not-disturb, quiet hours, and full-screen apps.
//
// Quiet does not drop anything: requests still queue and wait. It only stops the
// island from popping open, sounds from playing and notifications from showing.

use crate::settings::Settings;
use crate::sys::fullscreen;

/// "HH:MM" → minutes after midnight.
fn minutes(hhmm: &str) -> Option<u32> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// Whether `now` falls in [from, to), wrapping past midnight when from > to.
fn in_window(now: u32, from: u32, to: u32) -> bool {
    if from == to {
        false
    } else if from < to {
        now >= from && now < to
    } else {
        now >= from || now < to
    }
}

fn now_minutes() -> u32 {
    let t = crate::sys::local_time();
    t.hour * 60 + t.minute
}

/// Why it is quiet right now, if it is: "dnd", "hours" or "fullscreen".
pub fn reason(s: &Settings) -> Option<&'static str> {
    if s.dnd {
        return Some("dnd");
    }
    if s.quiet_enabled {
        if let (Some(from), Some(to)) = (minutes(&s.quiet_from), minutes(&s.quiet_to)) {
            if in_window(now_minutes(), from, to) {
                return Some("hours");
            }
        }
    }
    if s.quiet_fullscreen && fullscreen() {
        return Some("fullscreen");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_times() {
        assert_eq!(minutes("08:30"), Some(510));
        assert_eq!(minutes(" 23:00 "), Some(1380));
        assert_eq!(minutes("24:00"), None);
        assert_eq!(minutes("nope"), None);
    }

    #[test]
    fn windows_wrap_past_midnight() {
        let (from, to) = (23 * 60, 8 * 60);
        assert!(in_window(23 * 60 + 30, from, to));
        assert!(in_window(3 * 60, from, to));
        assert!(!in_window(12 * 60, from, to));
        assert!(!in_window(8 * 60, from, to), "the end is exclusive");
        assert!(in_window(13 * 60, 12 * 60, 14 * 60));
        assert!(!in_window(10, 600, 600), "an empty window is never quiet");
    }
}
