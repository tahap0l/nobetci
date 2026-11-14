use serde::{Deserialize, Serialize};
use tauri::AppHandle;

pub fn city(id: &str) -> Option<(f64, f64)> {
    match id {
        "istanbul" => Some((41.01, 28.97)),
        "ankara" => Some((39.93, 32.86)),
        "izmir" => Some((38.42, 27.14)),
        "bursa" => Some((40.19, 29.06)),
        "antalya" => Some((36.90, 30.71)),
        _ => None,
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    #[serde(rename(deserialize = "temperature_2m"))]
    pub temperature: f64,
    #[serde(rename(deserialize = "weather_code"))]
    pub code: u8,
}

#[derive(Deserialize)]
struct Forecast {
    current: Weather,
}

#[tauri::command]
pub async fn island_weather(app: AppHandle, city_id: String) -> Option<Weather> {
    if super::current(&app).island_weather_city != city_id {
        return None;
    }
    let (latitude, longitude) = city(&city_id)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let response = client
        .get(format!(
            "https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m,weather_code"
        ))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    Some(response.json::<Forecast>().await.ok()?.current)
}

/// What is playing, as the island's media card shows it. Every OS has its own
/// source: the system media controls on Windows, Spotify and Music on macOS,
/// and any MPRIS player (Spotify, VLC, browsers…) on Linux.
#[derive(Serialize, Default, Debug)]
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

#[cfg(target_os = "linux")]
mod linux_media;
#[cfg(target_os = "linux")]
use linux_media as platform_media;
#[cfg(target_os = "macos")]
mod mac_media;
#[cfg(target_os = "macos")]
use mac_media as platform_media;
#[cfg(windows)]
use windows_media as platform_media;

#[tauri::command]
pub async fn island_media(app: AppHandle, include_artwork: Option<bool>) -> Option<Media> {
    if !super::current(&app).island_media {
        return None;
    }
    tauri::async_runtime::spawn_blocking(move || platform_media::read(include_artwork.unwrap_or(false)))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn island_media_control(app: AppHandle, source: String, action: String, position_ms: Option<u64>) -> bool {
    if !super::current(&app).island_media {
        return false;
    }
    if !matches!(action.as_str(), "previous" | "toggle" | "next" | "seek") {
        return false;
    }
    tauri::async_runtime::spawn_blocking(move || platform_media::control(&source, &action, position_ms))
        .await
        .unwrap_or(false)
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
