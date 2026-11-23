// Small append-only log, nobetci.log in Nöbetçi's data folder
// (%LOCALAPPDATA%\Nobetci on Windows, ~/Library/Application Support/Nobetci on
// macOS, ~/.local/share/nobetci on Linux). Nothing leaves the machine. On Linux
// and macOS the folder and the file are the user's alone (0700 / 0600): the log
// names projects and paths. Where the file system cannot keep them private, the
// log is still written and says so (`settings::tighten`); where it cannot be
// written at all, the line goes to stderr, so a failure is never silent.

use std::io::Write;

use crate::settings;

pub fn line(message: impl AsRef<str>) {
    let stamp = crate::sys::local_time().stamp();
    let dir = settings::local_dir();
    let written = settings::private_dir(&dir).and_then(|()| {
        let path = dir.join("nobetci.log");
        // Keep it from growing forever: start fresh past ~1 MB.
        if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
            let _ = std::fs::remove_file(&path);
        }
        let mut file = open(&path)?;
        writeln!(file, "{stamp} {}", message.as_ref())?;
        for note in settings::take_loose() {
            writeln!(file, "{stamp} {note}")?;
        }
        Ok(())
    });
    if let Err(err) = written {
        eprintln!("{stamp} {} (nobetci.log could not be written: {err})", message.as_ref());
        for note in settings::take_loose() {
            eprintln!("{stamp} {note}");
        }
    }
}

/// Opens the log for appending, owner-only on Linux and macOS — including a log
/// an older version created with the default mode.
fn open(path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = file.metadata()?;
        settings::tighten(path, &meta, || file.set_permissions(std::fs::Permissions::from_mode(0o600)))?;
    }
    Ok(file)
}

#[cfg(all(test, unix))]
mod tests {
    #[test]
    fn the_log_is_private_even_when_an_older_version_made_it() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("nobetci-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("nobetci.log");
        std::fs::write(&path, b"old\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        super::open(&path).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        let fresh = dir.join("new.log");
        super::open(&fresh).unwrap();
        assert_eq!(std::fs::metadata(&fresh).unwrap().permissions().mode() & 0o777, 0o600);
        let _ = std::fs::remove_dir_all(dir);
    }
}
