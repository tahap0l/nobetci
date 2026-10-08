// Windows: the named pipe `\\.\pipe\nobetci-<sid>`, one instance per connection.
//
// Named pipes share one machine-wide namespace. The SID in the name keeps two
// accounts apart, an explicit DACL lets only this user (and SYSTEM) open it,
// remote clients are refused, and `first_pipe_instance` means we never serve on
// a name somebody else got to first. nobetci-hook additionally checks that the
// process serving the pipe runs as the same user before it sends anything.

use std::ffi::c_void;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::AppHandle;
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows::core::PCWSTR;
use windows::Win32::Security::Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW;
use windows::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

use super::Conn;
use crate::log;

impl Conn for NamedPipeServer {
    fn close(&mut self) {
        let _ = self.disconnect();
    }
}

/// `\\.\pipe\nobetci-<sid>` — must match nobetci-hook's `pipe_path()` exactly.
fn pipe_name() -> String {
    let key = crate::win_user::current_user_sid()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "user".into()));
    format!(r"\\.\pipe\nobetci-{key}")
}

/// Security attributes for the pipe: only this user (and SYSTEM) may open it.
/// The default DACL for a named pipe also grants Everyone read access; an explicit
/// one leaves nothing to reason about. Built once and kept for the process life.
struct PipeSecurity(SECURITY_ATTRIBUTES);
// The descriptor is immutable after creation and only ever read by CreateNamedPipe.
unsafe impl Send for PipeSecurity {}
unsafe impl Sync for PipeSecurity {}

fn pipe_security() -> Option<&'static PipeSecurity> {
    static CELL: OnceLock<Option<PipeSecurity>> = OnceLock::new();
    CELL.get_or_init(|| {
        let sid = crate::win_user::current_user_sid()?;
        let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)").encode_utf16().chain([0]).collect();
        let mut sd = PSECURITY_DESCRIPTOR::default();
        // SDDL_REVISION_1
        unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(sddl.as_ptr()), 1, &mut sd, None) }
            .ok()?;
        Some(PipeSecurity(SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: sd.0,
            bInheritHandle: false.into(),
        }))
    })
    .as_ref()
}

fn create_instance(name: &str, first: bool) -> std::io::Result<NamedPipeServer> {
    let mut options = ServerOptions::new();
    // first_pipe_instance also means we refuse to join a pipe somebody else
    // already owns under our name, rather than serving on top of it.
    options.first_pipe_instance(first).reject_remote_clients(true);
    match pipe_security() {
        // SAFETY: the attributes point at a descriptor that lives for the process.
        Some(sec) => unsafe { options.create_with_security_attributes_raw(name, &sec.0 as *const _ as *mut c_void) },
        None => {
            log::line("pipe: no explicit DACL (SID unavailable) — using the default");
            options.create(name)
        }
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let name = pipe_name();
        let mut server = match create_instance(&name, true) {
            Ok(s) => s,
            Err(err) => {
                log::line(format!("cannot open the relay pipe: {err}"));
                return;
            }
        };
        loop {
            if server.connect().await.is_err() {
                tokio::time::sleep(Duration::from_millis(200)).await;
                continue;
            }
            // Hand the connected instance to a task and listen on a fresh one.
            let next = match create_instance(&name, false) {
                Ok(s) => s,
                Err(err) => {
                    log::line(format!("cannot reopen the relay pipe: {err}"));
                    return;
                }
            };
            let connected = std::mem::replace(&mut server, next);
            let app = app.clone();
            tauri::async_runtime::spawn(async move { super::handle(app, connected).await });
        }
    });
}
