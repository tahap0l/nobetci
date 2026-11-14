//! The Linux half of the relay: the Unix socket Nöbetçi listens on, and the
//! parent-process chain.
//!
//! The socket is `~/.local/state/nobetci/nobetci.sock`, or `/tmp/nobetci-<uid>/`
//! when the home path is too long for a socket. The app keeps the folder at 0700
//! and the socket at 0600, so another account cannot reach it in the first place.
//! Before sending anything we still check two things, both cheap: the socket file
//! belongs to us, and the process on the other end runs as us (`SO_PEERCRED`).
//! Anything else gets nothing.

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

/// `sun_path` holds 108 bytes on Linux, the terminating NUL included.
const MAX_SOCKET_PATH: usize = 107;

/// Must match the app's `pipe::unix_socket::socket_path()` exactly.
fn socket_path() -> Option<PathBuf> {
    let preferred = home()?.join(".local/state/nobetci/nobetci.sock");
    if preferred.as_os_str().len() <= MAX_SOCKET_PATH {
        return Some(preferred);
    }
    let uid = unsafe { libc::getuid() };
    Some(PathBuf::from(format!("/tmp/nobetci-{uid}/nobetci.sock")))
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

/// The user id of the process at the other end, as the kernel saw it at connect.
fn peer_uid(stream: &UnixStream) -> Option<libc::uid_t> {
    let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let rc = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            &mut cred as *mut _ as *mut libc::c_void,
            &mut len,
        )
    };
    (rc == 0).then_some(cred.uid)
}

/// The chain of parent processes above this one, nearest first, as (pid, name).
///
/// Claude Code → shell → GNOME Terminal, Konsole, kitty or VS Code: somewhere up
/// this chain is the app the session lives in, which is what "go to window" needs.
pub fn ancestors(max: usize) -> Vec<(u32, String)> {
    let mut out: Vec<(u32, String)> = Vec::new();
    let mut pid = std::process::id();
    while out.len() < max {
        let Some(parent) = parent_of(pid) else { break };
        // init (1) and the kernel (0) end the chain; a loop means a reused PID.
        if parent <= 1 || out.iter().any(|(p, _)| *p == parent) {
            break;
        }
        let Some(name) = name_of(parent) else { break };
        out.push((parent, name));
        pid = parent;
    }
    out
}

/// The parent pid from `/proc/<pid>/stat`. The name in that line is in
/// parentheses and may itself hold spaces or parentheses, so the fields are read
/// from after the last `)`.
fn parent_of(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_ppid(&stat)
}

fn parse_ppid(stat: &str) -> Option<u32> {
    let rest = &stat[stat.rfind(')')? + 1..];
    // " S 1234 …": state, then the parent pid.
    rest.split_whitespace().nth(1)?.parse().ok()
}

fn name_of(pid: u32) -> Option<String> {
    let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
    let name = comm.trim_end_matches('\n');
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_parent_pid_past_an_awkward_name() {
        assert_eq!(parse_ppid("4242 (bash) S 4100 4242 4242 0 -1"), Some(4100));
        assert_eq!(parse_ppid("77 (my (odd) prog) R 12 77 77"), Some(12));
        assert_eq!(parse_ppid("garbage"), None);
    }

    #[test]
    fn our_own_chain_is_readable() {
        let chain = ancestors(12);
        assert!(!chain.is_empty(), "the test runner has a parent");
        assert!(chain.iter().all(|(pid, name)| *pid > 1 && !name.is_empty()));
    }

    #[test]
    fn the_socket_lives_under_home_or_a_private_tmp_folder() {
        let path = socket_path().unwrap();
        assert!(path.ends_with("nobetci.sock"));
        assert!(path.as_os_str().len() <= MAX_SOCKET_PATH);
    }
}
