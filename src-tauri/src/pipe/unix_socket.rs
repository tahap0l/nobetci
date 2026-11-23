// macOS: a Unix socket at ~/Library/Application Support/Nobetci/nobetci.sock, or
// in the per-user temporary folder when the home path is too long for a socket.
// Linux: ~/.local/state/nobetci/nobetci.sock, or /tmp/nobetci-<uid>/ when the home
// path is too long.
//
// Filesystem permissions do most of the work: the folder is kept at 0700 and the
// socket at 0600, so no other account can even reach it. Every connection is
// still checked — the peer must run as this user — and we refuse to start if
// something is already answering on the socket rather than serving on top of it.
// nobetci-hook makes the mirror-image checks (socket owner, peer uid) before it
// sends anything.
//
// A socket file outlives its process. One left behind breaks nothing (the next
// start and the relay both see that nobody answers), but quitting should leave
// the folder as it was: the socket we bound is removed when the process exits
// normally (an atexit handler — every quit ends in `exit`) and on SIGTERM and
// SIGINT, which then end the process as they would have. Only the very file we
// bound goes, never one that took its place, and only libc is needed for it.

use std::ffi::{CStr, CString};
use std::io;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
#[cfg(target_os = "macos")]
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicPtr, AtomicU64, Ordering};
use std::sync::Once;
use std::time::Duration;

use tauri::AppHandle;
use tokio::net::{UnixListener, UnixStream};

use super::Conn;
use crate::log;

impl Conn for UnixStream {
    // Dropping the stream closes it and the relay sees end-of-file — after
    // reading whatever we wrote: a socket keeps unread data for its peer.
    async fn close(&mut self) {}
}

/// The home folder from the user database, not `$HOME` — exactly as nobetci-hook
/// finds it, so the two always agree on the socket.
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
#[cfg(target_os = "macos")]
const MAX_SOCKET_PATH: usize = 103;
/// …and 108 on Linux.
#[cfg(target_os = "linux")]
const MAX_SOCKET_PATH: usize = 107;

/// Must match nobetci-hook's `socket_path()` (hook/src/linux.rs) exactly.
#[cfg(target_os = "linux")]
pub fn socket_path() -> Option<PathBuf> {
    let preferred = home()?.join(".local/state/nobetci/nobetci.sock");
    if preferred.as_os_str().len() <= MAX_SOCKET_PATH {
        return Some(preferred);
    }
    // A very long home folder: a folder of our own in /tmp, which `private_dir`
    // refuses to use unless it belongs to us and nobody else can enter it.
    Some(PathBuf::from(format!("/tmp/nobetci-{}/nobetci.sock", me())))
}

/// Must match nobetci-hook's `socket_path()` (hook/src/mac.rs) exactly.
#[cfg(target_os = "macos")]
pub fn socket_path() -> Option<PathBuf> {
    let preferred = home()?.join("Library/Application Support/Nobetci/nobetci.sock");
    if preferred.as_os_str().len() <= MAX_SOCKET_PATH {
        return Some(preferred);
    }
    // A very long home folder (a network home, say): the per-user temporary
    // folder instead, which macOS keeps at 0700 for this account alone.
    Some(user_temp_dir()?.join("nobetci.sock"))
}

/// The per-user temporary folder (`/var/folders/…/T/`), from confstr rather than
/// `$TMPDIR`, exactly as nobetci-hook finds it.
#[cfg(target_os = "macos")]
fn user_temp_dir() -> Option<PathBuf> {
    let mut buf = vec![0 as libc::c_char; 1024];
    let n = unsafe { libc::confstr(libc::_CS_DARWIN_USER_TEMP_DIR, buf.as_mut_ptr(), buf.len()) };
    if n == 0 || n > buf.len() {
        return None;
    }
    let dir = unsafe { CStr::from_ptr(buf.as_ptr()) }.to_str().ok()?;
    (!dir.is_empty()).then(|| PathBuf::from(dir))
}

fn me() -> u32 {
    unsafe { libc::getuid() }
}

/// The user id of the process on the other end. `getpeereid` reads the
/// credentials the kernel stored at connect time, so it still answers after a
/// fire-and-forget relay has written its event and gone — unlike a peer-pid
/// query, which fails once the other side has closed.
#[cfg(target_os = "linux")]
fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    // SO_PEERCRED, stored at connect time just like getpeereid's answer.
    stream.peer_cred().map(|cred| cred.uid())
}

