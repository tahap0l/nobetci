// macOS half of the click guard: AppKit mouse events.
//
// A local event monitor sees every left-button press our own windows receive —
// no Accessibility or Input Monitoring permission, and nothing from other apps.
// Each event knows who made it: events from a real mouse come from the HID
// system and carry source pid 0, while one posted by a program (CGEventPost)
// carries that program's pid. Pressing the button through the accessibility API
// (AXPress) makes no mouse event at all. On top of that, macOS only lets a
// program post mouse events or press buttons of other apps once the user has
// granted it Accessibility access.
//
// The monitor is installed once on the main thread and only records while a
// request waits.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use block2::RcBlock;
use objc2::msg_send;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
use objc2_core_graphics::{CGEvent, CGEventField};
use tauri::{AppHandle, WebviewWindow};

use super::Rect;

/// The island's NSWindow, to tell its presses from the settings window's.
static ISLAND: AtomicUsize = AtomicUsize::new(0);
static ARMED: AtomicBool = AtomicBool::new(false);

pub fn start(app: &AppHandle) {
    let Some(win) = crate::island::window(app) else {
        crate::log::line("input guard: no island window — guard off");
        return;
    };
    match win.ns_window() {
        Ok(ns) if !ns.is_null() => ISLAND.store(ns as usize, Ordering::Release),
        _ => {
            crate::log::line("input guard: no native island window — guard off");
            return;
        }
    }
    // Event monitors belong to the main thread.
    if app.run_on_main_thread(install).is_err() {
        crate::log::line("input guard: main thread unavailable — guard off");
    }
}

fn install() {
    let block = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
        if ARMED.load(Ordering::Acquire) {
            // SAFETY: AppKit hands the monitor a live event for the call's duration.
            let ev = unsafe { event.as_ref() };
            if ev.r#type() == NSEventType::LeftMouseDown {
                note(ev);
            }
        }
        // Always pass the event on untouched.
        event.as_ptr()
    });
    // SAFETY: the block returns the event it was given, a valid pointer.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::LeftMouseDown, &block) };
    match monitor {
        Some(m) => {
            // Lives as long as the app does.
            std::mem::forget(m);
            super::set_available(true);
        }
        None => crate::log::line("input guard: no event monitor — guard off"),
    }
}

fn note(ev: &NSEvent) {
    let physical = ev
        .CGEvent()
        .is_some_and(|cg| CGEvent::integer_value_field(Some(&*cg), CGEventField::EventSourceUnixProcessID) == 0);
    let island = ISLAND.load(Ordering::Acquire);
    // SAFETY: `window` is a plain property read on an event we were handed.
    let window: *mut AnyObject = unsafe { msg_send![ev, window] };
    let p = ev.locationInWindow();
    if island != 0 && window as usize == island {
        super::record(physical, p.x, p.y);
    } else {
        super::record(physical, f64::NAN, f64::NAN);
    }
}

pub fn arm(on: bool) {
    ARMED.store(on, Ordering::Release);
}

/// Island-logical pixels (CSS, from the top) → island points from the bottom,
/// which is how AppKit reports a press inside the window.
pub fn island_rect(win: &WebviewWindow, x: f64, y: f64, w: f64, h: f64) -> Option<Rect> {
    let scale = win.scale_factor().ok()?;
    let height = win.inner_size().ok()?.height as f64 / scale;
    Some(Rect { left: x, top: height - (y + h), right: x + w, bottom: height - y })
}
