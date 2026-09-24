// Shared entry point for desktop (main.rs) and mobile (Android/iOS call this directly).
// The UI is the same React app as the web; it talks to the company's Akış server over HTTPS.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("Akış başlatılamadı");
}
