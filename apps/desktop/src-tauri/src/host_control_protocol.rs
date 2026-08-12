//! INPUT:  Host negotiation, catalog, request, cancellation, and response JSON wire frames
//! OUTPUT: strict serde mirrors of the canonical @taki/shared Host-control schemas
//! POS:    shell/protocol — Host-control wire declarations re-exported through protocol.rs
#![allow(dead_code)] // Wire DTOs: some fields exist purely for serde parity, not all are read.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const HOST_CONTROL_PROTOCOL_VERSION: u64 = 1;
pub const HOST_CATALOG_SCHEMA_VERSION: u64 = 1;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityRequest {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub control: HostOperationControl,
    pub input: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityCancelReason {
    CallerCancelled,
    DeadlineExceeded,
    PolicyRevoked,
    GenerationRetired,
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
    ExecFailed,
    UnsupportedCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityError {
    pub code: CapabilityErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum CapabilityRespond {
    Completed {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
        output: Value,
    },
    Failed {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
        error: CapabilityError,
    },
    Cancelled {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
    },
    OutcomeUnknown {
        #[serde(rename = "requestId")]
        request_id: String,
        control: HostOperationControl,
    },
}

impl CapabilityRespond {
    pub fn ok(request_id: String, control: HostOperationControl, output: Value) -> Self {
        Self::Completed {
            request_id,
            control,
            output,
        }
    }

    pub fn err(
        request_id: String,
        control: HostOperationControl,
        code: CapabilityErrorCode,
        message: String,
    ) -> Self {
        Self::Failed {
            request_id,
            control,
            error: CapabilityError { code, message },
        }
    }

    pub fn cancelled(request_id: String, control: HostOperationControl) -> Self {
        Self::Cancelled {
            request_id,
            control,
        }
    }

    pub fn outcome_unknown(request_id: String, control: HostOperationControl) -> Self {
        Self::OutcomeUnknown {
            request_id,
            control,
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

    pub fn control(&self) -> &HostOperationControl {
        match self {
            Self::Completed { control, .. }
            | Self::Failed { control, .. }
            | Self::Cancelled { control, .. }
            | Self::OutcomeUnknown { control, .. } => control,
        }
    }
}
