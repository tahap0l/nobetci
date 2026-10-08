// The small things every OS answers differently: local time, the display
// language, whether a full-screen app is in front, and where home is.
//
// Bigger platform pieces live with the code that uses them: the relay server in
// `pipe/`, the click guard in `inputguard/`, window handling in `island.rs` and
// `focus.rs`.

/// Local wall-clock time.
#[derive(Clone, Copy, Debug)]
pub struct LocalTime {
    pub year: u32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
}

impl LocalTime {
    /// "YYYY-MM-DD HH:MM:SS"
    pub fn stamp(&self) -> String {
        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }

    /// "YYYYMMDD-HHMMSS", for file names.
    pub fn compact(&self) -> String {
        format!("{:04}{:02}{:02}-{:02}{:02}{:02}", self.year, self.month, self.day, self.hour, self.minute, self.second)
    }
}

#[cfg(windows)]
pub fn local_time() -> LocalTime {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    LocalTime {
        year: t.wYear.into(),
        month: t.wMonth.into(),
        day: t.wDay.into(),
        hour: t.wHour.into(),
        minute: t.wMinute.into(),
        second: t.wSecond.into(),
    }
}

#[cfg(target_os = "macos")]
pub fn local_time() -> LocalTime {
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&now, &mut tm);
        LocalTime {
            year: (tm.tm_year + 1900) as u32,
            month: (tm.tm_mon + 1) as u32,
            day: tm.tm_mday as u32,
            hour: tm.tm_hour as u32,
            minute: tm.tm_min as u32,
            second: tm.tm_sec as u32,
        }
    }
}

/// Whether the OS shows its interface in Turkish.
#[cfg(windows)]
pub fn system_is_turkish() -> bool {
    // LANG_TURKISH is 0x1F; the low 10 bits of a LANGID are the primary language.
    const LANG_TURKISH: u16 = 0x1F;
    unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() & 0x3FF == LANG_TURKISH }
}

/// Whether Turkish is the first of the user's preferred languages
/// (System Settings → General → Language & Region).
#[cfg(target_os = "macos")]
pub fn system_is_turkish() -> bool {
    let languages = objc2_foundation::NSLocale::preferredLanguages();
    languages.firstObject().is_some_and(|first| {
        let tag = first.to_string().to_ascii_lowercase();
        tag == "tr" || tag.starts_with("tr-") || tag.starts_with("tr_")
    })
}

/// A full-screen app, game or presentation is in front.
#[cfg(windows)]
pub fn fullscreen() -> bool {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    unsafe {
        SHQueryUserNotificationState()
            .map(|s| s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE)
            .unwrap_or(false)
    }
}

/// macOS has no public "a full-screen app is in front" query; until there is a
/// reliable one, full-screen quiet does nothing here and Settings says so.
#[cfg(target_os = "macos")]
pub fn fullscreen() -> bool {
    false
}

/// Whether `fullscreen()` can tell anything on this OS.
pub const FULLSCREEN_SUPPORTED: bool = cfg!(windows);

/// The user's home folder, as Claude Code sees it.
pub fn home() -> std::path::PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// "windows" or "macos" — what the front end adapts its wording to.
pub const PLATFORM: &str = if cfg!(target_os = "macos") { "macos" } else { "windows" };

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_are_zero_padded() {
        let t = LocalTime { year: 2026, month: 3, day: 7, hour: 9, minute: 5, second: 1 };
        assert_eq!(t.stamp(), "2026-03-07 09:05:01");
        assert_eq!(t.compact(), "20260307-090501");
    }

    #[test]
    fn the_clock_reads_something_sane() {
        let t = local_time();
        assert!(t.year >= 2024 && (1..=12).contains(&t.month) && (1..=31).contains(&t.day));
        assert!(t.hour < 24 && t.minute < 60 && t.second < 61);
    }
}
