// macOS: a Unix socket at ~/Library/Application Support/Nobetci/nobetci.sock, or
// in the per-user temporary folder when the home path is too long for a socket.
//
// Filesystem permissions do most of the work: the folder is kept at 0700 and the
// socket at 0600, so no other account can even reach it. Every connection is
// still checked — the peer must run as this user — and we refuse to start if
// something is already answering on the socket rather than serving on top of it.
// nobetci-hook makes the mirror-image checks (socket owner, peer uid) before it
// sends anything.

use std::ffi::CStr;
use std::io;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::AppHandle;
use tokio::net::{UnixListener, UnixStream};

use super::Conn;
use crate::log;

impl Conn for UnixStream {
    // Dropping the stream closes it; the relay sees end-of-file.
    fn close(&mut self) {}
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
const MAX_SOCKET_PATH: usize = 103;

/// Must match nobetci-hook's `socket_path()` (hook/src/mac.rs) exactly.
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
            let app = app.clone();
            tauri::async_runtime::spawn(async move { super::handle(app, stream).await });
        }
    });
}
