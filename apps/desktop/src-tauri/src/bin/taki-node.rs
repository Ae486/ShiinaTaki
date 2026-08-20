//! INPUT: node env configuration and stdin pairing codes
//! OUTPUT: debug-only headless governed capability Node with reconnecting WS client
//! POS: shell/bin — E2E/CI composition root; release builds refuse the scripted-approver bypass

#[cfg(debug_assertions)]
use std::collections::HashMap;
#[cfg(debug_assertions)]
use std::path::PathBuf;
#[cfg(debug_assertions)]
use std::sync::{Arc, Mutex};

#[cfg(debug_assertions)]
use taki_desktop_lib::gate::approver::ScriptedApprover;
#[cfg(debug_assertions)]
use taki_desktop_lib::node::{self, NodeConfig};
#[cfg(debug_assertions)]
use taki_desktop_lib::secrets::SecretStore;
#[cfg(debug_assertions)]
use taki_desktop_lib::status::TracingStatusEmitter;

#[cfg(debug_assertions)]
#[tokio::main]
async fn main() {
    node::init_tracing();
    let config = match config_from_env() {
        Ok(config) => config,
        Err(message) => {
            tracing::error!(error = %message, "taki-node configuration error");
            std::process::exit(2);
        }
    };
    let client = match node::build_node(config) {
        Ok(client) => client,
        Err(error) => {
            tracing::error!(error = %error, "taki-node failed to assemble");
            std::process::exit(1);
        }
    };
    let (tx, rx) = tokio::sync::mpsc::channel::<String>(8);
    spawn_stdin_pairing_reader(tx);
    client.run(rx).await;
}

#[cfg(not(debug_assertions))]
fn main() {
    // R1: the scripted approver (the only approver a windowless node can use) must never ship; neither does this bin.
    eprintln!("taki-node is a debug-only test harness; it is not available in release builds");
    std::process::exit(1);
}

#[cfg(debug_assertions)]
fn config_from_env() -> Result<NodeConfig, String> {
    let data_dir = PathBuf::from(
        std::env::var("TAKI_DATA_DIR")
            .map_err(|_| "TAKI_DATA_DIR is required (the node's private state root)")?,
    );
    let spec = std::env::var("TAKI_GATE_AUTOAPPROVE").map_err(|_| {
        "TAKI_GATE_AUTOAPPROVE is required (scripted-approver directives, e.g. `allow-once`)"
    })?;
    let approver = ScriptedApprover::parse(&spec)?;

    let exec_cwd = data_dir.join("exec-cwd");
    let _ = std::fs::create_dir_all(&exec_cwd); // best-effort: a missing cwd would fail every spawn

    Ok(NodeConfig {
        exec_cwd,
        url: std::env::var("TAKI_WS_URL").unwrap_or_else(|_| node::DEFAULT_WS_URL.to_string()),
        device_name: std::env::var("TAKI_DEVICE_NAME")
            .unwrap_or_else(|_| "TakiAgent Headless Node".to_string()),
        capabilities: capabilities_from_env(),
        approver: Arc::new(approver),
        // File-backed, keyed under the node's own data dir: hermetic per-run identity/token, never the Shell keyring.
        secrets: Arc::new(FileSecretStore::load(data_dir.join("secrets.json"))?),
        status: Arc::new(TracingStatusEmitter),
        data_dir,
    })
}

#[cfg(debug_assertions)]
fn capabilities_from_env() -> Vec<String> {
    match std::env::var("TAKI_CAPABILITIES") {
        Ok(list) => list
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect(),
        Err(_) => node::default_capabilities(),
    }
}

// stdin is the pairing channel (see the header contract): each non-empty line is forwarded as a pairing code. The
// WS client consumes one only when the core answers pairing-required; earlier lines buffer in the channel.
#[cfg(debug_assertions)]
fn spawn_stdin_pairing_reader(tx: tokio::sync::mpsc::Sender<String>) {
    std::thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match std::io::stdin().read_line(&mut line) {
                Ok(0) | Err(_) => break, // EOF / broken pipe — no more pairing codes will arrive
                Ok(_) => {
                    let code = line.trim().to_string();
                    if !code.is_empty() && tx.blocking_send(code).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Plaintext JSON secrets under the node's data dir. Deliberately NOT the OS keyring: the harness must never touch
/// the real Shell's credentials, and a temp data dir makes every test run hermetic. Its create-only lock is
/// process-local, so parallel debug nodes must use distinct temp dirs. Debug-only bin — never ships.
#[cfg(debug_assertions)]
struct FileSecretStore {
    path: PathBuf,
    map: Mutex<HashMap<String, String>>,
}

#[cfg(debug_assertions)]
impl FileSecretStore {
    fn load(path: PathBuf) -> Result<Self, String> {
        let map = match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str(&raw).map_err(|error| {
                format!("node secret store {} is malformed: {error}", path.display())
            })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => {
                return Err(format!(
                    "node secret store {} is unreadable: {error}",
                    path.display()
                ))
            }
        };
        Ok(Self {
            path,
            map: Mutex::new(map),
        })
    }

    fn persist(&self, map: &HashMap<String, String>) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let raw = serde_json::to_vec_pretty(map).map_err(|error| error.to_string())?;
        std::fs::write(&self.path, raw).map_err(|error| error.to_string())
    }
}

#[cfg(debug_assertions)]
impl SecretStore for FileSecretStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self
            .map
            .lock()
            .map_err(|error| error.to_string())?
            .get(key)
            .cloned())
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), String> {
        let mut map = self.map.lock().map_err(|error| error.to_string())?;
        map.insert(key.to_string(), secret.to_string());
        self.persist(&map)
    }

    fn set_if_absent(&self, key: &str, secret: &str) -> Result<bool, String> {
        let mut map = self.map.lock().map_err(|error| error.to_string())?;
        if map.contains_key(key) {
            return Ok(false);
        }
        map.insert(key.to_string(), secret.to_string());
        self.persist(&map)?;
        Ok(true)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        let mut map = self.map.lock().map_err(|error| error.to_string())?;
        map.remove(key);
        self.persist(&map)
    }
}
