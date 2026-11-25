// Linux: the few X11 questions Nobi asks of the desktop.
//
// Nobi runs on X11, or on XWayland under a Wayland session (`sys::use_x11`
// picks the X11 backend), because only there can a window place itself at the
// top of the screen and stay above the others. The same connection answers:
//   * which window is in front, and is it full screen (full-screen quiet);
//   * which top-level window belongs to a process (go to the session's window);
//   * which device a mouse press came from (the click guard, `inputguard/x11.rs`
//     — a speed bump for LOW and MEDIUM approvals that cannot vouch for a
//     hold, so HIGH and CRITICAL are decided in the terminal on Linux);
//   * whether a compositing manager runs, and if not, cuts the island's window
//     down to the island (`island::fit_shape`);
//   * which window has the keyboard, so the island can give it back once the
//     user is done typing into it (`island::set_typing`).
//
// libX11, libXi and libXfixes are loaded at run time (x11-dl), so a desktop
// without them simply goes without these features instead of failing to start.

use std::ffi::CString;
use std::os::raw::{c_int, c_uchar, c_uint, c_ulong};
use std::sync::OnceLock;

use x11_dl::xfixes;
use x11_dl::xlib::{self, Display, Xlib};

pub fn xlib() -> Option<&'static Xlib> {
    static LIB: OnceLock<Option<Xlib>> = OnceLock::new();
    LIB.get_or_init(|| Xlib::open().ok()).as_ref()
}

fn xfixes() -> Option<&'static xfixes::Xlib> {
    static LIB: OnceLock<Option<xfixes::Xlib>> = OnceLock::new();
    LIB.get_or_init(|| xfixes::Xlib::open().ok()).as_ref()
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

    /// A text property (STRING or UTF8_STRING), if the window has one.
    pub fn text(&self, win: c_ulong, prop: &str) -> Option<String> {
        let prop = self.atom(prop);
        let (mut kind, mut format, mut count, mut after) = (0, 0, 0, 0);
        let mut data: *mut c_uchar = std::ptr::null_mut();
        let rc = unsafe {
            (self.x.XGetWindowProperty)(
                self.dpy,
                win,
                prop,
                0,
                1024,
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
            return None;
        }
        let out = (format == 8)
            .then(|| String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(data, count as usize) }).into_owned());
        unsafe { (self.x.XFree)(data.cast()) };
        out
    }

    /// The windows directly inside `win`.
    pub fn children(&self, win: c_ulong) -> Vec<c_ulong> {
        let (mut root, mut parent) = (0, 0);
        let mut list: *mut c_ulong = std::ptr::null_mut();
        let mut count: c_uint = 0;
        let ok = unsafe { (self.x.XQueryTree)(self.dpy, win, &mut root, &mut parent, &mut list, &mut count) };
        if ok == 0 || list.is_null() {
            return Vec::new();
        }
        let out = unsafe { std::slice::from_raw_parts(list, count as usize) }.to_vec();
        unsafe { (self.x.XFree)(list.cast()) };
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
    activate(&c, win);
    true
}

/// Asks the window manager to make `win`, one of its client windows, the
/// active one (`_NET_ACTIVE_WINDOW`): raised, and given the keyboard.
fn activate(c: &Conn, win: c_ulong) {
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
}

/// The client window the window manager has active (`_NET_ACTIVE_WINDOW`),
/// if it says.
pub fn active_window() -> Option<c_ulong> {
    let c = Conn::open()?;
    c.longs(c.root(), "_NET_ACTIVE_WINDOW").first().copied().filter(|&win| win != 0)
}

/// Whether the keyboard focus is on `top` or a window inside it (GTK keeps
/// the focus on a child window of its own).
pub fn focus_within(top: c_ulong) -> bool {
    let Some(c) = Conn::open() else { return false };
    let (mut focus, mut revert): (c_ulong, c_int) = (0, 0);
    unsafe { (c.x.XGetInputFocus)(c.dpy, &mut focus, &mut revert) };
    // 0 is None and 1 PointerRoot: no window holds the keyboard.
    let (root, mut win) = (c.root(), focus);
    for _ in 0..32 {
        if win == top {
            return true;
        }
        if win <= 1 || win == root {
            return false;
        }
        let (mut root_of, mut parent) = (0, 0);
        let mut list: *mut c_ulong = std::ptr::null_mut();
        let mut count: c_uint = 0;
        if unsafe { (c.x.XQueryTree)(c.dpy, win, &mut root_of, &mut parent, &mut list, &mut count) } == 0 {
            return false;
        }
        if !list.is_null() {
            unsafe { (c.x.XFree)(list.cast()) };
        }
        win = parent;
    }
    false
}

