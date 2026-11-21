// Global shortcuts. They work whatever window has focus, which is the point —
// and also why "allow" is off by default and never covers high or critical risk
// (any program can synthesise keystrokes; Rust refuses a plain allow for those).
//
// The island turns the `hotkey` event into a decision, but an approval "via the
// hotkey" is only believed when the OS really reported a press of the allow
// shortcut a moment earlier: a page cannot claim one (`take_allow_press`).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::i18n::is_tr;
use crate::island::WINDOW_LABEL;
use crate::settings::Hotkeys;

/// When the allow shortcut was last pressed.
static ALLOW_PRESSED: Mutex<Option<Instant>> = Mutex::new(None);

/// The last press of the allow shortcut, if it came within `window`. Each press
/// backs one approval: taking it uses it up.
pub fn take_allow_press(window: Duration) -> Option<Instant> {
    let at = ALLOW_PRESSED.lock().unwrap().take()?;
    (at.elapsed() <= window).then_some(at)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub action: &'static str,
    pub accel: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// Replaces every registration with `hotkeys`; reports each one's fate.
pub fn apply(app: &AppHandle, hotkeys: &Hotkeys) -> Vec<HotkeyStatus> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut out = Vec::new();
    for (action, accel) in [
        ("toggle", &hotkeys.toggle),
        ("deny", &hotkeys.deny),
        ("allow", &hotkeys.allow),
        ("dnd", &hotkeys.dnd),
        ("assistant", &hotkeys.assistant),
    ] {
        let accel = accel.trim().to_string();
        if accel.is_empty() {
            out.push(HotkeyStatus { action, accel, ok: true, error: None });
            continue;
        }
        let result = accel
            .parse::<Shortcut>()
            .map_err(
                |e| if is_tr() { format!("tanınmayan kısayol: {e}") } else { format!("unrecognised shortcut: {e}") },
            )
            .and_then(|sc| {
                gs.on_shortcut(sc, move |app, _sc, ev| {
                    if ev.state == ShortcutState::Pressed {
                        if action == "allow" {
                            *ALLOW_PRESSED.lock().unwrap() = Some(Instant::now());
                        }
                        if action == "dnd" {
                            crate::toggle_dnd(app);
                        } else {
                            let _ = app.emit_to(WINDOW_LABEL, "hotkey", action);
                        }
                    }
                })
                .map_err(|e| {
                    if is_tr() {
                        format!("kaydedilemedi (başka bir uygulama kullanıyor olabilir): {e}")
                    } else {
                        format!("couldn't register (another app may be using it): {e}")
                    }
                })
            });
        match result {
            Ok(()) => out.push(HotkeyStatus { action, accel, ok: true, error: None }),
            Err(err) => {
                crate::log::line(format!("hotkey {action} {accel}: {err}"));
                out.push(HotkeyStatus { action, accel, ok: false, error: Some(err) });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_allow_press_backs_one_approval_shortly_after() {
        let window = Duration::from_millis(1500);
        *ALLOW_PRESSED.lock().unwrap() = None;
        assert_eq!(take_allow_press(window), None, "no press, no hotkey approval");
        let now = Instant::now();
        *ALLOW_PRESSED.lock().unwrap() = Some(now);
        assert_eq!(take_allow_press(window), Some(now));
        assert_eq!(take_allow_press(window), None, "used up by the first approval");
        if let Some(old) = now.checked_sub(Duration::from_secs(3)) {
            *ALLOW_PRESSED.lock().unwrap() = Some(old);
            assert_eq!(take_allow_press(window), None, "too long ago");
        }
    }
}
