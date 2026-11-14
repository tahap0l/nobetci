// Linux: the few X11 questions Nöbetçi asks of the desktop.
//
// Nöbetçi runs on X11, or on XWayland under a Wayland session (main.rs picks the
// X11 backend), because only there can a window place itself at the top of the
// screen and stay above the others. The same connection answers:
//   * which window is in front, and is it full screen (full-screen quiet);
//   * which top-level window belongs to a process (go to the session's window);
//   * which device a mouse press came from (the click guard, `inputguard/x11.rs`).
//
// libX11 and libXi are loaded at run time (x11-dl), so a desktop without them
// simply goes without these features instead of failing to start.

use std::ffi::CString;
use std::os::raw::{c_int, c_uchar, c_ulong};
use std::sync::OnceLock;

use x11_dl::xlib::{self, Display, Xlib};

pub fn xlib() -> Option<&'static Xlib> {
    static LIB: OnceLock<Option<Xlib>> = OnceLock::new();
    LIB.get_or_init(|| Xlib::open().ok()).as_ref()
}

/// A short-lived connection to the X server, closed when dropped.
pub struct Conn {
    pub x: &'static Xlib,
    pub dpy: *mut Display,
}

impl Conn {
    pub fn open() -> Option<Conn> {
        let x = xlib()?;
        let dpy = unsafe { (x.XOpenDisplay)(std::ptr::null()) };
        (!dpy.is_null()).then_some(Conn { x, dpy })
    }

    pub fn root(&self) -> c_ulong {
        unsafe { (self.x.XDefaultRootWindow)(self.dpy) }
    }

    pub fn atom(&self, name: &str) -> c_ulong {
        let name = CString::new(name).unwrap_or_default();
        unsafe { (self.x.XInternAtom)(self.dpy, name.as_ptr(), xlib::False) }
    }

    /// A 32-bit-format property (windows, atoms, cardinals) as a list of longs.
    pub fn longs(&self, win: c_ulong, prop: &str) -> Vec<c_ulong> {
        let prop = self.atom(prop);
        let (mut kind, mut format, mut count, mut after) = (0, 0, 0, 0);
        let mut data: *mut c_uchar = std::ptr::null_mut();
        let rc = unsafe {
            (self.x.XGetWindowProperty)(
                self.dpy,
                win,
                prop,
                0,
                4096,
                xlib::False,
                xlib::AnyPropertyType as c_ulong,
                &mut kind,
                &mut format,
                &mut count,
                &mut after,
                &mut data,
            )
        };
        if rc != xlib::Success as c_int || data.is_null() {
            return Vec::new();
        }
        // Format-32 data arrives as C longs, whatever the word size.
        let out = if format == 32 {
            unsafe { std::slice::from_raw_parts(data as *const c_ulong, count as usize) }.to_vec()
        } else {
            Vec::new()
        };
        unsafe { (self.x.XFree)(data.cast()) };
        out
    }
}

impl Drop for Conn {
    fn drop(&mut self) {
        unsafe { (self.x.XCloseDisplay)(self.dpy) };
    }
}

/// The window in front is full screen (a game, a presentation, a video).
pub fn fullscreen() -> bool {
    let Some(c) = Conn::open() else { return false };
    let Some(&active) = c.longs(c.root(), "_NET_ACTIVE_WINDOW").first() else { return false };
    if active == 0 {
        return false;
    }
    let full = c.atom("_NET_WM_STATE_FULLSCREEN");
    c.longs(active, "_NET_WM_STATE").contains(&full)
}

/// Brings the first window owned by one of `pids` to the front, nearest first.
/// Asks the window manager the standard way (`_NET_ACTIVE_WINDOW`), as a pager
/// would, which lets it raise the window even from the background.
pub fn activate_pid(pids: &[u32]) -> bool {
    let Some(c) = Conn::open() else { return false };
    let clients = c.longs(c.root(), "_NET_CLIENT_LIST");
    let owned: Vec<(c_ulong, u32)> =
        clients.iter().filter_map(|&w| c.longs(w, "_NET_WM_PID").first().map(|&pid| (w, pid as u32))).collect();
    let Some(&(win, _)) = pids.iter().find_map(|pid| owned.iter().find(|(_, owner)| owner == pid)) else {
        return false;
    };
    let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
    let msg = unsafe { &mut event.client_message };
    msg.type_ = xlib::ClientMessage;
    msg.window = win;
    msg.message_type = c.atom("_NET_ACTIVE_WINDOW");
    msg.format = 32;
    // 2 = a pager: the request comes from the user, not from the app itself.
    msg.data.set_long(0, 2);
    msg.data.set_long(1, xlib::CurrentTime as i64);
    unsafe {
        (c.x.XSendEvent)(
            c.dpy,
            c.root(),
            xlib::False,
            xlib::SubstructureRedirectMask | xlib::SubstructureNotifyMask,
            &mut event,
        );
        (c.x.XFlush)(c.dpy);
    }
    true
}
