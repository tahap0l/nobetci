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
// Raw events carry the physical button, before the server's button maps; the
// island's page gets the press mapped. So the press that counts is the one the
// maps turn into button 1 — the right-hand button for a left-handed
// `xmodmap -e 'pointer = 3 2 1'` or `xinput set-button-map`. Both maps are read
// at every press. (libinput's own left-handed option swaps the buttons before
// the server sees them, so it needs nothing here.)
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
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};

use tauri::{AppHandle, WebviewWindow};
use x11_dl::xinput::XInput;
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

/// The button the island's page receives for a press of physical `button`.
/// The server applies the device's own map (`xinput set-button-map`) first,
/// then the core pointer's (`xmodmap -e 'pointer = …'`); `map[i]` is what
/// button `i + 1` becomes. An empty map (one that could not be read) changes
/// nothing, nor does a map too short for the button; 0 switches a button off.
fn logical_button(button: u32, device_map: &[u8], core_map: &[u8]) -> u32 {
    let through = |map: &[u8], button: u32| match button {
        0 => 0,
        b => map.get(b as usize - 1).map_or(b, |&to| u32::from(to)),
    };
    through(core_map, through(device_map, button))
}

/// Wheel steps arrive as buttons 4 to 7. They are never the primary click,
/// whatever a map says, and are passed over before the server is asked anything.
fn is_wheel(button: u32) -> bool {
    (4..=7).contains(&button)
}

/// A map buffer that reads "no change" wherever the server writes nothing.
fn identity_map() -> [c_uchar; 255] {
    std::array::from_fn(|i| i as c_uchar + 1)
}

