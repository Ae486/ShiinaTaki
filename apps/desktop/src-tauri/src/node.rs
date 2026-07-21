//! INPUT:  NodeConfig — data/exec dirs, WS url, capability list, injected Approver/SecretStore/StatusEmitter
//! OUTPUT: build_node() -> WsClient (gate + decisions + audit + capability registry, fully wired); init_tracing
//! POS:    shell/node — the tauri-FREE node assembly; lib.rs (Tauri app) and bin/taki-node (headless) both call it

use std::hash::{BuildHasher, Hasher, RandomState};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::audit::FileAuditor;
use crate::capabilities_impl::clipboard::{ClipboardReadExec, ClipboardWriteExec};
use crate::capabilities_impl::exec::{ExecExec, ExecPolicy};
use crate::capabilities_impl::foreground_window::ForegroundWindowExec;
use crate::capabilities_impl::process_list::ProcessListExec;
use crate::capabilities_impl::screenshot::ScreenshotExec;
use crate::capabilities_impl::shell_open::ShellOpenExec;
use crate::capabilities_impl::CapabilityRegistry;
use crate::gate::approver::Approver;
use crate::gate::decisions::DecisionStore;
use crate::gate::level::load_level;
use crate::gate::{Gate, GatePolicy};
use crate::secrets::SecretStore;
use crate::status::StatusEmitter;
use crate::ws_client::WsClient;

/// DEFAULT_WS_HOST:DEFAULT_WS_PORT (@taki/shared).
pub const DEFAULT_WS_URL: &str = "ws://127.0.0.1:8974";

const DEVICE_ID_KEY: &str = "device-id";

/// Everything a node needs that depends on WHERE it runs (Tauri app vs headless bin); build_node supplies the rest.
pub struct NodeConfig {
    /// Node-owned state root (gate-decisions.json / audit.jsonl / exec-policy.json / permission-level.json) —
    /// outside the Workspace (D7).
    pub data_dir: PathBuf,
    /// The default exec working directory (a config `cwd` still overrides it inside ExecPolicy::load).
    pub exec_cwd: PathBuf,
    pub url: String,
    pub device_name: String,
    pub capabilities: Vec<String>,
    pub approver: Arc<dyn Approver>,
    pub secrets: Arc<dyn SecretStore>,
    pub status: Arc<dyn StatusEmitter>,
}

/// The full capability set this node build ships. One entry here + one register call in build_node per capability
/// (invariant 7). clipboard is two independently-gated names; workspace-files executes Core-side (ruling 1).
pub fn default_capabilities() -> Vec<String> {
    ["screenshot", "process-list", "clipboard-read", "clipboard-write", "shell-open", "exec", "foreground-window"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// Assembles the gate (policy + decisions + injected approver + audit), the capability handlers, and the WS client.
/// Tauri-free: the composition roots resolve dirs/approver/status sink and inject them.
pub fn build_node(config: NodeConfig) -> Result<WsClient, Box<dyn std::error::Error>> {
    let NodeConfig { data_dir, exec_cwd, url, device_name, capabilities, approver, secrets, status } = config;
    std::fs::create_dir_all(&data_dir)?;

    let device_id = ensure_device_id(secrets.as_ref());
    let decisions = Arc::new(DecisionStore::load(data_dir.join("gate-decisions.json")));
    let auditor = Arc::new(FileAuditor::new(data_dir.join("audit.jsonl")));
    // The active Permission Level is read exactly once here — operator-written file, frozen for the process
    // lifetime, out of the agent's reach (research §3.2 clause 3).
    let level = load_level(&data_dir.join("permission-level.json"));
    let gate = Arc::new(Gate::new(GatePolicy::new().with_level(level), decisions, approver, auditor));

    // The policy is load-or-degrade-safe and shared between the ExecExec handler (sandbox config) and the WS task
    // (classify) — exec's gate decision depends on the parsed command, not just the capability name (ruling 6).
    let exec_policy = Arc::new(ExecPolicy::load(&data_dir.join("exec-policy.json"), exec_cwd));

    let mut handlers = CapabilityRegistry::new();
    handlers.register(Arc::new(ScreenshotExec));
    handlers.register(Arc::new(ProcessListExec));
    handlers.register(Arc::new(ClipboardReadExec));
    handlers.register(Arc::new(ClipboardWriteExec));
    handlers.register(Arc::new(ShellOpenExec));
    handlers.register(Arc::new(ExecExec::new(exec_policy.clone())));
    handlers.register(Arc::new(ForegroundWindowExec));

    Ok(WsClient {
        url,
        device_id,
        device_name,
        capabilities,
        secrets,
        gate,
        handlers: Arc::new(handlers),
        exec_policy,
        status,
    })
}

/// The Shell's only subscriber init: without it every tracing line (gate decisions, audit failures, ws_client) is
/// dropped silently (R1/D1). Default level `info`, overridable via RUST_LOG; compact fmt to stderr; try_init keeps a
/// double call (tests / re-entry) harmless. Shared by the Tauri app and the headless bin.
pub fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .compact()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .try_init();
}

// A stable per-install device id (a v4-format UUID), generated once and persisted in the injected secret store —
// so the Tauri app (keyring) and a headless node (file store) each keep their own identity.
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
