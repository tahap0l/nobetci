// "Go to window": bring the terminal or editor a session runs in to the front.
//
// The relay sends its parent-process chain (Claude Code → shell → … → Windows
// Terminal / VS Code / Terminal.app / iTerm2). On Windows the first process in
// that chain that owns a normal top-level window is raised; on macOS, the first
// one that lives inside an app bundle is activated.

#[cfg(target_os = "macos")]
pub use mac::focus_chain;
#[cfg(windows)]
pub use win::focus_chain;

#[cfg(windows)]
mod win {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic,
        IsWindowVisible, SetForegroundWindow, ShowWindow, GWL_EXSTYLE, GW_OWNER, SW_RESTORE, WS_EX_TOOLWINDOW,
    };

    /// Visible, titled, unowned, not a tool window: what Alt-Tab would show.
    unsafe fn is_app_window(hwnd: HWND) -> bool {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
                return false;
            }
            if GetWindow(hwnd, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false) {
                return false;
            }
            GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize == 0
        }
    }

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let list = unsafe { &mut *(lparam.0 as *mut Vec<(HWND, u32)>) };
        if unsafe { is_app_window(hwnd) } {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            list.push((hwnd, pid));
        }
        true.into()
    }

    fn app_windows() -> Vec<(HWND, u32)> {
        let mut list: Vec<(HWND, u32)> = Vec::new();
        unsafe {
            let _ = EnumWindows(Some(collect), LPARAM(&mut list as *mut _ as isize));
        }
        list
    }

    /// Raises the window of the nearest process in `chain` that has one.
    pub fn focus_chain(chain: &[u32]) -> bool {
        let windows = app_windows();
        let Some(hwnd) = chain.iter().find_map(|pid| windows.iter().find(|(_, p)| p == pid).map(|(h, _)| *h)) else {
            return false;
        };
        unsafe {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            // Windows only lets the foreground process hand focus away. A tap of Alt
            // lifts that lock for the next SetForegroundWindow — the standard, if
            // unlovely, way for a background helper to raise another app's window.
            let key = |flags| INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, dwFlags: flags, ..Default::default() } },
            };
            let taps = [key(Default::default()), key(KEYEVENTF_KEYUP)];
            SendInput(&taps, std::mem::size_of::<INPUT>() as i32);
            SetForegroundWindow(hwnd).as_bool()
        }
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::process::Command;

    /// Executable path of a process of ours, if it still exists.
    fn pid_path(pid: u32) -> Option<String> {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        let n = unsafe { libc::proc_pidpath(pid as i32, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if n <= 0 {
            return None;
        }
        buf.truncate(n as usize);
        String::from_utf8(buf).ok()
    }

    /// Activates the app of the nearest process in `chain` that belongs to one.
    pub fn focus_chain(chain: &[u32]) -> bool {
        let Some(bundle) =
            chain.iter().find_map(|pid| pid_path(*pid).and_then(|p| super::app_bundle(&p).map(String::from)))
        else {
            return false;
        };
        // `open` on a running app brings it to the front through LaunchServices,
        // which works from a background helper where plain activation may not.
        Command::new("/usr/bin/open").arg(&bundle).spawn().is_ok()
    }
}

/// The outermost `.app` bundle a path lives in: helpers nest their own bundles
/// (".../Visual Studio Code.app/Contents/Frameworks/Code Helper.app/..."), and the
/// app to bring forward is the one the user started.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn app_bundle(path: &str) -> Option<&str> {
    let end = path.find(".app/")?;
    Some(&path[..end + 4])
}

#[cfg(test)]
mod tests {
    use super::app_bundle;

    #[test]
    fn finds_the_outer_app_bundle() {
        assert_eq!(
            app_bundle("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
            Some("/System/Applications/Utilities/Terminal.app")
        );
        assert_eq!(
            app_bundle(
                "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper"
            ),
            Some("/Applications/Visual Studio Code.app")
        );
        assert_eq!(app_bundle("/bin/zsh"), None);
        assert_eq!(app_bundle("/usr/bin/login"), None);
    }
}