#[cfg(target_os = "macos")]
fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
    let (mut uid, mut gid): (libc::uid_t, libc::gid_t) = (0, 0);
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } == 0 {
        Ok(uid)
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Makes `dir` ours and private (0700), or refuses.
fn private_dir(dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let meta = std::fs::symlink_metadata(dir)?;
    if !meta.is_dir() || meta.uid() != me() {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "the socket folder isn't ours"));
    }
    if meta.permissions().mode() & 0o777 != 0o700 {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn bind(path: &Path) -> io::Result<UnixListener> {
    if let Some(dir) = path.parent() {
        private_dir(dir)?;
    }
    // Somebody already answering here — another Nöbetçi, or anything else — keeps
    // the socket; we do not serve on top of it.
    if std::os::unix::net::UnixStream::connect(path).is_ok() {
        return Err(io::Error::new(io::ErrorKind::AddrInUse, "something is already listening on the socket"));
    }
    // Left over from a previous run (a socket file outlives its process).
    if std::fs::symlink_metadata(path).is_ok() {
        std::fs::remove_file(path)?;
    }
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// The socket we bound, for removing it at exit: its path (a C string kept for
/// the life of the process), device and inode. Read from a signal handler, so
/// atomics only.
static BOUND: AtomicPtr<libc::c_char> = AtomicPtr::new(std::ptr::null_mut());
static BOUND_DEV: AtomicU64 = AtomicU64::new(0);
static BOUND_INO: AtomicU64 = AtomicU64::new(0);

/// Remembers `path` as the socket this process bound.
fn remember(path: &Path) {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return };
    let Ok(c_path) = CString::new(path.as_os_str().as_bytes()) else { return };
    BOUND_DEV.store(meta.dev(), Ordering::SeqCst);
    BOUND_INO.store(meta.ino(), Ordering::SeqCst);
    // Kept for the life of the process: a signal handler may read it any time.
    BOUND.store(c_path.into_raw(), Ordering::SeqCst);
}

/// Removes the socket we bound, if the file there is still that one. Safe to
/// run in a signal handler: atomics, lstat and unlink only.
fn remove_ours() {
    let path = BOUND.load(Ordering::SeqCst);
    if path.is_null() {
        return;
    }
    // SAFETY: `path` is a NUL-terminated string that lives for the process;
    // lstat and unlink are async-signal-safe.
    unsafe {
        let mut st: libc::stat = std::mem::zeroed();
        if libc::lstat(path, &mut st) == 0
            && st.st_dev as u64 == BOUND_DEV.load(Ordering::SeqCst)
            && st.st_ino as u64 == BOUND_INO.load(Ordering::SeqCst)
        {
            libc::unlink(path);
        }
    }
}

extern "C" fn remove_at_exit() {
    remove_ours();
}

/// SIGTERM or SIGINT: the socket goes, then the signal does what it would have
/// done — the handler was reset on entry (SA_RESETHAND), so the signal raised
/// again ends the process the usual way.
extern "C" fn remove_on_signal(signal: libc::c_int) {
    remove_ours();
    // SAFETY: raise is async-signal-safe.
    unsafe { libc::raise(signal) };
}

/// Removes the socket at `path` when the process ends: at a normal exit, and on
/// SIGTERM and SIGINT unless something else already handles (or ignores) them.
fn remove_at_end(path: &Path) {
    remember(path);
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        // SAFETY: plain libc calls with valid arguments; the handlers only use
        // async-signal-safe calls.
        unsafe {
            libc::atexit(remove_at_exit);
            for signal in [libc::SIGTERM, libc::SIGINT] {
                let mut old: libc::sigaction = std::mem::zeroed();
                if libc::sigaction(signal, std::ptr::null(), &mut old) != 0 || old.sa_sigaction != libc::SIG_DFL {
                    continue;
                }
                let mut new: libc::sigaction = std::mem::zeroed();
                new.sa_sigaction = remove_on_signal as extern "C" fn(libc::c_int) as libc::sighandler_t;
                new.sa_flags = libc::SA_RESETHAND;
                libc::sigemptyset(&mut new.sa_mask);
                libc::sigaction(signal, &new, std::ptr::null_mut());
            }
        }
    });
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Some(path) = socket_path() else {
            log::line("cannot open the relay socket: no home folder");
            return;
        };
        let listener = match bind(&path) {
            Ok(l) => l,
            Err(err) => {
                log::line(format!("cannot open the relay socket {}: {err}", path.display()));
                return;
            }
        };
        remove_at_end(&path);
        loop {
            let stream = match listener.accept().await {
                Ok((stream, _)) => stream,
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
            };
            // Only this account may talk to us, whatever the file modes say.
            match peer_uid(&stream) {
                Ok(uid) if uid == me() => {}
                Ok(uid) => {
                    log::line(format!("relay socket: refused a connection from uid {uid}"));
                    continue;
                }
                Err(err) => {
                    log::line(format!("relay socket: could not identify a peer ({err}) — refused"));
                    continue;
                }
            }
            super::accept(app.clone(), stream);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_socket_we_bound_is_removed() {
        let dir = std::env::temp_dir().join(format!("nobetci-socket-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("nobetci.sock");
        remove_ours(); // nothing bound yet: nothing happens
        let ours = std::os::unix::net::UnixListener::bind(&path).unwrap();
        remember(&path);
        remove_ours();
        assert!(std::fs::symlink_metadata(&path).is_err(), "the socket we bound is gone");
        // Another socket in its place — another Nöbetçi that started after this
        // one lost its file, say — is not ours to remove.
        let theirs = std::os::unix::net::UnixListener::bind(&path).unwrap();
        remove_ours();
        assert!(std::fs::symlink_metadata(&path).is_ok(), "another's socket stays");
        drop((ours, theirs));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
