//! Linux media: any player that speaks MPRIS on the session bus (Spotify,
//! VLC, Firefox, Chromium, mpv with the plugin…). Read-only except the four
//! transport calls the card has buttons for. Artwork is shown only when the
//! player points at a local file; nothing is downloaded.

use super::{image_data_url, Media};
use dbus::arg::{prop_cast, PropMap, RefArg};
use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
use dbus::blocking::Connection;
use std::time::Duration;

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
const TIMEOUT: Duration = Duration::from_millis(400);

fn players(conn: &Connection) -> Vec<String> {
    let proxy = conn.with_proxy("org.freedesktop.DBus", "/org/freedesktop/DBus", TIMEOUT);
    let names: Result<(Vec<String>,), _> = proxy.method_call("org.freedesktop.DBus", "ListNames", ());
    names.map(|(n,)| n.into_iter().filter(|n| n.starts_with(PREFIX)).collect()).unwrap_or_default()
}

fn int(v: Option<&dbus::arg::Variant<Box<dyn RefArg>>>) -> Option<i64> {
    let v = &v?.0;
    v.as_i64().or_else(|| v.as_u64().and_then(|u| i64::try_from(u).ok()))
}

/// Reads one player; `None` if it is stopped or says nothing useful.
fn read_player(conn: &Connection, bus: &str, include_artwork: bool) -> Option<(u8, Media)> {
    let proxy = conn.with_proxy(bus, PATH, TIMEOUT);
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
            source: bus.to_string(),
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
    players(&conn)
        .iter()
        .filter_map(|bus| read_player(&conn, bus, include_artwork))
        .max_by_key(|(rank, _)| *rank)
        .map(|(_, m)| m)
}

pub fn control(source: &str, action: &str, position_ms: Option<u64>) -> bool {
    // Only ever talk to an MPRIS player, never to an arbitrary bus name.
    if !source.starts_with(PREFIX) || source.len() > 255 {
        return false;
    }
    let Ok(conn) = Connection::new_session() else { return false };
    let proxy = conn.with_proxy(source, PATH, TIMEOUT);
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
}
