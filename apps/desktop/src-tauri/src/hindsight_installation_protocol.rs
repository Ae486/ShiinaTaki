//! INPUT:  protected C1 installation registration and complete compiled-payload manifest
//! OUTPUT: strict Shared-compatible artifact/runtime/owner registration mirrors
//! POS:    shell/protocol — wire validation precedes the Windows retained-object trust checks

use serde::{Deserialize, Serialize};
use super::hindsight_custody_protocol::{positive_safe, require, valid_sha, valid_uuid, MAX_SAFE_INTEGER};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HindsightArtifact { pub path: String, pub sha256: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HindsightRuntime { pub path: String, pub sha256: String, pub version: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum HindsightCredentialSource {
    #[serde(rename = "windows-keyring")]
    WindowsKeyring { token_user_sha256: String, service: String, account: String, adapter: HindsightArtifact },
    #[serde(rename = "systemd")]
    Systemd { uid: u64, service: String, key_credential: String, node_credential: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HindsightRegistration {
    pub version: u8,
    pub installation_id: String,
    pub manifest_sha256: String,
    pub installation_root: String,
    pub runtime: HindsightRuntime,
    pub core_host_id: String,
    pub execution_host_id: String,
    pub catalog_store_id: String,
    pub core_data_directory: String,
    pub catalog_key_version: u64,
    pub custody: HindsightCredentialSource,
}

impl HindsightRegistration {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && positive_safe(self.catalog_key_version))?;
        for value in [&self.installation_id, &self.manifest_sha256, &self.runtime.sha256] { require(valid_sha(value))?; }
        for value in [&self.core_host_id, &self.execution_host_id, &self.catalog_store_id] { require(valid_uuid(value))?; }
        for value in [&self.installation_root, &self.core_data_directory, &self.runtime.path] { require(valid_path(value))?; }
        require(valid_node_version(&self.runtime.version))?;
        match &self.custody {
            HindsightCredentialSource::WindowsKeyring { token_user_sha256, service, account, adapter } => require(
                valid_sha(token_user_sha256) && service == "TakiAgent" && account == "secret-catalog-master-key-v1"
                    && valid_path(&adapter.path) && valid_sha(&adapter.sha256)),
            HindsightCredentialSource::Systemd { uid, service, key_credential, node_credential } => require(
                *uid <= MAX_SAFE_INTEGER && service == "taki-hindsight-host.service"
                    && key_credential == "taki-secret-catalog-master-key" && node_credential == "taki-hindsight-host-node"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HindsightManifest {
    pub version: u8,
    pub build: String,
    pub platform: String,
    pub architecture: String,
    pub entrypoint: String,
    pub files: Vec<HindsightArtifact>,
}

impl HindsightManifest {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && self.build == "taki-hindsight-host-c1-v1"
            && matches!(self.platform.as_str(), "win32" | "linux") && matches!(self.architecture.as_str(), "x64" | "arm64")
            && self.entrypoint == "app/main.js" && !self.files.is_empty())?;
        let mut paths = std::collections::HashSet::new();
        for file in &self.files {
            require(valid_sha(&file.sha256) && valid_relative_path(&file.path) && paths.insert(&file.path))?;
        }
        Ok(())
    }
}

pub fn parse_hindsight_registration(value: serde_json::Value) -> Result<HindsightRegistration, String> {
    let value: HindsightRegistration = serde_json::from_value(value).map_err(|_| "invalid custody registration")?;
    value.validate()?;
    Ok(value)
}
pub fn parse_hindsight_manifest(value: serde_json::Value) -> Result<HindsightManifest, String> {
    let value: HindsightManifest = serde_json::from_value(value).map_err(|_| "invalid custody manifest")?;
    value.validate()?;
    Ok(value)
}
fn valid_path(value: &str) -> bool { !value.is_empty() && value.encode_utf16().count() <= 4096 && !value.contains('\0') }
fn valid_node_version(value: &str) -> bool {
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3 && parts[0] == "v24" && parts[1..].iter().all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
}
fn valid_relative_path(value: &str) -> bool {
    !value.is_empty() && value.len() <= 1024 && value.split('/').all(|part| !part.is_empty() && part != "." && part != ".."
        && part.bytes().all(|b| b.is_ascii_alphanumeric() || b"_@.-".contains(&b)))
}
