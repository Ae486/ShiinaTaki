//! INPUT: disposable fixture root/installation environment plus built production Home assets.
//! OUTPUT: debug-only Home WebView using the exact production QQMM adapter, with Core networking blocked.
//! POS: native acceptance harness; never invokes run(), node::build_node, user keyring or default profiles.

#[cfg(not(debug_assertions))]
compile_error!("The QQMM Home fixture is debug-only.");

use std::path::PathBuf;
use taki_desktop_lib::qqmm;
use tauri::utils::config::Csp;
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let root = PathBuf::from(
        std::env::var_os("QQMM_FIXTURE_ROOT").expect("explicit fixture root required"),
    );
    let installation = PathBuf::from(
        std::env::var_os("QQMM_MANAGEMENT_INSTALLATION").expect("explicit installation required"),
    );
    assert!(root.is_absolute() && root.starts_with(std::env::temp_dir()));
    assert!(installation.starts_with(&root));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    // Fixture-only policy. The built Home still executes its ordinary Core
    // hooks, but no WebSocket can reach the real local Core or a fixture Core.
    context.config_mut().app.security.csp = Some(Csp::Policy(
        "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost; img-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'".into(),
    ));
    let app = tauri::Builder::default()
        .manage(qqmm::runtime())
        .invoke_handler(tauri::generate_handler![
            qqmm::qqmm_open,
            qqmm::qqmm_request,
            qqmm::qqmm_close
        ])
        .on_window_event(qqmm::on_window_event)
        .setup(move |app| {
            for label in ["home", "main", "pet", "other"] {
                let path = if label == "home" {
                    "home.html?page=qqmm"
                } else {
                    "index.html"
                };
                WebviewWindowBuilder::new(app, label, WebviewUrl::App(path.into()))
                    .title(format!("QQMM isolated fixture · {label}"))
                    .inner_size(1100.0, 850.0)
                    .visible(label == "home")
                    .data_directory(root.join("webview"))
                    .build()?;
            }
            Ok(())
        })
        .build(context)
        .expect("isolated Home fixture failed");
    app.run(qqmm::on_app_event);
}
