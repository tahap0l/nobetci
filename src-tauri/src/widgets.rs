use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Cities the weather card offers: (id, latitude, longitude). The front end has
/// the matching names in `island-widgets.ts`.
const CITIES: &[(&str, f64, f64)] = &[
    ("istanbul", 41.01, 28.97),
    ("ankara", 39.93, 32.86),
    ("izmir", 38.42, 27.14),
    ("bursa", 40.19, 29.06),
    ("antalya", 36.90, 30.71),
    ("adana", 37.00, 35.32),
    ("konya", 37.87, 32.48),
    ("gaziantep", 37.07, 37.38),
    ("kayseri", 38.73, 35.48),
    ("eskisehir", 39.78, 30.52),
    ("samsun", 41.29, 36.33),
    ("trabzon", 41.00, 39.72),
    ("diyarbakir", 37.91, 40.24),
    ("kocaeli", 40.77, 29.94),
    ("mersin", 36.81, 34.64),
    ("london", 51.51, -0.13),
    ("berlin", 52.52, 13.40),
    ("amsterdam", 52.37, 4.90),
    ("paris", 48.86, 2.35),
    ("new-york", 40.71, -74.01),
    ("san-francisco", 37.77, -122.42),
    ("tokyo", 35.68, 139.69),
];

pub fn city(id: &str) -> Option<(f64, f64)> {
    CITIES.iter().find(|(c, _, _)| *c == id).map(|&(_, lat, lon)| (lat, lon))
}

/// One hour of the forecast strip.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hour {
    /// Local time as "HH:00".
    time: String,
    temperature: f64,
    code: u8,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    pub temperature: f64,
    pub code: u8,
    feels_like: f64,
    is_day: bool,
    wind: f64,
    high: Option<f64>,
    low: Option<f64>,
    hours: Vec<Hour>,
}

#[derive(Deserialize)]
struct Current {
    temperature_2m: f64,
    weather_code: u8,
    apparent_temperature: Option<f64>,
    is_day: Option<u8>,
    wind_speed_10m: Option<f64>,
}

#[derive(Deserialize, Default)]
struct Hourly {
    time: Vec<String>,
    temperature_2m: Vec<f64>,
    weather_code: Vec<u8>,
}

#[derive(Deserialize, Default)]
struct Daily {
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
}

#[derive(Deserialize)]
struct Forecast {
    current: Current,
    #[serde(default)]
    hourly: Hourly,
    #[serde(default)]
    daily: Daily,
}

impl Forecast {
    fn into_weather(self) -> Weather {
        let c = self.current;
        // Every third hour from now: what the next half day looks like.
        let hours = (1..=4)
            .filter_map(|i| {
                let at = i * 3;
                let time = self.hourly.time.get(at)?;
                Some(Hour {
                    time: time.get(11..16).unwrap_or(time).to_string(),
                    temperature: *self.hourly.temperature_2m.get(at)?,
                    code: *self.hourly.weather_code.get(at)?,
                })
            })
            .collect();
        Weather {
            temperature: c.temperature_2m,
            code: c.weather_code,
            feels_like: c.apparent_temperature.unwrap_or(c.temperature_2m),
            is_day: c.is_day.unwrap_or(1) == 1,
            wind: c.wind_speed_10m.unwrap_or(0.0),
            high: self.daily.temperature_2m_max.first().copied(),
            low: self.daily.temperature_2m_min.first().copied(),
            hours,
        }
    }
}

/// How long a forecast is reused. The compact island and the weather card both
/// ask; one request serves both.
const WEATHER_TTL: std::time::Duration = std::time::Duration::from_secs(10 * 60);

type WeatherCache = std::sync::Mutex<Option<(String, std::time::Instant, Weather)>>;

fn weather_cache() -> &'static WeatherCache {
    static CACHE: std::sync::OnceLock<WeatherCache> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