/// Gives the keyboard back from `island` to `before`, the window that had it,
/// through the window manager. When that window is gone, the window manager's
/// topmost other window takes it (not a panel, the desktop or a minimised
/// window, and none of Nobi's); with no window manager, the keyboard
/// follows the pointer again.
pub fn give_focus(before: Option<c_ulong>, island: c_ulong) {
    let Some(c) = Conn::open() else { return };
    let root = c.root();
    let clients = c.longs(root, "_NET_CLIENT_LIST");
    let me = c_ulong::from(std::process::id());
    let skip =
        [c.atom("_NET_WM_WINDOW_TYPE_DOCK"), c.atom("_NET_WM_WINDOW_TYPE_DESKTOP"), c.atom("_NET_WM_STATE_HIDDEN")];
    let target = before.filter(|win| *win != island && clients.contains(win)).or_else(|| {
        c.longs(root, "_NET_CLIENT_LIST_STACKING").into_iter().rev().find(|&win| {
            win != island
                && c.longs(win, "_NET_WM_PID").first() != Some(&me)
                && !c
                    .longs(win, "_NET_WM_WINDOW_TYPE")
                    .iter()
                    .chain(&c.longs(win, "_NET_WM_STATE"))
                    .any(|a| skip.contains(a))
        })
    });
    match target {
        Some(win) => activate(&c, win),
        None if clients.is_empty() => unsafe {
            // PointerRoot (1), with RevertToPointerRoot (1).
            (c.x.XSetInputFocus)(c.dpy, 1, 1, xlib::CurrentTime);
            (c.x.XFlush)(c.dpy);
        },
        None => {}
    }
}

/// Whether a compositing manager runs on the default screen: it owns the
/// `_NET_WM_CM_S<n>` selection. Without one, X shows a window's transparent
/// pixels as black. None when X cannot be asked.
pub fn compositing() -> Option<bool> {
    let c = Conn::open()?;
    let screen = unsafe { (c.x.XDefaultScreen)(c.dpy) };
    let selection = c.atom(&format!("_NET_WM_CM_S{screen}"));
    Some(unsafe { (c.x.XGetSelectionOwner)(c.dpy, selection) } != 0)
}

/// Our own top-level window titled `title` (`_NET_WM_NAME`). Found by walking
/// the window tree, because a window manager may have put it inside a frame of
/// its own, and with none there is no `_NET_CLIENT_LIST` to ask.
pub fn own_window(title: &str) -> Option<c_ulong> {
    fn find(c: &Conn, win: c_ulong, pid: c_ulong, title: &str, depth: u32) -> Option<c_ulong> {
        if depth > 0
            && c.longs(win, "_NET_WM_PID").first() == Some(&pid)
            && c.text(win, "_NET_WM_NAME").as_deref() == Some(title)
        {
            return Some(win);
        }
        if depth >= 3 {
            return None;
        }
        c.children(win).into_iter().find_map(|child| find(c, child, pid, title, depth + 1))
    }
    let c = Conn::open()?;
    find(&c, c.root(), c_ulong::from(std::process::id()), title, 0)
}

/// ShapeBounding (X11/extensions/shape.h): the part of a window that is drawn
/// and takes the mouse.
const SHAPE_BOUNDING: c_int = 0;

/// Cuts `win` down to `rect` (x, y, width, height, in window pixels): only that
/// part is drawn and takes the mouse. `None` gives it its whole area back.
/// False when it could not be done.
pub fn set_shape(win: c_ulong, rect: Option<(i32, i32, u32, u32)>) -> bool {
    set_shape_rects(win, rect.as_ref().map(std::slice::from_ref))
}

/// Cuts `win` down to the union of `rects` (none: nothing of it is drawn).
/// `None` gives it its whole area back. False when it could not be done.
pub fn set_shape_rects(win: c_ulong, rects: Option<&[(i32, i32, u32, u32)]>) -> bool {
    let (Some(c), Some(xf)) = (Conn::open(), xfixes()) else { return false };
    let clamp = |v: i32| v.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16;
    let size = |v: u32| v.min(u32::from(u16::MAX)) as u16;
    unsafe {
        let (mut event_base, mut error_base) = (0, 0);
        if (xf.XFixesQueryExtension)(c.dpy, &mut event_base, &mut error_base) == 0 {
            return false;
        }
        // Window shapes are XFixes 2; a client must say which version it speaks.
        let (mut major, minor) = (5, 0);
        if (xf.XFixesQueryVersion)(c.dpy, &mut major, &minor) == 0 || major < 2 {
            return false;
        }
        let region = match rects {
            Some(rects) => {
                let mut list: Vec<xlib::XRectangle> = rects
                    .iter()
                    .map(|&(x, y, w, h)| xlib::XRectangle { x: clamp(x), y: clamp(y), width: size(w), height: size(h) })
                    .collect();
                (xf.XFixesCreateRegion)(c.dpy, list.as_mut_ptr(), list.len() as c_int)
            }
            // None: the window's own, unshaped area.
            None => 0,
        };
        (xf.XFixesSetWindowShapeRegion)(c.dpy, win, SHAPE_BOUNDING, 0, 0, region);
        if region != 0 {
            (xf.XFixesDestroyRegion)(c.dpy, region);
        }
        (c.x.XSync)(c.dpy, xlib::False);
    }
    true
}

