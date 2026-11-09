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
}

#[tauri::command]
pub async fn island_media(app: AppHandle) -> Option<Media> {
    if !super::current(&app).island_media {
        return None;
    }
    #[cfg(windows)]
    return windows_media::read().await;
    #[cfg(not(windows))]
    None
}

#[tauri::command]
pub async fn island_media_control(app: AppHandle, source: String, action: String) -> bool {
    if !super::current(&app).island_media {
        return false;
    }
    #[cfg(windows)]
    return windows_media::control(&source, &action).await;
    #[cfg(not(windows))]
    {
        let _ = (source, action);
        false
    }
}

#[cfg(windows)]
mod windows_media {
    use super::Media;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
    };

    async fn current() -> Option<Session> {
        Manager::RequestAsync().ok()?.await.ok()?.GetCurrentSession().ok()
    }

    pub async fn read() -> Option<Media> {
        let session = current().await?;
        let properties = session.TryGetMediaPropertiesAsync().ok()?.await.ok()?;
        let title = properties.Title().ok()?.to_string();
        if title.trim().is_empty() {
            return None;
        }
        Some(Media {
            title,
            artist: properties.Artist().ok()?.to_string(),
            source: session.SourceAppUserModelId().ok()?.to_string(),
            playing: session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()? == PlaybackStatus::Playing,
        })
    }

    pub async fn control(source: &str, action: &str) -> bool {
        let Some(session) = current().await else { return false };
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
            Ok(operation) => operation.await.unwrap_or(false),
            Err(_) => false,
        }
    }
}
