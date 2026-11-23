// The small things every OS answers differently: local time, the display
// language, whether a full-screen app is in front, where home is, how programs
// are started, and how a notification's text is read.
//
// Bigger platform pieces live with the code that uses them: the relay server in
// `pipe/`, the click guard in `inputguard/`, window handling in `island.rs` and
// `focus.rs`.

use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::atomic::{AtomicBool, Ordering};

/// Linux: Nöbetçi set GDK_BACKEND=x11 for itself (`use_x11`).
#[cfg(target_os = "linux")]
static X11_FORCED: AtomicBool = AtomicBool::new(false);

/// Linux: runs Nöbetçi on X11 (XWayland under Wayland). A Wayland window can
/// neither place itself at the top of the screen nor stay above the others,
/// and the click guard and "go to window" speak X11. Somebody who set
/// GDK_BACKEND knows why, so their choice stands. Must run before GTK starts.
#[cfg(target_os = "linux")]
pub fn use_x11() {
    if std::env::var_os("GDK_BACKEND").is_none() && std::env::var_os("DISPLAY").is_some() {
        std::env::set_var("GDK_BACKEND", "x11");
        X11_FORCED.store(true, Ordering::Relaxed);
    }
}

/// A program Nöbetçi starts (a browser through xdg-open, VS Code, the relay).
/// On Linux it does not inherit the X11 backend Nöbetçi chose for itself: a
/// browser opened from a link runs natively on Wayland, as if started from the
/// desktop. Nöbetçi's own web views keep it. Nor, when Nöbetçi runs from an
/// AppImage, what the AppImage set up for its own GTK and GStreamer
/// (`appimage_leftovers`): that program draws with the user's theme and loads
/// the system's modules, not the ones inside an image that disappears when
/// Nöbetçi quits.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[cfg_attr(not(target_os = "linux"), allow(unused_mut))]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "linux")]
    {
        if X11_FORCED.load(Ordering::Relaxed) {
            cmd.env_remove("GDK_BACKEND");
        }
        for (name, value) in appimage_leftovers(|name| std::env::var_os(name)) {
            match value {
                Some(value) => cmd.env(name, value),
                None => cmd.env_remove(name),
            };
        }
    }
    cmd
}

/// What an AppImage's start-up hooks put in Nöbetçi's environment for its own
/// GTK (linuxdeploy-plugin-gtk) and GStreamer (linuxdeploy-plugin-gstreamer,
/// D19), plus the AppImage runtime's own markers: none of it belongs to a
/// program Nöbetçi starts.
#[cfg(any(target_os = "linux", test))]
const APPIMAGE_VARS: &[&str] = &[
    "APPIMAGE",
    "APPDIR",
    "ARGV0",
    "OWD",
    "GTK_DATA_PREFIX",
    "GTK_THEME",
    "GTK_EXE_PREFIX",
    "GTK_PATH",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_MODULE_DIR",
    "GSETTINGS_SCHEMA_DIR",
    "GI_TYPELIB_PATH",
    "GST_REGISTRY_REUSE_PLUGIN_SCANNER",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GST_PLUGIN_PATH_1_0",
    "GST_PLUGIN_SCANNER_1_0",
    "GST_PTP_HELPER_1_0",
    "GST_PLUGIN_SYSTEM_PATH_0_10",
    "GST_PLUGIN_SCANNER_0_10",
    "GST_PTP_HELPER_0_10",
];

