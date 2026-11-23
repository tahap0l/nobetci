// Linux half of the click guard: XInput 2 raw events.
//
// X11 lets any program of the user's fake input with the XTEST extension, and to
// the page such a click looks real. What the guard can tell: every raw event
// names the device it came from, and the usual way to fake a click — XTEST's
// core request, which xdotool, xte and most tools use — presses through an XTEST
// device: "Virtual core XTEST pointer", or "<name> XTEST pointer" for a master
// pointer a program adds later (`xinput create-master`), which any client may do
// without asking. So a thread listens to raw button presses on the root window
// (no grab, nothing taken from anyone) and, at every press, asks the server about
// the device it came from right then — never a list made earlier. An XTEST
// device (by its name or its "XTEST Device" property), a device the server no
// longer knows, or one whose id changed hands while we asked counts as
// synthetic. Pressing the button through the accessibility bus (AT-SPI) makes no
// mouse event at all.
//
// What it cannot tell: XTEST also takes a device to press through
// (XTestFakeDeviceButtonEvent on a device opened with XOpenDevice), and then the
// server posts the press through that device, the real mouse included. Such a
// press names the real mouse as its source, and nothing in it — no flag, no
// property — sets it apart from a hand on that mouse. So this half cannot vouch
// for a press (`VOUCHES_FOR_HOLDS` is false): HIGH and CRITICAL requests, the
// ones that need a hold, are never approved on the island on Linux and are
// decided in the terminal (D23). For LOW and MEDIUM the check stays as a speed
// bump that stops the common tools, nothing more.
//
// XInput 2.2 is asked for: from 2.1 on, raw events arrive even while another
// client holds a grab — the implicit one the island's toolkit takes on a click —
// so the release that ends a press is seen too, and Rust measures the hold.
//
// Raw events carry the physical button, before the server's button maps; the
// island's page gets the press mapped. So the real press that counts is the one
// the maps turn into button 1 — the right-hand button for a left-handed
// `xmodmap -e 'pointer = 3 2 1'` or `xinput set-button-map`. (libinput's own
// left-handed option swaps the buttons before the server sees them, so it needs
// nothing here.) The maps that matter are the ones in force at the press, and
// the guard can only read them afterwards. The server tells this connection of
// every later change, in order with the presses: a core MappingNotify for its
// master pointer's map, and XInput 1's DeviceMappingNotify for a device's own
// map once the guard has asked for it — which it does for every pointer device,
// keeping each open (closing one would end that). Neither notice carries the
// new map, but one waiting in the queue behind a press means the maps just read
// may be newer than the press. So the maps read are the press's own unless such
// a notice waits behind it, or the press came before the guard was watching its
// device; a press judged under maps that may have moved backs no approval.
//
// A press from a device that is not physical is recorded whatever its button,
// wheel steps included: it replaces the last press, so a program can neither
// click with a button that a map makes the primary one (a wheel button mapped
// to 1 too) nor change a map behind its own click, and its click never rides on
// an earlier real one. Only a real wheel step is passed over. The guard follows
// every button a program holds until it is let go, by device and button, so a
// real press made while one is still down cannot vouch for the click its
// release makes (`inputguard`).
// The pointer is asked where it is as soon as a press arrives, before the
// device and maps are: a program that moves it right after a real press has
// less time to put that press on our button.
//
// The core map read is the guard's own client pointer's, the first master
// pointer's. A press through a second master pointer (`xinput create-master`)
// is judged by it too: its XTEST presses are refused whatever their button.
//
// Under a Wayland session the island runs on XWayland, where X11 programs can
// still use XTEST against it, so the same check applies. Input the compositor
// itself injects reaches XWayland as ordinary pointer input, though, and cannot
// be told from a hand on the mouse. GNOME and KDE inject only after a
// remote-desktop prompt; wlroots compositors (sway, Hyprland, river, …) offer a
// virtual-pointer protocol to any client, and there the guard cannot tell.
//
// Coordinates are physical root-window pixels, the space window positions use.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::CStr;
use std::os::raw::{c_char, c_int, c_uchar, c_uint, c_ulong};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};

