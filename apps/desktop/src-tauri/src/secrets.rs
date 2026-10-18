//! INPUT:  a key + secret string; the OS keyring (Windows Credential Manager via keyring v1)
//! OUTPUT: SecretStore trait + KeyringStore (real) + InMemoryStore (test/fallback fake); Windows create-only writes
//! POS:    shell/secrets — token/master-key persistence seam; named mutex serializes cross-process first creation

#[cfg(any(test, windows))]
use std::collections::HashMap;
#[cfg(test)]
use std::sync::Mutex;

#[cfg(any(test, windows))]
use sha2::{Digest, Sha256};
#[cfg(windows)]
use windows::core::{HSTRING, HRESULT};
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0};
#[cfg(windows)]
use windows::Win32::Security::{GetLengthSid, GetTokenInformation, IsValidSid, TokenUser, TOKEN_QUERY, TOKEN_USER};
#[cfg(windows)]
use windows::Win32::System::Threading::{
    CreateMutexW, GetCurrentProcess, INFINITE, OpenProcessToken, ReleaseMutex, WaitForSingleObject,
};

/// The keyring service name; the node token lives under user "node-token", the device id under "device-id".
pub const KEYRING_SERVICE: &str = "TakiAgent";

/// A minimal secret backend. A missing entry is `Ok(None)`, never an error (the caller re-pairs).
pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, secret: &str) -> Result<(), String>;
    /// Stores only when absent. `false` means another creator already owns the key.
    fn set_if_absent(&self, key: &str, secret: &str) -> Result<bool, String>;
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

    fn entry(&self, key: &str) -> Result<keyring_core::Entry, String> {
        #[cfg(windows)]
        {
            let modifiers = HashMap::from([("persistence", "Local")]);
            let _ = keyring::Entry::new(&self.service, key).map_err(|error| error.to_string())?;
            keyring_core::Entry::new_with_modifiers(&self.service, key, &modifiers)
                .map_err(|error| error.to_string())
        }
        #[cfg(not(windows))]
        keyring::Entry::new(&self.service, key)
            .map(|entry| entry.inner)
            .map_err(|error| error.to_string())
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

    fn set_if_absent(&self, key: &str, secret: &str) -> Result<bool, String> {
        #[cfg(windows)]
        let _create_lock = CredentialCreateLock::acquire(&self.service, key)?;
        if self.get(key)?.is_some() {
            return Ok(false);
        }
        self.set(key, secret)?;
        Ok(true)
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        match self.entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(windows)]
struct CredentialCreateLock {
    handle: HANDLE,
}

#[cfg(windows)]
impl CredentialCreateLock {
    fn acquire(service: &str, key: &str) -> Result<Self, String> {
        let user_sid = current_user_sid()?;
        let name = HSTRING::from(credential_mutex_name(&user_sid, service, key));
        // SAFETY: the name is a live NUL-terminated HSTRING and no security-attribute pointer is supplied.
        let handle = unsafe { CreateMutexW(None, false, &name) }.map_err(|error| error.to_string())?;
        // SAFETY: CreateMutexW returned a valid waitable mutex handle owned by this guard.
        let wait = unsafe { WaitForSingleObject(handle, INFINITE) };
        if wait != WAIT_OBJECT_0 && wait != WAIT_ABANDONED {
            // SAFETY: the handle is valid and was not acquired, so only close is required.
            let _ = unsafe { CloseHandle(handle) };
            return Err("credential create lock wait failed".into());
        }
        Ok(Self { handle })
    }
}

#[cfg(any(test, windows))]
fn credential_mutex_name(user_sid: &[u8], service: &str, key: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(user_sid);
    digest.update(b"\0");
    digest.update(service.as_bytes());
    digest.update(b"\0");
    digest.update(key.as_bytes());
    format!("Global\\TakiAgent.SecretStore.{:x}", digest.finalize())
}

#[cfg(windows)]
pub(crate) fn current_user_sid() -> Result<Vec<u8>, String> {
    // SAFETY: GetCurrentProcess returns the live current-process pseudo handle.
    process_user_sid(unsafe { GetCurrentProcess() })
}

/// Used by installed custody to compare the launched runtime's actual token user with this Host's user.
#[cfg(windows)]
pub(crate) fn process_user_sid(process: HANDLE) -> Result<Vec<u8>, String> {
    let mut token = HANDLE::default();
    // SAFETY: the caller holds a live process handle; token points to writable storage.
    unsafe { OpenProcessToken(process, TOKEN_QUERY, &mut token) }
        .map_err(|error| format!("open process token failed: {error}"))?;
    let result = read_user_sid(token);
    // SAFETY: OpenProcessToken returned an owned token handle, closed exactly once here.
    let close_result = unsafe { CloseHandle(token) };
    match (result, close_result) {
        (Ok(sid), Ok(())) => Ok(sid),
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(format!("close process token failed: {error}")),
    }
}

#[cfg(windows)]
fn read_user_sid(token: HANDLE) -> Result<Vec<u8>, String> {
    let mut required = 0u32;
    // SAFETY: the zero-length probe supplies no destination and writes only the required byte count.
    let probe = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut required) };
    if let Err(error) = probe {
        if error.code() != HRESULT::from_win32(ERROR_INSUFFICIENT_BUFFER.0) {
            return Err(format!("query process-token SID size failed: {error}"));
        }
    }
    if required < std::mem::size_of::<TOKEN_USER>() as u32 {
        return Err("process-token SID response was too small".into());
    }
    let required = usize::try_from(required).map_err(|_| "process-token SID size overflow")?;
    let words = required.div_ceil(std::mem::size_of::<usize>());
    let mut buffer = vec![0usize; words];
    let buffer_bytes = u32::try_from(buffer.len() * std::mem::size_of::<usize>())
        .map_err(|_| "process-token SID buffer overflow")?;
    // SAFETY: the usize buffer is aligned for TOKEN_USER and is at least the probed byte length.
    unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            Some(buffer.as_mut_ptr().cast()),
            buffer_bytes,
            &mut u32::try_from(required).map_err(|_| "process-token SID size overflow")?,
        )
    }
    .map_err(|error| format!("read process-token SID failed: {error}"))?;
    // SAFETY: GetTokenInformation initialized a TOKEN_USER at the aligned start of the live buffer.
    let token_user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    let sid = token_user.User.Sid;
    // SAFETY: the SID pointer belongs to the validated TOKEN_USER buffer and remains live through this copy.
    if sid.is_invalid() || !unsafe { IsValidSid(sid).as_bool() } {
        return Err("process token returned an invalid user SID".into());
    }
    // SAFETY: IsValidSid accepted the SID, so GetLengthSid and the byte copy use its canonical extent.
    let sid_len = unsafe { GetLengthSid(sid) } as usize;
    let sid_bytes = unsafe { std::slice::from_raw_parts(sid.0.cast::<u8>(), sid_len) };
    Ok(sid_bytes.to_vec())
}

