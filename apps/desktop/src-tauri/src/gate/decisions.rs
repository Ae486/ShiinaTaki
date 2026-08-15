//! INPUT:  a capability + an approver Scope/allow; a gate-decisions.json path (Shell-owned app_data_dir)
//! OUTPUT: read-only exact legacy Never lookup for production plus dormant pre-Slice-3 writer helpers used only by tests
//! POS:    shell/gate — Slice-3 compatibility input; production ws_client never prompts or writes this legacy store

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::audit::iso8601_utc;
use crate::gate::approver::Scope;

/// A remembered verdict: skip the ask and auto-allow (always) or auto-deny (never).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Remembered {
    Always,
    Never,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PersistedDecision {
    capability: String,
    decision: Remembered,
    #[serde(rename = "decidedAt")]
    decided_at: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct DecisionFile {
    decisions: Vec<PersistedDecision>,
}

/// once/session/always/never memory for the gate. Persisted verdicts survive a Shell restart; session ones do not.
pub struct DecisionStore {
    path: PathBuf,
    persisted: Mutex<HashMap<String, Remembered>>,
    session: Mutex<HashMap<String, Remembered>>,
    legacy_closed: bool,
}

impl DecisionStore {
    /// Loads persisted verdicts; a missing file is empty and a corrupt one is a WARNING + empty (re-askable, D7).
    pub fn load(path: PathBuf) -> Self {
        let (persisted, legacy_closed) = load_persisted(&path);
        Self { path, persisted: Mutex::new(persisted), session: Mutex::new(HashMap::new()), legacy_closed }
    }

    /// A remembered verdict for this capability (persisted first, then session), or None -> ask.
    pub fn get(&self, capability: &str) -> Option<Remembered> {
        if self.legacy_closed { return Some(Remembered::Never); }
        if let Some(remembered) = self.persisted.lock().unwrap().get(capability).copied() {
            return Some(remembered);
        }
        self.session.lock().unwrap().get(capability).copied()
    }

    /// Records the decision per scope: once -> nothing, session -> memory, always -> persisted (allow->always, deny->never).
    /// pub(super): only the gate module tree can write decision memory — the compiler half of the NL red line
    /// (research §3.2 clause 2); the source-scan test in gate.rs pins the single call site within it.
    pub(super) fn remember(&self, capability: &str, scope: Scope, allow: bool) {
        let remembered = if allow { Remembered::Always } else { Remembered::Never };
        match scope {
            Scope::Once => {}
            Scope::Session => {
                self.session.lock().unwrap().insert(capability.to_string(), remembered);
            }
            Scope::Always => {
                self.persisted.lock().unwrap().insert(capability.to_string(), remembered);
                self.persist();
            }
        }
    }

    fn persist(&self) {
        let decisions = self
            .persisted
            .lock()
            .unwrap()
            .iter()
            .map(|(capability, decision)| PersistedDecision {
                capability: capability.clone(),
                decision: *decision,
                decided_at: iso8601_utc(SystemTime::now()),
            })
            .collect();
        if let Err(error) = write_atomic(&self.path, &DecisionFile { decisions }) {
            tracing::error!(error = %error, "failed to persist gate decisions");
        }
    }
}

// Approvals are re-askable, not auth state: a missing file is empty, a corrupt file is a warning + empty.
fn load_persisted(path: &PathBuf) -> (HashMap<String, Remembered>, bool) {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (HashMap::new(), false),
        Err(error) => {
            tracing::warn!(error = %error, "gate decisions unreadable; starting empty");
            return (HashMap::new(), true);
        }
    };
    match serde_json::from_str::<DecisionFile>(&raw) {
        Ok(file) => {
            let mut result = HashMap::new();
            for entry in file.decisions {
                if result.contains_key(&entry.capability) {
                    tracing::warn!(code = "LEGACY_SHELL_DECISIONS_AMBIGUOUS", "legacy Shell decisions ambiguous; affected Host fails closed");
                    return (HashMap::new(), true);
                }
                result.insert(entry.capability, entry.decision);
            }
            (result, false)
        },
        Err(_) => {
            tracing::warn!("gate decisions file is malformed; starting empty");
            (HashMap::new(), true)
        }
    }
}

fn write_atomic(path: &PathBuf, file: &DecisionFile) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_vec_pretty(file)?)?;
    fs::rename(&temp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, DecisionStore) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gate-decisions.json");
        let store = DecisionStore::load(path);
        (dir, store)
    }

    #[test]
    fn once_is_not_remembered() {
        let (_dir, store) = store();
        store.remember("screenshot", Scope::Once, true);
        assert_eq!(store.get("screenshot"), None);
    }

    #[test]
    fn session_is_memory_only_and_not_persisted() {
        let (_dir, store) = store();
        store.remember("screenshot", Scope::Session, true);
        assert_eq!(store.get("screenshot"), Some(Remembered::Always));
        // A fresh load of the same path (a Shell restart) forgets a session grant.
        let reloaded = DecisionStore::load(store.path.clone());
        assert_eq!(reloaded.get("screenshot"), None);
    }

    #[test]
    fn always_is_durable_across_a_reload() {
        let (_dir, store) = store();
        store.remember("screenshot", Scope::Always, true);
        let reloaded = DecisionStore::load(store.path.clone());
        assert_eq!(reloaded.get("screenshot"), Some(Remembered::Always));
    }

    #[test]
    fn deny_plus_always_persists_as_never() {
        let (_dir, store) = store();
        store.remember("screenshot", Scope::Always, false);
        let reloaded = DecisionStore::load(store.path.clone());
        assert_eq!(reloaded.get("screenshot"), Some(Remembered::Never));
    }

    #[test]
    fn corrupt_file_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gate-decisions.json");
        fs::write(&path, b"{ not valid json").unwrap();
        let store = DecisionStore::load(path);
        assert_eq!(store.get("screenshot"), Some(Remembered::Never));
    }
}
