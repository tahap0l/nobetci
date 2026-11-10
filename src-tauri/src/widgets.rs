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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    title: String,
    artist: String,
    source: String,
    playing: bool,
    artwork: Option<String>,
    can_previous: bool,
    can_toggle: bool,
    can_next: bool,
}

#[tauri::command]
pub async fn island_media(app: AppHandle, include_artwork: Option<bool>) -> Option<Media> {
    if !super::current(&app).island_media {
        return None;
    }
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || windows_media::read(include_artwork.unwrap_or(false)))
        .await
        .ok()
        .flatten();
    #[cfg(not(windows))]
    {
        let _ = include_artwork;
        None
    }
}

#[tauri::command]
pub async fn island_media_control(app: AppHandle, source: String, action: String) -> bool {
    if !super::current(&app).island_media {
        return false;
    }
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(move || windows_media::control(&source, &action))
        .await
        .unwrap_or(false);
    #[cfg(not(windows))]
    {
        let _ = (source, action);
        false
    }
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
        Some(Media {
            title,
            artist: properties.Artist().ok()?.to_string(),
            source: session.SourceAppUserModelId().ok()?.to_string(),
            playing: playback.PlaybackStatus().ok()? == PlaybackStatus::Playing,
            artwork: include_artwork.then(|| artwork(&properties)).flatten(),
            can_previous: controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()).unwrap_or(false),
            can_toggle: controls.as_ref().and_then(|c| c.IsPlayPauseToggleEnabled().ok()).unwrap_or(false),
            can_next: controls.as_ref().and_then(|c| c.IsNextEnabled().ok()).unwrap_or(false),
        })
    }

    pub fn control(source: &str, action: &str) -> bool {
        let Some(session) = current() else { return false };
        if session.SourceAppUserModelId().map_or(true, |id| id != source) {
            return false;
        }
        let operation = match action {
            "previous" => session.TrySkipPreviousAsync(),
            "toggle" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            _ => return false,
        };
        match operation {
            Ok(operation) => operation.get().unwrap_or(false),
            Err(_) => false,
        }
    }
}
