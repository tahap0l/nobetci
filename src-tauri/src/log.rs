// Small append-only log, nobetci.log in Nöbetçi's data folder
// (%LOCALAPPDATA%\Nobetci on Windows, ~/Library/Application Support/Nobetci on
// macOS). Nothing leaves the machine.

use std::io::Write;

use crate::settings;

pub fn line(message: impl AsRef<str>) {
    let stamp = crate::sys::local_time().stamp();
    let dir = settings::local_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("nobetci.log");
    // Keep it from growing forever: start fresh past ~1 MB.
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{stamp} {}", message.as_ref());
    }
}
