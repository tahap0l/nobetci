// macOS: is a full-screen app, game or presentation in front?
//
// There is no public "full-screen app in front" query, but the window list says
// enough. Windows are listed front to back; the first ordinary one (layer 0, the
// level of document windows) belongs to the app in front. A full-screen window
// covers its whole display exactly — a zoomed window stops at the menu bar and
// the Dock — so its bounds match the display's.
//
// Window bounds and layers are readable without the Screen Recording permission
// (only window titles need it), so this asks for nothing.

use std::ffi::c_void;

type CFTypeRef = *const c_void;
type CFArrayRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFStringRef = *const c_void;
type CFIndex = isize;

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

const ON_SCREEN_ONLY: u32 = 1 << 0;
const EXCLUDE_DESKTOP_ELEMENTS: u32 = 1 << 4;
const NUMBER_SINT32: CFIndex = 3;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGWindowLayer: CFStringRef;
    static kCGWindowBounds: CFStringRef;
    static kCGWindowOwnerPID: CFStringRef;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFArrayRef;
    fn CGRectMakeWithDictionaryRepresentation(dict: CFDictionaryRef, rect: *mut CGRect) -> bool;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: CFArrayRef) -> CFIndex;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: CFIndex) -> CFTypeRef;
    fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
    fn CFNumberGetValue(number: CFTypeRef, kind: CFIndex, out: *mut c_void) -> bool;
    fn CFRelease(value: CFTypeRef);
}

fn displays() -> Vec<CGRect> {
    let mut ids = [0u32; 16];
    let mut count = 0u32;
    // SAFETY: the buffer holds `ids.len()` display ids.
    if unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) } != 0 {
        return Vec::new();
    }
    ids[..count as usize].iter().map(|&id| unsafe { CGDisplayBounds(id) }).collect()
}

fn int(dict: CFDictionaryRef, key: CFStringRef) -> Option<i32> {
    let value = unsafe { CFDictionaryGetValue(dict, key) };
    if value.is_null() {
        return None;
    }
    let mut out = 0i32;
    unsafe { CFNumberGetValue(value, NUMBER_SINT32, &mut out as *mut i32 as *mut c_void) }.then_some(out)
}

/// The two rectangles cover the same pixels, give or take rounding.
fn same(a: &CGRect, b: &CGRect) -> bool {
    let close = |x: f64, y: f64| (x - y).abs() < 1.0;
    close(a.origin.x, b.origin.x)
        && close(a.origin.y, b.origin.y)
        && close(a.size.width, b.size.width)
        && close(a.size.height, b.size.height)
}

pub fn fullscreen() -> bool {
    let screens = displays();
    if screens.is_empty() {
        return false;
    }
    let me = std::process::id() as i32;
    // SAFETY: Core Foundation calls on the array this function owns and releases.
    unsafe {
        let list = CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP_ELEMENTS, 0);
        if list.is_null() {
            return false;
        }
        let mut answer = false;
        for i in 0..CFArrayGetCount(list) {
            let window = CFArrayGetValueAtIndex(list, i);
            if window.is_null() || int(window, kCGWindowLayer) != Some(0) {
                continue;
            }
            // Our own windows (the island, the settings) do not count.
            if int(window, kCGWindowOwnerPID) == Some(me) {
                continue;
            }
            let bounds = CFDictionaryGetValue(window, kCGWindowBounds);
            let mut rect = CGRect::default();
            if !bounds.is_null() && CGRectMakeWithDictionaryRepresentation(bounds, &mut rect) {
                answer = screens.iter().any(|s| same(s, &rect));
            }
            // Only the frontmost ordinary window decides.
            break;
        }
        CFRelease(list);
        answer
    }
}
