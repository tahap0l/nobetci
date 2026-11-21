// Linux half of the click guard: XInput 2 raw events.
//
// X11 lets any program of the user's fake input with the XTEST extension, and to
// the page such a click looks real. The X server keeps the two apart, though:
// every event says which device it came from, and XTEST input always comes from
// an XTEST device — "Virtual core XTEST pointer", or "<name> XTEST pointer" for
// a master pointer that a program adds later (`xinput create-master`), which any
// client may do without asking. So a thread listens to raw button presses on the
// root window (no grab, nothing taken from anyone) and, at every press, asks the
// server about the device it came from right then — never a list made earlier.
// An XTEST device (by its name or its "XTEST Device" property), a device the
// server no longer knows, or one whose id changed hands while we asked counts as
// synthetic. Pressing the button through the accessibility bus (AT-SPI) makes no
// mouse event at all.
//
// XInput 2.2 is asked for: from 2.1 on, raw events arrive even while another
// client holds a grab — the implicit one the island's toolkit takes on a click —
// so the release that ends a press is seen too, and Rust measures the hold.
//
// Under a Wayland session the island runs on XWayland, where X11 programs can
// still use XTEST against it, so the same check applies. Input the compositor
// itself injects reaches XWayland as ordinary pointer input, though, and cannot
// be told from a hand on the mouse. GNOME and KDE inject only after a
// remote-desktop prompt; wlroots compositors (sway, Hyprland, river, …) offer a
// virtual-pointer protocol to any client, and there the guard cannot tell.
//
// Coordinates are physical root-window pixels, the space window positions use.

use std::ffi::CStr;
use std::os::raw::{c_char, c_int, c_uchar, c_uint, c_ulong};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

use tauri::{AppHandle, WebviewWindow};
use x11_dl::xinput2::{self, XInput2};
use x11_dl::xlib::{self, Xlib};

use super::Rect;

static ARMED: AtomicBool = AtomicBool::new(false);
/// The XInput extension's opcode, for the event-queue check.
static XI_OPCODE: AtomicI32 = AtomicI32::new(0);

pub fn start(_app: &AppHandle) {
    let started = std::thread::Builder::new().name("input-guard".into()).spawn(|| {
        if let Err(why) = listen() {
            crate::log::line(format!("input guard: {why} — guard off"));
            super::set_available(false);
        }
    });
    if started.is_err() {
        crate::log::line("input guard: could not start its thread — guard off");
    }
}

pub fn arm(on: bool) {
    ARMED.store(on, Ordering::Release);
}

pub fn island_rect(win: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) -> Option<Rect> {
    let pos = win.outer_position().ok()?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let px = |v: f64| (v * scale).round();
    Some(Rect {
        left: pos.x as f64 + px(x),
        top: pos.y as f64 + px(y),
        right: pos.x as f64 + px(x + w),
        bottom: pos.y as f64 + px(y + h),
    })
}

/// An error on the guard's own connection is an answer, not a crash: a device
/// that vanished mid-question fails that question, and the press counts as
/// synthetic. Left alone, Xlib would hand it to the process-wide error handler,
/// which may end the app.
unsafe extern "C" fn swallow(_: *mut xlib::Display, _: *mut xlib::XErrorEvent, _: *mut xlib::xError) -> c_int {
    0
}

/// Picks XI_HierarchyChanged events out of the queue (`XCheckIfEvent`).
unsafe extern "C" fn is_hierarchy_change(_: *mut xlib::Display, event: *mut xlib::XEvent, _: *mut c_char) -> c_int {
    // SAFETY: Xlib hands the predicate a valid queued event.
    let cookie = unsafe { &(*event).generic_event_cookie };
    c_int::from(
        cookie.type_ == xlib::GenericEvent
            && cookie.extension == XI_OPCODE.load(Ordering::Relaxed)
            && cookie.evtype == xinput2::XI_HierarchyChanged,
    )
}

/// What the server says about a device, as the press is judged.
struct Device {
    name: String,
    /// A slave device: real hardware, or an XTEST one.
    slave: bool,
    /// Carries the server's "XTEST Device" property (or could not be asked).
    marked: bool,
}

/// A press came from real hardware: a slave device that is not an XTEST device.
fn is_physical(device: Option<&Device>) -> bool {
    device.is_some_and(|d| d.slave && !d.name.contains("XTEST") && !d.marked)
}

struct Server<'a> {
    x: &'a Xlib,
    xi: &'a XInput2,
    dpy: *mut xlib::Display,
    /// The "XTEST Device" property's atom; None on a server without it.
    xtest_property: Option<c_ulong>,
}

