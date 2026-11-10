//! INPUT: explicit Home-window setup and reveal actions guarded by Tauri command ACLs
//! OUTPUT: Shell-only opt-in configuration and a dedicated local attachment pairing view
//! POS: shell/operator commands — no Core RPC, model tool or credential-catalog read surface

use std::sync::{Arc, Mutex};
use serde::Serialize;
use tauri::{Manager, State};
use crate::browser_attachment::{BrowserAttachment, PairingDetails};

pub(crate) struct BrowserAttachmentHandle(pub Mutex<Arc<BrowserAttachment>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupResult { restart_required: bool }

pub(crate) fn data_dir(handle: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Some(value) = std::env::var_os("TAKI_SHELL_DATA_DIR") {
        let path = std::path::PathBuf::from(value);
        if !path.is_absolute() { return Err("TAKI_SHELL_DATA_DIR must be absolute".into()); }
        return Ok(path);
    }
    handle.path().app_data_dir().map_err(|_| "Shell data directory unavailable".into())
}

#[tauri::command]
pub(crate) fn browser_attachment_setup(app: tauri::AppHandle, enabled: bool) -> Result<SetupResult, String> {
    let root = data_dir(&app)?;
    std::fs::create_dir_all(&root).map_err(|_| "无法保存浏览器连接设置")?;
    // This file carries only opt-in and an unprivileged loopback port. The actual credential stays in SecretStore.
    let target = root.join("browser-attachment.json");
    let temporary = root.join(format!(".browser-attachment-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, serde_json::json!({ "enabled": enabled, "port": 18793 }).to_string())
        .map_err(|_| "无法保存浏览器连接设置")?;
    if let Err(_error) = std::fs::rename(&temporary, &target) {
        let _ = std::fs::remove_file(&temporary);
        return Err("无法提交浏览器连接设置".into());
    }
    app.state::<BrowserAttachmentHandle>().0.lock().map_err(|_| "浏览器连接状态不可用")?.reload_configuration();
    Ok(SetupResult { restart_required: false })
}

#[tauri::command]
pub(crate) fn browser_attachment_pair(state: State<'_, BrowserAttachmentHandle>) -> Result<Option<PairingDetails>, String> {
    let attachment = state.0.lock().map_err(|_| "浏览器连接状态不可用")?;
    if attachment.is_unavailable() { return Err("浏览器连接设置暂不可用，修复后将自动恢复".into()); }
    Ok(attachment.pairing_details())
}
