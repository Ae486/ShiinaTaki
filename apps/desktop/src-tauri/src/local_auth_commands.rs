//! INPUT: actual invoking Home/Pet WebView and Shared local challenge data.
//! OUTPUT: non-secret Core endpoint and bounded operator proof after native server verification.
//! POS: shell/commands — finite native-only admission bridge; never exposes account selection or Node authority.

use crate::local_auth::{self, LocalChallenge};
use crate::secrets::SecretStore;

pub(crate) fn permitted_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "Operator window unavailable")?;
    let origin = url.origin().ascii_serialization();
    if !permitted_source(window.label(), &origin) {
        return Err("Local admission is limited to the native operator windows".into());
    }
    Ok(())
}

fn permitted_source(label: &str, origin: &str) -> bool {
    let local_origin = matches!(origin, "http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost")
        || (cfg!(debug_assertions) && origin == "http://localhost:1420");
    matches!(label, "home" | "pet") && local_origin
}

fn operator_identity(window: &tauri::WebviewWindow) -> Result<String, String> {
    use tauri::Manager;
    static IDENTITY: std::sync::Mutex<Option<(std::path::PathBuf, String)>> = std::sync::Mutex::new(None);
    let root = crate::browser_attachment_commands::data_dir(window.app_handle())?;
    let mut cache = IDENTITY.lock().map_err(|_| "Operator identity state unavailable")?;
    if let Some((path, identity)) = cache.as_ref() {
        if path == &root { return Ok(identity.clone()); }
    }
    let identity = stable_operator_identity(&crate::secrets::shell_store(&root))?;
    *cache = Some((root, identity.clone()));
    Ok(identity)
}

fn stable_operator_identity(store: &dyn SecretStore) -> Result<String, String> {
    const ACCOUNT: &str = "operator-device-id";
    if store.get(ACCOUNT)?.is_none() {
        store.set_if_absent(ACCOUNT, &uuid::Uuid::new_v4().to_string())?;
    }
    let identity = store.get(ACCOUNT)?.ok_or("Operator identity unavailable")?;
    uuid::Uuid::parse_str(&identity).map_err(|_| "Stored operator identity is invalid")?;
    Ok(identity)
}

#[tauri::command]
pub(crate) fn local_operator_identity(window: tauri::WebviewWindow) -> Result<String, String> {
    permitted_window(&window)?;
    operator_identity(&window)
}

#[tauri::command]
pub(crate) fn local_core_endpoint(window: tauri::WebviewWindow) -> Result<String, String> {
    permitted_window(&window)?;
    Ok(local_auth::descriptor()?.endpoint)
}

#[tauri::command]
pub(crate) fn local_operator_proof(window: tauri::WebviewWindow, challenge: LocalChallenge) -> Result<String, String> {
    permitted_window(&window)?;
    validate_identity(&challenge, &operator_identity(&window)?)?;
    local_auth::prove(&challenge, &local_auth::descriptor()?)
}

fn validate_identity(challenge: &LocalChallenge, identity: &str) -> Result<(), String> {
    if challenge.role != crate::protocol::Role::Operator || challenge.device_id != identity {
        return Err("Operator admission identity does not match this native profile".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests;
