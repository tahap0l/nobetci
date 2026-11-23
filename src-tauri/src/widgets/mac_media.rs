//! macOS media: Spotify and Music, through their AppleScript dictionaries.
//! An app is asked only while it is already running, so the card never starts
//! one. The script checks that itself (`if application … is running`) right
//! before its first word to the app: a check in a separate process could pass
//! for a player that quits a moment later, and AppleScript would start it
//! again. The first question shows macOS's Automation prompt for that app.
//!
//! A player that hangs cannot hold the card up: each Apple Event gives up after
//! two seconds, osascript is stopped after three, and the card asks again only
//! once the last read is done (`read_media` in widgets.rs).

use super::Media;
use std::time::Duration;

const APPS: [&str; 2] = ["Spotify", "Music"];
/// Field separator in the script's answer (ASCII unit separator).
const SEP: char = '\u{1F}';
/// How long the app may take to answer one Apple Event (AppleScript's own
/// default is two minutes).
const EVENT_TIMEOUT_SECS: u32 = 2;
/// How long osascript may run in all.
const OSASCRIPT_LIMIT: Duration = Duration::from_secs(3);

/// A cheap first look, so that osascript only starts when the app is there.
fn running(app: &str) -> bool {
    crate::sys::command("/usr/bin/pgrep").args(["-xq", app]).status().map(|s| s.success()).unwrap_or(false)
}

fn osascript(script: &str) -> Option<String> {
    let mut command = crate::sys::command("/usr/bin/osascript");
    command.args(["-e", script]);
    let out = super::output_within(command, OSASCRIPT_LIMIT)?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// A script that runs `body` in `app` only if the app is running when the
/// script gets there, each Apple Event limited to EVENT_TIMEOUT_SECS. When the
/// app is not running it answers "" without a word to the app.
fn script_for(app: &str, body: &str) -> String {
    format!(
        "if application \"{app}\" is running then\n\
         with timeout of {EVENT_TIMEOUT_SECS} seconds\n\
         tell application \"{app}\"\n\
         {body}\n\
         end tell\n\
         end timeout\n\
         end if\n\
         return \"\""
    )
}

fn read_script(app: &str) -> String {
    script_for(
        app,
        "set s to player state as string\n\
         if s is \"stopped\" then return s\n\
         set t to current track\n\
         set sep to character id 31\n\
         return s & sep & (name of t) & sep & (artist of t) & sep & (duration of t) & sep & (player position)",
    )
}

/// The script for a transport button, or None for an action the card does not have.
fn control_script(app: &str, action: &str, position_ms: Option<u64>) -> Option<String> {
    let command = match action {
        "previous" => "previous track".to_string(),
        "toggle" => "playpause".to_string(),
        "next" => "next track".to_string(),
        // A whole number of seconds keeps the script free of decimal separators.
        "seek" => format!("set player position to {}", position_ms? / 1000),
        _ => return None,
    };
    Some(script_for(app, &format!("{command}\nreturn \"ok\"")))
}

/// AppleScript prints reals with the system's decimal separator.
fn number(s: &str) -> Option<f64> {
    s.trim().replace(',', ".").parse().ok()
}

/// The card's view of what `read_script` answered: a rank (playing above
/// paused) and the track, or None when the app is stopped, was not running or
/// said nothing useful.
fn parse_answer(app: &str, answer: &str) -> Option<(u8, Media)> {
    let mut f = answer.split(SEP);
    let rank = match f.next()? {
        "playing" => 2,
        "paused" => 1,
        _ => return None,
    };
    let title = f.next()?.to_string();
    if title.trim().is_empty() {
        return None;
    }
    let artist = f.next().unwrap_or_default().to_string();
    // Spotify reports duration in milliseconds, Music in seconds.
    let duration = f.next().and_then(number).filter(|d| *d > 0.0);
    let duration_ms = duration.map(|d| (if app == "Spotify" { d } else { d * 1000.0 }) as u64);
    let position_ms = f.next().and_then(number).map(|p| (p.max(0.0) * 1000.0) as u64);
    Some((
        rank,
        Media {
            title,
            artist,
            source: app.to_string(),
            playing: rank == 2,
            artwork: None,
            can_previous: true,
            can_toggle: true,
            can_next: true,
            position_ms: duration_ms.and(position_ms).zip(duration_ms).map(|(p, d)| p.min(d)),
            duration_ms,
            can_seek: duration_ms.is_some(),
        },
    ))
}

pub fn read(_include_artwork: bool) -> Option<Media> {
    APPS.iter()
        .filter(|app| running(app))
        .filter_map(|app| parse_answer(app, &osascript(&read_script(app))?))
        .max_by_key(|(rank, _)| *rank)
        .map(|(_, m)| m)
}

pub fn control(source: &str, action: &str, position_ms: Option<u64>) -> bool {
    let Some(app) = APPS.iter().find(|a| **a == source) else { return false };
    let Some(script) = control_script(app, action, position_ms) else { return false };
    running(app) && osascript(&script).is_some_and(|answer| answer == "ok")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_script_checks_the_app_itself_before_it_says_a_word_to_it() {
        for app in APPS {
            for script in [read_script(app), control_script(app, "toggle", None).unwrap()] {
                let check = script.find(&format!("if application \"{app}\" is running then")).expect(&script);
                let timeout = script.find("with timeout of 2 seconds").expect(&script);
                let tell = script.find(&format!("tell application \"{app}\"\n")).expect(&script);
                assert!(check < timeout && timeout < tell, "{script}");
                assert_eq!(script.matches("tell application").count(), 1, "{script}");
                assert!(script.ends_with("end if\nreturn \"\""), "{script}");
            }
        }
    }

    #[test]
    fn transport_scripts_answer_ok_and_only_for_the_card_s_buttons() {
        let next = control_script("Music", "next", None).unwrap();
        assert!(next.contains("next track\nreturn \"ok\""), "{next}");
        let seek = control_script("Spotify", "seek", Some(91_500)).unwrap();
        assert!(seek.contains("set player position to 91\n"), "{seek}");
        assert!(control_script("Spotify", "seek", None).is_none());
        assert!(control_script("Spotify", "quit", None).is_none());
        assert!(!control("Finder", "toggle", None), "only Spotify and Music are asked");
    }

    #[test]
    fn answers_become_the_card() {
        let sep = SEP.to_string();
        let spotify = ["playing", "Song", "Artist", "215000", "12,5"].join(&sep);
        let (rank, m) = parse_answer("Spotify", &spotify).unwrap();
        assert_eq!((rank, m.playing, m.duration_ms, m.position_ms), (2, true, Some(215_000), Some(12_500)));
        let music = ["paused", "Song", "", "215.5", "300"].join(&sep);
        let (rank, m) = parse_answer("Music", &music).unwrap();
        assert_eq!((rank, m.playing, m.duration_ms, m.position_ms), (1, false, Some(215_500), Some(215_500)));
        assert!(parse_answer("Music", "stopped").is_none());
        assert!(parse_answer("Music", "").is_none(), "the app was not running");
        assert!(parse_answer("Music", &["playing", " "].join(&sep)).is_none());
    }
}