impl Server<'_> {
    /// Whether a press from `id` came from real hardware, asked at the moment of
    /// the press. A device the server no longer knows counts as synthetic, and so
    /// does any press judged while the device hierarchy changed: the answer may
    /// then describe another device that got the same id.
    fn physical(&self, id: c_int) -> bool {
        let device = self.device(id);
        if self.hierarchy_changed() {
            crate::log::line("input guard: the input devices changed while a press was judged — counted as synthetic");
            return false;
        }
        let physical = is_physical(device.as_ref());
        if !physical {
            let name = device.map_or_else(|| "?".to_string(), |d| d.name);
            crate::log::line(format!("input guard: a press from device {id} ({name}) counts as synthetic"));
        }
        physical
    }

    fn device(&self, id: c_int) -> Option<Device> {
        let mut count = 0;
        // Every device at once: asking for one id the server no longer has would
        // be an error rather than an answer.
        let info = unsafe { (self.xi.XIQueryDevice)(self.dpy, xinput2::XIAllDevices, &mut count) };
        if info.is_null() {
            return None;
        }
        // SAFETY: the server returned `count` entries, freed below.
        let devices = unsafe { std::slice::from_raw_parts(info, count.max(0) as usize) };
        let device = devices.iter().find(|d| d.deviceid == id).map(|d| Device {
            name: if d.name.is_null() {
                String::new()
            } else {
                unsafe { CStr::from_ptr(d.name) }.to_string_lossy().into_owned()
            },
            slave: matches!(d._use, xinput2::XISlavePointer | xinput2::XISlaveKeyboard | xinput2::XIFloatingSlave),
            marked: false,
        });
        unsafe { (self.xi.XIFreeDeviceInfo)(info) };
        device.map(|d| Device { marked: self.xtest_marked(id), ..d })
    }

    /// The server marks every XTEST device with an "XTEST Device" property that
    /// nobody can remove. A device that cannot be asked counts as marked.
    fn xtest_marked(&self, id: c_int) -> bool {
        let Some(property) = self.xtest_property else { return false };
        let (mut kind, mut format, mut items, mut after): (c_ulong, c_int, c_ulong, c_ulong) = (0, 0, 0, 0);
        let mut data: *mut c_uchar = std::ptr::null_mut();
        let rc = unsafe {
            (self.xi.XIGetProperty)(
                self.dpy,
                id,
                property,
                0,
                1,
                xlib::False,
                xlib::AnyPropertyType as c_ulong,
                &mut kind,
                &mut format,
                &mut items,
                &mut after,
                &mut data,
            )
        };
        if !data.is_null() {
            unsafe { (self.x.XFree)(data.cast()) };
        }
        rc != xlib::Success as c_int || kind != 0
    }

    /// Whether a hierarchy change sits in the queue: one the server made after the
    /// press being judged, since events arrive in order and our questions' replies
    /// came in behind them. Taken off the queue — nothing else needs them.
    fn hierarchy_changed(&self) -> bool {
        let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
        let mut changed = false;
        while unsafe { (self.x.XCheckIfEvent)(self.dpy, &mut event, Some(is_hierarchy_change), std::ptr::null_mut()) }
            != 0
        {
            changed = true;
        }
        changed
    }
}

/// One mask byte array with `events` set.
fn mask_bits(events: &[c_int]) -> [c_uchar; 4] {
    let mut bits = [0 as c_uchar; 4];
    for event in events {
        bits[(event >> 3) as usize] |= 1 << (event & 7);
    }
    bits
}

