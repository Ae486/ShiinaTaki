//! INPUT: explicit temporary profile plus isolated asset/WS endpoints.
//! OUTPUT: real Home and Pet WebView2 windows with scoped self-window controls.
//! POS: debug-only C2 QA harness; never starts Node/Core, keyring, real profiles or providers.

#[cfg(not(debug_assertions))]
compile_error!("The C2 native fixture is debug-only.");

use std::path::PathBuf;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let root = PathBuf::from(std::env::var_os("C2_FIXTURE_ROOT").expect("fixture root required"));
    assert!(root.is_absolute() && root.starts_with(std::env::temp_dir()));
    let assets: u16 = std::env::var("C2_FIXTURE_ASSET_PORT")
        .expect("asset port")
        .parse()
        .expect("port");
    let ws: u16 = std::env::var("C2_FIXTURE_WS_PORT")
        .expect("WS port")
        .parse()
        .expect("port");
    let origin = format!("http://127.0.0.1:{assets}");
    let redirect = format!(
        "const NativeWebSocket = window.WebSocket; window.WebSocket = class extends NativeWebSocket {{ constructor(url, protocols) {{ if (!/^ws:\\/\\/(127\\.0\\.0\\.1|localhost):8974\\/?$/.test(String(url))) throw Error('Non-fixture WS blocked'); super('ws://127.0.0.1:{ws}', protocols); }} }};"
    );
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    // Remote fixture assets receive only these test-scoped self-window APIs. Production capabilities are unchanged.
    context.runtime_authority_mut().add_capability(serde_json::json!({
        "identifier": "c2-native-fixture", "description": "isolated C2 native QA",
        "windows": ["home", "pet"], "remote": {"urls": [format!("{origin}/*")]},
        "permissions": ["core:event:default", "core:window:allow-is-visible", "core:window:allow-is-minimized",
            "core:window:allow-is-focused", "core:window:allow-minimize", "core:window:allow-unminimize",
            "core:window:allow-hide", "core:window:allow-show", "core:window:allow-set-focus"]
    }).to_string()).expect("fixture ACL");
    tauri::Builder::default()
        .setup(move |app| {
            for (index, label) in ["home", "pet"].into_iter().enumerate() {
                let url = format!("{origin}/test/c2-presence-fixture.html?window={label}");
                WebviewWindowBuilder::new(
                    app,
                    label,
                    WebviewUrl::External(url.parse().expect("fixture URL")),
                )
                .title(format!("C2 isolated fixture · {label}"))
                .inner_size(if label == "home" { 1000.0 } else { 420.0 }, 720.0)
                .position(if index == 0 { 20.0 } else { 1050.0 }, 40.0)
                .initialization_script(&redirect)
                .data_directory(root.join("webview"))
                .build()?;
            }
            Ok(())
        })
        .run(context)
        .expect("isolated C2 fixture failed");
}