/// What `win` draws, read from its pixels' alpha: a `width` × `height` mask,
/// row by row, of the pixels at least half opaque. An ARGB window keeps its
/// alpha even where no compositing manager runs to use it, so a window cut to
/// this mask (`Painted::rects`) shows what it draws and none of the black that
/// stands in for transparency. None when it cannot be read.
pub fn painted(win: c_ulong) -> Option<Painted> {
    let c = Conn::open()?;
    let (mut root, mut x, mut y, mut width, mut height, mut border, mut depth) = (0, 0, 0, 0, 0, 0, 0);
    let ok = unsafe {
        (c.x.XGetGeometry)(c.dpy, win, &mut root, &mut x, &mut y, &mut width, &mut height, &mut border, &mut depth)
    };
    if ok == 0 || depth != 32 || width == 0 || height == 0 || width > 4096 || height > 4096 {
        return None;
    }
    let image = unsafe { (c.x.XGetImage)(c.dpy, win, 0, 0, width, height, !0, xlib::ZPixmap) };
    if image.is_null() {
        return None;
    }
    // SAFETY: a ZPixmap image of `width` × `height` from the server; read
    // within its rows and destroyed once.
    unsafe {
        let img = &*image;
        let usable = img.bits_per_pixel == 32 && !img.data.is_null() && img.bytes_per_line >= 4 * img.width;
        let painted = usable.then(|| {
            let bytes = std::slice::from_raw_parts(img.data as *const u8, (img.bytes_per_line * img.height) as usize);
            let little = img.byte_order == xlib::LSBFirst;
            let (w, h) = (img.width as usize, img.height as usize);
            let mut mask = Vec::with_capacity(w * h);
            for py in 0..h {
                for px in 0..w {
                    let at = py * img.bytes_per_line as usize + px * 4;
                    mask.push(if little { bytes[at + 3] } else { bytes[at] } >= 128);
                }
            }
            Painted { width: w, height: h, mask }
        });
        (c.x.XDestroyImage)(image);
        painted
    }
}

/// A window's drawn pixels (`painted`).
#[derive(Clone, Debug, PartialEq)]
pub struct Painted {
    pub width: usize,
    pub height: usize,
    /// Row by row: whether the pixel is drawn.
    pub mask: Vec<bool>,
}

impl Painted {
    /// The rectangles covering exactly the drawn pixels.
    pub fn rects(&self) -> Vec<(i32, i32, u32, u32)> {
        alpha_rects(self.width, self.height, |x, y| if self.mask[y * self.width + x] { 255 } else { 0 })
    }
}

/// The rectangles covering every pixel of a `width` × `height` picture whose
/// alpha (`alpha(x, y)`) is at least half: one row's runs at a time, a run
/// that goes on unchanged from the row above growing that rectangle.
pub(crate) fn alpha_rects(
    width: usize,
    height: usize,
    alpha: impl Fn(usize, usize) -> u8,
) -> Vec<(i32, i32, u32, u32)> {
    let mut done: Vec<(i32, i32, u32, u32)> = Vec::new();
    let mut open: Vec<(i32, i32, u32, u32)> = Vec::new();
    for row in 0..height {
        let mut runs = Vec::new();
        let mut col = 0;
        while col < width {
            if alpha(col, row) >= 128 {
                let start = col;
                while col < width && alpha(col, row) >= 128 {
                    col += 1;
                }
                runs.push((start as i32, (col - start) as u32));
            } else {
                col += 1;
            }
        }
        let mut next = Vec::with_capacity(runs.len());
        for (x, w) in runs {
            match open.iter().position(|r| r.0 == x && r.2 == w) {
                Some(i) => {
                    let mut grown = open.swap_remove(i);
                    grown.3 += 1;
                    next.push(grown);
                }
                None => next.push((x, row as i32, w, 1)),
            }
        }
        done.append(&mut open);
        open = next;
    }
    done.append(&mut open);
    done
}

#[cfg(test)]
mod tests {
    use super::alpha_rects;

    #[test]
    fn the_cut_covers_exactly_what_is_drawn() {
        // A small mascot: a body two rows tall, ears above, a faint edge left out.
        let picture = [
            "#....#", //
            "##..##", //
            "######", //
            "######", //
            ".+##+.", // `+` is half-transparent antialiasing: left out
        ];
        let alpha = |x: usize, y: usize| match picture[y].as_bytes()[x] {
            b'#' => 255,
            b'+' => 90,
            _ => 0,
        };
        let rects = alpha_rects(6, 5, alpha);
        let covered = |x: usize, y: usize| {
            rects.iter().any(|&(rx, ry, w, h)| {
                (rx as usize..(rx as usize + w as usize)).contains(&x)
                    && (ry as usize..(ry as usize + h as usize)).contains(&y)
            })
        };
        for y in 0..5 {
            for x in 0..6 {
                assert_eq!(covered(x, y), alpha(x, y) >= 128, "({x}, {y}) in {rects:?}");
            }
        }
        assert!(rects.contains(&(0, 2, 6, 2)), "rows that run on unchanged make one rectangle: {rects:?}");
        assert!(alpha_rects(3, 2, |_, _| 0).is_empty(), "nothing drawn: nothing shown");
        assert_eq!(alpha_rects(3, 2, |_, _| 255), vec![(0, 0, 3, 2)]);
    }
}
