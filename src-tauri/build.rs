// The files in permissions/ make Tauri check every app command against the
// windows' capabilities (capabilities/*.json): the island, the settings window
// and the desktop mascot can each call only the commands their capability
// grants (see permissions/windows.toml).
fn main() {
    tauri_build::build()
}
