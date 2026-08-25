//! INPUT:  JSON wire frames (parsed by serde) + the shared golden fixtures under packages/shared/fixtures/protocol
//! OUTPUT: stable protocol import surface, non-Host serde mirrors, and shared golden-fixture parity tests
//! POS:    shell/protocol — re-exports Host-control mirrors; NO tauri:: types here
#![allow(dead_code)] // Wire DTOs: some fields exist purely for serde (de)serialization parity, not all are read.

#[path = "host_control_protocol.rs"]
mod host_control_protocol;
pub use host_control_protocol::*;
#[path = "host_approval_protocol.rs"]
mod host_approval_protocol;
pub use host_approval_protocol::*;
#[path = "ws_challenge.rs"]
pub(crate) mod ws_challenge;
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
    pub host: HostDeclaration,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<HostNegotiation>,
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
    ConfigRefused,
    ScheduleRefused,
    ScheduleConflict,
    PolicyConflict,
    GovernanceRefused,
    GovernanceDenied,
    ApprovalRequired,
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

/// The screenshot capability output (mirror of ScreenshotOutputSchema; Option A: serialized to an opaque Value).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScreenshotOutput {
    #[serde(rename = "mediaType")]
    pub media_type: String,
    #[serde(rename = "dataBase64")]
    pub data_base64: String,
    pub width: u32,
    pub height: u32,
}

/// One process in a process-list snapshot (mirror of ProcessInfoSchema). cmd/argv is excluded in v1 (ruling 5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    #[serde(rename = "parentPid")]
    pub parent_pid: Option<u32>,
    #[serde(rename = "memoryBytes")]
    pub memory_bytes: u64,
    #[serde(rename = "startTime")]
    pub start_time: u64,
}

/// The process-list capability output (mirror of ProcessListOutputSchema).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessListOutput {
    pub processes: Vec<ProcessInfo>,
    pub count: usize,
}

/// The clipboard-read output (mirror of ClipboardReadOutputSchema); text is content — never logged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardReadOutput {
    pub text: String,
}

/// An ack for clipboard-write (mirror of ClipboardWriteOutputSchema); ok is always true on the success arm.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardWriteOutput {
    pub ok: bool,
}

/// The shell-open output (mirror of ShellOpenOutputSchema); echoes the launched target back to the model
/// (dialog + model only — the target never enters the audit line or a log).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShellOpenOutput {
    pub ok: bool,
    pub opened: String,
}

/// The exec output (mirror of ExecOutputSchema; Option A opaque payload). A nonzero exit / timeout / truncation is a
/// SUCCESSFUL execution carried here, NOT a wire error (ruling 17). exitCode is null when the child was killed
/// (timeout / output-cap). stdout/stderr are content — never logged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecOutput {
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    #[serde(rename = "timedOut")]
    pub timed_out: bool,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

/// The foreground-window sample output (mirror of ForegroundWindowOutputSchema, T3a perception). available=false is a
/// no-sample SUCCESS (pet window / desktop foreground) — processName/windowTitle are null then, never an error. No
/// skip_serializing_if: a null field stays on the wire (the zod fields are required + nullable). windowTitle is
/// untrusted content (Core A1-fences it before any prompt); idleSeconds is session idle (GetLastInputInfo).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ForegroundWindowOutput {
    pub available: bool,
    #[serde(rename = "processName")]
    pub process_name: Option<String>,
    #[serde(rename = "windowTitle")]
    pub window_title: Option<String>,
    #[serde(rename = "idleSeconds")]
    pub idle_seconds: Option<u64>,
}

/// The operator-selectable Permission Level (mirror of PermissionLevelSchema, T2b).
/// A preset VIEW over per-cell postures — never a second enforcement path; the gate projects through it.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionLevel {
    Strict,
    Standard,
    Relaxed,
}

/// A projected cell posture (mirror of PermissionPostureSchema): run silently, ask the human, or refuse.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PermissionPosture {
    Auto,
    Ask,
    Deny,
}

/// Mirror of PermissionLevelStateSchema — the active-level get/set payload (strictObject parity).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PermissionLevelState {
    pub level: PermissionLevel,
}

/// Mirror of PermissionCellStateSchema — one `capability[:argClass]` row as the settings panel reads it.
/// denyByDefault marks a floor cell: user-configurable over this surface only, agent-immovable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PermissionCellState {
    pub key: String,
    pub level: PermissionLevel,
    pub posture: PermissionPosture,
    #[serde(rename = "denyByDefault")]
    pub deny_by_default: bool,
}

