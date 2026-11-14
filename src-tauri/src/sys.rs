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

/// The name of the app that opens `scheme:` links, if one is installed.
/// `scheme` must be a plain URL scheme (letters, digits, `+`, `-`, `.`).
pub fn scheme_handler(scheme: &str) -> Option<String> {
    if scheme.is_empty() || !scheme.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.')) {
        return None;
    }
    scheme_handler_os(scheme).filter(|name| !name.trim().is_empty())
}

#[cfg(windows)]
fn scheme_handler_os(scheme: &str) -> Option<String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Shell::{AssocQueryStringW, ASSOCF_IS_PROTOCOL, ASSOCSTR_FRIENDLYAPPNAME};
    let wide: Vec<u16> = scheme.encode_utf16().chain(Some(0)).collect();
    let mut buf = [0u16; 260];
    let mut len = buf.len() as u32;
    // ASSOCF_IS_PROTOCOL also finds protocols registered by packaged (Store) apps.
    let hr = unsafe {
        AssocQueryStringW(
            ASSOCF_IS_PROTOCOL,
            ASSOCSTR_FRIENDLYAPPNAME,
            PCWSTR(wide.as_ptr()),
            PCWSTR::null(),
            Some(PWSTR(buf.as_mut_ptr())),
            &mut len,
        )
    };
    if hr.is_err() {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

#[cfg(target_os = "macos")]
fn scheme_handler_os(scheme: &str) -> Option<String> {
    use std::ffi::c_void;
    type CFTypeRef = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFURLCreateWithBytes(a: CFTypeRef, bytes: *const u8, len: isize, enc: u32, base: CFTypeRef) -> CFTypeRef;
        fn CFURLGetFileSystemRepresentation(url: CFTypeRef, abs: u8, buf: *mut u8, len: isize) -> u8;
        fn CFRelease(p: CFTypeRef);
    }
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultApplicationURLForURL(url: CFTypeRef, roles: u32, err: *mut CFTypeRef) -> CFTypeRef;
    }
    const UTF8: u32 = 0x0800_0100;
    const ALL_ROLES: u32 = 0xFFFF_FFFF;
    let link = format!("{scheme}://");
    // SAFETY: every object created here is released before returning.
    unsafe {
        let url = CFURLCreateWithBytes(std::ptr::null(), link.as_ptr(), link.len() as isize, UTF8, std::ptr::null());
        if url.is_null() {
            return None;
        }
        let app = LSCopyDefaultApplicationURLForURL(url, ALL_ROLES, std::ptr::null_mut());
        CFRelease(url);
        if app.is_null() {
            return None;
        }
        let mut buf = [0u8; 1024];
        let ok = CFURLGetFileSystemRepresentation(app, 1, buf.as_mut_ptr(), buf.len() as isize);
        CFRelease(app);
        if ok == 0 {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        let path = String::from_utf8_lossy(&buf[..end]).into_owned();
        // "/Applications/ChatGPT.app" → "ChatGPT"
        let name = path.trim_end_matches('/').rsplit('/').next()?.trim_end_matches(".app").to_string();
        Some(name)
    }
}

#[cfg(target_os = "linux")]
fn scheme_handler_os(scheme: &str) -> Option<String> {
    let out = std::process::Command::new("xdg-mime")
        .args(["query", "default", &format!("x-scheme-handler/{scheme}")])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().trim_end_matches(".desktop").to_string();
    out.status.success().then_some(name)
}

/// Opens an app link (`claude://…`, `ms-copilot:`) with the app that handles it.
/// Only for the fixed links in `assistant.rs`; web addresses go through `open_url`.
pub fn open_app_link(url: &str) -> bool {
    let Some((scheme, _)) = url.split_once(':') else { return false };
    if matches!(scheme, "http" | "https" | "file" | "javascript" | "data") || scheme_handler(scheme).is_none() {
        return false;
    }
    #[cfg(windows)]
    {
        use windows::core::{w, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        let r = unsafe {
            ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
        };
        // ShellExecute reports success with a value above 32.
        r.0 as isize > 32
    }
    #[cfg(target_os = "macos")]
    return std::process::Command::new("/usr/bin/open").arg(url).spawn().is_ok();
    #[cfg(target_os = "linux")]
    return std::process::Command::new("xdg-open").arg(url).spawn().is_ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn odd_schemes_are_never_looked_up() {
        assert_eq!(scheme_handler(""), None);
        assert_eq!(scheme_handler("a b"), None);
        assert_eq!(scheme_handler("x;rm -rf"), None);
        assert!(!open_app_link("https://example.com"));
        assert!(!open_app_link("javascript:alert(1)"));
    }

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
