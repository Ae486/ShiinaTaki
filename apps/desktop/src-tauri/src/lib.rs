use serde::Serialize;

#[derive(Serialize)]
struct Pong {
    kind: &'static str,
    nonce: String,
}

// Scaffold IPC command proving the frontend↔Rust link. Commands defined in
// lib.rs must not be `pub` (Tauri macro requirement). Replaced by real
// capability commands (delegating to services/) in M3.
#[tauri::command]
fn ping(nonce: String) -> String {
    let pong = Pong { kind: "pong", nonce };
    format!("IPC ok: {} / {}", pong.kind, pong.nonce)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
