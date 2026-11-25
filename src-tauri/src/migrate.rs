//! Nobi was called Nöbetçi before 3.0. On the first start after the rename the
//! old install's settings, rules, history and agenda are copied over, the old
//! OpenAI key moves to the new credential-store entry, and the old login entry
//! is taken out (the new one is made when the copied settings ask for it).
//!
//! Nothing here touches `~/.claude/settings.json`: hooks that still run the old
//! relay show as out of date in Settings and are replaced through the reviewed
//! diff like any other update.

use std::path::{Path, PathBuf};

use crate::settings;

/// The folder name before 3.0, next to the new one.
const LEGACY_DIR: &str = if cfg!(target_os = "linux") { "nobetci" } else { "Nobetci" };
/// The product name before 3.0: what the old login entry is named after.
const LEGACY_APP_NAME: &str = "Nobetci";
/// Written into the new config folder once a migration has run (or was not
/// needed), so a later start never copies over the user's newer data.
const MARKER: &str = ".migrated-from-nobetci";

/// The old folder beside a new one: `…/Nobi` → `…/Nobetci`.
fn legacy_of(new: &Path) -> Option<PathBuf> {
    new.parent().map(|p| p.join(LEGACY_DIR))
}

/// Files of the old install that are not data: the relay and its uninstaller
/// are reinstalled under the new name, the log and socket are per run.
fn keep(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    !(lower.ends_with(".log")
        || lower.contains(".log.")
        || lower.ends_with(".sock")
        || lower.ends_with(".exe")
        || lower.ends_with(".tmp")
        || lower == MARKER)
}

/// Copies the top-level files of `old` that `keep` allows into `new`, never
/// over a file already there. Returns how many were copied.
fn copy_files(old: &Path, new: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(old) else { return 0 };
    let mut copied = 0;
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        let name = entry.file_name();
        let Some(text) = name.to_str() else { continue };
        if !kind.is_file() || !keep(text) {
            continue;
        }
        let dest = new.join(&name);
        if dest.exists() || std::fs::create_dir_all(new).is_err() {
            continue;
        }
        // fs::copy keeps the permission bits (0600 history stays 0600).
        if std::fs::copy(entry.path(), &dest).is_ok() {
            copied += 1;
        }
    }
    copied
}

/// What a migration found; `copied` > 0 means the old install's data came over.
pub struct Outcome {
    pub copied: usize,
}

/// Runs before the settings are first read. Pairs of (old, new) folders are
/// copied only while the new install has no settings of its own.
pub fn run() -> Outcome {
    let config = settings::config_dir();
    let local = settings::local_dir();
    let outcome = migrate_dirs(&config, &local);
    if outcome.copied > 0 {
        crate::log::line(format!("migrated {} file(s) from the Nöbetçi install", outcome.copied));
    }
    outcome
}

fn migrate_dirs(config: &Path, local: &Path) -> Outcome {
    let marker = config.join(MARKER);
    if marker.exists() || config.join("settings.json").exists() {
        return Outcome { copied: 0 };
    }
    let mut copied = 0;
    let mut pairs = vec![(legacy_of(config), config.to_path_buf())];
    if local != config {
        pairs.push((legacy_of(local), local.to_path_buf()));
    }
    let mut found_old = false;
    for (old, new) in pairs {
        let Some(old) = old.filter(|o| o.is_dir()) else { continue };
        found_old = true;
        copied += copy_files(&old, &new);
    }
    if found_old && std::fs::create_dir_all(config).is_ok() {
        let _ = std::fs::write(&marker, b"");
    }
    Outcome { copied }
}

/// Takes out the old install's login entry: its name was the old product name,
/// and it starts a program the rename has replaced. Whether the new one is made
/// follows the copied `autostart` setting (see `lib.rs`).
pub fn remove_legacy_login_entry() -> bool {
    let mut builder = auto_launch::AutoLaunchBuilder::new();
    builder.set_app_name(LEGACY_APP_NAME);
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    builder.set_app_path(&exe);
    #[cfg(target_os = "macos")]
    builder.set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent);
    let Ok(old) = builder.build() else { return false };
    match old.is_enabled() {
        Ok(true) => match old.disable() {
            Ok(()) => {
                crate::log::line("removed the Nöbetçi login entry");
                true
            }
            Err(err) => {
                crate::log::line(format!("could not remove the Nöbetçi login entry: {err}"));
                false
            }
        },
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nobi-migrate-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_old_install_comes_over_once_and_never_over_new_data() {
        let root = temp("once");
        let (old_cfg, old_local) = (root.join("cfg").join(LEGACY_DIR), root.join("local").join(LEGACY_DIR));
        let (cfg, local) = (root.join("cfg").join("Nobi"), root.join("local").join("Nobi"));
        std::fs::create_dir_all(old_cfg.join("bin")).unwrap();
        std::fs::create_dir_all(&old_local).unwrap();
        for (dir, name) in [
            (&old_cfg, "settings.json"),
            (&old_cfg, "agenda.json"),
            (&old_local, "audit.jsonl"),
            (&old_local, "nobetci.log"),
            (&old_local, "uninstall.exe"),
        ] {
            std::fs::write(dir.join(name), name).unwrap();
        }
        std::fs::write(old_cfg.join("bin").join("nobetci-hook.exe"), "x").unwrap();

        assert_eq!(migrate_dirs(&cfg, &local).copied, 3);
        assert_eq!(std::fs::read_to_string(cfg.join("settings.json")).unwrap(), "settings.json");
        assert!(cfg.join("agenda.json").exists() && local.join("audit.jsonl").exists());
        assert!(!local.join("nobetci.log").exists() && !local.join("uninstall.exe").exists());
        assert!(!cfg.join("bin").exists());
        // The old folders stay: the old uninstaller (or the user) removes them.
        assert!(old_cfg.join("settings.json").exists());

        // A second start copies nothing, even once the new settings are gone.
        std::fs::write(cfg.join("settings.json"), "mine").unwrap();
        std::fs::remove_file(cfg.join("agenda.json")).unwrap();
        assert_eq!(migrate_dirs(&cfg, &local).copied, 0);
        assert!(!cfg.join("agenda.json").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_fresh_install_without_an_old_one_writes_nothing() {
        let root = temp("fresh");
        let cfg = root.join("Nobi");
        assert_eq!(migrate_dirs(&cfg, &cfg).copied, 0);
        assert!(!cfg.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn new_settings_written_first_win() {
        let root = temp("new-first");
        let (old, cfg) = (root.join(LEGACY_DIR), root.join("Nobi"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::write(old.join("settings.json"), "old").unwrap();
        std::fs::write(cfg.join("settings.json"), "new").unwrap();
        assert_eq!(migrate_dirs(&cfg, &cfg).copied, 0);
        assert_eq!(std::fs::read_to_string(cfg.join("settings.json")).unwrap(), "new");
        let _ = std::fs::remove_dir_all(&root);
    }
}