#[cfg(windows)]
impl Drop for CredentialCreateLock {
    fn drop(&mut self) {
        // SAFETY: successful/abandoned waits grant this thread mutex ownership until this guard is dropped.
        let _ = unsafe { ReleaseMutex(self.handle) };
        // SAFETY: this guard exclusively owns the valid kernel handle and closes it exactly once.
        let _ = unsafe { CloseHandle(self.handle) };
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

    fn set_if_absent(&self, key: &str, secret: &str) -> Result<bool, String> {
        let mut map = self.map.lock().unwrap();
        if map.contains_key(key) {
            return Ok(false);
        }
        map.insert(key.to_string(), secret.to_string());
        Ok(true)
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

    #[test]
    fn in_memory_create_only_keeps_the_first_value() {
        let store = InMemoryStore::new();
        assert_eq!(store.set_if_absent("master", "first"), Ok(true));
        assert_eq!(store.set_if_absent("master", "second"), Ok(false));
        assert_eq!(store.get("master").unwrap().as_deref(), Some("first"));
    }

    #[test]
    fn credential_mutex_names_are_global_user_and_account_scoped() {
        let first = credential_mutex_name(b"user-a", "TakiAgent", "master-v1");
        assert!(first.starts_with("Global\\TakiAgent.SecretStore."));
        assert_eq!(first, credential_mutex_name(b"user-a", "TakiAgent", "master-v1"));
        assert_ne!(first, credential_mutex_name(b"user-b", "TakiAgent", "master-v1"));
        assert_ne!(first, credential_mutex_name(b"user-a", "TakiAgent", "master-v2"));
        assert_ne!(first, credential_mutex_name(b"user-a", "OtherService", "master-v1"));
    }
}