#[tauri::command]
pub async fn island_weather(app: AppHandle, city_id: String) -> Option<Weather> {
    if super::current(&app).island_weather_city != city_id {
        return None;
    }
    let (latitude, longitude) = city(&city_id)?;
    if let Some((cached, at, w)) = weather_cache().lock().ok()?.as_ref() {
        if *cached == city_id && at.elapsed() < WEATHER_TTL {
            return Some(w.clone());
        }
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let response = client
        .get(format!(
            "https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}\
             &current=temperature_2m,weather_code,apparent_temperature,is_day,wind_speed_10m\
             &hourly=temperature_2m,weather_code&forecast_hours=13\
             &daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto"
        ))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let weather = response.json::<Forecast>().await.ok()?.into_weather();
    if let Ok(mut cache) = weather_cache().lock() {
        *cache = Some((city_id, std::time::Instant::now(), weather.clone()));
    }
    Some(weather)
}

/// What is playing, as the island's media card shows it. Every OS has its own
/// source: the system media controls on Windows, Spotify and Music on macOS,
/// and any MPRIS player (Spotify, VLC, browsers…) on Linux.
#[derive(Serialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    title: String,
    artist: String,
    /// Which player, to send it commands: an app id, a bus name or an app name.
    source: String,
    playing: bool,
    artwork: Option<String>,
    can_previous: bool,
    can_toggle: bool,
    can_next: bool,
    /// Where the track is, and how long it is, when the player says.
    position_ms: Option<u64>,
    duration_ms: Option<u64>,
    can_seek: bool,
}

/// Turns a small local image into a data URL for the card; anything else, None.
#[cfg(target_os = "linux")]
fn image_data_url(bytes: &[u8]) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if bytes.is_empty() || bytes.len() > 512 * 1024 {
        return None;
    }
    let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        return None;
    };
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

pub mod stats;

#[cfg(target_os = "linux")]
mod linux_media;
#[cfg(target_os = "linux")]
use linux_media as platform_media;
// Also built for the tests on Linux: its scripts and their answers are checked there.
#[cfg(any(target_os = "macos", all(test, unix)))]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
mod mac_media;
#[cfg(target_os = "macos")]
use mac_media as platform_media;
#[cfg(windows)]
use windows_media as platform_media;

/// Whether the island may ask about the player: when the media card is on, or
/// when the user typed a media command in the assistant (`explicit`, C-19).
/// Either way only a player that is already running is asked; none is started.
fn media_allowed(card_on: bool, explicit: Option<bool>) -> bool {
    card_on || explicit == Some(true)
}

/// How long the last answer stands in for a read that is still under way.
const MEDIA_STALE: Duration = Duration::from_secs(30);

/// Reads the player one question at a time. The compact island and the card
/// ask every few seconds without waiting for each other, and a player that
/// hangs (AppleScript waits for it) must not pile up threads and processes:
/// while a read is under way, the answer it is about to replace stands in.
fn read_media(include_artwork: bool, read: impl FnOnce(bool) -> Option<Media>) -> Option<Media> {
    static BUSY: AtomicBool = AtomicBool::new(false);
    static LAST: Mutex<Option<(Instant, Option<Media>)>> = Mutex::new(None);
    let last = || match &*LAST.lock().unwrap_or_else(PoisonError::into_inner) {
        Some((at, media)) if at.elapsed() < MEDIA_STALE => media.clone(),
        _ => None,
    };
    if BUSY.swap(true, Ordering::AcqRel) {
        return last();
    }
    /// Lets the next read in, however this one ends.
    struct Done;
    impl Drop for Done {
        fn drop(&mut self) {
            BUSY.store(false, Ordering::Release);
        }
    }
    let _done = Done;
    let media = read(include_artwork);
    *LAST.lock().unwrap_or_else(PoisonError::into_inner) = Some((Instant::now(), media.clone()));
    media
}

#[tauri::command]
pub async fn island_media(app: AppHandle, include_artwork: Option<bool>, explicit: Option<bool>) -> Option<Media> {
    if !media_allowed(super::current(&app).island_media, explicit) {
        return None;
    }
    let include_artwork = include_artwork.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || read_media(include_artwork, platform_media::read)).await.ok().flatten()
}