use tauri::{AppHandle, WebviewWindow};
use x11_dl::xinput::{XDevice, XInput};
use x11_dl::xinput2::{self, XInput2};
use x11_dl::xlib::{self, Xlib};

use super::Rect;

/// A program can press through the real mouse device here (see above): the
/// guard cannot vouch for a hold, and the island approves none (D23).
pub const VOUCHES_FOR_HOLDS: bool = false;

static ARMED: AtomicBool = AtomicBool::new(false);
/// The XInput extension's opcode, for the event-queue check.
static XI_OPCODE: AtomicI32 = AtomicI32::new(0);
/// The event type XInput 1's DeviceMappingNotify arrives as on the guard's
/// connection, once a device is watched; -1 matches no event.
static DEVICE_MAPPING_NOTIFY: AtomicI32 = AtomicI32::new(-1);

/// XInput 1's class whose event base DeviceMappingNotify counts from
/// (`OtherClass`, XI.h), and its place there (`_deviceMappingNotify`, XInput.h).
const OTHER_CLASS: c_uchar = 6;
const MAPPING_OFFSET: c_uchar = 1;

/// XInput 1's DeviceMappingNotify as libXi hands it over (`XDeviceMappingEvent`,
/// XInput.h); x11-dl has no binding for it.
#[repr(C)]
struct XDeviceMappingEvent {
    type_: c_int,
    serial: c_ulong,
    send_event: xlib::Bool,
    display: *mut xlib::Display,
    window: xlib::Window,
    deviceid: xlib::XID,
    time: xlib::Time,
    request: c_int,
    first_keycode: c_int,
    count: c_int,
}

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

/// Notes a change to a pointer button map waiting in the queue — the core
/// pointer's or a device's own — and takes nothing: `XCheckIfEvent` leaves every
/// event the predicate does not pick.
unsafe extern "C" fn notes_pointer_mapping(
    _: *mut xlib::Display,
    event: *mut xlib::XEvent,
    seen: *mut c_char,
) -> c_int {
    // SAFETY: Xlib hands the predicate a valid queued event; one of
    // DeviceMappingNotify's type was laid out by libXi as XDeviceMappingEvent,
    // which fits in an XEvent. `seen` is the flag `Server::maps_moved` passes in.
    unsafe {
        let kind = (*event).get_type();
        let request = if kind == xlib::MappingNotify {
            (*event).mapping.request
        } else if kind == DEVICE_MAPPING_NOTIFY.load(Ordering::Relaxed) {
            (*event.cast::<XDeviceMappingEvent>()).request
        } else {
            return 0;
        };
        if request == xlib::MappingPointer {
            *seen.cast::<bool>() = true;
        }
    }
    0
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

/// Wheel steps arrive as buttons 4 to 7. A real one is never the primary click,
/// whatever a map says, and is passed over before the maps are asked about.
fn is_wheel(button: u32) -> bool {
    (4..=7).contains(&button)
}

/// A map buffer that reads "no change" wherever the server writes nothing.
fn identity_map() -> [c_uchar; 255] {
    std::array::from_fn(|i| i as c_uchar + 1)
}

/// What a press of physical `button` stands for, from what the server says,
/// asked only as far as needed: None when it is no click at all (a real wheel
/// step, a real press of another button); otherwise whether it can back an
/// approval. A program's press counts whatever its button, wheel buttons
/// included — as one that backs nothing, so it replaces the last press — and
/// so does a real one judged under button maps that may have moved (`primary`
/// is None).
fn verdict(button: u32, physical: impl FnOnce() -> bool, primary: impl FnOnce() -> Option<bool>) -> Option<bool> {
    if !physical() {
        return Some(false);
    }
    if is_wheel(button) {
        return None;
    }
    match primary() {
        Some(true) => Some(true),
        Some(false) => None,
        None => Some(false),
    }
}

/// A pointer device whose button map the guard follows: opened through
/// XInput 1, and told about from the request serial `since` on.
struct Watched {
    device: *mut XDevice,
    since: c_ulong,
}

struct Server<'a> {
    x: &'a Xlib,
    xi: &'a XInput2,
    /// XInput 1, for a device's own button map; None when libXi lacks it.
    xi1: Option<&'a XInput>,
    dpy: *mut xlib::Display,
    root: c_ulong,
    /// The "XTEST Device" property's atom; None on a server without it.
    xtest_property: Option<c_ulong>,
    /// Every pointer device there is, by id, kept open (`watch_devices`).
    watched: RefCell<HashMap<c_int, Watched>>,
}

