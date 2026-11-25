//! Linux media: any player that speaks MPRIS on the session bus (Spotify,
//! VLC, Firefox, Chromium, mpv with the plugin…). Read-only except the four
//! transport calls the card has buttons for. Artwork is shown only when the
//! player points at a local file; nothing is downloaded.
//!
//! Only players that are running are asked: every call goes out with D-Bus's
//! "no auto start" flag, so a player that has just quit (or one the bus could
//! start on demand) is never started by asking it something.

use super::{image_data_url, Media};
use dbus::arg::{prop_cast, PropMap, RefArg};
use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
use dbus::blocking::{BlockingSender, Connection, Proxy};
use dbus::strings::BusName;
use dbus::Message;
use std::time::Duration;

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
const TIMEOUT: Duration = Duration::from_millis(400);

/// The session bus, sending every call with NO_AUTO_START.
struct Running<'a>(&'a Connection);

impl BlockingSender for Running<'_> {
    fn send_with_reply_and_block(&self, mut msg: Message, timeout: Duration) -> Result<Message, dbus::Error> {
        msg.set_auto_start(false);
        self.0.send_with_reply_and_block(msg, timeout)
    }
}

/// `name` when it is an MPRIS player's bus name, checked the way D-Bus checks
/// it. The island hands the name back for the transport buttons, so it is not
/// trusted: dbus-rs panics on an invalid name, which would end the app.
fn player_name(name: &str) -> Option<BusName<'static>> {
    // libdbus reads a name up to a NUL: one inside would name another player.
    if !name.starts_with(PREFIX) || name.len() > 255 || name.contains('\0') {
        return None;
    }
    BusName::new(name).ok()
}

fn player<'a, 'c>(conn: &'c Running<'c>, bus: BusName<'a>) -> Proxy<'a, &'c Running<'c>> {
    Proxy::new(bus, PATH, TIMEOUT, conn)
}

fn players(conn: &Connection) -> Vec<BusName<'static>> {
    let proxy = conn.with_proxy("org.freedesktop.DBus", "/org/freedesktop/DBus", TIMEOUT);
    let names: Result<(Vec<String>,), _> = proxy.method_call("org.freedesktop.DBus", "ListNames", ());
    names.map(|(n,)| n.iter().filter_map(|n| player_name(n)).collect()).unwrap_or_default()
}

fn int(v: Option<&dbus::arg::Variant<Box<dyn RefArg>>>) -> Option<i64> {
    let v = &v?.0;
    v.as_i64().or_else(|| v.as_u64().and_then(|u| i64::try_from(u).ok()))
}

/// Reads one player; `None` if it is stopped or says nothing useful.
fn read_player(conn: &Running, bus: BusName<'static>, include_artwork: bool) -> Option<(u8, Media)> {
    let source = bus.to_string();
    let proxy = player(conn, bus);
    let props: PropMap = proxy.get_all(PLAYER).ok()?;
    let status = prop_cast::<String>(&props, "PlaybackStatus").map(String::as_str).unwrap_or("Stopped");
    let rank = match status {
        "Playing" => 2,
        "Paused" => 1,
        _ => return None,
    };
    // Typed Get: the metadata dictionary parses straight into a PropMap.
    let meta: PropMap = proxy.get(PLAYER, "Metadata").unwrap_or_default();
    let title = prop_cast::<String>(&meta, "xesam:title").cloned().unwrap_or_default();
    if title.trim().is_empty() {
        return None;
    }
    let artist = prop_cast::<Vec<String>>(&meta, "xesam:artist").map(|a| a.join(", ")).unwrap_or_default();
    let flag = |k: &str| prop_cast::<bool>(&props, k).copied().unwrap_or(false);
    let duration_ms = int(meta.get("mpris:length")).filter(|&us| us > 0).map(|us| us as u64 / 1000);
    let position_ms = duration_ms.and(int(props.get("Position"))).map(|us| us.max(0) as u64 / 1000);
    let artwork =
        if include_artwork { prop_cast::<String>(&meta, "mpris:artUrl").and_then(|u| local_image(u)) } else { None };
    Some((
        rank,
        Media {
            title,
            artist,
            source,
            playing: rank == 2,
            artwork,
            can_previous: flag("CanGoPrevious"),
            can_toggle: flag("CanPause") || flag("CanPlay"),
            can_next: flag("CanGoNext"),
            position_ms: position_ms.zip(duration_ms).map(|(p, d)| p.min(d)),
            duration_ms,
            can_seek: duration_ms.is_some() && flag("CanSeek") && meta.contains_key("mpris:trackid"),
        },
    ))
}