struct Server<'a> {
    x: &'a Xlib,
    xi: &'a XInput2,
    /// XInput 1, for a device's own button map; None when libXi lacks it.
    xi1: Option<&'a XInput>,
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

    /// Whether a press of physical `button` on `source` is the primary click, by
    /// the button maps as they are at the press.
    fn primary(&self, source: c_int, button: u32) -> bool {
        let logical = logical_button(button, &self.device_map(source), &self.core_map());
        if logical == 1 && button != 1 {
            // Once per button: a left-handed set-up is worth a line in the log.
            static NOTED: AtomicU32 = AtomicU32::new(0);
            if NOTED.swap(button, Ordering::Relaxed) != button {
                crate::log::line(format!("input guard: physical button {button} is the primary click (button map)"));
            }
        }
        logical == 1
    }

    /// The core pointer's button map (what xmodmap sets).
    fn core_map(&self) -> Vec<u8> {
        let mut map = identity_map();
        let n = unsafe { (self.x.XGetPointerMapping)(self.dpy, map.as_mut_ptr(), map.len() as c_int) };
        map[..n.clamp(0, map.len() as c_int) as usize].to_vec()
    }

    /// A device's own button map (what `xinput set-button-map` sets); empty when
    /// it cannot be read — a device that is gone fails `physical` anyway.
    fn device_map(&self, id: c_int) -> Vec<u8> {
        let (Some(xi1), Ok(id)) = (self.xi1, c_ulong::try_from(id)) else { return Vec::new() };
        let device = unsafe { (xi1.XOpenDevice)(self.dpy, id) };
        if device.is_null() {
            return Vec::new();
        }
        let mut map = identity_map();
        let n = unsafe { (xi1.XGetDeviceButtonMapping)(self.dpy, device, map.as_mut_ptr(), map.len() as c_uint) };
        unsafe { (xi1.XCloseDevice)(self.dpy, device) };
        map[..n.clamp(0, map.len() as c_int) as usize].to_vec()
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
    // Without XInput 1 a device's own button map stays unread (the core map still counts).
    let xi1 = XInput::open().ok();
    let server = Server { x, xi: &xi, xi1: xi1.as_ref(), dpy, xtest_property };
    crate::log::line(format!("input guard: XInput {major}.{minor}, every press checked against its device"));
    super::set_available(true);

    // The device and physical button behind the press being tracked: only
    // letting go of that button on that device ends it.
    let mut pressed_by: Option<(c_int, u32)> = None;
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
        let (evtype, source, button) = (cookie.evtype, raw.sourceid, u32::try_from(raw.detail).unwrap_or(0));
        unsafe { (x.XFreeEventData)(dpy, cookie) };
        if !ARMED.load(Ordering::Acquire) {
            continue;
        }
        if evtype == xinput2::XI_RawButtonRelease {
            if pressed_by == Some((source, button)) {
                super::release();
            }
            continue;
        }
        // The physical button that the button maps make the primary click.
        if is_wheel(button) || !server.primary(source, button) {
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
        pressed_by = Some((source, button));
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

    #[test]
    fn the_primary_click_is_the_button_the_maps_turn_into_button_1() {
        // Maps that could not be read change nothing: button 1 clicks.
        assert_eq!(logical_button(1, &[], &[]), 1);
        assert_eq!(logical_button(3, &[], &[]), 3);
        // `xmodmap -e 'pointer = 3 2 1'`, the usual left-handed set-up.
        let swapped = [3, 2, 1, 4, 5, 6, 7, 8, 9, 10];
        assert_eq!(logical_button(3, &[], &swapped), 1, "the right-hand button clicks");
        assert_eq!(logical_button(1, &[], &swapped), 3, "the left-hand one opens menus");
        // `xinput set-button-map <device> 3 2 1`: the same for one mouse.
        assert_eq!(logical_button(3, &swapped, &[]), 1);
        assert_eq!(logical_button(1, &swapped, &[1, 2, 3]), 3);
        // Both: the device's map first, then the core pointer's — as X.Org does
        // (measured on Xvfb: device 3 1 2 with core 2 3 1 leaves every button as it was).
        for button in 1..=3 {
            assert_eq!(logical_button(button, &[3, 1, 2], &[2, 3, 1]), button);
        }
        assert_eq!(logical_button(3, &swapped, &swapped), 3, "swapped twice is straight again");
        // A switched-off button, a button past a short map, and no button at all.
        assert_eq!(logical_button(1, &[], &[0, 2, 3]), 0);
        assert_eq!(logical_button(1, &[0, 2, 3], &[]), 0);
        assert_eq!(logical_button(8, &[], &[3, 2, 1]), 8);
        assert_eq!(logical_button(0, &[], &swapped), 0);
        // Wheel steps are never asked about.
        assert!((4..=7).all(is_wheel));
        assert!(![1, 2, 3, 8, 9].into_iter().any(is_wheel));
        assert_eq!(identity_map()[0], 1);
        assert_eq!(identity_map()[254], 255);
    }

    /// The guard's own reading of both maps on a real X server. It changes the
    /// server's button maps, so it runs only by hand, on a throwaway Xvfb:
    /// `DISPLAY=:87 cargo test -p nobetci --lib live_button_maps -- --ignored`.
    #[test]
    #[ignore]
    fn live_button_maps() {
        let x = crate::x11::xlib().expect("libX11");
        let xi = XInput2::open().expect("libXi");
        let xi1 = XInput::open().expect("libXi (XInput 1)");
        let dpy = unsafe { (x.XOpenDisplay)(std::ptr::null()) };
        assert!(!dpy.is_null(), "no X display");
        for code in 1..=255 {
            unsafe { (x.XESetWireToError)(dpy, code, Some(swallow)) };
        }
        let server = Server { x, xi: &xi, xi1: Some(&xi1), dpy, xtest_property: None };
        let mut count = 0;
        let info = unsafe { (xi.XIQueryDevice)(dpy, xinput2::XIAllDevices, &mut count) };
        let devices = unsafe { std::slice::from_raw_parts(info, count as usize) };
        let xtest = devices
            .iter()
            .find(|d| unsafe { CStr::from_ptr(d.name) }.to_bytes() == b"Virtual core XTEST pointer")
            .expect("an XTEST pointer")
            .deviceid;
        unsafe { (xi.XIFreeDeviceInfo)(info) };
        let set_core = |map: &[u8]| {
            let mut full = identity_map()[..server.core_map().len()].to_vec();
            full[..map.len()].copy_from_slice(map);
            assert_eq!(unsafe { (x.XSetPointerMapping)(dpy, full.as_ptr(), full.len() as c_int) }, 0);
        };
        let set_device = |map: &[u8]| {
            let device = unsafe { (xi1.XOpenDevice)(dpy, xtest as c_ulong) };
            assert!(!device.is_null());
            let mut full = identity_map()[..server.device_map(xtest).len()].to_vec();
            full[..map.len()].copy_from_slice(map);
            let rc = unsafe { (xi1.XSetDeviceButtonMapping)(dpy, device, full.as_mut_ptr(), full.len() as c_int) };
            unsafe { (xi1.XCloseDevice)(dpy, device) };
            assert_eq!(rc, 0);
        };
        let primary = |button| server.primary(xtest, button);

        assert!(primary(1) && !primary(3), "identity");
        set_core(&[3, 2, 1]);
        assert_eq!(&server.core_map()[..3], &[3, 2, 1]);
        assert!(primary(3) && !primary(1), "xmodmap pointer = 3 2 1");
        set_core(&[1, 2, 3]);
        set_device(&[3, 2, 1]);
        assert_eq!(&server.device_map(xtest)[..3], &[3, 2, 1]);
        assert!(primary(3) && !primary(1), "xinput set-button-map 3 2 1");
        set_core(&[3, 2, 1]);
        assert!(primary(1) && !primary(3), "both swapped");
        set_device(&[1, 2, 3]);
        set_core(&[1, 2, 3]);
        assert!(primary(1));
        assert!(server.device_map(9999).is_empty(), "no such device: nothing read");
        unsafe { (x.XCloseDisplay)(dpy) };
    }
}
