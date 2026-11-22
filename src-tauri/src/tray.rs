// Notification-area icon: Open, Settings, Pause, Do not disturb, Desktop mascot, Quit.

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
    let buddy = MenuItem::with_id(
        app,
        "buddy",
        pick("Desktop mascot on / off", "Masaüstü maskotu aç / kapat"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", pick("Quit", "Çıkış"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&open, &sep1, &settings, &pause, &dnd, &buddy, &sep2, &quit])
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).tooltip("Nöbetçi").menu(&menu(app)?).on_menu_event(
        |app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app, None),
            "dnd" => crate::toggle_dnd(app),
            "buddy" => crate::toggle_buddy(app),
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        },
    );

    // macOS: a monochrome template the menu bar tints itself, for light, dark
    // and coloured menu bars alike; drawn 18 pt tall, so 36 px stays sharp on
    // Retina. Windows and Linux keep the colour owl.
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon(menu_bar_icon()).icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// The owl's silhouette for the macOS menu bar: black, with the shape in the
/// alpha channel only (eyes and beak cut out), as template images are.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn menu_bar_icon() -> tauri::image::Image<'static> {
    tauri::include_image!("icons/tray-template.png")
}

/// Rebuilds the menu in the current language.
pub fn relabel(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_menu_bar_owl_is_a_template_image() {
        let icon = super::menu_bar_icon();
        // 18 pt tall in the menu bar: twice that for Retina.
        assert_eq!((icon.width(), icon.height()), (36, 36));
        let px = icon.rgba();
        assert!(px.chunks(4).all(|p| p[..3] == [0, 0, 0]), "black only: a template's shape lives in its alpha");
        let solid = px.chunks(4).filter(|p| p[3] > 128).count();
        assert!((300..36 * 36 - 300).contains(&solid), "a silhouette, neither blank nor a full square: {solid}");
        // The macOS builder call, type-checked everywhere.
        let _ = tauri::tray::TrayIconBuilder::<tauri::Wry>::with_id("t").icon(icon).icon_as_template(true);
    }
}
