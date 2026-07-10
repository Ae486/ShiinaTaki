//! INPUT:  a key + secret string; the OS keyring (Windows Credential Manager via keyring v1)
//! OUTPUT: SecretStore trait + KeyringStore (real) + InMemoryStore (test/fallback fake)
//! POS:    shell/secrets — the node-token persistence seam (D6); NoEntry -> Ok(None); NO tauri:: types (unit-testable)

#[cfg(test)]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

/// The keyring service name; the node token lives under user "node-token", the device id under "device-id".
pub const KEYRING_SERVICE: &str = "TakiAgent";

/// A minimal secret backend. A missing entry is `Ok(None)`, never an error (the caller re-pairs).
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

/// The real backend: Windows Credential Manager (keyring installs the platform store on first `Entry::new`).
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new() -> Self {
        Self { service: KEYRING_SERVICE.to_string() }
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, key).map_err(|error| error.to_string())
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        match self.entry(key)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), String> {
        self.entry(key)?.set_password(secret).map_err(|error| error.to_string())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// An in-memory fake for unit tests — never touches Credential Manager (machine-global state, ruling 5).
#[cfg(test)]
#[derive(Default)]
pub struct InMemoryStore {
    map: Mutex<HashMap<String, String>>,
}

#[cfg(test)]
impl InMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg(test)]
impl SecretStore for InMemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        Ok(self.map.lock().unwrap().get(key).cloned())
    }

    fn set(&self, key: &str, secret: &str) -> Result<(), String> {
        self.map.lock().unwrap().insert(key.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.map.lock().unwrap().remove(key);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_fake_round_trips_and_maps_missing_to_none() {
        let store = InMemoryStore::new();
        // A never-set key is None (the NoEntry -> Ok(None) contract the KeyringStore also honors).
        assert_eq!(store.get("node-token").unwrap(), None);

        store.set("node-token", "secret-value").unwrap();
        assert_eq!(store.get("node-token").unwrap(), Some("secret-value".to_string()));

        store.delete("node-token").unwrap();
        assert_eq!(store.get("node-token").unwrap(), None);
        // Deleting an absent key is a no-op success, not an error.
        assert!(store.delete("node-token").is_ok());
    }
}
