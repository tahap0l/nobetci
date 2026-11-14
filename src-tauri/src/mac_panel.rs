// macOS: the island as a non-activating panel.
//
// A click on an ordinary window makes its app the active one, which pulls the
// keyboard away from the terminal the user was typing in. Panels can opt out:
// an NSPanel with the "non-activating" style takes clicks — and, when the user
// wants to type into it, the keyboard — without activating Nöbetçi.
//
// Tauri builds the island as a plain window, so its class is switched to a small
// NSPanel subclass at launch, the same technique the tauri-nspanel plugin uses.
// The subclass only answers two questions differently from NSPanel: a borderless
// window may still become the key window (so text fields work), and it never
// becomes the main window.

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

fn panel_class() -> Option<&'static AnyClass> {
    static CLASS: OnceLock<Option<usize>> = OnceLock::new();
    let addr = CLASS.get_or_init(|| {
        let superclass = AnyClass::get(c"NSPanel")?;
        let class = match ClassBuilder::new(c"NobetciIslandPanel", superclass) {
            Some(mut builder) => {
                // SAFETY: both selectors are `- (BOOL)name`, matching the functions.
                unsafe {
                    builder.add_method(sel!(canBecomeKeyWindow), yes as extern "C-unwind" fn(_, _) -> _);
                    builder.add_method(sel!(canBecomeMainWindow), no as extern "C-unwind" fn(_, _) -> _);
                }
                builder.register()
            }
            // Registered already (a second window asked first).
            None => AnyClass::get(c"NobetciIslandPanel")?,
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

/// Turns `win` into a non-activating panel. Must run on the main thread, before
/// the window is first shown; does nothing if anything is missing.
pub fn make_panel(win: &WebviewWindow) {
    let Ok(raw) = win.ns_window() else { return };
    if raw.is_null() {
        return;
    }
    let Some(panel) = panel_class() else {
        crate::log::line("island: no NSPanel class — the island stays an ordinary window");
        return;
    };
    // SAFETY: `raw` is the island's live NSWindow; NSPanel is a subclass of
    // NSWindow that adds no instance variables, so the object's layout fits it.
    unsafe {
        let window = &*(raw as *const AnyObject);
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
