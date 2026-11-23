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
// That setting is read when the press is handled, a moment after it happened,
// so it only picks among real presses: a program's press of any button is
// recorded as one that backs nothing, and swapping the buttons around its own
// click cannot hide it. The guard follows every button a program holds until
// it is let go, so a real click made while a program holds a button down
// cannot vouch for the click the program's release makes (`inputguard`).
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

/// Raw input names the device behind a press, and SendInput's have none: the
/// guard can vouch for a hold here.
pub const VOUCHES_FOR_HOLDS: bool = true;

/// RI_MOUSE_*_BUTTON_DOWN / _UP in RAWMOUSE::usButtonFlags.
const LEFT_DOWN: u16 = 0x0001;
const LEFT_UP: u16 = 0x0002;
const RIGHT_DOWN: u16 = 0x0004;
const RIGHT_UP: u16 = 0x0008;
/// Every button's down and up flags: left, right, middle, X1 and X2. Each
/// button's up flag is the bit above its down flag.
const BUTTONS: [(u16, u16); 5] =
    [(LEFT_DOWN, LEFT_UP), (RIGHT_DOWN, RIGHT_UP), (0x0010, 0x0020), (0x0040, 0x0080), (0x0100, 0x0200)];
const ANY_DOWN: u16 = LEFT_DOWN | RIGHT_DOWN | 0x0010 | 0x0040 | 0x0100;
const ANY_UP: u16 = LEFT_UP | RIGHT_UP | 0x0020 | 0x0080 | 0x0200;
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
    let physical = !raw.header.hDevice.is_invalid();
    // Read at every press, so a change in Windows' mouse settings applies at once.
    let (down, up) = watched_buttons(physical, || unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0);
    // A program's buttons are followed until let go: presses first, since one
    // event may carry a press and its release.
    let (pressed, let_go) = if physical { (0, 0) } else { program_buttons(flags) };
    for button in BUTTONS.iter().map(|b| b.0).filter(|d| pressed & d != 0) {
        super::program_down(u64::from(button));
    }
    if flags & down != 0 {
        if !physical {
            note_press_without_device();
        }
        let mut p = POINT::default();
        let _ = unsafe { GetCursorPos(&mut p) };
        super::record(physical, p.x as f64, p.y as f64);
    }
    for button in BUTTONS.iter().map(|b| b.0).filter(|d| let_go & d != 0) {
        super::program_up(u64::from(button));
    }
    if flags & up != 0 {
        super::release(physical);
    }
}

/// The buttons a program's event presses and lets go of, each named by its
/// down flag.
fn program_buttons(flags: u16) -> (u16, u16) {
    let (mut pressed, mut let_go) = (0, 0);
    for (down, up) in BUTTONS {
        if flags & down != 0 {
            pressed |= down;
        }
        if flags & up != 0 {
            let_go |= down;
        }
    }
    (pressed, let_go)
}

/// The raw flags the guard follows for a press: for a real one, the button a
/// click comes from (`primary_button`); for a program's, every button.
fn watched_buttons(physical: bool, swapped: impl FnOnce() -> bool) -> (u16, u16) {
    if physical {
        primary_button(swapped())
    } else {
        (ANY_DOWN, ANY_UP)
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

    #[test]
    fn a_program_s_press_counts_whatever_its_button() {
        // A real press: only the primary button, as the swap setting says.
        assert_eq!(watched_buttons(true, || false), (LEFT_DOWN, LEFT_UP));
        assert_eq!(watched_buttons(true, || true), (RIGHT_DOWN, RIGHT_UP));
        // A program's: every button, and the swap setting is not even read, so
        // flipping it behind its own click hides nothing.
        let (down, up) = watched_buttons(false, || panic!("the setting is not read"));
        for (d, u) in [(0x0001, 0x0002), (0x0004, 0x0008), (0x0010, 0x0020), (0x0040, 0x0080), (0x0100, 0x0200)] {
            assert!(down & d != 0 && up & u != 0, "button flags {d:#06x}/{u:#06x}");
        }
        assert_eq!(down & up, 0, "downs and ups never mix");
    }

    #[test]
    fn a_program_s_buttons_are_followed_until_let_go() {
        // Each button is named by its down flag, pressed or let go.
        assert_eq!(program_buttons(LEFT_DOWN), (LEFT_DOWN, 0));
        assert_eq!(program_buttons(LEFT_UP), (0, LEFT_DOWN));
        assert_eq!(program_buttons(LEFT_DOWN | LEFT_UP), (LEFT_DOWN, LEFT_DOWN), "a click in one event");
        assert_eq!(program_buttons(RIGHT_DOWN | 0x0020), (RIGHT_DOWN, 0x0010), "right down, middle up");
        assert_eq!(program_buttons(0x0100 | 0x0200), (0x0100, 0x0100));
        assert_eq!(program_buttons(0x0400), (0, 0), "a wheel step is no button");
        for (down, up) in BUTTONS {
            assert_eq!(up, down << 1);
        }
    }
}