/// Mirror of PermissionCellSetParamsSchema — an operator cell override; secondConfirm must accompany
/// any change that loosens a deny-by-default cell (the panel re-asks the human before sending it).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PermissionCellSetParams {
    pub key: String,
    pub level: PermissionLevel,
    pub posture: PermissionPosture,
    #[serde(rename = "secondConfirm", skip_serializing_if = "Option::is_none")]
    pub second_confirm: Option<bool>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures_dir() -> PathBuf {
        // The canonical golden-fixture home, read by BOTH vitest and cargo (ruling 4).
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/shared/fixtures/protocol")
    }

    // Parse `text` under the type owning `prefix`; on success return the re-serialized Value (for the round-trip trap).
    fn reparse(prefix: &str, text: &str) -> Option<Value> {
        match prefix {
            "connect-request" => serde_json::from_str::<ConnectParams>(text)
                .ok()
                .map(to_value),
            "connect-result" => serde_json::from_str::<ConnectResult>(text)
                .ok()
                .map(to_value),
            "app-error" => serde_json::from_str::<AppErrorFrame>(text)
                .ok()
                .map(to_value),
            "client-frame" => serde_json::from_str::<ClientFrame>(text).ok().map(to_value),
            "capability-request" => serde_json::from_str::<CapabilityRequest>(text)
                .ok()
                .map(to_value),
            "capability-execute" => serde_json::from_str::<CapabilityExecute>(text)
                .ok()
                .map(to_value),
            "capability-challenge" => serde_json::from_str::<Value>(text).ok()
                .and_then(|value| parse_capability_challenge(value).ok()).map(to_value),
            "capability-resume" => serde_json::from_str::<Value>(text).ok()
                .and_then(|value| parse_capability_resume(value).ok()).map(to_value),
            "capability-cancel" => serde_json::from_str::<CapabilityCancel>(text)
                .ok()
                .map(to_value),
            "capability-respond" => serde_json::from_str::<CapabilityRespond>(text)
                .ok()
                .and_then(|response| response.validate_lineage().ok().map(|_| response))
                .map(to_value),
            "host-catalog-publish" => serde_json::from_str::<HostCatalogPublish>(text)
                .ok()
                .map(to_value),
            "host-frame-ack" => serde_json::from_str::<HostFrameAck>(text)
                .ok()
                .map(to_value),
            // Per-capability output payloads (Option A) — the SAME golden files the vitest per-capability schemas assert.
            "screenshot-output" => serde_json::from_str::<ScreenshotOutput>(text)
                .ok()
                .map(to_value),
            "process-list-output" => serde_json::from_str::<ProcessListOutput>(text)
                .ok()
                .map(to_value),
            "clipboard-read-output" => serde_json::from_str::<ClipboardReadOutput>(text)
                .ok()
                .map(to_value),
            "clipboard-write-output" => serde_json::from_str::<ClipboardWriteOutput>(text)
                .ok()
                .map(to_value),
            "shell-open-output" => serde_json::from_str::<ShellOpenOutput>(text)
                .ok()
                .map(to_value),
            "exec-output" => serde_json::from_str::<ExecOutput>(text).ok().map(to_value),
            "foreground-window-output" => serde_json::from_str::<ForegroundWindowOutput>(text)
                .ok()
                .map(to_value),
            // Permission Level config surface (T2b) — leaf shapes the settings panel and the gate share.
            "permission-level-state" => serde_json::from_str::<PermissionLevelState>(text)
                .ok()
                .map(to_value),
            "permission-cell-state" => serde_json::from_str::<PermissionCellState>(text)
                .ok()
                .map(to_value),
            "permission-cell-set" => serde_json::from_str::<PermissionCellSetParams>(text)
                .ok()
                .map(to_value),
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
            assert_eq!(
                reparsed.is_some(),
                valid,
                "{name}: parse/reject disagreed with its validity tag"
            );

            // Casing/rename drift trap: a valid frame must re-serialize to exactly what it parsed from.
            if let Some(round_tripped) = reparsed {
                let original: Value = serde_json::from_str(&text).expect("raw json");
                assert_eq!(
                    round_tripped, original,
                    "{name}: round-trip drifted (a rename/casing mismatch)"
                );
            }
        }
        assert!(
            seen >= 12,
            "expected the full golden-fixture set, found {seen}"
        );
    }
}
