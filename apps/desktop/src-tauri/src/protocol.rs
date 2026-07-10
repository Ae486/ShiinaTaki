//! INPUT:  JSON wire frames (parsed by serde) + the shared golden fixtures under packages/shared/fixtures/protocol
//! OUTPUT: serde mirrors of the @taki/shared protocol (connect, app-error, client frames, capability channel)
//! POS:    shell/protocol — the ONLY Rust declaration of the wire shapes (invariant 3); NO tauri:: types here
#![allow(dead_code)] // Wire DTOs: some fields exist purely for serde (de)serialization parity, not all are read.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The connect handshake role. Operators converse; this shell is always a node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Operator,
    Node,
}

/// Mirror of ConnectParamsSchema (`connect-schema.ts`); camelCase on the wire, token/pairingCode optional.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectParams {
    #[serde(rename = "deviceId")]
    pub device_id: String,
    #[serde(rename = "deviceName")]
    pub device_name: String,
    pub role: Role,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(rename = "pairingCode", skip_serializing_if = "Option::is_none")]
    pub pairing_code: Option<String>,
}

/// The single literal status of a successful connect result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectStatus {
    Ok,
}

/// Mirror of ConnectResultSchema; token appears exactly once (the connect that completes pairing).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectResult {
    pub status: ConnectStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// Mirror of the closed ErrorCode union (`error-code-schema.ts`); the node branches on PAIRING_REQUIRED vs AUTH_FAILED.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    ProviderError,
    InternalError,
    PairingRequired,
    AuthFailed,
    NotAuthenticated,
    AlreadyConnected,
    Forbidden,
}

/// A JSON-RPC id: string or number (mirror of `z.union([z.string(), z.number()])`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum JsonRpcId {
    Str(String),
    Num(i64),
}

/// The app-error envelope narrowed to its domain code — the shape the node reads (mirror of the vitest AppErrorFrame).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppErrorFrame {
    pub jsonrpc: String,
    pub id: Option<JsonRpcId>,
    pub error: AppErrorObject,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppErrorObject {
    pub code: i64,
    pub message: String,
    pub data: AppErrorData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppErrorData {
    pub code: ErrorCode,
}

/// A frame a JSON-RPC client may receive: a success response, an error response, or a server notification.
/// Untagged (the wire carries no discriminant); variants are ordered most-specific first (mirror of JsonRpcClientFrameSchema).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ClientFrame {
    Success {
        jsonrpc: String,
        id: JsonRpcId,
        result: Value,
    },
    Error {
        jsonrpc: String,
        id: Option<JsonRpcId>,
        error: Value,
    },
    Notification {
        jsonrpc: String,
        method: String,
        #[serde(default, skip_serializing_if = "Value::is_null")]
        params: Value,
    },
}

/// The capability.request notification params (core→node). strictObject parity: reject unknown keys.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CapabilityRequest {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub capability: String,
    pub input: Value,
}

/// The screenshot capability output carried by a successful capability.respond.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityOutput {
    #[serde(rename = "mediaType")]
    pub media_type: String,
    #[serde(rename = "dataBase64")]
    pub data_base64: String,
    pub width: u32,
    pub height: u32,
}

/// The closed wire error union shared with the core (`capability-schema.ts`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapabilityErrorCode {
    Denied,
    ExecFailed,
    UnsupportedCapability,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityError {
    pub code: CapabilityErrorCode,
    pub message: String,
}

/// The capability.respond params (node→core). Untagged; discriminated by the presence of output vs error.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum CapabilityRespond {
    Ok {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: bool,
        output: CapabilityOutput,
    },
    Err {
        #[serde(rename = "requestId")]
        request_id: String,
        ok: bool,
        error: CapabilityError,
    },
}

impl CapabilityRespond {
    /// A success respond frame for a captured screenshot.
    pub fn ok(request_id: String, output: CapabilityOutput) -> Self {
        Self::Ok { request_id, ok: true, output }
    }

    /// A failure respond frame carrying a closed-union wire code.
    pub fn err(request_id: String, code: CapabilityErrorCode, message: String) -> Self {
        Self::Err { request_id, ok: false, error: CapabilityError { code, message } }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures_dir() -> PathBuf {
        // The canonical golden-fixture home, read by BOTH vitest and cargo (ruling 4).
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/shared/fixtures/protocol")
    }

    // Parse `text` under the type owning `prefix`; on success return the re-serialized Value (for the round-trip trap).
    fn reparse(prefix: &str, text: &str) -> Option<Value> {
        match prefix {
            "connect-request" => serde_json::from_str::<ConnectParams>(text).ok().map(to_value),
            "connect-result" => serde_json::from_str::<ConnectResult>(text).ok().map(to_value),
            "app-error" => serde_json::from_str::<AppErrorFrame>(text).ok().map(to_value),
            "client-frame" => serde_json::from_str::<ClientFrame>(text).ok().map(to_value),
            "capability-request" => serde_json::from_str::<CapabilityRequest>(text).ok().map(to_value),
            "capability-respond" => serde_json::from_str::<CapabilityRespond>(text).ok().map(to_value),
            other => panic!("no serde type mapped for fixture prefix {other:?}"),
        }
    }

    fn to_value<T: Serialize>(value: T) -> Value {
        serde_json::to_value(value).expect("serialize back to Value")
    }

    #[test]
    fn golden_fixtures_parse_reject_and_round_trip() {
        let mut seen = 0;
        for entry in fs::read_dir(fixtures_dir()).expect("read fixtures dir") {
            let path = entry.expect("dir entry").path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if !name.ends_with(".json") {
                continue;
            }
            seen += 1;
            let stem: Vec<&str> = name.trim_end_matches(".json").split('.').collect();
            let prefix = stem[0];
            let valid = stem[stem.len() - 1] == "valid";
            let text = fs::read_to_string(&path).expect("read fixture");

            let reparsed = reparse(prefix, &text);
            assert_eq!(reparsed.is_some(), valid, "{name}: parse/reject disagreed with its validity tag");

            // Casing/rename drift trap: a valid frame must re-serialize to exactly what it parsed from.
            if let Some(round_tripped) = reparsed {
                let original: Value = serde_json::from_str(&text).expect("raw json");
                assert_eq!(round_tripped, original, "{name}: round-trip drifted (a rename/casing mismatch)");
            }
        }
        assert!(seen >= 12, "expected the full golden-fixture set, found {seen}");
    }
}
