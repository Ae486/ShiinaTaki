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
use crate::capabilities_impl::screenshot::{ScreenshotAmbientExec, ScreenshotExec};
use crate::capabilities_impl::shell_open::ShellOpenExec;
use crate::capabilities_impl::CapabilityRegistry;
use crate::gate::approver::Approver;
use crate::gate::decisions::DecisionStore;
use crate::gate::level::{load_legacy_constraint, load_level};
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
/// screenshot-ambient shares screenshot's capture but is advertised (and governed) under its own name so the two
/// grants can never merge — this list, the exec's `capability()` and the governance cell key must agree exactly.
pub fn default_capabilities() -> Vec<String> {
    [
        "screenshot",
        "screenshot-ambient",
        "process-list",
        "clipboard-read",
        "clipboard-write",
        "shell-open",
        "exec",
        "foreground-window",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

/// Assembles the gate (policy + decisions + injected approver + audit), the capability handlers, and the WS client.
/// Tauri-free: the composition roots resolve dirs/approver/status sink and inject them.
pub fn build_node(config: NodeConfig) -> Result<WsClient, Box<dyn std::error::Error>> {
    let NodeConfig {
        data_dir,
        exec_cwd,
        url,
        device_name,
        capabilities,
        approver,
        secrets,
        status,
    } = config;
    std::fs::create_dir_all(&data_dir)?;

    let device_id = ensure_device_id(secrets.as_ref())?;
    let browser_attachment = crate::browser_attachment::BrowserAttachment::load(&data_dir, secrets.as_ref())?;
    let decisions = Arc::new(DecisionStore::load(data_dir.join("gate-decisions.json")));
    let auditor = Arc::new(FileAuditor::new(data_dir.join("audit.jsonl")));
    // The active Permission Level is read exactly once here — operator-written file, frozen for the process
    // lifetime, out of the agent's reach (research §3.2 clause 3).
    let level = load_level(&data_dir.join("permission-level.json"));
    let legacy_level = load_legacy_constraint(&data_dir.join("permission-level.json"));
    let gate = Arc::new(Gate::new(
        GatePolicy::new().with_level(level),
        decisions,
        approver,
        auditor,
    ).with_legacy_level(legacy_level));

    // The policy is load-or-degrade-safe and shared between the ExecExec handler (sandbox config) and the WS task
    // (classify) — exec's gate decision depends on the parsed command, not just the capability name (ruling 6).
    let exec_policy = Arc::new(ExecPolicy::load(
        &data_dir.join("exec-policy.json"),
        exec_cwd,
    ));

    let mut handlers = CapabilityRegistry::new();
    handlers.register(Arc::new(ScreenshotExec));
    handlers.register(Arc::new(ScreenshotAmbientExec));
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
        browser_attachment,
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
fn ensure_device_id(secrets: &dyn SecretStore) -> Result<String, std::io::Error> {
    match secrets.get(DEVICE_ID_KEY) {
        Ok(Some(existing)) if is_uuid(&existing) => Ok(existing),
        Ok(Some(_)) => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "stored device identity is not a valid UUID",
        )),
        Ok(None) => {
            let id = generate_uuid_v4();
            match secrets.set_if_absent(DEVICE_ID_KEY, &id) {
                Ok(true) => Ok(id),
                Ok(false) => match secrets.get(DEVICE_ID_KEY) {
                    Ok(Some(winner)) if is_uuid(&winner) => Ok(winner),
                    Ok(Some(_)) => Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "persisted winning device identity is not a valid UUID",
                    )),
                    Ok(None) => Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "device identity creator reported a winner but no identity was persisted",
                    )),
                    Err(error) => Err(std::io::Error::other(format!(
                        "failed to read winning device identity: {error}"
                    ))),
                },
                Err(error) => Err(std::io::Error::other(format!(
                    "failed to persist device identity: {error}"
                ))),
            }
        }
        Err(error) => Err(std::io::Error::other(format!(
            "failed to read device identity: {error}"
        ))),
    }
}

fn is_uuid(value: &str) -> bool {
    if value.len() != 36
        || [8, 13, 18, 23]
            .into_iter()
            .any(|index| value.as_bytes()[index] != b'-')
    {
        return false;
    }
    let compact: String = value
        .chars()
        .filter(|character| *character != '-')
        .collect();
    if compact.len() != 32 || !compact.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return false;
    }
    let bytes = compact.as_bytes();
    let nil = bytes.iter().all(|byte| *byte == b'0');
    let version = bytes[12].to_ascii_lowercase();
    let variant = bytes[16].to_ascii_lowercase();
    nil || ((b'1'..=b'8').contains(&version) && matches!(variant, b'8' | b'9' | b'a' | b'b'))
}

