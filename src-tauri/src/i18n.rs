// Language for text produced on the Rust side: risk labels, rule notes, errors,
// the tray menu and what Claude is told on a denial. Turkish when the user picks
// it (or the system displays Turkish and the setting is "auto"), English otherwise.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::sys::system_is_turkish;

static TURKISH: AtomicBool = AtomicBool::new(false);

pub fn system_lang() -> &'static str {
    if system_is_turkish() {
        "tr"
    } else {
        "en"
    }
}

/// Applies the `language` setting: "tr", "en" or "auto".
pub fn apply(pref: &str) {
    let tr = match pref {
        "tr" => true,
        "en" => false,
        _ => system_is_turkish(),
    };
    TURKISH.store(tr, Ordering::Relaxed);
}

pub fn is_tr() -> bool {
    TURKISH.load(Ordering::Relaxed)
}

/// The string for the current language.
pub fn pick(en: &'static str, tr: &'static str) -> &'static str {
    if is_tr() {
        tr
    } else {
        en
    }
}