/// The environment changes that undo an AppImage's set-up for a program
/// Nöbetçi starts: each variable to remove (None) or to set back. Nothing when
/// Nöbetçi does not run from an AppImage (`APPDIR` unset), so a user's own
/// GTK_THEME and the like stay. XDG_DATA_DIRS gets back what it was before the
/// GTK hook put the image's folders in front of it, or goes when it had no
/// value. `env` reads Nöbetçi's own environment.
#[cfg(any(target_os = "linux", test))]
fn appimage_leftovers(
    env: impl Fn(&str) -> Option<std::ffi::OsString>,
) -> Vec<(&'static str, Option<std::ffi::OsString>)> {
    let Some(appdir) = env("APPDIR").filter(|dir| !dir.is_empty()) else { return Vec::new() };
    // The runtime sets APPIMAGE; an image run unpacked has only the hook's
    // mark. An APPDIR of somebody else's changes nothing.
    if env("APPIMAGE").is_none() && env("GTK_DATA_PREFIX").as_ref() != Some(&appdir) {
        return Vec::new();
    }
    let appdir = appdir.to_string_lossy().trim_end_matches('/').to_string();
    let mut changes: Vec<(&'static str, Option<std::ffi::OsString>)> =
        APPIMAGE_VARS.iter().filter(|name| env(name).is_some()).map(|name| (*name, None)).collect();
    if let Some(dirs) = env("XDG_DATA_DIRS") {
        let dirs = dirs.to_string_lossy().into_owned();
        // The hook sets "$APPDIR/usr/share:/usr/share:$XDG_DATA_DIRS"; any other
        // entry inside the image goes too.
        let hooked = format!("{appdir}/usr/share:/usr/share:");
        let before = dirs.strip_prefix(&hooked).unwrap_or(&dirs);
        let kept: Vec<&str> = before
            .split(':')
            .filter(|d| !d.is_empty() && *d != appdir && !d.starts_with(&format!("{appdir}/")))
            .collect();
        if kept.join(":") != dirs {
            changes.push(("XDG_DATA_DIRS", (!kept.is_empty()).then(|| kept.join(":").into())));
        }
    }
    changes
}

/// Text for a notification body that is shown as written. Notification
/// servers that read the body as markup (the freedesktop `body-markup`
/// capability) would otherwise turn `<a href=…>` in a command Claude asked for
/// into a link and drop other tags, so the toast would differ from the card.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn escape_markup(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Linux: whether the desktop's notification server reads the body as markup
/// (`body-markup`: GNOME Shell, Plasma, dunst, mako…). Asked once. When it
/// cannot be asked, the body is treated as markup: an escaped `&amp;` shown
/// literally is better than a link the card never showed.
#[cfg(target_os = "linux")]
pub fn notifications_read_markup() -> bool {
    use std::sync::OnceLock;
    static ANSWER: OnceLock<bool> = OnceLock::new();
    *ANSWER.get_or_init(|| {
        let Ok(bus) = dbus::blocking::Connection::new_session() else { return true };
        let server = bus.with_proxy(
            "org.freedesktop.Notifications",
            "/org/freedesktop/Notifications",
            std::time::Duration::from_millis(800),
        );
        let caps: Result<(Vec<String>,), dbus::Error> =
            server.method_call("org.freedesktop.Notifications", "GetCapabilities", ());
        caps.map(|(caps,)| caps.iter().any(|c| c == "body-markup")).unwrap_or(true)
    })
}

/// Linux: whether a login entry (an XDG autostart `.desktop` file) is
/// switched off by the desktop. Xfce, LXQt and KDE write `Hidden=true`,
/// Cinnamon `X-GNOME-Autostart-enabled=false`, MATE its own key of that kind;
/// none of them deletes the file.
#[cfg(any(target_os = "linux", test))]
pub fn login_entry_switched_off(text: &str) -> bool {
    entry_lines(text).any(|(key, value)| {
        let key = key.to_ascii_lowercase();
        (key == "hidden" && value.eq_ignore_ascii_case("true"))
            || (key.starts_with("x-") && key.ends_with("-autostart-enabled") && value.eq_ignore_ascii_case("false"))
    })
}

/// Linux: a login entry that starts `program`: None when its `Exec=` already
/// does, however it is quoted; otherwise the entry with only the program in
/// that line replaced (see `exec_starting`). Every other line — the
/// desktop's own keys, a delay, comments — stays. `exists` says whether a
/// path is there.
#[cfg(any(target_os = "linux", test))]
pub fn login_entry_for(text: &str, program: &str, exists: impl Fn(&str) -> bool) -> Option<String> {
    // As the autostart plugin writes it: `Exec=<program> <no arguments>`.
    let written = format!("Exec={} ", exec_arg(program));
    let mut group = "";
    let mut seen = false;
    let mut changed = false;
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if group == "[Desktop Entry]" && !seen {
                out.push(written.clone());
                (seen, changed) = (true, true);
            }
            group = trimmed;
        } else if group == "[Desktop Entry]" && !seen && !trimmed.starts_with('#') {
            if let Some((key, value)) = line.split_once('=').filter(|(key, _)| key.trim() == "Exec") {
                seen = true;
                if let Some(value) = exec_starting(value, program, &exists) {
                    out.push(format!("{key}={value}"));
                    changed = true;
                    continue;
                }
            }
        }
        out.push(line.to_string());
    }
    if !seen {
        if group != "[Desktop Entry]" {
            out.push("[Desktop Entry]".into());
        }
        out.push(written);
        changed = true;
    }
    if !changed {
        return None;
    }
    let mut updated = out.join("\n");
    if text.ends_with('\n') {
        updated.push('\n');
    }
    Some(updated)
}