// A v4-format UUID from OS-seeded RandomState entropy — no uuid crate (outside the pinned set); persisted, so one
// generation per install makes collisions irrelevant.
fn generate_uuid_v4() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let mut bytes = [0u8; 16];
    fill_random(&mut bytes[..8], nanos);
    fill_random(&mut bytes[8..], nanos ^ u64::from(std::process::id()));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn fill_random(slice: &mut [u8], seed: u64) {
    let mut hasher = RandomState::new().build_hasher(); // OS-seeded per process
    hasher.write_u64(seed);
    let value = hasher.finish();
    for (index, byte) in slice.iter_mut().enumerate() {
        *byte = (value >> (index * 8)) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::{default_capabilities, ensure_device_id, DEVICE_ID_KEY};
    use crate::capabilities_impl::screenshot::ScreenshotAmbientExec;
    use crate::capabilities_impl::CapabilityExec;
    use crate::secrets::SecretStore;
    use std::sync::Mutex;

    #[test]
    fn the_ambient_capture_is_advertised_under_the_execs_own_name_beside_the_on_demand_one() {
        // Ties two of the three name sites together (advertised list <-> exec name); the third (the governance cell
        // key) is pinned in gate::governance's fixed-risk test. A drift on any of them is a runtime-only failure:
        // an unadvertised name never routes, an ungoverned key is a fail-closed deny.
        let capabilities = default_capabilities();
        assert!(capabilities.contains(&ScreenshotAmbientExec.capability().to_string()));
        assert!(
            capabilities.contains(&"screenshot".to_string()),
            "the on-demand name stays advertised separately"
        );
    }

    #[test]
    fn stable_device_identity_rejects_invalid_existing_state() {
        let invalid = FakeStore::with_value("not-a-uuid");
        assert!(ensure_device_id(&invalid)
            .unwrap_err()
            .to_string()
            .contains("valid UUID"));
        assert_eq!(
            invalid.set_calls(),
            0,
            "invalid identity must never be silently replaced"
        );
    }

    #[test]
    fn existing_device_identity_wins_without_a_write() {
        let existing = "d9428888-122b-4c2f-bc91-36301f6b3c80";
        let store = FakeStore::with_value(existing);
        assert_eq!(ensure_device_id(&store).unwrap(), existing);
        assert_eq!(store.set_calls(), 0);
    }

    #[test]
    fn missing_device_identity_persists_the_create_only_winner() {
        let store = FakeStore::default();
        let identity = ensure_device_id(&store).expect("missing identity is created and persisted");
        assert_eq!(store.get(DEVICE_ID_KEY).unwrap(), Some(identity));
    }

    #[test]
    fn losing_device_identity_creator_adopts_and_validates_the_persisted_winner() {
        let winner = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
        let store = FakeStore::with_competing_value(winner);
        assert_eq!(ensure_device_id(&store).unwrap(), winner);
        assert_eq!(store.set_calls(), 1);

        let malformed = FakeStore::with_competing_value("not-a-uuid");
        assert!(ensure_device_id(&malformed)
            .unwrap_err()
            .to_string()
            .contains("winning device identity"));
    }

    #[test]
    fn device_identity_store_errors_fail_closed() {
        let unreadable = FakeStore::with_get_error("keyring unavailable");
        assert!(ensure_device_id(&unreadable)
            .unwrap_err()
            .to_string()
            .contains("failed to read"));

        let failing = FakeStore::with_set_error("disk full");
        assert!(ensure_device_id(&failing)
            .unwrap_err()
            .to_string()
            .contains("failed to persist"));
    }

    #[derive(Default)]
    struct FakeState {
        value: Option<String>,
        get_error: Option<String>,
        set_error: Option<String>,
        competing_value: Option<String>,
        set_calls: usize,
    }

    #[derive(Default)]
    struct FakeStore(Mutex<FakeState>);

    impl FakeStore {
        fn with_value(value: &str) -> Self {
            Self(Mutex::new(FakeState {
                value: Some(value.into()),
                ..FakeState::default()
            }))
        }

        fn with_get_error(error: &str) -> Self {
            Self(Mutex::new(FakeState {
                get_error: Some(error.into()),
                ..FakeState::default()
            }))
        }

        fn with_set_error(error: &str) -> Self {
            Self(Mutex::new(FakeState {
                set_error: Some(error.into()),
                ..FakeState::default()
            }))
        }

        fn with_competing_value(value: &str) -> Self {
            Self(Mutex::new(FakeState {
                competing_value: Some(value.into()),
                ..FakeState::default()
            }))
        }

        fn set_calls(&self) -> usize {
            self.0.lock().unwrap().set_calls
        }
    }

    impl SecretStore for FakeStore {
        fn get(&self, _key: &str) -> Result<Option<String>, String> {
            let state = self.0.lock().unwrap();
            match &state.get_error {
                Some(error) => Err(error.clone()),
                None => Ok(state.value.clone()),
            }
        }

        fn set(&self, _key: &str, secret: &str) -> Result<(), String> {
            let mut state = self.0.lock().unwrap();
            state.set_calls += 1;
            if let Some(error) = &state.set_error {
                return Err(error.clone());
            }
            state.value = Some(secret.into());
            Ok(())
        }

        fn set_if_absent(&self, _key: &str, secret: &str) -> Result<bool, String> {
            let mut state = self.0.lock().unwrap();
            if let Some(error) = &state.get_error {
                return Err(error.clone());
            }
            if state.value.is_some() {
                return Ok(false);
            }
            state.set_calls += 1;
            if let Some(error) = &state.set_error {
                return Err(error.clone());
            }
            if let Some(winner) = state.competing_value.take() {
                state.value = Some(winner);
                return Ok(false);
            }
            state.value = Some(secret.into());
            Ok(true)
        }

        fn delete(&self, _key: &str) -> Result<(), String> {
            Ok(())
        }
    }
}