/// A seek position as the card sends it — the share of the bar clicked times
/// the track's length, so rarely a whole number — in whole milliseconds. Not a
/// number, negative or past any track: refused (Err), never sent to a player.
fn seek_position(position_ms: Option<f64>) -> Result<Option<u64>, ()> {
    match position_ms {
        None => Ok(None),
        // NaN and the infinities are outside the range too.
        Some(ms) if (0.0..1e15).contains(&ms) => Ok(Some(ms.round() as u64)),
        Some(_) => Err(()),
    }
}

#[tauri::command]
pub async fn island_media_control(
    app: AppHandle,
    source: String,
    action: String,
    position_ms: Option<f64>,
    explicit: Option<bool>,
) -> bool {
    if !media_allowed(super::current(&app).island_media, explicit) {
        return false;
    }
    if !matches!(action.as_str(), "previous" | "toggle" | "next" | "seek") {
        return false;
    }
    let Ok(position_ms) = seek_position(position_ms) else { return false };
    tauri::async_runtime::spawn_blocking(move || platform_media::control(&source, &action, position_ms))
        .await
        .unwrap_or(false)
}

/// Runs one of the small programs the cards ask (osascript, ioreg, nvidia-smi)
/// and returns what it printed, or None when it fails or is still running after
/// `limit`; then it is stopped. A program that hangs must not hold a thread, or
/// pile up, while the card keeps asking.
#[cfg(unix)]
pub(crate) fn output_within(mut command: std::process::Command, limit: Duration) -> Option<std::process::Output> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    // Read while it runs: a full pipe must not stall it.
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        if let Some(pipe) = stdout.as_mut() {
            let _ = pipe.read_to_end(&mut out);
        }
        out
    });
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let stdout = reader.join().unwrap_or_default();
    status.map(|status| std::process::Output { status, stdout, stderr: Vec::new() })
}

