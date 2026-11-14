//! macOS media: Spotify and Music, through their AppleScript dictionaries.
//! An app is asked only while it is already running, so the card never starts
//! one; the first question shows macOS's Automation prompt for that app.

use super::Media;
use std::process::Command;

const APPS: [&str; 2] = ["Spotify", "Music"];
/// Field separator in the script's answer (ASCII unit separator).
const SEP: char = '\u{1F}';

fn running(app: &str) -> bool {
    Command::new("/usr/bin/pgrep").args(["-xq", app]).status().map(|s| s.success()).unwrap_or(false)
}

fn osascript(script: &str) -> Option<String> {
    let out = Command::new("/usr/bin/osascript").args(["-e", script]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// AppleScript prints reals with the system's decimal separator.
fn number(s: &str) -> Option<f64> {
    s.trim().replace(',', ".").parse().ok()
}

fn read_app(app: &str) -> Option<(u8, Media)> {
    // Spotify reports duration in milliseconds, Music in seconds.
    let script = format!(
        r#"tell application "{app}"
  set s to player state as string
  if s is "stopped" then return s
  set t to current track
  set sep to character id 31
  return s & sep & (name of t) & sep & (artist of t) & sep & (duration of t) & sep & (player position)
end tell"#
    );
    let answer = osascript(&script)?;
    let mut f = answer.split(SEP);
    let state = f.next()?;
    let rank = match state {
        "playing" => 2,
        "paused" => 1,
        _ => return None,
    };
    let title = f.next()?.to_string();
    if title.trim().is_empty() {
        return None;
    }
    let artist = f.next().unwrap_or_default().to_string();
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
    APPS.iter().filter(|app| running(app)).filter_map(|app| read_app(app)).max_by_key(|(rank, _)| *rank).map(|(_, m)| m)
}

pub fn control(source: &str, action: &str, position_ms: Option<u64>) -> bool {
    let Some(app) = APPS.iter().find(|a| **a == source) else { return false };
    if !running(app) {
        return false;
    }
    let command = match action {
        "previous" => "previous track".to_string(),
        "toggle" => "playpause".to_string(),
        "next" => "next track".to_string(),
        // A whole number of seconds keeps the script free of decimal separators.
        "seek" => match position_ms {
            Some(ms) => format!("set player position to {}", ms / 1000),
            None => return false,
        },
        _ => return false,
    };
    osascript(&format!(r#"tell application "{app}" to {command}"#)).is_some()
}
