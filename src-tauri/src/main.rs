// Nobi runs without a console window: the owl is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = nobi_lib::cli() {
        std::process::exit(code);
    }
    nobi_lib::run()
}