impl<'a> Server<'a> {
    fn new(
        x: &'a Xlib,
        xi: &'a XInput2,
        xi1: Option<&'a XInput>,
        dpy: *mut xlib::Display,
        xtest_property: Option<c_ulong>,
    ) -> Self {
        let root = unsafe { (x.XDefaultRootWindow)(dpy) };
        let server = Server { x, xi, xi1, dpy, root, xtest_property, watched: RefCell::default() };
        server.watch_devices();
        server
    }

    /// Asks the server to tell this connection whenever the button map of a
    /// pointer device changes (DeviceMappingNotify), for every such device
    /// there is now. Run at the start and after every change of the device
    /// hierarchy: each device is let go and opened again, so one that went away
    /// is dropped and one that came — under an old id or a new one — is
    /// followed from now on, and `since` says from when.
    fn watch_devices(&self) {
        let Some(xi1) = self.xi1 else { return };
        let mut watched = self.watched.borrow_mut();
        for (_, gone) in watched.drain() {
            unsafe { (xi1.XCloseDevice)(self.dpy, gone.device) };
        }
        let mut count = 0;
        let info = unsafe { (self.xi.XIQueryDevice)(self.dpy, xinput2::XIAllDevices, &mut count) };
        if info.is_null() {
            return;
        }
        // SAFETY: the server returned `count` entries, freed right after.
        let pointers: Vec<c_int> = unsafe { std::slice::from_raw_parts(info, count.max(0) as usize) }
            .iter()
            .filter(|d| matches!(d._use, xinput2::XISlavePointer | xinput2::XIFloatingSlave))
            .map(|d| d.deviceid)
            .collect();
        unsafe { (self.xi.XIFreeDeviceInfo)(info) };
        for id in pointers {
            let Ok(xid) = c_ulong::try_from(id) else { continue };
            let device = unsafe { (xi1.XOpenDevice)(self.dpy, xid) };
            if device.is_null() {
                continue;
            }
            // The event's type and class as XInput.h's
            // FindTypeAndClass(…, OtherClass, _deviceMappingNotify) works them out.
            // SAFETY: libXi filled in `num_classes` entries.
            let classes =
                unsafe { std::slice::from_raw_parts((*device).classes, (*device).num_classes.max(0) as usize) };
            let Some(base) = classes.iter().find(|c| c.input_class == OTHER_CLASS).map(|c| c.event_type_base) else {
                unsafe { (xi1.XCloseDevice)(self.dpy, device) };
                continue;
            };
            let kind = base.wrapping_add(MAPPING_OFFSET);
            DEVICE_MAPPING_NOTIFY.store(c_int::from(kind), Ordering::Relaxed);
            let mut class = (xid << 8) | c_ulong::from(kind);
            let since = unsafe { (self.x.XNextRequest)(self.dpy) };
            unsafe { (xi1.XSelectExtensionEvent)(self.dpy, self.root, &mut class, 1) };
            watched.insert(id, Watched { device, since });
        }
    }

    /// What a press of physical `button` on `source` stands for (`verdict`),
    /// the device and the maps asked about at the moment it is judged.
    /// `serial` is the press event's: the last request of ours the server had
    /// dealt with when it made the event.
    fn judge_press(&self, source: c_int, button: u32, serial: c_ulong) -> Option<bool> {
        verdict(button, || self.physical(source), || self.primary(source, button, serial))
    }

