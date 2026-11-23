// Windows: the extended style that keeps the island and the desktop mascot out
// of the way (D16).
//
// tao keeps its own idea of a window's flags and, whenever one changes (the
// click-through flag on every crossing of the island, a show, focusable), it
// writes the whole GWL_EXSTYLE again from that idea: WS_EX_TOOLWINDOW gone,
// WS_EX_APPWINDOW added (so Alt-Tab and Task View list the window), and
// WS_EX_NOACTIVATE only for a window declared unfocusable. `island.rs` calls
// `restyle` right after every such change, on the main thread, before the
// window handles any input.

use std::ffi::c_void;

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowLongPtrW, IsWindow, IsWindowVisible, SetForegroundWindow, SetWindowLongPtrW,
    GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

// island.rs spells the bits out so its tests run everywhere; they must be these.
const _: () = assert!(super::WS_EX_NOACTIVATE == WS_EX_NOACTIVATE.0 as isize);
const _: () = assert!(super::WS_EX_TOOLWINDOW == WS_EX_TOOLWINDOW.0 as isize);
const _: () = assert!(super::WS_EX_APPWINDOW == WS_EX_APPWINDOW.0 as isize);

/// Puts the window's extended style back the way `super::ex_style` wants it:
/// not in Alt-Tab, and not activated by a click unless `typing`.
pub fn restyle(hwnd: *mut c_void, typing: bool) {
    if hwnd.is_null() {
        return;
    }
    let hwnd = HWND(hwnd);
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = super::ex_style(ex, typing);
        if want != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
        }
    }
}

/// The window in front now, as a number (0: none).
pub fn foreground() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

/// Gives the foreground back to `previous` (from `foreground`) while the
/// island (`island`) still has it and `previous` is still a visible window.
/// The foreground window may hand the foreground on, so Windows allows it.
pub fn give_back(previous: isize, island: isize) {
    if previous == 0 || island == 0 {
        return;
    }
    unsafe {
        if GetForegroundWindow().0 as isize != island {
            return;
        }
        let previous = HWND(previous as *mut c_void);
        if IsWindow(Some(previous)).as_bool() && IsWindowVisible(previous).as_bool() {
            let _ = SetForegroundWindow(previous);
        }
    }
}
