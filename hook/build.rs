// Gives the Windows relay a version resource, so it carries the same product
// name and version as the app and the installer. Code signing checks these
// (SignPath's metadata restrictions), and Windows shows them under Properties.
fn main() {
    #[cfg(windows)]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = tauri_winres::WindowsResource::new();
        res.set("ProductName", "Nobi")
            .set("FileDescription", "Nobi hook relay")
            .set("OriginalFilename", "nobi-hook.exe")
            .set("LegalCopyright", "MIT License, Nobi contributors");
        res.compile().expect("compile the relay's version resource");
    }
}
