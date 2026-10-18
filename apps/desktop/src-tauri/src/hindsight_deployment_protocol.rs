//! INPUT:  strict Shared C2 plans, registrations, invocations and startup checkpoints
//! OUTPUT: validated serde mirrors with absent-only optional fields and exact resource bindings
//! POS:    shell/protocol — wire facts do not construct live Host or Native authority

use serde::{Deserialize, Serialize};
use serde_json::Value;
use super::{CapabilityAuthorizationLineage, HostOperationControl, HindsightOwner, HindsightPrepare, HindsightSlot, parse_timestamp};
use super::hindsight_custody_protocol::{positive_safe, require, valid_sha, valid_uuid};

pub const DEPLOYMENT_CAPABILITY: &str = "hindsight-deployment";
pub const DEPLOYMENT_OBSERVE_CAPABILITY: &str = "hindsight-deployment-observe";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentPlan {
    pub version: u8, pub deployment_id: String, pub operation_id: String,
    pub core_host_id: String, pub execution_host_id: String, pub installation_id: String,
    pub deployment_registration_sha256: String, pub engine_id: String, pub image_id: String,
    pub configuration_digest: String, pub consumer: String, pub storage: String,
}
impl DeploymentPlan {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && self.deployment_id == self.operation_id && self.consumer == "c2a-fake-v1" && self.storage == "new-named-volume")?;
        for id in [&self.deployment_id, &self.operation_id, &self.core_host_id, &self.execution_host_id] { require(valid_uuid(id))?; }
        for digest in [&self.installation_id, &self.deployment_registration_sha256, &self.configuration_digest] { require(valid_sha(digest))?; }
        require(valid_engine(&self.engine_id) && valid_image(&self.image_id))
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustodyAttemptMapping {
    pub core_operation_id: String, pub core_attempt_id: String, pub broker_operation_id: String,
    pub host_attempt_id: String, pub request_id: String, pub input_digest: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustodyLink {
    pub input: HindsightPrepare, pub mapping: CustodyAttemptMapping, pub deadline_at: String,
}
impl CustodyLink {
    fn validate(&self) -> Result<(), String> {
        self.input.validate()?; parse_timestamp(&self.deadline_at)?;
        for id in [&self.mapping.core_operation_id, &self.mapping.core_attempt_id, &self.mapping.broker_operation_id,
            &self.mapping.host_attempt_id, &self.mapping.request_id] { require(valid_uuid(id))?; }
        require(self.mapping.core_operation_id == self.mapping.broker_operation_id && valid_sha(&self.mapping.input_digest))
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeploymentAction { Create, Start, Inject }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentEffect {
    pub version: u8, pub action: DeploymentAction, pub plan: DeploymentPlan, pub custody: CustodyLink,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_id: Option<String>,
}
impl DeploymentEffect {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1)?; self.plan.validate()?; self.custody.validate()?;
        require(self.plan.configuration_digest == self.custody.input.configuration_digest
            && self.plan.installation_id == self.custody.input.installation_id && self.plan.core_host_id == self.custody.input.core_host_id)?;
        require(match self.action {
            DeploymentAction::Create => self.container_id.is_none() && self.startup_id.is_none(),
            DeploymentAction::Start => self.container_id.as_deref().is_some_and(valid_sha) && self.startup_id.is_none(),
            DeploymentAction::Inject => self.container_id.as_deref().is_some_and(valid_sha) && self.startup_id.as_deref().is_some_and(valid_uuid),
        })
    }
    pub fn cell(&self) -> &'static str {
        match self.action { DeploymentAction::Create => "hindsight-deployment:create",
            DeploymentAction::Start => "hindsight-deployment:start", DeploymentAction::Inject => "hindsight-deployment:inject" }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentObserve { pub version: u8, pub deployment_id: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DeploymentInput { Effect(Box<DeploymentEffect>), Observe(DeploymentObserve) }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentInvocation {
    pub version: u8, pub request_id: String, pub control: HostOperationControl,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<CapabilityAuthorizationLineage>,
    pub owner: HindsightOwner, pub input: DeploymentInput,
}
impl DeploymentInvocation {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && valid_uuid(&self.request_id))?;
        validate_control(&self.control, self.authorization.as_ref())?;
        match &self.owner {
            HindsightOwner::WindowsToken { token_user_sha256 } => require(valid_sha(token_user_sha256))?,
            HindsightOwner::UnixUser { uid } => require(*uid <= super::hindsight_custody_protocol::MAX_SAFE_INTEGER)?,
        }
        match &self.input {
            DeploymentInput::Effect(effect) => { require(self.control.capability_id == DEPLOYMENT_CAPABILITY)?; effect.validate() }
            DeploymentInput::Observe(input) => require(self.control.capability_id == DEPLOYMENT_OBSERVE_CAPABILITY && input.version == 1 && valid_uuid(&input.deployment_id)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InjectionCheckpoint {
    pub version: u8, pub request_id: String, pub control: HostOperationControl,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<CapabilityAuthorizationLineage>,
    pub checkpoint_id: String, pub deployment_id: String, pub container_id: String, pub startup_id: String,
    pub configuration_digest: String, pub custody_snapshot_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeStartupBinding {
    pub startup_id: String, pub configuration_digest: String, pub operation_id: String,
    pub attempt_id: String, pub authorization_id: String, pub deadline_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source", deny_unknown_fields)]
pub enum FixedSelectionEntry {
    #[serde(rename = "catalog")]
    Catalog { slot: HindsightSlot },
    #[serde(rename = "inherit-default")]
    InheritDefault { slot: HindsightSlot },
    #[serde(rename = "unused")]
    Unused { slot: HindsightSlot },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeStartupPermit {
    pub version: u8, pub checkpoint_id: String, pub binding: NativeStartupBinding, pub selection: Vec<FixedSelectionEntry>,
}
impl NativeStartupPermit {
    pub fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && valid_uuid(&self.checkpoint_id) && valid_sha(&self.binding.configuration_digest))?;
        for id in [&self.binding.startup_id, &self.binding.operation_id, &self.binding.attempt_id, &self.binding.authorization_id] { require(valid_uuid(id))?; }
        parse_timestamp(&self.binding.deadline_at)?;
        require(!self.selection.is_empty() && self.selection.len() <= 7)?;
        let mut slots = std::collections::HashSet::new(); let mut inherits = false; let mut default = false;
        for entry in &self.selection {
            let slot = match entry {
                FixedSelectionEntry::Catalog { slot } => { default |= *slot == HindsightSlot::DefaultModel; slot }
                FixedSelectionEntry::InheritDefault { slot } => { inherits = true;
                    require(matches!(slot, HindsightSlot::RetainModel | HindsightSlot::ReflectModel | HindsightSlot::ConsolidationModel))?; slot }
                FixedSelectionEntry::Unused { slot } => { require(!matches!(slot, HindsightSlot::Connection | HindsightSlot::DefaultModel))?; slot }
            };
            require(slots.insert(*slot))?;
        }
        require(!inherits || default)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case", deny_unknown_fields)]
pub enum InjectionCheckpointResult { Granted { permit: NativeStartupPermit }, Unavailable { reason: DeploymentRefusal } }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeploymentRefusal {
    UnsupportedInstallation, UnsafeInstallation, HostUnavailable, CustodyLocked, InputOversize, SnapshotStale,
    OutcomeUnknown, ApprovalRequired, Denied, OwnershipConflict, EngineMismatch, ArtifactMismatch, RegistryUnavailable, RegistryFull,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeploymentState { Waiting, Running, Stopped, Unavailable, OutcomeUnknown }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentStatus {
    pub version: u8, pub state: DeploymentState, pub deployment_ready: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configuration_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<DeploymentRefusal>,
}
impl DeploymentStatus {
    fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && !self.deployment_ready && self.deployment_id == self.operation_id)?;
        for id in [&self.deployment_id, &self.operation_id, &self.startup_id, &self.attempt_id].into_iter().flatten() { require(valid_uuid(id))?; }
        for digest in [&self.configuration_digest, &self.container_id].into_iter().flatten() { require(valid_sha(digest))?; }
        require(self.state == DeploymentState::Unavailable || (self.deployment_id.is_some() && self.configuration_digest.is_some()))?;
        require(self.state != DeploymentState::Running || (self.container_id.is_some() && self.startup_id.is_some() && self.attempt_id.is_some()))
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentDockerRegistration { pub path: String, pub sha256: String, pub version: String, pub endpoint: String, pub engine_id: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentImageRegistration { pub id: String, pub os: String, pub architecture: String, pub consumer: String, pub bootstrap_version: u8 }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeploymentRegistration {
    pub version: u8, pub installation_id: String, pub core_host_id: String, pub execution_host_id: String,
    pub docker: DeploymentDockerRegistration, pub image: DeploymentImageRegistration, pub state_directory: String,
}
impl DeploymentRegistration {
    fn validate(&self) -> Result<(), String> {
        require(self.version == 1 && valid_sha(&self.installation_id) && valid_uuid(&self.core_host_id) && valid_uuid(&self.execution_host_id))?;
        require(valid_sha(&self.docker.sha256) && valid_engine(&self.docker.engine_id)
            && self.docker.endpoint == "npipe:////./pipe/dockerDesktopLinuxEngine"
            && !self.docker.version.is_empty() && self.docker.version.len() <= 128)?;
        for path in [&self.docker.path, &self.state_directory] { require(!path.contains('\0') && path.chars().count() <= 4096
            && (path.starts_with('/') || (path.len() > 2 && path.as_bytes()[0].is_ascii_alphabetic() && path.as_bytes()[1] == b':' && matches!(path.as_bytes()[2], b'/' | b'\\'))))?; }
        require(valid_image(&self.image.id) && self.image.os == "linux" && self.image.architecture == "amd64"
            && self.image.consumer == "c2a-fake-v1" && self.image.bootstrap_version == 1)
    }
}

pub fn parse_deployment_effect(value: Value) -> Result<DeploymentEffect, String> {
    absent_only(&value, &["/containerId", "/startupId"])?;
    let result: DeploymentEffect = serde_json::from_value(value).map_err(|_| "invalid deployment effect")?;
    result.validate()?; Ok(result)
}
pub fn parse_deployment_observe(value: Value) -> Result<DeploymentObserve, String> {
    let result: DeploymentObserve = serde_json::from_value(value).map_err(|_| "invalid deployment observation")?;
    require(result.version == 1 && valid_uuid(&result.deployment_id))?; Ok(result)
}
pub fn parse_deployment_invocation(value: Value) -> Result<DeploymentInvocation, String> {
    absent_only(&value, &["/authorization", "/control/coreAttemptId", "/control/effectId", "/control/expiresAt", "/input/containerId", "/input/startupId"])?;
    let result: DeploymentInvocation = serde_json::from_value(value).map_err(|_| "invalid deployment invocation")?;
    result.validate()?; Ok(result)
}
pub fn parse_deployment_checkpoint(value: Value) -> Result<InjectionCheckpoint, String> {
    absent_only(&value, &["/authorization", "/control/coreAttemptId", "/control/effectId", "/control/expiresAt"])?;
    let result: InjectionCheckpoint = serde_json::from_value(value).map_err(|_| "invalid deployment checkpoint")?;
    require(result.version == 1 && valid_sha(&result.container_id) && valid_sha(&result.configuration_digest))?;
    for id in [&result.request_id, &result.checkpoint_id, &result.deployment_id, &result.startup_id, &result.custody_snapshot_id] { require(valid_uuid(id))?; }
    validate_control(&result.control, result.authorization.as_ref())?; Ok(result)
}
pub fn parse_deployment_checkpoint_result(value: Value) -> Result<InjectionCheckpointResult, String> {
    let result: InjectionCheckpointResult = serde_json::from_value(value).map_err(|_| "invalid checkpoint result")?;
    if let InjectionCheckpointResult::Granted { permit } = &result { permit.validate()?; }
    Ok(result)
}
pub fn parse_deployment_status(value: Value) -> Result<DeploymentStatus, String> {
    absent_only(&value, &["/deploymentId", "/operationId", "/configurationDigest", "/containerId", "/startupId", "/attemptId", "/reason"])?;
    let result: DeploymentStatus = serde_json::from_value(value).map_err(|_| "invalid deployment status")?;
    result.validate()?; Ok(result)
}
pub fn parse_deployment_registration(value: Value) -> Result<DeploymentRegistration, String> {
    let result: DeploymentRegistration = serde_json::from_value(value).map_err(|_| "invalid deployment registration")?;
    result.validate()?; Ok(result)
}
fn absent_only(value: &Value, paths: &[&str]) -> Result<(), String> {
    require(!paths.iter().any(|path| value.pointer(path).is_some_and(Value::is_null)))
}
fn valid_engine(value: &str) -> bool { !value.is_empty() && value.len() <= 128 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b":_.-".contains(&b)) }
fn valid_image(value: &str) -> bool { value.strip_prefix("sha256:").is_some_and(valid_sha) }
fn validate_control(control: &HostOperationControl, authorization: Option<&CapabilityAuthorizationLineage>) -> Result<(), String> {
    for id in [&control.run_id, &control.operation_id, &control.attempt_id, &control.target_host_id, &control.idempotency_key] { require(valid_uuid(id))?; }
    for id in [&control.core_attempt_id, &control.effect_id].into_iter().flatten() { require(valid_uuid(id))?; }
    for digest in [&control.input_digest, &control.governance_projection.digest] { require(valid_sha(digest))?; }
    for stamp in [&control.dispatched_at, &control.deadline_at] { parse_timestamp(stamp)?; }
    if let Some(stamp) = &control.expires_at { parse_timestamp(stamp)?; }
    for generation in [control.connection_generation, control.catalog_generation, control.policy_generation, control.approval_generation,
        control.governance_projection.registry_revision, control.governance_projection.descriptor_revision, control.governance_projection.classifier_revision] { require(positive_safe(generation))?; }
    let cells = &control.governance_projection.cells;
    require(!cells.is_empty() && cells.iter().all(|cell| !cell.key.is_empty()) && cells.windows(2).all(|pair| pair[0].key < pair[1].key))?;
    if let Some(value) = authorization { require(valid_uuid(&value.authorization_id) && positive_safe(value.approval_generation) && valid_sha(&value.challenge_digest))?; }
    Ok(())
}