/// An `Exec=` value that starts `program`, made from `value` as written:
/// None when it already does, or when it starts some other program that is
/// still there (a wrapper script of the user's, `sh -c "sleep 10; …"`).
/// Otherwise only the program is replaced — quoted if it must be — and what
/// stands around it stays as written: `env GDK_SCALE=2` before it, its
/// arguments after it.
#[cfg(any(target_os = "linux", test))]
fn exec_starting(value: &str, program: &str, exists: &dyn Fn(&str) -> bool) -> Option<String> {
    let args = exec_args(value);
    let Some(arg) = program_arg(&args) else {
        return Some(format!("{} {} ", value.trim(), exec_arg(program)).trim_start().to_string());
    };
    if arg.value == program {
        return None;
    }
    // The autostart plugin writes the path as it is, unquoted, so a path
    // with a space in it reads as several arguments: take them together, up
    // to the end of this program's path or of an AppImage's.
    let raw = &value[arg.start..];
    let (old, end) = match unquoted_path_len(raw, program) {
        Some(len) if !raw.starts_with(['"', '\'']) && arg.start + len > arg.end => (&raw[..len], arg.start + len),
        _ => (arg.value.as_str(), arg.end),
    };
    let file = old.rsplit('/').next().unwrap_or(old).to_lowercase();
    let ours = old == program || file.ends_with(".appimage") || file.starts_with("nobetci");
    // A bare command name (`sh`, `flatpak`) is looked up in PATH: there.
    if !ours && (!old.starts_with('/') || exists(old)) {
        return None;
    }
    Some(format!("{}{}{}", &value[..arg.start], exec_arg(program), &value[end..]))
}

/// The program among an `Exec=` value's arguments: after `env`, its options
/// (with the name or folder `-u` and `-C` take) and the variables it sets.
#[cfg(any(target_os = "linux", test))]
fn program_arg(args: &[ExecArg]) -> Option<&ExecArg> {
    let env = args.first().is_some_and(|a| a.value == "env");
    let mut rest = args.iter().skip(usize::from(env));
    while let Some(arg) = rest.next() {
        let v = arg.value.as_str();
        if env && matches!(v, "-u" | "--unset" | "-C" | "--chdir") {
            rest.next();
        } else if !(env && v.starts_with('-')) && !is_assignment(v) {
            return Some(arg);
        }
    }
    None
}

/// How long the path at the start of `raw` is, read as the plugin writes
/// it (unquoted, spaces and all): `program` itself, or the first stretch
/// that ends in `.AppImage` or in `program`'s own file name.
#[cfg(any(target_os = "linux", test))]
fn unquoted_path_len(raw: &str, program: &str) -> Option<usize> {
    let ends_here = |len: usize| raw[len..].chars().next().is_none_or(char::is_whitespace);
    if raw.starts_with(program) && ends_here(program.len()) {
        return Some(program.len());
    }
    let name = format!("/{}", program.rsplit('/').next().unwrap_or(program));
    raw.char_indices().map(|(at, c)| at + c.len_utf8()).find(|&len| {
        let head = &raw[..len];
        ends_here(len) && (head.to_lowercase().ends_with(".appimage") || head.ends_with(&name))
    })
}

