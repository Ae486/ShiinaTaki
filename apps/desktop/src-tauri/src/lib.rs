//! INPUT:  Tauri app lifecycle (setup hook) + the submit_pairing_code command from the Pet UI
//! OUTPUT: run() — boots the app, wires the gate/secrets/audit/capabilities, spawns the long-lived WS node task
//! POS:    shell — the app composition root (the ONLY place besides the dialog impl that touches Tauri); main.rs is a shim

mod audit;
mod capabilities_impl;
mod gate;
mod protocol;
mod secrets;
mod ws_client;

use std::hash::{BuildHasher, Hasher, RandomState};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{Manager, State};
use tokio::sync::mpsc;

use capabilities_impl::clipboard::{ClipboardReadExec, ClipboardWriteExec};
use capabilities_impl::exec::{ExecExec, ExecPolicy};
use capabilities_impl::process_list::ProcessListExec;
use capabilities_impl::screenshot::ScreenshotExec;
use capabilities_impl::shell_open::ShellOpenExec;
use capabilities_impl::CapabilityRegistry;
use gate::approver::TwoStepDialogApprover;
use gate::decisions::DecisionStore;
use gate::{Gate, GatePolicy};
use secrets::{KeyringStore, SecretStore};
use ws_client::WsClient;
use audit::FileAuditor;

const WS_URL: &str = "ws://127.0.0.1:8974"; // DEFAULT_WS_HOST:DEFAULT_WS_PORT (@taki/shared)
const DEVICE_NAME: &str = "TakiAgent Shell";
const DEVICE_ID_KEY: &str = "device-id";

#[derive(Serialize)]
struct Pong {
    kind: &'static str,
    nonce: String,
}

// Scaffold IPC command proving the frontend↔Rust link (kept as the reference command).
#[tauri::command]
fn ping(nonce: String) -> String {
    let pong = Pong { kind: "pong", nonce };
    format!("IPC ok: {} / {}", pong.kind, pong.nonce)
}

/// Holds the pairing-code sender; the Pet UI submits a code here and the WS task's handshake receives it.
struct PairingState {
    tx: mpsc::Sender<String>,
}

// The Pet UI calls this after the user reads the pairing code from the core console (prd ruling 13).
#[tauri::command]
fn submit_pairing_code(code: String, state: State<'_, PairingState>) -> Result<(), String> {
    state.tx.try_send(code).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let (tx, rx) = mpsc::channel::<String>(8);
            app.manage(PairingState { tx });

            let client = build_client(handle.clone())?;
            // The long-lived node client runs on Tauri's tokio runtime; closing the Pet UI never stops it (invariant 4).
            tauri::async_runtime::spawn(async move { client.run(rx).await });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ping, submit_pairing_code])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Assembles the gate (policy + decisions + native approver + audit), the capability handlers, and the WS client.
fn build_client(handle: tauri::AppHandle) -> Result<WsClient, Box<dyn std::error::Error>> {
    let data_dir = handle.path().app_data_dir()?; // Shell-owned, outside the Workspace by construction (D7)
    std::fs::create_dir_all(&data_dir)?;

    let secrets: Arc<dyn SecretStore> = Arc::new(KeyringStore::new());
    let device_id = ensure_device_id(secrets.as_ref());

    let decisions = Arc::new(DecisionStore::load(data_dir.join("gate-decisions.json")));
    let auditor = Arc::new(FileAuditor::new(data_dir.join("audit.jsonl")));
    let approver = Arc::new(TwoStepDialogApprover::new(handle.clone()));
    let gate = Arc::new(Gate::new(GatePolicy::new(), decisions, approver, auditor));

    // exec (#12): Shell-resolved cwd (ruling 0) — the Core Workspace if it exists on THIS host (single-machine v1),
    // else a Shell-owned dir under app_data_dir (invariant-8-safe: exec never assumes Core's filesystem). The policy
    // is load-or-degrade-safe and shared between the ExecExec handler (sandbox config) and the WS task (classify).
    let exec_cwd = resolve_exec_cwd(&handle, &data_dir);
    let exec_policy = Arc::new(ExecPolicy::load(&data_dir.join("exec-policy.json"), exec_cwd));

    let mut handlers = CapabilityRegistry::new();
    handlers.register(Arc::new(ScreenshotExec));
    handlers.register(Arc::new(ProcessListExec));
    handlers.register(Arc::new(ClipboardReadExec));
    handlers.register(Arc::new(ClipboardWriteExec));
    handlers.register(Arc::new(ShellOpenExec));
    handlers.register(Arc::new(ExecExec::new(exec_policy.clone())));

    Ok(WsClient {
        app: handle,
        url: WS_URL.to_string(),
        device_id,
        device_name: DEVICE_NAME.to_string(),
        // Each declared capability is one entry here + one register call above (invariant 7). clipboard is two
        // independently-gated names. workspace-files is NOT here — it executes Core-side (ruling 1).
        capabilities: vec![
            "screenshot".to_string(),
            "process-list".to_string(),
            "clipboard-read".to_string(),
            "clipboard-write".to_string(),
            "shell-open".to_string(),
            "exec".to_string(),
        ],
        secrets,
        gate,
        handlers: Arc::new(handlers),
        exec_policy,
    })
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

// A stable per-install device id (a v4-format UUID), generated once and persisted in the keyring.
fn ensure_device_id(secrets: &dyn SecretStore) -> String {
    if let Ok(Some(existing)) = secrets.get(DEVICE_ID_KEY) {
        return existing;
    }
    let id = generate_uuid_v4();
    let _ = secrets.set(DEVICE_ID_KEY, &id);
    id
}

// A v4-format UUID from OS-seeded RandomState entropy — no uuid crate (outside the pinned set); persisted, so one
// generation per install makes collisions irrelevant.
fn generate_uuid_v4() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos() as u64;
    let mut bytes = [0u8; 16];
    fill_random(&mut bytes[..8], nanos);
    fill_random(&mut bytes[8..], nanos ^ u64::from(std::process::id()));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

fn fill_random(slice: &mut [u8], seed: u64) {
    let mut hasher = RandomState::new().build_hasher(); // OS-seeded per process
    hasher.write_u64(seed);
    let value = hasher.finish();
    for (index, byte) in slice.iter_mut().enumerate() {
        *byte = (value >> (index * 8)) as u8;
    }
}
