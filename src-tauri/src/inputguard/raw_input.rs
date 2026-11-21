// Windows half of the click guard: raw input.
//
// A real mouse button press arrives with the handle of the device it came from;
// input synthesised with SendInput has none, and a UI Automation invoke produces
// no mouse input at all. While a request waits we listen to raw mouse input on a
// message-only window (no hooks) and hand every press of the primary button to
// the shared guard. Listening stops as soon as nothing is waiting, so a quiet
// Nöbetçi still costs nothing.
//
// Raw input reports physical buttons: with "Primary mouse button: Right" (the
// left-handed setting, SM_SWAPBUTTON) the click a page sees is the right one.
//
// Some laptops' precision touchpads also deliver presses without a device
// handle. Those count as synthetic like SendInput's — the decision does not
// change here — but the log says when such a press arrives, so a refused
// touchpad click can be recognised (see the troubleshooting notes).

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, WebviewWindow};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK,
    RIDEV_REMOVE, RID_INPUT, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetCursorPos, GetMessageW, GetSystemMetrics, PostThreadMessageW,
    RegisterClassW, TranslateMessage, HWND_MESSAGE, MSG, SM_SWAPBUTTON, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP,
    WM_INPUT, WNDCLASSW,
};

use super::Rect;

/// RI_MOUSE_*_BUTTON_DOWN / _UP in RAWMOUSE::usButtonFlags.
const LEFT_DOWN: u16 = 0x0001;
const LEFT_UP: u16 = 0x0002;
const RIGHT_DOWN: u16 = 0x0004;
const RIGHT_UP: u16 = 0x0008;
/// Our own message: wParam 1 = start listening, 0 = stop.
const WM_ARM: u32 = WM_APP + 1;

/// The listener thread, once it runs.
static THREAD: AtomicU32 = AtomicU32::new(0);

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn register(hwnd: HWND, on: bool) -> bool {
    let device = RAWINPUTDEVICE {
        usUsagePage: 0x01, // generic desktop
        usUsage: 0x02,     // mouse
        dwFlags: if on { RIDEV_INPUTSINK } else { RIDEV_REMOVE },
        hwndTarget: if on { hwnd } else { HWND::default() },
    };
    unsafe { RegisterRawInputDevices(&[device], std::mem::size_of::<RAWINPUTDEVICE>() as u32).is_ok() }
}

fn on_raw_input(lparam: LPARAM) {
    let mut raw = RAWINPUT::default();
    let mut size = std::mem::size_of::<RAWINPUT>() as u32;
    let got = unsafe {
        GetRawInputData(
            HRAWINPUT(lparam.0 as *mut _),
            RID_INPUT,
            Some(&mut raw as *mut _ as *mut _),
            &mut size,
            std::mem::size_of::<RAWINPUTHEADER>() as u32,
        )
    };
    if got == u32::MAX || raw.header.dwType != RIM_TYPEMOUSE.0 {
        return;
    }
    let flags = unsafe { raw.data.mouse.Anonymous.Anonymous.usButtonFlags };
    // Read at every press, so a change in Windows' mouse settings applies at once.
    let swapped = unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0;
    let (down, up) = primary_button(swapped);
    if flags & down != 0 {
        let physical = !raw.header.hDevice.is_invalid();
        if !physical {
            note_press_without_device();
        }
        let mut p = POINT::default();
        let _ = unsafe { GetCursorPos(&mut p) };
        super::record(physical, p.x as f64, p.y as f64);
    }
    if flags & up != 0 {
        super::release();
    }
}

/// The raw flags of the button a click comes from: the right one when the user
/// made it the primary button.
fn primary_button(swapped: bool) -> (u16, u16) {
    if swapped {
        (RIGHT_DOWN, RIGHT_UP)
    } else {
        (LEFT_DOWN, LEFT_UP)
    }
}

/// Logs, at most once a minute, that a press came without a device handle.
fn note_press_without_device() {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap();
    if last.is_none_or(|at| at.elapsed() > Duration::from_secs(60)) {
        *last = Some(Instant::now());
        crate::log::line(
            "input guard: a press without a device handle counts as synthetic — SendInput makes such \
             presses, and so can a precision touchpad on some laptops",
        );
    }
}

/// Starts the listener thread (idle until `arm(true)`).
pub fn start(_app: &AppHandle) {
    std::thread::spawn(|| unsafe {
        let Ok(module) = GetModuleHandleW(None) else { return };
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: module.into(),
            lpszClassName: w!("NobetciInputGuard"),
            ..Default::default()
        };
        RegisterClassW(&class);
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("NobetciInputGuard"),
            w!(""),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(module.into()),
            None,
        ) else {
            crate::log::line("input guard: no message window — guard off");
            return;
        };
        THREAD.store(GetCurrentThreadId(), Ordering::Release);
        // Probe once so a machine where raw input is unavailable is known up front.
        let ok = register(hwnd, true) && register(hwnd, false);
        super::set_available(ok);
        if !ok {
            crate::log::line("input guard: raw input unavailable — guard off");
        }

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            match msg.message {
                WM_ARM => {
                    register(hwnd, msg.wParam.0 == 1);
                }
                WM_INPUT => on_raw_input(msg.lParam),
                _ => {}
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}

pub fn arm(on: bool) {
    let tid = THREAD.load(Ordering::Acquire);
    if tid != 0 {
        unsafe {
            let _ = PostThreadMessageW(tid, WM_ARM, WPARAM(on as usize), LPARAM(0));
        }
    }
}

/// Island-logical pixels → physical screen pixels.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_primary_button_follows_the_swap_setting() {
        assert_eq!(primary_button(false), (LEFT_DOWN, LEFT_UP));
        assert_eq!(primary_button(true), (RIGHT_DOWN, RIGHT_UP), "left-handed: the right button clicks");
    }
}
