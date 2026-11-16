// Gives the Windows relay a version resource, so it carries the same product
// name and version as the app and the installer. Code signing checks these
// (SignPath's metadata restrictions), and Windows shows them under Properties.
fn main() {
    #[cfg(windows)]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = tauri_winres::WindowsResource::new();
        res.set("ProductName", "Nobetci")
            .set("FileDescription", "Nobetci hook relay")
            .set("OriginalFilename", "nobetci-hook.exe")
            .set("LegalCopyright", "MIT License, Nobetci contributors");
        res.compile().expect("compile the relay's version resource");
    }
}
