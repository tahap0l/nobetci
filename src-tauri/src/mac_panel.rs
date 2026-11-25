// macOS: the island and the desktop mascot as non-activating panels.
//
// A click on an ordinary window makes its app the active one, which pulls the
// keyboard away from the terminal the user was typing in. Panels can opt out:
// an NSPanel with the "non-activating" style takes clicks — and, when the user
// wants to type into the island, the keyboard — without activating Nobi.
//
// Tauri builds both as plain windows, so their class is switched to a small
// NSPanel subclass at launch, the same technique the tauri-nspanel plugin uses.
// The switch replaces tao's own window class, whose `focusable` setting no
// longer applies afterwards — so tao's set_focusable must never be called on
// these windows (it would look for an instance variable the class lacks). The
// subclasses answer for themselves instead:
//   * NobiIslandPanel may become the key window (so text fields work), never
//     the main window;
//   * NobiMascotPanel never becomes either: the mascot only shows.

use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{msg_send, sel};
use tauri::WebviewWindow;

/// NSWindowStyleMaskNonactivatingPanel.
const NONACTIVATING_PANEL: usize = 1 << 7;

extern "C-unwind" fn yes(_this: &AnyObject, _cmd: Sel) -> Bool {
    Bool::YES
}

extern "C-unwind" fn no(_this: &AnyObject, _cmd: Sel) -> Bool {
    Bool::NO
}

/// The panel class for a window that may take the keyboard (`keyboard`), or
/// for one that never does.
fn panel_class(keyboard: bool) -> Option<&'static AnyClass> {
    static ISLAND: OnceLock<Option<usize>> = OnceLock::new();
    static MASCOT: OnceLock<Option<usize>> = OnceLock::new();
    let (cell, name) = if keyboard { (&ISLAND, c"NobiIslandPanel") } else { (&MASCOT, c"NobiMascotPanel") };
    let addr = cell.get_or_init(|| {
        let superclass = AnyClass::get(c"NSPanel")?;
        let class = match ClassBuilder::new(name, superclass) {
            Some(mut builder) => {
                // SAFETY: both selectors are `- (BOOL)name`, matching the functions.
                unsafe {
                    if keyboard {
                        builder.add_method(sel!(canBecomeKeyWindow), yes as extern "C-unwind" fn(_, _) -> _);
                    } else {
                        builder.add_method(sel!(canBecomeKeyWindow), no as extern "C-unwind" fn(_, _) -> _);
                    }
                    builder.add_method(sel!(canBecomeMainWindow), no as extern "C-unwind" fn(_, _) -> _);
                }
                builder.register()
            }
            // Registered already.
            None => AnyClass::get(name)?,
        };
        Some(class as *const AnyClass as usize)
    });
    // SAFETY: the address is that of a registered class, which lives forever.
    addr.map(|a| unsafe { &*(a as *const AnyClass) })
}

/// Makes the panel the key window so a text field in it gets the keystrokes.
pub fn make_key(win: &WebviewWindow) {
    let Ok(raw) = win.ns_window() else { return };
    if raw.is_null() {
        return;
    }
    // SAFETY: `raw` is the island's live NSWindow.
    unsafe {
        let window = &*(raw as *const AnyObject);
        let _: () = msg_send![window, makeKeyWindow];
    }
}

/// Brings the panel to the front without making it the key window (tao's show
/// is makeKeyAndOrderFront). Must run on the main thread.
pub fn order_front(win: &WebviewWindow) {
    let Ok(raw) = win.ns_window() else { return };
    if raw.is_null() {
        return;
    }
    // SAFETY: `raw` is a live NSWindow of ours; called on the main thread.
    unsafe {
        let window = &*(raw as *const AnyObject);
        let _: () = msg_send![window, orderFrontRegardless];
    }
}

/// Turns `win` into a non-activating panel; `keyboard` says whether it may
/// ever become the key window. Must run on the main thread; does nothing if
/// anything is missing. A window already on screen (the island, which Tauri
/// shows before the app's setup runs) is ordered out first, so it is a panel
/// the next time it is ordered in — with `order_front`.
pub fn make_panel(win: &WebviewWindow, keyboard: bool) {
    let Ok(raw) = win.ns_window() else { return };
    if raw.is_null() {
        return;
    }
    let Some(panel) = panel_class(keyboard) else {
        crate::log::line("no NSPanel class — the window stays an ordinary window");
        return;
    };
    // SAFETY: `raw` is a live NSWindow of ours; NSPanel is a subclass of
    // NSWindow that adds no instance variables, so the object's layout fits it.
    unsafe {
        let window = &*(raw as *const AnyObject);
        let visible: Bool = msg_send![window, isVisible];
        if visible.as_bool() {
            let none: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![window, orderOut: none];
        }
        AnyObject::set_class(window, panel);
        let mask: usize = msg_send![window, styleMask];
        let _: () = msg_send![window, setStyleMask: mask | NONACTIVATING_PANEL];
        // Take the keyboard only when a text field asks for it.
        let _: () = msg_send![window, setBecomesKeyOnlyIfNeeded: Bool::YES];
        // Panels hide when their app deactivates unless told otherwise.
        let _: () = msg_send![window, setHidesOnDeactivate: Bool::NO];
        let _: () = msg_send![window, setFloatingPanel: Bool::YES];
    }
}

/// Starts macOS Dictation for the key window's focused text field, as the
/// Edit menu's "Start Dictation…" does. False when nothing took the action.
pub fn start_dictation() -> bool {
    let Some(class) = AnyClass::get(c"NSApplication") else { return false };
    // SAFETY: called on the main thread (see assistant_dictate); both messages
    // are standard NSApplication API with these exact types.
    unsafe {
        let app: *mut AnyObject = msg_send![class, sharedApplication];
        if app.is_null() {
            return false;
        }
        let none: *mut AnyObject = std::ptr::null_mut();
        let ok: Bool = msg_send![app, sendAction: sel!(startDictation:), to: none, from: none];
        ok.as_bool()
    }
}
