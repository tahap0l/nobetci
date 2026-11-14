// Linux half of the click guard: XInput 2 raw events.
//
// X11 lets any program of the user's fake input with the XTEST extension, and to
// the page such a click looks real. The X server keeps the two apart, though:
// every event says which device it came from, and XTEST input always comes from
// its own virtual devices ("Virtual core XTEST pointer"). So a thread listens to
// raw button presses on the root window (no grab, nothing taken from anyone) and
// records whether each came from a real device. Pressing the button through the
// accessibility bus (AT-SPI) makes no mouse event at all.
//
// Under a Wayland session the island runs on XWayland, where X11 programs can
// still use XTEST against it, so the same check applies. A Wayland-native program
// cannot inject input into other windows without the user agreeing to a remote
// desktop prompt.
//
// Coordinates are physical root-window pixels, the space window positions use.

use std::ffi::CStr;
use std::os::raw::{c_int, c_uchar, c_uint, c_ulong};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, WebviewWindow};
use x11_dl::xinput2::{self, XInput2};
use x11_dl::xlib;

use super::Rect;

static ARMED: AtomicBool = AtomicBool::new(false);

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

/// Device ids whose input is synthesised: the XTEST devices.
fn synthetic_devices(xi: &XInput2, dpy: *mut xlib::Display) -> Vec<c_int> {
    let mut count = 0;
    let info = unsafe { (xi.XIQueryDevice)(dpy, xinput2::XIAllDevices, &mut count) };
    if info.is_null() {
        return Vec::new();
    }
    let devices = unsafe { std::slice::from_raw_parts(info, count.max(0) as usize) };
    let out = devices
        .iter()
        .filter(|d| !d.name.is_null() && unsafe { CStr::from_ptr(d.name) }.to_string_lossy().contains("XTEST"))
        .map(|d| d.deviceid)
        .collect();
    unsafe { (xi.XIFreeDeviceInfo)(info) };
    out
}

fn listen() -> Result<(), &'static str> {
    let x = crate::x11::xlib().ok_or("no libX11")?;
    let xi = XInput2::open().map_err(|_| "no libXi")?;
    let dpy = unsafe { (x.XOpenDisplay)(std::ptr::null()) };
    if dpy.is_null() {
        return Err("no X display (a Wayland session without XWayland?)");
    }
    let (mut opcode, mut first_event, mut first_error) = (0, 0, 0);
    let name = c"XInputExtension";
    if unsafe { (x.XQueryExtension)(dpy, name.as_ptr(), &mut opcode, &mut first_event, &mut first_error) } == 0 {
        return Err("the X server has no XInput extension");
    }
    let (mut major, mut minor) = (2, 0);
    if unsafe { (xi.XIQueryVersion)(dpy, &mut major, &mut minor) } != xlib::Success as c_int {
        return Err("the X server has no XInput 2");
    }
    let root = unsafe { (x.XDefaultRootWindow)(dpy) };
    let mut bits = [0 as c_uchar; 4];
    for event in [xinput2::XI_RawButtonPress, xinput2::XI_RawButtonRelease] {
        bits[(event >> 3) as usize] |= 1 << (event & 7);
    }
    let mut mask = xinput2::XIEventMask {
        deviceid: xinput2::XIAllMasterDevices,
        mask_len: bits.len() as c_int,
        mask: bits.as_mut_ptr(),
    };
    unsafe {
        (xi.XISelectEvents)(dpy, root, &mut mask, 1);
        (x.XFlush)(dpy);
    }
    let synthetic = synthetic_devices(&xi, dpy);
    if synthetic.is_empty() {
        crate::log::line("input guard: no XTEST device found — every press counts as physical");
    }
    super::set_available(true);

    loop {
        let mut event: xlib::XEvent = unsafe { std::mem::zeroed() };
        unsafe { (x.XNextEvent)(dpy, &mut event) };
        let cookie = unsafe { &mut event.generic_event_cookie };
        if cookie.type_ != xlib::GenericEvent || cookie.extension != opcode {
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
            super::release();
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
        super::record(!synthetic.contains(&source), px, py);
    }
}