/// A `file://` artwork address, read from disk (small images only).
fn local_image(url: &str) -> Option<String> {
    let path = percent_decode(url.strip_prefix("file://")?)?;
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > 512 * 1024 {
        return None;
    }
    image_data_url(&std::fs::read(path).ok()?)
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn read(include_artwork: bool) -> Option<Media> {
    let conn = Connection::new_session().ok()?;
    let running = Running(&conn);
    players(&conn)
        .into_iter()
        .filter_map(|bus| read_player(&running, bus, include_artwork))
        .max_by_key(|(rank, _)| *rank)
        .map(|(_, m)| m)
}

pub fn control(source: &str, action: &str, position_ms: Option<u64>) -> bool {
    // Only ever talk to an MPRIS player, never to an arbitrary bus name.
    let Some(bus) = player_name(source) else { return false };
    if !matches!(action, "previous" | "toggle" | "next" | "seek") {
        return false;
    }
    let Ok(conn) = Connection::new_session() else { return false };
    let running = Running(&conn);
    let proxy = player(&running, bus);
    let result: Result<(), dbus::Error> = match action {
        "previous" => proxy.method_call(PLAYER, "Previous", ()),
        "toggle" => proxy.method_call(PLAYER, "PlayPause", ()),
        "next" => proxy.method_call(PLAYER, "Next", ()),
        "seek" => {
            let Some(ms) = position_ms else { return false };
            let Ok(meta) = proxy.get::<PropMap>(PLAYER, "Metadata") else { return false };
            let Some(track) = prop_cast::<dbus::Path<'static>>(&meta, "mpris:trackid").cloned() else {
                return false;
            };
            let us = i64::try_from(ms.saturating_mul(1000)).unwrap_or(i64::MAX);
            proxy.method_call(PLAYER, "SetPosition", (track, us))
        }
        _ => return false,
    };
    result.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_file_urls() {
        assert_eq!(
            percent_decode("/home/a/K%C3%BCt%C3%BCphane/cover%201.jpg").as_deref(),
            Some("/home/a/Kütüphane/cover 1.jpg")
        );
        assert_eq!(percent_decode("/bad%2"), None);
        assert_eq!(percent_decode("/bad%zz"), None);
    }

    #[test]
    fn refuses_non_mpris_targets() {
        assert!(!control("org.freedesktop.systemd1", "toggle", None));
        assert!(!control("org.mpris.MediaPlayer2.x", "rm", None));
    }

    #[test]
    fn malformed_player_names_are_refused_without_a_panic() {
        // Each of these passed the old prefix check and made dbus-rs panic,
        // which ends the app (panic = "abort").
        for name in [
            "org.mpris.MediaPlayer2.",
            "org.mpris.MediaPlayer2.a b",
            "org.mpris.MediaPlayer2..vlc",
            "org.mpris.MediaPlayer2.9lives",
            "org.mpris.MediaPlayer2.vlc.",
            "org.mpris.MediaPlayer2.ş",
            "org.mpris.MediaPlayer2.x\0y",
        ] {
            assert!(player_name(name).is_none(), "{name:?}");
            assert!(!control(name, "toggle", None), "{name:?}");
        }
        assert!(player_name(&format!("{PREFIX}{}", "a".repeat(250))).is_none(), "too long");
        for name in [
            "org.mpris.MediaPlayer2.vlc",
            "org.mpris.MediaPlayer2.spotify",
            "org.mpris.MediaPlayer2.firefox.instance_1_84",
        ] {
            assert_eq!(player_name(name).as_deref(), Some(name));
        }
    }
}

#[cfg(test)]
mod live {
    /// Needs a session bus with an MPRIS player: `cargo test -- --ignored mpris_live`.
    #[test]
    #[ignore]
    fn mpris_live() {
        let m = super::read(true).expect("a player");
        println!("{m:?}");
        assert!(super::control(&m.source, "toggle", None));
        assert!(super::control(&m.source, "seek", Some(90_000)));
        println!("{:?}", super::read(false));
    }

    /// Needs a session bus that could start `org.mpris.MediaPlayer2.nobiactivation`
    /// on demand, whose start writes the file named by NOBI_ACTIVATION_MARK:
    /// `cargo test -- --ignored a_player_that_is_not_running_is_never_started`.
    #[test]
    #[ignore]
    fn a_player_that_is_not_running_is_never_started() {
        let mark = std::path::PathBuf::from(std::env::var_os("NOBI_ACTIVATION_MARK").expect("the mark file"));
        let _ = std::fs::remove_file(&mark);
        for action in ["toggle", "next", "previous", "seek"] {
            assert!(!super::control("org.mpris.MediaPlayer2.nobiactivation", action, Some(1_000)));
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
        assert!(!mark.exists(), "asking a player that is not running must not start it");
    }
}
