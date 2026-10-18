//! INPUT:  strict Shared C1 custody requests, private invocation frames and bounded value-free results
//! OUTPUT: serde mirrors with UUID, digest, fixed-slot and safe-integer validation
//! POS:    shell/protocol — JSON describes admitted input; it cannot construct the post-gate context type

use serde::{Deserialize, Serialize};
use serde_json::Value;
use super::{CapabilityAuthorizationLineage, HostOperationControl, parse_timestamp};

pub const CUSTODY_REQUEST_BYTES: usize = 32 * 1024;
pub const CUSTODY_RESULT_BYTES: usize = 16 * 1024;
pub const CUSTODY_ENVELOPE_BYTES: usize = 16 * 1024 * 1024;
pub const CUSTODY_CAPABILITY: &str = "hindsight-custody";
pub(crate) const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HindsightSlot {
    #[serde(rename = "connectionApiKey")]
    Connection,
    #[serde(rename = "defaultModelApiKey")]
    DefaultModel,
    #[serde(rename = "retainModelApiKey")]
    RetainModel,
    #[serde(rename = "reflectModelApiKey")]
    ReflectModel,
    #[serde(rename = "consolidationModelApiKey")]
    ConsolidationModel,
    #[serde(rename = "embeddingApiKey")]
    Embedding,
    #[serde(rename = "rerankerApiKey")]
    Reranker,
}

