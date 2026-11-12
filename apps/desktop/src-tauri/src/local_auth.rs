//! INPUT: selected Core profile discovery and a socket-bound shared-protocol challenge.
//! OUTPUT: verified server identity and one-use client proof; bootstrap keys remain native.
//! POS: shell/local_auth — native-only credential bridge, independent of execution Node startup.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::sync::Mutex;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use crate::secrets::{KeyringStore, SecretStore};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalDescriptor {
    pub version: u8,
    pub core_id: String,
    pub instance_id: String,
    pub endpoint: String,
}

/// Mirror of Shared LocalAuthChallengeSchema; no reusable credential is carried here.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LocalChallenge {
    pub version: u8,
    pub core_id: String,
    pub instance_id: String,
    pub endpoint: String,
    pub nonce: String,
    pub client_nonce: String,
    pub device_id: String,
    pub role: crate::protocol::Role,
    pub expires_at: u64,
    pub server_proof: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HostIdentity { host_id: String }

pub(crate) fn selected_profile() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("TAKI_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or("Local Core profile unavailable")?;
    Ok(PathBuf::from(home).join(".takiagent"))
}

pub(crate) fn descriptor() -> Result<LocalDescriptor, String> {
    let root = selected_profile()?;
    let identity: HostIdentity = read_record(root.join("host-identity.json"))?;
    let descriptor: LocalDescriptor = read_record(root.join("local-core.json"))?;
    if descriptor.version != 1 || descriptor.core_id != identity.host_id
        || uuid::Uuid::parse_str(&descriptor.core_id).is_err()
        || uuid::Uuid::parse_str(&descriptor.instance_id).is_err() {
        return Err("Local Core profile identity is invalid".into());
    }
    validate_endpoint(&descriptor.endpoint)?;
    Ok(descriptor)
}

fn read_record<T: serde::de::DeserializeOwned>(path: PathBuf) -> Result<T, String> {
    let bytes = std::fs::read(path).map_err(|_| "Local Core is not ready")?;
    if bytes.len() > 4096 { return Err("Local Core discovery is invalid".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "Local Core discovery is invalid".into())
}

pub(crate) fn validate_endpoint(endpoint: &str) -> Result<(), String> {
    let parsed = tauri::Url::parse(endpoint).map_err(|_| "Invalid local Core endpoint")?;
    if parsed.scheme() != "ws" || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Local Core endpoint must be a loopback WebSocket".into());
    }
    Ok(())
}

pub(crate) fn is_local_endpoint(endpoint: &str) -> bool {
    tauri::Url::parse(endpoint).ok().is_some_and(|url|
        matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")))
}

pub(crate) fn prove(challenge: &LocalChallenge, expected: &LocalDescriptor) -> Result<String, String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Local clock unavailable")?.as_millis() as u64;
    let key = profile_key(&expected.core_id)?;
    verify_and_sign(challenge, expected, (&key, now))
}

fn profile_key(core_id: &str) -> Result<Vec<u8>, String> {
    static KEY: Mutex<Option<(String, Vec<u8>)>> = Mutex::new(None);
    let mut cache = KEY.lock().map_err(|_| "Local Core credential state unavailable")?;
    if let Some((identity, key)) = cache.as_ref() {
        if identity == core_id { return Ok(key.clone()); }
    }
    let stored = KeyringStore::new().get(&format!("local-bootstrap-{core_id}"))
        .map_err(|_| "Local Core credential store unavailable")?.ok_or("Local Core credentials are not ready")?;
    let key = decode_hex(&stored).ok_or("Local Core credentials are invalid")?;
    *cache = Some((core_id.to_owned(), key.clone()));
    Ok(key)
}

fn verify_and_sign(challenge: &LocalChallenge, expected: &LocalDescriptor, context: (&[u8], u64)) -> Result<String, String> {
    let (key, now) = context;
    if key.len() != 32 || challenge.version != 1 || challenge.core_id != expected.core_id
        || challenge.instance_id != expected.instance_id || challenge.endpoint != expected.endpoint
        || challenge.expires_at <= now || challenge.expires_at > now.saturating_add(30_000)
        || uuid::Uuid::parse_str(&challenge.device_id).is_err()
        || decode_hex(&challenge.nonce).is_none() || decode_hex(&challenge.client_nonce).is_none() {
        return Err("Local Core challenge binding is invalid".into());
    }
    let proof = decode_hex(&challenge.server_proof).ok_or("Local Core proof is invalid")?;
    mac(key, "server", challenge)?.verify_slice(&proof).map_err(|_| "Local Core identity could not be verified")?;
    Ok(mac(key, "client", challenge)?.finalize().into_bytes().iter().map(|byte| format!("{byte:02x}")).collect())
}

fn mac(key: &[u8], side: &str, challenge: &LocalChallenge) -> Result<Hmac<Sha256>, String> {
    let transcript = serde_json::to_string(&serde_json::json!([
        challenge.version, challenge.core_id, challenge.instance_id, challenge.endpoint,
        challenge.nonce, challenge.client_nonce, challenge.device_id, challenge.role, challenge.expires_at
    ])).map_err(|_| "Local Core challenge encoding failed")?;
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| "Local Core credentials are invalid")?;
    mac.update(format!("taki-local-auth-v1:{side}\n{transcript}").as_bytes());
    Ok(mac)
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)) { return None; }
    (0..value.len()).step_by(2).map(|index| u8::from_str_radix(&value[index..index + 2], 16).ok()).collect()
}

#[cfg(test)]
pub(crate) mod tests;
