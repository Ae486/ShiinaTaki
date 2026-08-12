//! INPUT:  Tauri app lifecycle (setup hook) + the submit_pairing_code / get_status commands from the Pet UI
//! OUTPUT: run() — inits tracing, boots the app, selects the approver, calls node::build_node, spawns the WS task
//! POS:    shell — the Tauri composition root (the ONLY place besides the dialog impl that touches Tauri); main.rs
//!         is a shim; the tauri-free assembly lives in node.rs (shared with bin/taki-node)

// audit/gate/node/secrets/status/ws_client are pub: the headless taki-node bin (a separate crate root) composes
// the same node from them; capability handlers and the wire protocol stay crate-internal.
pub mod audit;
mod capabilities_impl;
pub mod gate;
mod host_session;
pub mod node;
mod protocol;
pub mod secrets;
pub mod status;
pub mod ws_client;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tokio::sync::mpsc;

use gate::approver::{Approver, TwoStepDialogApprover};
use secrets::{KeyringStore, SecretStore};
use status::StatusEmitter;
use ws_client::WsClient;

const DEVICE_NAME: &str = "TakiAgent Shell";
const STATUS_EVENT: &str = "taki://status";

#[derive(Serialize)]
struct Pong {
    kind: &'static str,
    nonce: String,
}

// Scaffold IPC command proving the frontend↔Rust link (kept as the reference command).
#[tauri::command]
fn ping(nonce: String) -> String {
    let pong = Pong {
        kind: "pong",
        nonce,
    };
    format!("IPC ok: {} / {}", pong.kind, pong.nonce)
}

/// Holds the pairing-code sender; the Pet UI submits a code here and the WS task's handshake receives it.
struct PairingState {
    tx: mpsc::Sender<String>,
}

/// The latest node connection status, shared with the Pet UI. The WS task writes it on every transition; the UI seeds
/// from it on mount via `get_status`, because Tauri does not buffer an event emitted before a listener attaches — a
/// fresh WebView would otherwise miss the one-shot `pairing-required` and hang on the default "connecting".
#[derive(Clone)]
pub struct StatusHandle(pub Arc<Mutex<String>>);

// The Pet UI reads the current status on mount to close the emit-before-listener race.
#[tauri::command]
fn get_status(state: State<'_, StatusHandle>) -> String {
    state
        .0
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| "connecting".into())
}

// The Pet UI calls this after the user reads the pairing code from the core console (prd ruling 13).
#[tauri::command]
fn submit_pairing_code(code: String, state: State<'_, PairingState>) -> Result<(), String> {
    state.tx.try_send(code).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    node::init_tracing();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Persist ONLY the pet overlay's position across restarts (leader decision (a), issue #14). The `main`
        // pairing/status window is denied so its geometry is not tracked; SIZE is omitted because the pet is
        // non-resizable. Save/restore is entirely OS-side here — geometry never crosses the WS boundary.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .with_denylist(&["main"])
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let (tx, rx) = mpsc::channel::<String>(8);
            app.manage(PairingState { tx });

            let status = StatusHandle(Arc::new(Mutex::new("connecting".to_string())));
            app.manage(status.clone());

            let client = build_client(handle.clone(), status)?;
            // The long-lived node client runs on Tauri's tokio runtime; closing the Pet UI never stops it (invariant 4).
            tauri::async_runtime::spawn(async move { client.run(rx).await });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            submit_pairing_code,
            get_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Serialize, Clone)]
struct StatusPayload<'a> {
    state: &'a str,
}

/// Forwards node status to the Pet UI. Mirrors into the shared get_status state FIRST (a late-attaching WebView
/// misses one-shot emits), then emits the event; a failed emit (window closed) is not an error (invariant 4).
struct TauriStatusEmitter {
    app: tauri::AppHandle,
    status: Arc<Mutex<String>>,
}

impl StatusEmitter for TauriStatusEmitter {
    fn emit(&self, state: &str) {
        if let Ok(mut current) = self.status.lock() {
            *current = state.to_string();
        }
        let _ = self.app.emit(STATUS_EVENT, StatusPayload { state });
    }
}

// Resolves the Tauri-app-specific pieces (dirs, status sink, approver, keyring) and hands assembly to node::build_node.
fn build_client(
    handle: tauri::AppHandle,
    status: StatusHandle,
) -> Result<WsClient, Box<dyn std::error::Error>> {
    let data_dir = handle.path().app_data_dir()?; // Shell-owned, outside the Workspace by construction (D7)
    let exec_cwd = resolve_exec_cwd(&handle, &data_dir);
    let emitter: Arc<dyn StatusEmitter> = Arc::new(TauriStatusEmitter {
        app: handle.clone(),
        status: status.0,
    });
    node::build_node(node::NodeConfig {
        data_dir,
        exec_cwd,
        url: node::DEFAULT_WS_URL.to_string(),
        device_name: DEVICE_NAME.to_string(),
        capabilities: node::default_capabilities(),
        approver: select_approver(handle),
        secrets: Arc::new(KeyringStore::new()) as Arc<dyn SecretStore>,
        status: emitter,
    })
}

// The approver seam (R1): the scripted approver is a permission-gate BYPASS, so it exists only in debug builds
// (cfg — the type is absent in release) AND requires the TAKI_GATE_AUTOAPPROVE env opt-in; anything else — including
// a malformed spec — falls back to the real dialog (fail-closed). Normal runs are unchanged (R2).
fn select_approver(handle: tauri::AppHandle) -> Arc<dyn Approver> {
    #[cfg(debug_assertions)]
    if let Ok(spec) = std::env::var("TAKI_GATE_AUTOAPPROVE") {
        match gate::approver::ScriptedApprover::parse(&spec) {
            Ok(scripted) => return Arc::new(scripted),
            Err(error) => {
                tracing::error!(error = %error, "TAKI_GATE_AUTOAPPROVE ignored; falling back to the dialog approver");
            }
        }
    }
    tracing::info!("approver: two-step native dialog");
    Arc::new(TwoStepDialogApprover::new(handle))
}

// The default exec cwd (ruling 0): the Core Workspace dir when it exists on this Shell host, else a Shell-owned dir
// under app_data_dir. A config `cwd` overrides this inside ExecPolicy::load. Single-machine v1: the Workspace exists.
fn resolve_exec_cwd(handle: &tauri::AppHandle, data_dir: &std::path::Path) -> std::path::PathBuf {
    if let Ok(home) = handle.path().home_dir() {
        let workspace = home.join(".takiagent").join("workspace");
        if workspace.is_dir() {
            return workspace;
        }
    }
    let fallback = data_dir.join("exec-cwd");
    let _ = std::fs::create_dir_all(&fallback); // best-effort: a missing cwd would fail every spawn
    fallback
}
