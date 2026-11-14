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

#[cfg(unix)]
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

/// Whether the user's languages (LANGUAGE, LC_ALL, LC_MESSAGES or LANG, the
/// first one set) put Turkish first.
#[cfg(target_os = "linux")]
pub fn system_is_turkish() -> bool {
    ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .find_map(|var| std::env::var(var).ok().filter(|v| !v.is_empty()))
        .is_some_and(|tag| is_turkish_tag(&tag))
}

/// "tr", "tr_TR.UTF-8", "tr-TR" or, in LANGUAGE, "tr:en".
#[cfg(any(target_os = "linux", test))]
fn is_turkish_tag(tag: &str) -> bool {
    let first = tag.split(':').next().unwrap_or("").to_ascii_lowercase();
    first == "tr" || first.starts_with("tr_") || first.starts_with("tr-") || first.starts_with("tr.")
}

/// The window in front is full screen (X11 / XWayland).
#[cfg(target_os = "linux")]
pub fn fullscreen() -> bool {
    crate::x11::fullscreen()
}

/// A window covering a whole display is in front (see mac_fullscreen.rs).
#[cfg(target_os = "macos")]
pub use crate::mac_fullscreen::fullscreen;

/// Whether `fullscreen()` can tell anything on this OS.
pub const FULLSCREEN_SUPPORTED: bool = true;

/// The user's home folder, as Claude Code sees it.
pub fn home() -> std::path::PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// "windows", "macos" or "linux" — what the front end adapts its wording to.
pub const PLATFORM: &str = if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(target_os = "linux") {
    "linux"
} else {
    "windows"
};

/// Opens a web page in the default browser. Anything but http(s) is refused.
pub fn open_url(url: &str) -> bool {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return false;
    }
    #[cfg(windows)]
    return std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]).spawn().is_ok();
    #[cfg(target_os = "macos")]
    return std::process::Command::new("/usr/bin/open").arg(url).spawn().is_ok();
    #[cfg(target_os = "linux")]
    return std::process::Command::new("xdg-open").arg(url).spawn().is_ok();
}

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
    fn turkish_locales_are_recognised() {
        for tag in ["tr", "tr_TR.UTF-8", "tr-TR", "TR_tr", "tr:en_US"] {
            assert!(is_turkish_tag(tag), "{tag}");
        }
        for tag in ["en_US.UTF-8", "C", "trk", "de_DE", "en:tr"] {
            assert!(!is_turkish_tag(tag), "{tag}");
        }
    }

    #[test]
    fn the_clock_reads_something_sane() {
        let t = local_time();
        assert!(t.year >= 2024 && (1..=12).contains(&t.month) && (1..=31).contains(&t.day));
        assert!(t.hour < 24 && t.minute < 60 && t.second < 61);
    }
}
