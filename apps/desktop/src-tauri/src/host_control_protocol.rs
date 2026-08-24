//! INPUT:  Host negotiation, catalog, request, cancellation, and response JSON wire frames
//! OUTPUT: strict serde mirrors of the canonical @taki/shared Host-control schemas
//! POS:    shell/protocol — Host-control wire declarations re-exported through protocol.rs
#![allow(dead_code)] // Wire DTOs: some fields exist purely for serde parity, not all are read.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const HOST_CONTROL_PROTOCOL_VERSION: u64 = 3;
pub const HOST_CATALOG_SCHEMA_VERSION: u64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostProtocolRange {
    pub min: u64,
    pub max: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostDeclaration {
    pub protocol: HostProtocolRange,
    #[serde(rename = "catalogSchemaVersions")]
    pub catalog_schema_versions: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostNegotiation {
    #[serde(rename = "hostId")]
    pub host_id: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u64,
    #[serde(rename = "catalogSchemaVersion")]
    pub catalog_schema_version: u64,
    #[serde(rename = "connectionGeneration")]
    pub connection_generation: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HostLocalReadiness {
    Ready,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CapabilityExecutionKind {
    Read,
    Effect,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityCancellation {
    Cooperative,
    NonCooperative,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostCapabilityDescriptor {
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    pub execution: CapabilityExecutionKind,
    pub cancellation: CapabilityCancellation,
    pub governance: HostCapabilityGovernanceSupport,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostCapabilityGovernanceSupport {
    #[serde(rename = "descriptorRevision")]
    pub descriptor_revision: u64,
    #[serde(rename = "classifierId")]
    pub classifier_id: String,
    #[serde(rename = "classifierRevision")]
    pub classifier_revision: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostWorkspaceDescriptor {
    #[serde(rename = "workspaceId")]
    pub workspace_id: String,
    #[serde(rename = "rootLabel")]
    pub root_label: String,
    #[serde(rename = "transferCapabilityIds")]
    pub transfer_capability_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostSkillDescriptor {
    #[serde(rename = "skillId")]
    pub skill_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostMcpDescriptor {
    #[serde(rename = "mcpServerId")]
    pub mcp_server_id: String,
    #[serde(rename = "toolNames")]
    pub tool_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostCatalogPublish {
    #[serde(rename = "hostId")]
    pub host_id: String,
    pub label: String,
    #[serde(rename = "protocolVersion")]
    pub protocol_version: u64,
    #[serde(rename = "catalogSchemaVersion")]
    pub catalog_schema_version: u64,
    #[serde(rename = "connectionGeneration")]
    pub connection_generation: u64,
    #[serde(rename = "catalogGeneration")]
    pub catalog_generation: u64,
    #[serde(rename = "publishedAt")]
    pub published_at: String,
    pub readiness: HostLocalReadiness,
    #[serde(rename = "localReason", skip_serializing_if = "Option::is_none")]
    pub local_reason: Option<String>,
    pub capabilities: Vec<HostCapabilityDescriptor>,
    pub workspaces: Vec<HostWorkspaceDescriptor>,
    pub skills: Vec<HostSkillDescriptor>,
    #[serde(rename = "mcpServers")]
    pub mcp_servers: Vec<HostMcpDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HostFrameRejectReason {
    WrongHost,
    StaleGeneration,
    UnsupportedVersion,
    InvalidCatalog,
    UnknownRequest,
    Duplicate,
    Late,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostFrameAck {
    Accepted,
    Rejected { reason: HostFrameRejectReason },
}

impl Serialize for HostFrameAck {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        match self {
            Self::Accepted => {
                let mut value = serializer.serialize_struct("HostFrameAck", 1)?;
                value.serialize_field("accepted", &true)?;
                value.end()
            }
            Self::Rejected { reason } => {
                let mut value = serializer.serialize_struct("HostFrameAck", 2)?;
                value.serialize_field("accepted", &false)?;
                value.serialize_field("reason", reason)?;
                value.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for HostFrameAck {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        let object = value
            .as_object()
            .ok_or_else(|| serde::de::Error::custom("Host acknowledgement must be an object"))?;
        if object
            .keys()
            .any(|key| key != "accepted" && key != "reason")
        {
            return Err(serde::de::Error::custom(
                "Host acknowledgement contains an unknown field",
            ));
        }
        let accepted = object
            .get("accepted")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                serde::de::Error::custom("Host acknowledgement requires boolean accepted")
            })?;
        match (accepted, object.get("reason")) {
            (true, None) => Ok(Self::Accepted),
            (true, Some(_)) => Err(serde::de::Error::custom(
                "accepted Host acknowledgement cannot include reason",
            )),
            (false, None) => Err(serde::de::Error::custom(
                "rejected Host acknowledgement requires reason",
            )),
            (false, Some(reason)) => serde_json::from_value(reason.clone())
                .map(|reason| Self::Rejected { reason })
                .map_err(serde::de::Error::custom),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostOperationControl {
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "coreAttemptId", skip_serializing_if = "Option::is_none")]
    pub core_attempt_id: Option<String>,
    #[serde(rename = "effectId", skip_serializing_if = "Option::is_none")]
    pub effect_id: Option<String>,
    #[serde(rename = "operationId")]
    pub operation_id: String,
    #[serde(rename = "attemptId")]
    pub attempt_id: String,
    #[serde(rename = "targetHostId")]
    pub target_host_id: String,
    #[serde(rename = "connectionGeneration")]
    pub connection_generation: u64,
    #[serde(rename = "catalogGeneration")]
    pub catalog_generation: u64,
    #[serde(rename = "policyGeneration")]
    pub policy_generation: u64,
    #[serde(rename = "governanceProjection")]
    pub governance_projection: HostGovernanceProjection,
    #[serde(rename = "approvalGeneration")]
    pub approval_generation: u64,
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    #[serde(rename = "inputDigest")]
    pub input_digest: String,
    #[serde(rename = "idempotencyKey")]
    pub idempotency_key: String,
    #[serde(rename = "dispatchedAt")]
    pub dispatched_at: String,
    #[serde(rename = "deadlineAt")]
    pub deadline_at: String,
    #[serde(rename = "expiresAt", skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostGovernanceProjection {
    #[serde(rename = "registryRevision")]
    pub registry_revision: u64,
    #[serde(rename = "descriptorRevision")]
    pub descriptor_revision: u64,
    #[serde(rename = "classifierRevision")]
    pub classifier_revision: u64,
    pub cells: Vec<HostGovernanceCell>,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostGovernanceCell {
    pub key: String,
    pub posture: HostGovernancePosture,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HostGovernancePosture {
    Auto,
    Ask,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostGovernanceEvidence {
    #[serde(rename = "descriptorRevision")]
    pub descriptor_revision: u64,
    #[serde(rename = "classifierRevision")]
    pub classifier_revision: u64,
    #[serde(rename = "cellKey")]
    pub cell_key: String,
    #[serde(rename = "effectivePosture")]
    pub effective_posture: HostGovernancePosture,
    pub constraint: HostGovernanceConstraint,
}

impl HostGovernanceEvidence {
    fn default_for(control: &HostOperationControl) -> Self {
        // Early failures (for example, an input-digest mismatch) happen before
        // trusted argument classification. Bind their hard-deny evidence to a
        // real projected cell so Core can still verify the terminal frame.
        let blocked_key = format!("{}:blocked", control.capability_id);
        let cell_key = control
            .governance_projection
            .cells
            .iter()
            .find(|cell| cell.key == blocked_key)
            .or_else(|| {
                control
                    .governance_projection
                    .cells
                    .iter()
                    .find(|cell| cell.key == control.capability_id)
            })
            .or_else(|| control.governance_projection.cells.first())
            .map(|cell| cell.key.clone())
            .unwrap_or_else(|| control.capability_id.clone());
        Self {
            descriptor_revision: control.governance_projection.descriptor_revision,
            classifier_revision: control.governance_projection.classifier_revision,
            cell_key,
            effective_posture: HostGovernancePosture::Deny,
            constraint: HostGovernanceConstraint::Hard,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HostGovernanceConstraint {
    None,
    LegacyDeny,
    Local,
    Managed,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityRequest {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub control: HostOperationControl,
    pub input: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityExecute {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub control: HostOperationControl,
    #[serde(rename = "challengeId")]
    pub challenge_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization: Option<Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityCancelReason {
    CallerCancelled,
    DeadlineExceeded,
    PolicyRevoked,
    GenerationRetired,
    ApprovalDenied,
    ApprovalInvalidated,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityCancel {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub control: HostOperationControl,
    pub reason: CapabilityCancelReason,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapabilityErrorCode {
    Denied,
    ApprovalRequired,
    ExecFailed,
    UnsupportedCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityError {
    pub code: CapabilityErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityAuthorizationLineage {
    #[serde(rename = "authorizationId")]
    pub authorization_id: String,
    #[serde(rename = "approvalGeneration")]
    pub approval_generation: u64,
    #[serde(rename = "challengeDigest")]
    pub challenge_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum CapabilityRespond {
    Completed {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
        output: Value,
        governance: HostGovernanceEvidence,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        authorization: Option<CapabilityAuthorizationLineage>,
    },
    Failed {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
        error: CapabilityError,
        governance: HostGovernanceEvidence,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        authorization: Option<CapabilityAuthorizationLineage>,
    },
    Cancelled {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        authorization: Option<CapabilityAuthorizationLineage>,
    },
    OutcomeUnknown {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        authorization: Option<CapabilityAuthorizationLineage>,
    },
}

impl CapabilityRespond {
    pub fn ok(request_id: String, control: HostOperationControl, output: Value) -> Self {
        let governance = HostGovernanceEvidence::default_for(&control);
        Self::Completed {
            request_id,
            control,
            output,
            governance,
            authorization: None,
        }
    }

    pub fn err(
        request_id: String,
        control: HostOperationControl,
        code: CapabilityErrorCode,
        message: String,
    ) -> Self {
        let governance = HostGovernanceEvidence::default_for(&control);
        Self::Failed {
            request_id,
            control,
            error: CapabilityError { code, message },
            governance,
            authorization: None,
        }
    }

    pub fn with_governance(mut self, evidence: HostGovernanceEvidence) -> Self {
        match &mut self {
            Self::Completed { governance, .. } | Self::Failed { governance, .. } => {
                *governance = evidence
            }
            Self::Cancelled { .. } | Self::OutcomeUnknown { .. } => {}
        }
        self
    }

    pub fn with_authorization(mut self, lineage: CapabilityAuthorizationLineage) -> Self {
        match &mut self {
            Self::Completed { authorization, .. }
            | Self::Failed { authorization, .. }
            | Self::Cancelled { authorization, .. }
            | Self::OutcomeUnknown { authorization, .. } => *authorization = Some(lineage),
        }
        self
    }

    pub fn authorization(&self) -> Option<&CapabilityAuthorizationLineage> {
        match self {
            Self::Completed { authorization, .. }
            | Self::Failed { authorization, .. }
            | Self::Cancelled { authorization, .. }
            | Self::OutcomeUnknown { authorization, .. } => authorization.as_ref(),
        }
    }

    pub fn cancelled(request_id: String, control: HostOperationControl) -> Self {
        Self::Cancelled {
            request_id,
            control,
            authorization: None,
        }
    }

    pub fn outcome_unknown(request_id: String, control: HostOperationControl) -> Self {
        Self::OutcomeUnknown {
            request_id,
            control,
            authorization: None,
        }
    }

    pub fn request_id(&self) -> &str {
        match self {
            Self::Completed { request_id, .. }
            | Self::Failed { request_id, .. }
            | Self::Cancelled { request_id, .. }
            | Self::OutcomeUnknown { request_id, .. } => request_id,
        }
    }

    /// Cross-field rule shared with the zod schema: an ask-classified completion requires its
    /// Core-minted authorization lineage, and a lineage never vouches for a non-ask completion.
    pub fn validate_lineage(&self) -> Result<(), String> {
        if let Self::Completed { governance, authorization, .. } = self {
            let is_ask = governance.effective_posture == HostGovernancePosture::Ask;
            if is_ask != authorization.is_some() {
                return Err(
                    "a completed ask-classified execution requires matching authorization lineage".into(),
                );
            }
        }
        if let Some(lineage) = self.authorization() {
            if uuid::Uuid::parse_str(&lineage.authorization_id).is_err()
                || lineage.approval_generation == 0
                || !is_sha256_hex(&lineage.challenge_digest)
            {
                return Err("capability authorization lineage is malformed".into());
            }
        }
        Ok(())
    }

    pub fn control(&self) -> &HostOperationControl {
        match self {
            Self::Completed { control, .. }
            | Self::Failed { control, .. }
            | Self::Cancelled { control, .. }
            | Self::OutcomeUnknown { control, .. } => control,
        }
    }
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