/// `NAME=value`, as `env` takes it.
#[cfg(any(target_os = "linux", test))]
fn is_assignment(arg: &str) -> bool {
    arg.split_once('=').is_some_and(|(name, _)| {
        name.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

/// One argument of an `Exec=` value: what it says, and where it stands in
/// the value as written.
#[cfg(any(target_os = "linux", test))]
struct ExecArg {
    value: String,
    start: usize,
    end: usize,
}

/// The arguments of an `Exec=` value as the desktop reads it: the key file's
/// escapes (`\s`, `\\`…) first, then the Exec quoting — whitespace outside
/// quotes splits arguments; inside double quotes `\"`, `` \` ``, `\$` and
/// `\\` stand for the character.
#[cfg(any(target_os = "linux", test))]
fn exec_args(value: &str) -> Vec<ExecArg> {
    // The key file's escapes, each character with where it was written.
    let mut chars: Vec<(char, usize, usize)> = Vec::new();
    let mut it = value.char_indices().peekable();
    while let Some((start, c)) = it.next() {
        let escaped = match (c, it.peek().map(|&(_, next)| next)) {
            ('\\', Some(next @ ('s' | 'n' | 't' | 'r' | '\\'))) => {
                it.next();
                Some(match next {
                    's' => ' ',
                    'n' => '\n',
                    't' => '\t',
                    'r' => '\r',
                    _ => '\\',
                })
            }
            _ => None,
        };
        let end = it.peek().map_or(value.len(), |&(at, _)| at);
        chars.push((escaped.unwrap_or(c), start, end));
    }
    // The Exec quoting, read the way GLib and KDE split it (as a shell
    // would): single quotes keep everything; outside quotes a backslash
    // keeps the next character.
    let mut args: Vec<ExecArg> = Vec::new();
    let mut current: Option<ExecArg> = None;
    let mut quote: Option<char> = None;
    let mut i = 0;
    while let Some(&(c, start, end)) = chars.get(i) {
        i += 1;
        if quote.is_none() && c.is_whitespace() {
            args.extend(current.take());
            continue;
        }
        let arg = current.get_or_insert(ExecArg { value: String::new(), start, end });
        arg.end = end;
        match (quote, c, chars.get(i).copied()) {
            (None, '"' | '\'', _) => quote = Some(c),
            (Some(q), _, _) if c == q => quote = None,
            (None, '\\', Some((kept, _, kept_end)))
            | (Some('"'), '\\', Some((kept @ ('"' | '`' | '$' | '\\'), _, kept_end))) => {
                arg.value.push(kept);
                arg.end = kept_end;
                i += 1;
            }
            _ => arg.value.push(c),
        }
    }
    args.extend(current);
    args
}

/// `program` as an `Exec=` argument: as it is, or in double quotes when it
/// holds a character the desktop would read otherwise — with the Exec escapes
/// and then the key file's own (a `"` is written `\\"`, a `\` `\\\\`).
#[cfg(any(target_os = "linux", test))]
fn exec_arg(program: &str) -> String {
    const RESERVED: &[char] =
        &[' ', '\t', '\n', '"', '\'', '\\', '>', '<', '~', '|', '&', ';', '$', '*', '?', '#', '(', ')', '`'];
    if !program.contains(RESERVED) {
        return program.to_string();
    }
    let mut out = String::from("\"");
    for c in program.chars() {
        match c {
            '"' | '`' | '$' => {
                out.push_str(r"\\");
                out.push(c);
            }
            '\\' => out.push_str(r"\\\\"),
            '\n' => out.push_str(r"\n"),
            '\t' => out.push_str(r"\t"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The `key=value` lines of a `.desktop` file's [Desktop Entry] group.
#[cfg(any(target_os = "linux", test))]
fn entry_lines(text: &str) -> impl Iterator<Item = (&str, &str)> {
    let mut group = "";
    text.lines().filter_map(move |line| {
        let line = line.trim();
        if line.starts_with('[') {
            group = line;
            return None;
        }
        if group != "[Desktop Entry]" || line.starts_with('#') {
            return None;
        }
        line.split_once('=').map(|(key, value)| (key.trim(), value.trim()))
    })
}

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

/// How far local time was from UTC at `ts_ms` (milliseconds since the epoch),
/// in minutes east of UTC, by this computer's time zone rules: summer time
/// where it was in force at that moment. None when the system cannot say.
#[cfg(unix)]
pub fn utc_offset_min_at(ts_ms: u64) -> Option<i32> {
    let secs = libc::time_t::try_from(ts_ms / 1000).ok()?;
    // SAFETY: localtime_r only writes into `tm`, which outlives the call.
    unsafe {
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&secs, &mut tm).is_null() {
            return None;
        }
        i32::try_from(tm.tm_gmtoff / 60).ok()
    }
}

#[cfg(windows)]
pub fn utc_offset_min_at(ts_ms: u64) -> Option<i32> {
    use windows::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows::Win32::System::Time::{
        FileTimeToSystemTime, GetDynamicTimeZoneInformation, SystemTimeToFileTime, SystemTimeToTzSpecificLocalTimeEx,
        DYNAMIC_TIME_ZONE_INFORMATION, TIME_ZONE_ID_INVALID,
    };
    // A FILETIME counts 100 ns from 1601-01-01 UTC.
    let ticks = i64::try_from(ts_ms / 1000).ok()?.checked_add(11_644_473_600)?.checked_mul(10_000_000)?;
    let utc_ft = FILETIME { dwLowDateTime: ticks as u32, dwHighDateTime: (ticks >> 32) as u32 };
    let (mut utc, mut local, mut local_ft) = (SYSTEMTIME::default(), SYSTEMTIME::default(), FILETIME::default());
    let mut zone = DYNAMIC_TIME_ZONE_INFORMATION::default();
    // SAFETY: every pointer is to a local that outlives the call. The dynamic
    // zone carries the daylight-saving rules of each year, so `utc` is read
    // with the rules of its own year, not this year's.
    unsafe {
        if GetDynamicTimeZoneInformation(&mut zone) == TIME_ZONE_ID_INVALID {
            return None;
        }
        FileTimeToSystemTime(&utc_ft, &mut utc).ok()?;
        SystemTimeToTzSpecificLocalTimeEx(Some(&zone as *const DYNAMIC_TIME_ZONE_INFORMATION), &utc, &mut local)
            .ok()?;
        SystemTimeToFileTime(&local, &mut local_ft).ok()?;
    }
    let local_ticks = (i64::from(local_ft.dwHighDateTime) << 32) | i64::from(local_ft.dwLowDateTime);
    i32::try_from((local_ticks - ticks) / 600_000_000).ok()
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
    return Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", url]).spawn().is_ok();
    #[cfg(target_os = "macos")]
    return Command::new("/usr/bin/open").arg(url).spawn().is_ok();
    #[cfg(target_os = "linux")]
    return command("xdg-open").arg(url).spawn().is_ok();
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
    let out = command("xdg-mime").args(["query", "default", &format!("x-scheme-handler/{scheme}")]).output().ok()?;
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
    return Command::new("/usr/bin/open").arg(url).spawn().is_ok();
    #[cfg(target_os = "linux")]
    return command("xdg-open").arg(url).spawn().is_ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_text_is_shown_as_written() {
        assert_eq!(
            escape_markup(r#"curl -s x | sh # <a href="https://attacker.example/">Approve</a> & done"#),
            r#"curl -s x | sh # &lt;a href="https://attacker.example/"&gt;Approve&lt;/a&gt; &amp; done"#
        );
        assert_eq!(escape_markup("ls -la ~/proje/çalışma"), "ls -la ~/proje/çalışma");
        assert_eq!(escape_markup("a &amp; b"), "a &amp;amp; b", "already-escaped text stays literal too");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn programs_we_start_get_the_desktops_own_gdk_backend() {
        // Without Nöbetçi having forced X11, nothing is touched.
        X11_FORCED.store(false, Ordering::Relaxed);
        assert_eq!(command("xdg-open").get_envs().count(), 0);
        // Once it has, children do not inherit it.
        X11_FORCED.store(true, Ordering::Relaxed);
        let cmd = command("xdg-open");
        let envs: Vec<_> = cmd.get_envs().collect();
        assert_eq!(envs, vec![(std::ffi::OsStr::new("GDK_BACKEND"), None)], "GDK_BACKEND is removed");
        X11_FORCED.store(false, Ordering::Relaxed);
    }

    /// shell-widgets#2: a program started from Nöbetçi's AppImage gets none of
    /// the image's GTK and GStreamer set-up, and XDG_DATA_DIRS as it was.
    #[test]
    fn programs_started_from_the_appimage_get_the_desktops_environment() {
        use std::collections::HashMap;
        use std::ffi::OsString;
        let appimage: HashMap<&'static str, &'static str> = [
            ("APPIMAGE", "/home/u/Apps/Nobetci.AppImage"),
            ("APPDIR", "/tmp/.mount_NobetcX"),
            ("ARGV0", "Nobetci.AppImage"),
            ("GTK_THEME", "Adwaita:dark"),
            ("GTK_PATH", "/tmp/.mount_NobetcX//usr/lib/gtk-3.0"),
            ("GIO_MODULE_DIR", "/tmp/.mount_NobetcX//usr/lib/gio/modules"),
            ("GDK_PIXBUF_MODULE_FILE", "/tmp/.mount_NobetcX//usr/lib/gdk-pixbuf-2.0/2.10.0/loaders.cache"),
            ("GST_PLUGIN_SYSTEM_PATH_1_0", "/tmp/.mount_NobetcX/usr/lib/gstreamer-1.0"),
            ("GST_PLUGIN_SCANNER_1_0", "/tmp/.mount_NobetcX/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"),
            ("XDG_DATA_DIRS", "/tmp/.mount_NobetcX/usr/share:/usr/share:/usr/local/share:/usr/share"),
            ("HOME", "/home/u"),
        ]
        .into();
        fn env<'a>(vars: &'a HashMap<&'static str, &'static str>) -> impl Fn(&str) -> Option<OsString> + 'a {
            move |name| vars.get(name).map(OsString::from)
        }
        let changes = appimage_leftovers(env(&appimage));
        let removed: Vec<&str> = changes.iter().filter(|(_, v)| v.is_none()).map(|(n, _)| *n).collect();
        for name in ["APPIMAGE", "APPDIR", "ARGV0", "GTK_THEME", "GTK_PATH", "GIO_MODULE_DIR", "GST_PLUGIN_SCANNER_1_0"]
        {
            assert!(removed.contains(&name), "{name}: {changes:?}");
        }
        assert!(!removed.contains(&"HOME"));
        assert!(
            changes.contains(&("XDG_DATA_DIRS", Some(OsString::from("/usr/local/share:/usr/share")))),
            "back to what it was: {changes:?}"
        );
        // The hook had nothing to put in front of: the variable goes.
        let mut fresh = appimage.clone();
        fresh.insert("XDG_DATA_DIRS", "/tmp/.mount_NobetcX/usr/share:/usr/share:");
        assert!(appimage_leftovers(env(&fresh)).contains(&("XDG_DATA_DIRS", None)));
        // An image run unpacked has no APPIMAGE, only the hook's mark.
        let mut unpacked = appimage.clone();
        unpacked.remove("APPIMAGE");
        unpacked.insert("GTK_DATA_PREFIX", "/tmp/.mount_NobetcX");
        assert!(appimage_leftovers(env(&unpacked)).iter().any(|(n, _)| *n == "GTK_THEME"));
        // Not from an AppImage: a user's own GTK_THEME stays.
        let desktop: HashMap<&'static str, &'static str> =
            [("GTK_THEME", "Yaru:dark"), ("XDG_DATA_DIRS", "/usr/share")].into();
        assert!(appimage_leftovers(env(&desktop)).is_empty());
        let mut stray = desktop.clone();
        stray.insert("APPDIR", "/opt/something");
        assert!(appimage_leftovers(env(&stray)).is_empty(), "an APPDIR of somebody else's");
    }

    /// hooks-settings#2: a login entry the desktop switched off counts as
    /// removed, and a refresh changes its Exec= line and nothing else.
    #[test]
    fn a_login_entry_switched_off_by_the_desktop_is_recognised_and_kept() {
        let written = "[Desktop Entry]\nType=Application\nVersion=1.0\nName=Nobetci\nComment=Nobetci startup script\nExec=/home/u/Apps/Nobetci.AppImage \nStartupNotify=false\nTerminal=false";
        assert!(!login_entry_switched_off(written));
        for off in [
            format!("{written}\nHidden=true"),
            format!("{written}\nX-GNOME-Autostart-enabled=false"),
            format!("{written}\nX-MATE-Autostart-enabled=False"),
            format!("{written}\nhidden = TRUE"),
        ] {
            assert!(login_entry_switched_off(&off), "{off}");
        }
        assert!(!login_entry_switched_off(&format!("{written}\nX-GNOME-Autostart-enabled=true")));
        assert!(!login_entry_switched_off("[Other Group]\nHidden=true\n"), "only the entry's own group counts");
        let gone = |_: &str| false;
        // Already this program: left alone.
        assert_eq!(login_entry_for(written, "/home/u/Apps/Nobetci.AppImage", gone), None);
        // A moved AppImage: only Exec= changes; the user's delay and comment stay.
        let customised =
            "# mine\n[Desktop Entry]\nName=Nobetci\nExec=/old/Nobetci.AppImage \nX-GNOME-Autostart-Delay=10\n";
        assert_eq!(
            login_entry_for(customised, "/new/Nobetci.AppImage", gone).as_deref(),
            Some("# mine\n[Desktop Entry]\nName=Nobetci\nExec=/new/Nobetci.AppImage \nX-GNOME-Autostart-Delay=10\n")
        );
        // An entry without Exec= gets one in its group.
        assert_eq!(
            login_entry_for("[Desktop Entry]\nName=N\n[Extra]\nA=b\n", "/p/nobetci", gone).as_deref(),
            Some("[Desktop Entry]\nName=N\nExec=/p/nobetci \n[Extra]\nA=b\n")
        );
    }

    /// hooks-settings#2 (repair): what the user wrote around the program in
    /// `Exec=` stays — `env`, arguments, quotes — and only a program path
    /// that differs is replaced.
    #[test]
    fn a_customised_exec_line_keeps_what_the_user_wrote() {
        let entry = |exec: &str| format!("[Desktop Entry]\nName=Nobetci\nExec={exec}\nX-GNOME-Autostart-Delay=10\n");
        let gone: fn(&str) -> bool = |_| false;
        // The review's three: already this program, so nothing to do.
        for (exec, program) in [
            ("env GDK_SCALE=2 /home/u/Apps/Nobetci.AppImage ", "/home/u/Apps/Nobetci.AppImage"),
            ("/home/u/Apps/Nobetci.AppImage --minimized", "/home/u/Apps/Nobetci.AppImage"),
            ("\"/home/u/My Apps/Nobetci.AppImage\"", "/home/u/My Apps/Nobetci.AppImage"),
            ("env -u GTK_THEME LANG=tr_TR.UTF-8 /usr/bin/nobetci %U", "/usr/bin/nobetci"),
        ] {
            assert_eq!(login_entry_for(&entry(exec), program, gone), None, "{exec}");
        }
        // Moved: the program alone changes, quoted when it has a space.
        for (exec, program, want) in [
            (
                "env GDK_SCALE=2 /old/Nobetci.AppImage --minimized",
                "/new/My Apps/Nobetci.AppImage",
                "env GDK_SCALE=2 \"/new/My Apps/Nobetci.AppImage\" --minimized",
            ),
            ("\"/old dir/Nobetci.AppImage\" --minimized", "/new/Nobetci.AppImage", "/new/Nobetci.AppImage --minimized"),
            // The plugin writes a path unquoted: with a space in it, it reads
            // as two arguments — taken together, and quoted from now on.
            (
                "/home/u/My Apps/Nobetci.AppImage ",
                "/home/u/My Apps/Nobetci.AppImage",
                "\"/home/u/My Apps/Nobetci.AppImage\" ",
            ),
            ("/home/u/Old Apps/Nobetci_2.4.0.AppImage ", "/home/u/Nobetci.AppImage", "/home/u/Nobetci.AppImage "),
            ("/home/u/My Apps/nobetci --minimized", "/usr/bin/nobetci", "/usr/bin/nobetci --minimized"),
            // Some other program that is gone: the entry would start nothing.
            ("/home/u/gone/start-nobetci.sh", "/p/Nobetci.AppImage", "/p/Nobetci.AppImage"),
        ] {
            assert_eq!(login_entry_for(&entry(exec), program, gone), Some(entry(want)), "{exec}");
        }
        // A wrapper the user pointed it at is theirs while it is there; a
        // command found in PATH is there.
        let there: fn(&str) -> bool = |_| true;
        for (exec, exists) in [
            ("/home/u/bin/start-nobetci.sh", there),
            ("sh -c \"sleep 10; /home/u/Nobetci.AppImage\"", gone),
            ("flatpak run org.example.Wrapper", gone),
        ] {
            assert_eq!(login_entry_for(&entry(exec), "/p/Nobetci.AppImage", exists), None, "{exec}");
        }
        // Quoting as the desktop reads it, both ways.
        for program in ["/opt/Nöbetçi/nobetci", "/a b/c", "/a\"b/c$d`e", "/a\\b c", "/tab\there"] {
            let args = exec_args(&format!("{} --x", exec_arg(program)));
            let read: Vec<&str> = args.iter().map(|a| a.value.as_str()).collect();
            assert_eq!(read, [program, "--x"], "{}", exec_arg(program));
        }
        assert_eq!(exec_arg("/a b/c"), "\"/a b/c\"");
        assert_eq!(exec_arg("/a\"b"), r#""/a\\"b""#);
        let read: Vec<String> =
            exec_args(r#"env A=1 "/x y/z" '/p q/r' a\sb "c\\\\d" e\"f"#).into_iter().map(|a| a.value).collect();
        assert_eq!(read, ["env", "A=1", "/x y/z", "/p q/r", "a", "b", "c\\d", "e\"f"]);
    }

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