impl HindsightSlot {
    fn may_inherit(self) -> bool {
        matches!(self, Self::RetainModel | Self::ReflectModel | Self::ConsolidationModel)
    }
    fn may_be_unused(self) -> bool { self.may_inherit() || matches!(self, Self::Embedding | Self::Reranker) }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source", deny_unknown_fields)]
pub enum HindsightSelectedEntry {
    #[serde(rename = "catalog")]
    Catalog { slot: HindsightSlot, #[serde(rename = "updatedAt")] updated_at: String },
    #[serde(rename = "inherit-default")]
    InheritDefault { slot: HindsightSlot },
    #[serde(rename = "unused")]
    Unused { slot: HindsightSlot },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HindsightPrepare {
    pub version: u8,
    pub snapshot_id: String,
    pub core_boot_id: String,
    pub core_host_id: String,
    pub catalog_store_id: String,
    pub catalog_key_version: u64,
    pub sealed_envelope_sha256: String,
    pub installation_id: String,
    pub configuration_digest: String,
    pub selection: Vec<HindsightSelectedEntry>,
}

impl HindsightPrepare {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && positive_safe(self.catalog_key_version))?;
        for value in [&self.snapshot_id, &self.core_boot_id, &self.core_host_id, &self.catalog_store_id] { require(valid_uuid(value))?; }
        for value in [&self.sealed_envelope_sha256, &self.installation_id, &self.configuration_digest] { require(valid_sha(value))?; }
        require(!self.selection.is_empty() && self.selection.len() <= 7)?;
        let mut slots = std::collections::HashSet::new();
        let mut inherited = false;
        let mut default_catalog = false;
        for entry in &self.selection {
            let slot = match entry {
                HindsightSelectedEntry::Catalog { slot, updated_at } => {
                    parse_timestamp(updated_at)?;
                    default_catalog |= *slot == HindsightSlot::DefaultModel;
                    slot
                }
                HindsightSelectedEntry::InheritDefault { slot } => { require(slot.may_inherit())?; inherited = true; slot }
                HindsightSelectedEntry::Unused { slot } => { require(slot.may_be_unused())?; slot }
            };
            require(slots.insert(*slot))?;
        }
        require(!inherited || default_catalog)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum HindsightOwner {
    #[serde(rename = "windows-token")]
    WindowsToken { #[serde(rename = "tokenUserSha256")] token_user_sha256: String },
    #[serde(rename = "unix-user")]
    UnixUser { uid: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HindsightInvocation {
    pub version: u8,
    pub request_id: String,
    pub control: HostOperationControl,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<CapabilityAuthorizationLineage>,
    pub owner: HindsightOwner,
    pub input: HindsightPrepare,
}

impl HindsightInvocation {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && valid_uuid(&self.request_id) && self.control.capability_id == CUSTODY_CAPABILITY)?;
        for value in [&self.control.run_id, &self.control.operation_id, &self.control.attempt_id,
            &self.control.target_host_id, &self.control.idempotency_key] { require(valid_uuid(value))?; }
        for value in [&self.control.input_digest, &self.control.governance_projection.digest] { require(valid_sha(value))?; }
        for value in [&self.control.dispatched_at, &self.control.deadline_at] { parse_timestamp(value)?; }
        if let Some(value) = &self.control.expires_at { parse_timestamp(value)?; }
        for value in [&self.control.core_attempt_id, &self.control.effect_id].into_iter().flatten() { require(valid_uuid(value))?; }
        let cells = &self.control.governance_projection.cells;
        require(!cells.is_empty() && cells.iter().all(|cell| !cell.key.is_empty())
            && cells.windows(2).all(|pair| pair[0].key < pair[1].key))?;
        for value in [self.control.connection_generation, self.control.catalog_generation, self.control.policy_generation,
            self.control.approval_generation, self.control.governance_projection.registry_revision,
            self.control.governance_projection.descriptor_revision, self.control.governance_projection.classifier_revision] {
            require(positive_safe(value))?;
        }
        match &self.owner {
            HindsightOwner::WindowsToken { token_user_sha256 } => require(valid_sha(token_user_sha256))?,
            HindsightOwner::UnixUser { uid } => require(*uid <= MAX_SAFE_INTEGER)?,
        }
        if let Some(authorization) = &self.authorization {
            require(valid_uuid(&authorization.authorization_id) && positive_safe(authorization.approval_generation)
                && valid_sha(&authorization.challenge_digest))?;
        }
        self.input.validate()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HindsightRefusal {
    UnsupportedInstallation, UnsafeInstallation, HostUnavailable, CustodyLocked, InputOversize,
    SnapshotStale, OutcomeUnknown, ApprovalRequired, Denied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum HindsightCustodyResult {
    Prepared {
        version: u8, snapshot_id: String, request_id: String, host_attempt_id: String,
        installation_id: String, sealed_envelope_sha256: String, configuration_digest: String, deployment_ready: bool,
    },
    Unavailable { version: u8, reason: HindsightRefusal, deployment_ready: bool },
}

impl HindsightCustodyResult {
    pub fn unavailable(reason: HindsightRefusal) -> Self {
        Self::Unavailable { version: 1, reason, deployment_ready: false }
    }
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Unavailable { version, deployment_ready, .. } => require(*version == 1 && !deployment_ready),
            Self::Prepared { version, snapshot_id, request_id, host_attempt_id, installation_id,
                sealed_envelope_sha256, configuration_digest, deployment_ready } => {
                require(*version == 1 && !deployment_ready)?;
                for value in [snapshot_id, request_id, host_attempt_id] { require(valid_uuid(value))?; }
                for value in [installation_id, sealed_envelope_sha256, configuration_digest] { require(valid_sha(value))?; }
                Ok(())
            }
        }
    }
}

pub fn parse_hindsight_prepare(value: Value) -> Result<HindsightPrepare, String> {
    let value: HindsightPrepare = serde_json::from_value(value).map_err(|_| "invalid custody request")?;
    value.validate()?;
    Ok(value)
}
pub fn parse_hindsight_invocation(value: Value) -> Result<HindsightInvocation, String> {
    // Serde Option accepts explicit null, while Shared optional fields permit absence only. Preserve the
    // original wire distinction before deserialization discards it, including optional nested control fields.
    for path in ["/authorization", "/control/coreAttemptId", "/control/effectId", "/control/expiresAt"] {
        require(!value.pointer(path).is_some_and(Value::is_null))?;
    }
    let value: HindsightInvocation = serde_json::from_value(value).map_err(|_| "invalid custody invocation")?;
    value.validate()?;
    Ok(value)
}
pub fn parse_hindsight_result(value: Value) -> Result<HindsightCustodyResult, String> {
    let value: HindsightCustodyResult = serde_json::from_value(value).map_err(|_| "invalid custody result")?;
    value.validate()?;
    Ok(value)
}
pub(crate) fn require(valid: bool) -> Result<(), String> { if valid { Ok(()) } else { Err("invalid custody contract".into()) } }
pub(crate) fn positive_safe(value: u64) -> bool { value > 0 && value <= MAX_SAFE_INTEGER }
pub(crate) fn valid_sha(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
pub(crate) fn valid_uuid(value: &str) -> bool {
    let Ok(id) = uuid::Uuid::parse_str(value) else { return false; };
    id.hyphenated().to_string().eq_ignore_ascii_case(value) && (id.is_nil() || id.is_max()
        || (id.get_variant() == uuid::Variant::RFC4122 && (1..=8).contains(&id.get_version_num())))
}
