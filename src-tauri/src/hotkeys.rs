// Global shortcuts. They work whatever window has focus, which is the point —
// and also why "allow" is off by default and never covers high or critical risk
// (any program can synthesise keystrokes; Rust refuses a plain allow for those).

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::i18n::is_tr;
use crate::island::WINDOW_LABEL;
use crate::settings::Hotkeys;

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
    for (action, accel) in
        [("toggle", &hotkeys.toggle), ("deny", &hotkeys.deny), ("allow", &hotkeys.allow), ("dnd", &hotkeys.dnd)]
    {
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