#[cfg(windows)]
mod windows_media {
    use super::Media;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };
    use windows::Storage::Streams::DataReader;

    fn current() -> Option<Session> {
        Manager::RequestAsync().ok()?.get().ok()?.GetCurrentSession().ok()
    }

    fn artwork(properties: &Properties) -> Option<String> {
        let stream = properties.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 512 * 1024 {
            return None;
        }
        let content_type = stream.ContentType().ok()?.to_string();
        if !matches!(content_type.as_str(), "image/jpeg" | "image/png" | "image/webp") {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
        if u64::from(reader.LoadAsync(size as u32).ok()?.get().ok()?) != size {
            return None;
        }
        let mut bytes = vec![0; size as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!("data:{content_type};base64,{}", STANDARD.encode(bytes)))
    }

    pub fn read(include_artwork: bool) -> Option<Media> {
        let session = current()?;
        let properties = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = properties.Title().ok()?.to_string();
        if title.trim().is_empty() {
            return None;
        }
        let playback = session.GetPlaybackInfo().ok()?;
        let controls = playback.Controls().ok();
        let playing = playback.PlaybackStatus().ok()? == PlaybackStatus::Playing;
        let (position_ms, duration_ms) = timeline(&session, playing);
        Some(Media {
            title,
            artist: properties.Artist().ok()?.to_string(),
            source: session.SourceAppUserModelId().ok()?.to_string(),
            playing,
            artwork: include_artwork.then(|| artwork(&properties)).flatten(),
            can_previous: controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()).unwrap_or(false),
            can_toggle: controls.as_ref().and_then(|c| c.IsPlayPauseToggleEnabled().ok()).unwrap_or(false),
            can_next: controls.as_ref().and_then(|c| c.IsNextEnabled().ok()).unwrap_or(false),
            position_ms,
            duration_ms,
            can_seek: duration_ms.is_some()
                && controls.as_ref().and_then(|c| c.IsPlaybackPositionEnabled().ok()).unwrap_or(false),
        })
    }

    /// 100-ns ticks between 1601-01-01 (Windows time) and 1970-01-01.
    const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

    /// Position and length in milliseconds. The position is a snapshot taken
    /// when the player last reported; while playing, the time since is added.
    fn timeline(session: &Session, playing: bool) -> (Option<u64>, Option<u64>) {
        let Ok(t) = session.GetTimelineProperties() else { return (None, None) };
        let (Ok(start), Ok(end), Ok(pos)) = (t.StartTime(), t.EndTime(), t.Position()) else {
            return (None, None);
        };
        let length = end.Duration - start.Duration;
        if length <= 0 {
            return (None, None);
        }
        let mut at = pos.Duration - start.Duration;
        if playing {
            if let Ok(updated) = t.LastUpdatedTime() {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos() as i64 / 100 + EPOCH_DIFF_TICKS)
                    .unwrap_or(updated.UniversalTime);
                at += (now - updated.UniversalTime).clamp(0, length);
            }
        }
        let ms = |ticks: i64| (ticks.max(0) / 10_000) as u64;
        (Some(ms(at.min(length))), Some(ms(length)))
    }

    pub fn control(source: &str, action: &str, position_ms: Option<u64>) -> bool {
        let Some(session) = current() else { return false };
        if session.SourceAppUserModelId().map_or(true, |id| id != source) {
            return false;
        }
        let operation = match action {
            "previous" => session.TrySkipPreviousAsync(),
            "toggle" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "seek" => match position_ms {
                Some(ms) => session.TryChangePlaybackPositionAsync(ms as i64 * 10_000),
                None => return false,
            },
            _ => return false,
        };
        match operation {
            Ok(operation) => operation.get().unwrap_or(false),
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod weather_tests {
    use super::*;

    #[test]
    fn a_forecast_becomes_the_card() {
        let json = r#"{
          "current": {"temperature_2m": 12.4, "weather_code": 3, "apparent_temperature": 10.1, "is_day": 0, "wind_speed_10m": 14.2},
          "hourly": {"time": ["2026-11-15T02:00","2026-11-15T03:00","2026-11-15T04:00","2026-11-15T05:00","2026-11-15T06:00","2026-11-15T07:00","2026-11-15T08:00","2026-11-15T09:00","2026-11-15T10:00","2026-11-15T11:00","2026-11-15T12:00","2026-11-15T13:00","2026-11-15T14:00"],
                     "temperature_2m": [12,11,11,10,10,10,11,12,13,14,15,15,16],
                     "weather_code": [3,3,3,61,61,61,3,3,2,2,1,1,0]},
          "daily": {"temperature_2m_max": [16.2], "temperature_2m_min": [9.8]}
        }"#;
        let w = serde_json::from_str::<Forecast>(json).unwrap().into_weather();
        assert!(!w.is_day);
        assert_eq!(w.high, Some(16.2));
        assert_eq!(w.hours.len(), 4);
        assert_eq!(w.hours[0].time, "05:00");
        assert_eq!(w.hours[0].code, 61);
        assert_eq!(w.hours[3].time, "14:00");
    }

    #[test]
    fn an_old_style_answer_still_parses() {
        let json = r#"{"current": {"temperature_2m": 20.0, "weather_code": 0}}"#;
        let w = serde_json::from_str::<Forecast>(json).unwrap().into_weather();
        assert_eq!(w.feels_like, 20.0);
        assert!(w.hours.is_empty());
    }

    #[test]
    fn cities_are_unique_and_plausible() {
        for (i, (id, lat, lon)) in CITIES.iter().enumerate() {
            assert!(lat.abs() <= 90.0 && lon.abs() <= 180.0, "{id}");
            assert!(CITIES[i + 1..].iter().all(|(other, _, _)| other != id), "{id}");
        }
    }
}

#[cfg(test)]
mod media_tests {
    use super::*;
    use std::sync::mpsc;

    /// shell-widgets#1: a click on the time bar sends a fractional position
    /// (62 % of a 215 s track is 133886.36… ms); it is taken, rounded.
    #[test]
    fn a_seek_position_need_not_be_a_whole_number() {
        let sent: Option<f64> = serde_json::from_value(serde_json::json!(133886.36363636362)).unwrap();
        assert_eq!(seek_position(sent), Ok(Some(133886)));
        let whole: Option<f64> = serde_json::from_value(serde_json::json!(133886)).unwrap();
        assert_eq!(seek_position(whole), Ok(Some(133886)), "a whole number still reads");
        assert_eq!(seek_position(Some(0.4)), Ok(Some(0)));
        assert_eq!(seek_position(None), Ok(None));
        for bad in [-1.0, f64::NAN, f64::INFINITY, 1e300] {
            assert_eq!(seek_position(Some(bad)), Err(()), "{bad}");
        }
    }

    #[test]
    fn the_player_is_asked_only_with_the_card_on_or_when_the_user_asks() {
        assert!(media_allowed(true, None));
        assert!(media_allowed(true, Some(false)));
        assert!(!media_allowed(false, None), "the card is off and nobody asked");
        assert!(!media_allowed(false, Some(false)));
        assert!(media_allowed(false, Some(true)), "/play typed in the assistant (C-19)");
    }

    fn track(title: &str) -> Option<Media> {
        Some(Media { title: title.into(), ..Media::default() })
    }

    fn title(media: Option<Media>) -> Option<String> {
        media.map(|m| m.title)
    }

    #[test]
    fn a_player_that_hangs_is_asked_once_at_a_time() {
        // The only test that reads through read_media: its state is shared.
        assert_eq!(title(read_media(false, |_| track("First"))), Some("First".into()));

        let (started, wait_started) = mpsc::channel();
        let (release, wait_release) = mpsc::channel::<()>();
        let slow = std::thread::spawn(move || {
            read_media(true, move |artwork| {
                assert!(artwork);
                started.send(()).unwrap();
                wait_release.recv().unwrap();
                track("Second")
            })
        });
        wait_started.recv().unwrap();
        // Meanwhile every other read answers at once with what was last known,
        // without asking the player.
        for _ in 0..20 {
            assert_eq!(title(read_media(false, |_| panic!("asked while busy"))), Some("First".into()));
        }
        release.send(()).unwrap();
        assert_eq!(title(slow.join().unwrap()), Some("Second".into()));
        // Done: the next read asks the player again.
        assert_eq!(title(read_media(false, |_| None)), None);
        assert_eq!(title(read_media(false, |_| track("Third"))), Some("Third".into()));
    }

    #[cfg(unix)]
    fn sh(script: &str) -> std::process::Command {
        let mut command = std::process::Command::new("sh");
        command.args(["-c", script]);
        command
    }

    #[cfg(unix)]
    #[test]
    fn a_helper_program_answers_in_full() {
        let out = output_within(sh("printf 'a\\nb'"), Duration::from_secs(10)).unwrap();
        assert!(out.status.success());
        assert_eq!(out.stdout, b"a\nb");
        let failed = output_within(sh("exit 3"), Duration::from_secs(10)).unwrap();
        assert_eq!(failed.status.code(), Some(3));
        // More than a pipe holds: read while it runs, so it never stalls.
        let big = output_within(sh("head -c 300000 /dev/zero"), Duration::from_secs(10)).unwrap();
        assert_eq!(big.stdout.len(), 300_000);
    }

    #[cfg(unix)]
    #[test]
    fn a_helper_program_that_hangs_is_stopped_and_reaped() {
        let pid_file = std::env::temp_dir().join(format!("nobi-hang-{}", std::process::id()));
        let _ = std::fs::remove_file(&pid_file);
        let started = Instant::now();
        let script = format!("echo $$ > '{}'; exec sleep 30", pid_file.display());
        assert!(output_within(sh(&script), Duration::from_millis(400)).is_none());
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
        let pid: i32 = std::fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
        let _ = std::fs::remove_file(&pid_file);
        // Gone, not even a zombie: signal 0 finds no such process.
        let alive = unsafe { libc::kill(pid, 0) } == 0;
        assert!(!alive, "process {pid} is still there");
    }
}