fn listen() -> Result<(), &'static str> {
    let x = crate::x11::xlib().ok_or("no libX11")?;
    let xi = XInput2::open().map_err(|_| "no libXi")?;
    let dpy = unsafe { (x.XOpenDisplay)(std::ptr::null()) };
    if dpy.is_null() {
        return Err("no X display (a Wayland session without XWayland?)");
    }
    for code in 1..=255 {
        unsafe { (x.XESetWireToError)(dpy, code, Some(swallow)) };
    }
    let (mut opcode, mut first_event, mut first_error) = (0, 0, 0);
    let name = c"XInputExtension";
    if unsafe { (x.XQueryExtension)(dpy, name.as_ptr(), &mut opcode, &mut first_event, &mut first_error) } == 0 {
        return Err("the X server has no XInput extension");
    }
    XI_OPCODE.store(opcode, Ordering::Relaxed);
    let (mut major, mut minor) = (2, 2);
    if unsafe { (xi.XIQueryVersion)(dpy, &mut major, &mut minor) } != xlib::Success as c_int || major < 2 {
        return Err("the X server has no XInput 2");
    }
    if minor < 1 {
        crate::log::line(format!(
            "input guard: XInput {major}.{minor} only — a release during the island's own grab may go unseen"
        ));
    }
    let root = unsafe { (x.XDefaultRootWindow)(dpy) };
    let mut raw = mask_bits(&[xinput2::XI_RawButtonPress, xinput2::XI_RawButtonRelease]);
    let mut hierarchy = mask_bits(&[xinput2::XI_HierarchyChanged]);
    let mut masks = [
        // Raw events from every master pointer, including ones added later.
        xinput2::XIEventMask {
            deviceid: xinput2::XIAllMasterDevices,
            mask_len: raw.len() as c_int,
            mask: raw.as_mut_ptr(),
        },
        // Hierarchy changes are only ever selected for all devices.
        xinput2::XIEventMask {
            deviceid: xinput2::XIAllDevices,
            mask_len: hierarchy.len() as c_int,
            mask: hierarchy.as_mut_ptr(),
        },
    ];
    unsafe {
        (xi.XISelectEvents)(dpy, root, masks.as_mut_ptr(), masks.len() as c_int);
        (x.XSync)(dpy, xlib::False);
    }
    let atom = c"XTEST Device";
    let xtest_property = match unsafe { (x.XInternAtom)(dpy, atom.as_ptr(), xlib::True) } {
        0 => None,
        atom => Some(atom),
    };
    let server = Server { x, xi: &xi, dpy, xtest_property };
    crate::log::line(format!("input guard: XInput {major}.{minor}, every press checked against its device"));
    super::set_available(true);

    // The device behind the press being tracked: only it can let go of it.
    let mut pressed_by: Option<c_int> = None;
    loop {
        let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
        unsafe { (x.XNextEvent)(dpy, &mut event) };
        let cookie = unsafe { &mut event.generic_event_cookie };
        // Hierarchy changes matter only while a press is judged (`physical`).
        if cookie.type_ != xlib::GenericEvent
            || cookie.extension != opcode
            || cookie.evtype == xinput2::XI_HierarchyChanged
        {
            continue;
        }
        if unsafe { (x.XGetEventData)(dpy, cookie) } == 0 {
            continue;
        }
        let raw = unsafe { &*(cookie.data as *const xinput2::XIRawEvent) };
        let (evtype, source, button) = (cookie.evtype, raw.sourceid, raw.detail);
        unsafe { (x.XFreeEventData)(dpy, cookie) };
        if button != 1 || !ARMED.load(Ordering::Acquire) {
            continue;
        }
        if evtype == xinput2::XI_RawButtonRelease {
            if pressed_by == Some(source) {
                super::release();
            }
            continue;
        }
        // Raw events carry no position; the pointer has not moved since.
        let (mut root_ret, mut child): (c_ulong, c_ulong) = (0, 0);
        let (mut rx, mut ry, mut wx, mut wy) = (0, 0, 0, 0);
        let mut state: c_uint = 0;
        let found = unsafe {
            (x.XQueryPointer)(dpy, root, &mut root_ret, &mut child, &mut rx, &mut ry, &mut wx, &mut wy, &mut state)
        };
        let (px, py) = if found != 0 { (rx as f64, ry as f64) } else { (f64::NAN, f64::NAN) };
        pressed_by = Some(source);
        super::record(server.physical(source), px, py);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(name: &str, slave: bool, marked: bool) -> Device {
        Device { name: name.into(), slave, marked }
    }

    #[test]
    fn only_real_slave_devices_are_physical() {
        assert!(is_physical(Some(&device("Logitech USB Optical Mouse", true, false))));
        assert!(is_physical(Some(&device("xwayland-pointer:13", true, false))));
        assert!(!is_physical(Some(&device("Virtual core XTEST pointer", true, true))));
        // Added later by a program: caught by its name and by its property alike.
        assert!(!is_physical(Some(&device("evil XTEST pointer", true, false))));
        assert!(!is_physical(Some(&device("innocent pointer", true, true))));
        // A master never generates a press itself; the server no longer knowing
        // the device at all is no better.
        assert!(!is_physical(Some(&device("Virtual core pointer", false, false))));
        assert!(!is_physical(None));
    }

    #[test]
    fn masks_set_the_right_bits() {
        let bits = mask_bits(&[xinput2::XI_RawButtonPress, xinput2::XI_RawButtonRelease]);
        assert_eq!(bits, [0, 1 << 7, 1, 0], "events 15 and 16");
        assert_eq!(mask_bits(&[xinput2::XI_HierarchyChanged]), [0, 1 << 3, 0, 0], "event 11");
    }
}