    /// Whether a press from `id` came from real hardware, asked at the moment of
    /// the press. A device the server no longer knows counts as synthetic, and so
    /// does any press judged while the device hierarchy changed: the answer may
    /// then describe another device that got the same id.
    fn physical(&self, id: c_int) -> bool {
        let device = self.device(id);
        if self.hierarchy_changed() {
            crate::log::line("input guard: the input devices changed while a press was judged — counted as synthetic");
            self.watch_devices();
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
    /// the button maps in force at the press; None when they cannot be known:
    /// a map changed after the press (the maps just read may be newer), or the
    /// press came before the server was telling us about its device's map.
    fn primary(&self, source: c_int, button: u32, serial: c_ulong) -> Option<bool> {
        let device_map = match self.xi1 {
            // Never seen: XInput 1 ships in the same libXi as XInput 2. Without
            // it a device's own map stays unread and only the core map counts.
            None => Vec::new(),
            Some(_) => match self.device_map(source, serial) {
                Some(map) => map,
                None => {
                    crate::log::line(format!(
                        "input guard: a press from device {source} came before its button map was followed — it backs no approval"
                    ));
                    return None;
                }
            },
        };
        let logical = logical_button(button, &device_map, &self.core_map());
        if self.maps_moved() {
            crate::log::line("input guard: a button map changed right after a press — the press backs no approval");
            return None;
        }
        if logical == 1 && button != 1 {
            // Once per button: a left-handed set-up is worth a line in the log.
            static NOTED: AtomicU32 = AtomicU32::new(0);
            if NOTED.swap(button, Ordering::Relaxed) != button {
                crate::log::line(format!("input guard: physical button {button} is the primary click (button map)"));
            }
        }
        Some(logical == 1)
    }

    /// Whether a pointer button map changed after the press being judged: its
    /// MappingNotify or DeviceMappingNotify waits in the queue, sent after the
    /// press and before the replies to our reads of the maps, which Xlib queued
    /// it in front of. Left in the queue for the loop, which passes over it.
    fn maps_moved(&self) -> bool {
        let mut seen = false;
        let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
        let flag = std::ptr::addr_of_mut!(seen).cast::<c_char>();
        unsafe { (self.x.XCheckIfEvent)(self.dpy, &mut event, Some(notes_pointer_mapping), flag) };
        seen
    }

    /// The core pointer's button map (what xmodmap sets).
    fn core_map(&self) -> Vec<u8> {
        let mut map = identity_map();
        let n = unsafe { (self.x.XGetPointerMapping)(self.dpy, map.as_mut_ptr(), map.len() as c_int) };
        map[..n.clamp(0, map.len() as c_int) as usize].to_vec()
    }

    /// A device's own button map (what `xinput set-button-map` sets), read
    /// through the handle `watch_devices` keeps open; empty when it cannot be
    /// read (a device that is gone fails `physical` anyway). None when the
    /// device is not watched, or was not yet when the press of `serial` was made.
    fn device_map(&self, id: c_int, serial: c_ulong) -> Option<Vec<u8>> {
        let xi1 = self.xi1?;
        let device = self.watched.borrow().get(&id).filter(|w| serial >= w.since)?.device;
        let mut map = identity_map();
        let n = unsafe { (xi1.XGetDeviceButtonMapping)(self.dpy, device, map.as_mut_ptr(), map.len() as c_uint) };
        Some(map[..n.clamp(0, map.len() as c_int) as usize].to_vec())
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
    if xi1.is_none() {
        crate::log::line("input guard: no XInput 1 — a device's own button map is not followed");
    }
    let server = Server::new(x, &xi, xi1.as_ref(), dpy, xtest_property);
    crate::log::line(format!("input guard: XInput {major}.{minor}, every press checked against its device"));
    super::set_available(true);

    // The device and physical button behind the last press: only letting go of
    // that button on that device ends it.
    let mut pressed_by: Option<(c_int, u32)> = None;
    loop {
        let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
        unsafe { (x.XNextEvent)(dpy, &mut event) };
        let cookie = unsafe { &mut event.generic_event_cookie };
        // Map notices only matter behind a press being judged (`maps_moved`).
        if cookie.type_ != xlib::GenericEvent || cookie.extension != opcode {
            continue;
        }
        // Devices came or went: follow the button maps of the ones there are now.
        // (While a press is judged, `physical` sees such a change first.)
        if cookie.evtype == xinput2::XI_HierarchyChanged {
            server.watch_devices();
            continue;
        }
        if unsafe { (x.XGetEventData)(dpy, cookie) } == 0 {
            continue;
        }
        let raw = unsafe { &*(cookie.data as *const xinput2::XIRawEvent) };
        let (evtype, source, button, serial) =
            (cookie.evtype, raw.sourceid, u32::try_from(raw.detail).unwrap_or(0), raw.serial);
        unsafe { (x.XFreeEventData)(dpy, cookie) };
        if !ARMED.load(Ordering::Acquire) {
            continue;
        }
        if evtype == xinput2::XI_RawButtonRelease {
            if pressed_by == Some((source, button)) {
                super::release_last();
            }
            super::program_up(held_key(source, button));
            continue;
        }
        // Raw events carry no position. Asked first, before the device and the
        // maps, so a program that moves the pointer once a real press arrives
        // has the least time to put that press on our button.
        let (px, py) = pointer(x, dpy, root);
        let Some(backs) = server.judge_press(source, button, serial) else { continue };
        pressed_by = Some((source, button));
        if !backs {
            // Some(false) is a program's press, or a real one judged under maps
            // that may have moved; either way it backs nothing, and following
            // it as a program's until it is let go only ever refuses more.
            super::program_down(held_key(source, button));
        }
        super::record(backs, px, py);
    }
}

/// The guard's key for a button held on a device (`inputguard::program_down`).
fn held_key(source: c_int, button: u32) -> u64 {
    (u64::from(source as u32) << 32) | u64::from(button)
}

/// Where the pointer is now, in root-window pixels; NaN when it is on another
/// screen.
fn pointer(x: &Xlib, dpy: *mut xlib::Display, root: c_ulong) -> (f64, f64) {
    let (mut root_ret, mut child): (c_ulong, c_ulong) = (0, 0);
    let (mut rx, mut ry, mut wx, mut wy) = (0, 0, 0, 0);
    let mut state: c_uint = 0;
    let found = unsafe {
        (x.XQueryPointer)(dpy, root, &mut root_ret, &mut child, &mut rx, &mut ry, &mut wx, &mut wy, &mut state)
    };
    if found != 0 {
        (rx as f64, ry as f64)
    } else {
        (f64::NAN, f64::NAN)
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

    #[test]
    fn a_program_s_press_is_recorded_whatever_its_button() {
        let never = || -> Option<bool> { panic!("the maps are not asked about") };
        // A program's press replaces the last one, as one that backs nothing:
        // even a button that is not the click, under any map — a wheel button
        // too, which a map can make button 1 (`pointer = 4 2 3 1`).
        for button in [1, 2, 3, 4, 5, 6, 7, 8, 9] {
            assert_eq!(verdict(button, || false, never), Some(false), "button {button}");
        }
        // A real press: the primary click backs an approval, another button is no click.
        assert_eq!(verdict(1, || true, || Some(true)), Some(true));
        assert_eq!(verdict(3, || true, || Some(false)), None);
        // Maps that may have moved behind it: recorded, backing nothing.
        assert_eq!(verdict(1, || true, || None), Some(false));
        // A real wheel step is passed over before the maps are asked.
        for button in 4..=7 {
            assert_eq!(verdict(button, || true, never), None, "button {button}");
        }
    }

    #[test]
    fn each_device_and_button_is_held_apart() {
        // A program's held button is let go only by a release of that button on
        // that device: no other release may stand in for it.
        let keys = [held_key(4, 1), held_key(4, 3), held_key(6, 1), held_key(10, 1), held_key(c_int::MAX, 255)];
        for (i, a) in keys.iter().enumerate() {
            for b in &keys[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    /// A connection to the X server of the live tests, its errors swallowed as
    /// the guard's are.
    fn live_display(x: &Xlib) -> *mut xlib::Display {
        let dpy = unsafe { (x.XOpenDisplay)(std::ptr::null()) };
        assert!(!dpy.is_null(), "no X display");
        for code in 1..=255 {
            unsafe { (x.XESetWireToError)(dpy, code, Some(swallow)) };
        }
        dpy
    }

    /// The id of the server's own XTEST pointer, a device of the first master.
    fn xtest_pointer(xi: &XInput2, dpy: *mut xlib::Display) -> c_int {
        let mut count = 0;
        let info = unsafe { (xi.XIQueryDevice)(dpy, xinput2::XIAllDevices, &mut count) };
        let devices = unsafe { std::slice::from_raw_parts(info, count as usize) };
        let id = devices
            .iter()
            .find(|d| unsafe { CStr::from_ptr(d.name) }.to_bytes() == b"Virtual core XTEST pointer")
            .expect("an XTEST pointer")
            .deviceid;
        unsafe { (xi.XIFreeDeviceInfo)(info) };
        id
    }

    /// Everything the server has sent so far, read and dropped.
    fn drain(x: &Xlib, dpy: *mut xlib::Display) {
        unsafe { (x.XSync)(dpy, xlib::False) };
        let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
        while unsafe { (x.XPending)(dpy) } > 0 {
            unsafe { (x.XNextEvent)(dpy, &mut event) };
        }
    }

    /// Sets the first `map.len()` buttons of the core pointer's map (what
    /// xmodmap sets) and of a device's own (what `xinput set-button-map` sets).
    fn set_core(x: &Xlib, dpy: *mut xlib::Display, map: &[u8]) {
        let mut full = identity_map();
        let n = unsafe { (x.XGetPointerMapping)(dpy, full.as_mut_ptr(), full.len() as c_int) };
        let mut full = identity_map()[..n as usize].to_vec();
        full[..map.len()].copy_from_slice(map);
        assert_eq!(unsafe { (x.XSetPointerMapping)(dpy, full.as_ptr(), full.len() as c_int) }, 0);
    }

    fn set_device(xi1: &XInput, dpy: *mut xlib::Display, id: c_int, map: &[u8]) {
        let device = unsafe { (xi1.XOpenDevice)(dpy, id as c_ulong) };
        assert!(!device.is_null());
        let mut full = identity_map();
        let n = unsafe { (xi1.XGetDeviceButtonMapping)(dpy, device, full.as_mut_ptr(), full.len() as c_uint) };
        let mut full = identity_map()[..n as usize].to_vec();
        full[..map.len()].copy_from_slice(map);
        let rc = unsafe { (xi1.XSetDeviceButtonMapping)(dpy, device, full.as_mut_ptr(), full.len() as c_int) };
        unsafe { (xi1.XCloseDevice)(dpy, device) };
        assert_eq!(rc, 0);
    }

    /// A serial no press comes after: for judging maps outside the event stream.
    const LATER: c_ulong = c_ulong::MAX;

    /// The guard's own reading of both maps on a real X server. It changes the
    /// server's button maps, so it runs only by hand, on a throwaway Xvfb
    /// started with `-noreset`:
    /// `DISPLAY=:87 cargo test -p nobetci --lib live_ -- --ignored --test-threads=1`.
    #[test]
    #[ignore]
    fn live_button_maps() {
        let x = crate::x11::xlib().expect("libX11");
        let xi = XInput2::open().expect("libXi");
        let xi1 = XInput::open().expect("libXi (XInput 1)");
        // The maps change from another connection, as xmodmap and xinput would:
        // closing a device on the guard's own would end what it follows.
        let (dpy, program) = (live_display(x), live_display(x));
        let xtest = xtest_pointer(&xi, dpy);
        set_device(&xi1, program, xtest, &[1, 2, 3]);
        set_core(x, program, &[1, 2, 3]);
        unsafe { (x.XSync)(program, xlib::False) };
        let server = Server::new(x, &xi, Some(&xi1), dpy, None);
        drain(x, dpy);
        // Each change sends the guard a notice; read it before the next
        // judgement, as the guard's loop would have.
        let set_core = |map: &[u8]| {
            set_core(x, program, map);
            unsafe { (x.XSync)(program, xlib::False) };
            drain(x, dpy);
        };
        let set_device = |map: &[u8]| {
            set_device(&xi1, program, xtest, map);
            unsafe { (x.XSync)(program, xlib::False) };
            drain(x, dpy);
        };
        let primary = |button| server.primary(xtest, button, LATER);

        assert_eq!((primary(1), primary(3)), (Some(true), Some(false)), "identity");
        set_core(&[3, 2, 1]);
        assert_eq!(&server.core_map()[..3], &[3, 2, 1]);
        assert_eq!((primary(3), primary(1)), (Some(true), Some(false)), "xmodmap pointer = 3 2 1");
        set_core(&[1, 2, 3]);
        set_device(&[3, 2, 1]);
        assert_eq!(&server.device_map(xtest, LATER).unwrap_or_default()[..3], &[3, 2, 1]);
        assert_eq!((primary(3), primary(1)), (Some(true), Some(false)), "xinput set-button-map 3 2 1");
        set_core(&[3, 2, 1]);
        assert_eq!((primary(1), primary(3)), (Some(true), Some(false)), "both swapped");
        set_device(&[1, 2, 3]);
        set_core(&[1, 2, 3]);
        assert_eq!(primary(1), Some(true));
        assert_eq!(server.device_map(9999, LATER), None, "no such device: not followed");
        assert_eq!(server.device_map(xtest, 0), None, "a press from before it was followed");
        unsafe {
            (x.XCloseDisplay)(program);
            (x.XCloseDisplay)(dpy);
        }
    }

    /// The verifier's case: a program presses button 1 and swaps the maps in
    /// the same breath, so that by the time the guard reads them button 1 is no
    /// longer the click the page got. Two connections, as in real life: the
    /// guard's, listening to raw presses, and the program's.
    #[test]
    #[ignore]
    fn live_a_map_changed_behind_a_press() {
        let x = crate::x11::xlib().expect("libX11");
        let xi = XInput2::open().expect("libXi");
        let xi1 = XInput::open().expect("libXi (XInput 1)");
        let xtst = x11_dl::xtest::Xf86vmode::open().expect("libXtst");
        let (guard, program) = (live_display(x), live_display(x));
        let (mut opcode, mut event_base, mut error_base) = (0, 0, 0);
        let name = c"XInputExtension";
        assert_ne!(
            unsafe { (x.XQueryExtension)(guard, name.as_ptr(), &mut opcode, &mut event_base, &mut error_base) },
            0
        );
        let (mut major, mut minor) = (2, 2);
        assert_eq!(unsafe { (xi.XIQueryVersion)(guard, &mut major, &mut minor) }, xlib::Success as c_int);
        let mut raw = mask_bits(&[xinput2::XI_RawButtonPress, xinput2::XI_RawButtonRelease]);
        let mut mask = xinput2::XIEventMask {
            deviceid: xinput2::XIAllMasterDevices,
            mask_len: raw.len() as c_int,
            mask: raw.as_mut_ptr(),
        };
        unsafe {
            (xi.XISelectEvents)(guard, (x.XDefaultRootWindow)(guard), &mut mask, 1);
        }
        drain(x, guard);
        let server = Server::new(x, &xi, Some(&xi1), guard, None);
        let xtest = xtest_pointer(&xi, guard);
        // The program clicks `button`, then runs `then`, all before the guard reads a thing.
        let click_then = |button: c_uint, then: &dyn Fn()| {
            unsafe {
                (xtst.XTestFakeButtonEvent)(program, button, xlib::True, 0);
                (xtst.XTestFakeButtonEvent)(program, button, xlib::False, 0);
            }
            then();
            unsafe { (x.XSync)(program, xlib::False) };
        };
        // The guard's loop: events in order, up to the next raw press.
        let next_press = || -> (c_int, u32, c_ulong) {
            loop {
                let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
                unsafe { (x.XNextEvent)(guard, &mut event) };
                let cookie = unsafe { &mut event.generic_event_cookie };
                if cookie.type_ != xlib::GenericEvent || cookie.extension != opcode {
                    continue;
                }
                if unsafe { (x.XGetEventData)(guard, cookie) } == 0 {
                    continue;
                }
                let raw = unsafe { &*(cookie.data as *const xinput2::XIRawEvent) };
                let press = (cookie.evtype == xinput2::XI_RawButtonPress).then_some((
                    raw.sourceid,
                    raw.detail as u32,
                    raw.serial,
                ));
                unsafe { (x.XFreeEventData)(guard, cookie) };
                if let Some(press) = press {
                    return press;
                }
            }
        };
        let restore = || {
            set_device(&xi1, program, xtest, &[1, 2, 3]);
            set_core(x, program, &[1, 2, 3, 4]);
            unsafe { (x.XSync)(program, xlib::False) };
            drain(x, guard);
        };
        restore();

        // Nothing moves: the maps read are the press's own.
        click_then(1, &|| {});
        let (source, button, serial) = next_press();
        assert_eq!((source, button), (xtest, 1));
        assert_eq!(server.primary(source, button, serial), Some(true));
        // The core map swapped right behind the press: the guard cannot know
        // which button the page got, so the press backs nothing.
        click_then(1, &|| set_core(x, program, &[3, 2, 1]));
        let (source, button, serial) = next_press();
        assert_eq!(server.primary(source, button, serial), None, "xmodmap behind the press");
        restore();
        // The same with the device's own map, told by DeviceMappingNotify.
        click_then(1, &|| set_device(&xi1, program, xtest, &[3, 2, 1]));
        let (source, button, serial) = next_press();
        assert_eq!(server.primary(source, button, serial), None, "xinput set-button-map behind the press");
        restore();
        // Swapped before the press: in force at the press, and read as such.
        set_core(x, program, &[3, 2, 1]);
        click_then(3, &|| {});
        let (source, button, serial) = next_press();
        assert_eq!(server.primary(source, button, serial), Some(true), "button 3 is the click under 3 2 1");
        restore();
        set_device(&xi1, program, xtest, &[3, 2, 1]);
        click_then(3, &|| {});
        let (source, button, serial) = next_press();
        assert_eq!(server.primary(source, button, serial), Some(true), "and under the device's 3 2 1");
        restore();
        // A press from before the guard (re)started following its device —
        // as after a change of the device hierarchy — backs nothing.
        click_then(1, &|| {});
        let (source, button, serial) = next_press();
        server.watch_devices();
        assert_eq!(server.primary(source, button, serial), None, "followed only after the press");
        restore();
        // Whatever the maps do, a program's press is recorded, as one that backs
        // nothing: it replaces the last press — a wheel step too, since a map
        // can make it the click (`pointer = 4 2 3 1`).
        click_then(3, &|| set_core(x, program, &[3, 2, 1]));
        let (source, button, serial) = next_press();
        assert_eq!(server.judge_press(source, button, serial), Some(false));
        restore();
        click_then(1, &|| {});
        let (source, button, serial) = next_press();
        assert_eq!(server.judge_press(source, button, serial), Some(false));
        set_core(x, program, &[4, 2, 3, 1]);
        click_then(4, &|| {});
        let (source, button, serial) = next_press();
        assert_eq!(server.judge_press(source, button, serial), Some(false), "a program's wheel button as the click");
        restore();
        unsafe {
            (x.XCloseDisplay)(program);
            (x.XCloseDisplay)(guard);
        }
    }
}
