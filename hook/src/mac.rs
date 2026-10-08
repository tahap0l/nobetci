//! The macOS half of the relay: the Unix socket Nöbetçi listens on, and the
//! parent-process chain.
//!
//! The socket is `~/Library/Application Support/Nobetci/nobetci.sock` (or the
//! per-user temporary folder when the home path is too long for a socket). The
//! app keeps that folder at 0700 and the socket at 0600, so another account
//! cannot reach it in the first place. Before sending anything we still check two
//! things, both cheap: the socket file belongs to us, and the process on the
//! other end runs as us (`getpeereid`). Anything else gets nothing.

use std::ffi::CStr;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::os::unix::io::AsRawFd;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;

/// The home folder of the account we run as, from the user database rather than
/// `$HOME`: the app and every relay must agree on the socket even when a shell
/// has pointed `HOME` somewhere else.
fn home() -> Option<PathBuf> {
    unsafe {
        let mut pwd: libc::passwd = std::mem::zeroed();
        let mut buf = vec![0 as libc::c_char; 4096];
        let mut found: *mut libc::passwd = std::ptr::null_mut();
        let rc = libc::getpwuid_r(libc::getuid(), &mut pwd, buf.as_mut_ptr(), buf.len(), &mut found);
        if rc != 0 || found.is_null() || pwd.pw_dir.is_null() {
            return None;
        }
        let dir = CStr::from_ptr(pwd.pw_dir).to_str().ok()?;
        (!dir.is_empty()).then(|| PathBuf::from(dir))
    }
}

/// `sun_path` holds 104 bytes on macOS, the terminating NUL included.
const MAX_SOCKET_PATH: usize = 103;

/// Must match the app's `pipe::unix_socket::socket_path()` exactly.
fn socket_path() -> Option<PathBuf> {
    let preferred = home()?.join("Library/Application Support/Nobetci/nobetci.sock");
    if preferred.as_os_str().len() <= MAX_SOCKET_PATH {
        return Some(preferred);
    }
    // A very long home folder (a network home, say): the per-user temporary
    // folder instead, which macOS keeps at 0700 for this account alone.
    Some(user_temp_dir()?.join("nobetci.sock"))
}

/// The per-user temporary folder (`/var/folders/…/T/`), from confstr rather than
/// `$TMPDIR` for the same reason as `home()`.
fn user_temp_dir() -> Option<PathBuf> {
    let mut buf = vec![0 as libc::c_char; 1024];
    let n = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, buf.as_mut_ptr(), buf.len()) };
    if n == 0 || n > buf.len() {
        return None;
    }
    let dir = unsafe { CStr::from_ptr(buf.as_ptr()) }.to_str().ok()?;
    (!dir.is_empty()).then(|| PathBuf::from(dir))
}

/// Connects to the app. No socket, a stale one, or one that is not ours: `None`,
/// at once — there is nothing to wait for.
pub fn connect() -> Option<UnixStream> {
    let path = socket_path()?;
    let me = unsafe { libc::getuid() };
    let meta = std::fs::symlink_metadata(&path).ok()?;
    if !meta.file_type().is_socket() || meta.uid() != me {
        return None;
    }
    let stream = UnixStream::connect(&path).ok()?;
    // Somebody else's server on our socket gets nothing from us.
    (peer_uid(&stream) == Some(me)).then_some(stream)
}

/// The effective user id of the process at the other end.
fn peer_uid(stream: &UnixStream) -> Option<libc::uid_t> {
    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    let rc = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
    (rc == 0).then_some(uid)
}

/// The chain of parent processes above this one, nearest first, as (pid, name).
///
/// Claude Code → shell → login → Terminal, iTerm2 or VS Code: somewhere up this
/// chain is the app the session lives in, which is what "go to window" needs.
pub fn ancestors(max: usize) -> Vec<(u32, String)> {
    let mut out: Vec<(u32, String)> = Vec::new();
    let mut pid = std::process::id() as i32;
    while out.len() < max {
        let Some((parent, _)) = bsd_info(pid) else { break };
        // launchd (1) and the kernel (0) end the chain; a loop means a reused PID.
        if parent <= 1 || out.iter().any(|(p, _)| *p as i32 == parent) {
            break;
        }
        let Some((_, name)) = bsd_info(parent) else { break };
        out.push((parent as u32, name));
        pid = parent;
    }
    out
}

/// (parent pid, process name) for `pid`.
///
/// The short form on purpose: the full PROC_PIDTBSDINFO is refused for
/// processes of another user, and Terminal, iTerm2 and friends start the shell
/// under a root-owned `/usr/bin/login` — the chain would stop right there, below
/// the app that owns the window.
fn bsd_info(pid: i32) -> Option<(i32, String)> {
    unsafe {
        let mut info: libc::proc_bsdshortinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdshortinfo>() as libc::c_int;
        let got =
            libc::proc_pidinfo(pid, libc::PROC_PIDT_SHORTBSDINFO, 0, &mut info as *mut _ as *mut libc::c_void, size);
        if got != size {
            return None;
        }
        Some((info.pbsi_ppid as i32, fixed_str(&info.pbsi_comm)))
    }
}

/// A C string in a fixed-size array, read without ever going past its end.
fn fixed_str(raw: &[libc::c_char]) -> String {
    let bytes: Vec<u8> = raw.iter().take_while(|c| **c != 0).map(|c| *c as u8).collect();
    String::from_utf8_lossy(&bytes).into_owned()
}
