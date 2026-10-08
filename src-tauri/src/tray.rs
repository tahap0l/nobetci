// Notification-area icon: Open, Settings, Pause, Do not disturb, Quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Wry};

use crate::i18n::pick;
use crate::island::WINDOW_LABEL;

const TRAY_ID: &str = "nobetci";

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let open = MenuItem::with_id(app, "open", pick("Open Nöbetçi", "Nöbetçi'yi aç"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", pick("Settings…", "Ayarlar…"), true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", pick("Pause / resume", "Duraklat / devam et"), true, None::<&str>)?;
    let dnd =
        MenuItem::with_id(app, "dnd", pick("Do not disturb on / off", "Rahatsız etme aç / kapat"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", pick("Quit", "Çıkış"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&open, &sep1, &settings, &pause, &dnd, &sep2, &quit])
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).tooltip("Nöbetçi").menu(&menu(app)?).on_menu_event(
        |app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app, None),
            "dnd" => crate::toggle_dnd(app),
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        },
    );

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Rebuilds the menu in the current language.
pub fn relabel(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}
