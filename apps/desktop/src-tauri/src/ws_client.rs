//! INPUT:  Core WS endpoint, pairing codes, Host negotiation, capability request/cancel frames
//! OUTPUT: reconnecting Node client with complete catalog publication and generation-bound terminal responses
//! POS:    shell/ws_client — socket/session owner; Tauri-free; exact control binding delegates to host_session

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::mpsc::Receiver;
use tokio::sync::Mutex;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::capabilities_impl::exec::{classify as classify_exec, ExecPolicy};
use crate::capabilities_impl::shell_open::classify as classify_shell_open;
use crate::capabilities_impl::CapabilityRegistry;
use crate::gate::Gate;
use crate::host_session::{BeginDecision, ChallengeSlot, HostSession};
use crate::protocol::ws_challenge::{build_challenge, matches_pending_authorization};
use crate::protocol::{
    CapabilityAuthorizationLineage, CapabilityCancel, CapabilityCancellation,
    CapabilityExecutionKind, CapabilityRequest, CapabilityRespond, ClientFrame, ConnectParams,
    ConnectResult, ErrorCode, HostCapabilityDescriptor, HostCatalogPublish, HostDeclaration,
    HostFrameAck, HostGovernanceEvidence, HostLocalReadiness, HostNegotiation, HostProtocolRange,
    JsonRpcId, Role, parse_capability_resume, HOST_CATALOG_SCHEMA_VERSION,
    HOST_CONTROL_PROTOCOL_VERSION,
};
use crate::secrets::SecretStore;
use crate::status::StatusEmitter;

const TOKEN_KEY: &str = "node-token";
const RECONNECT_MIN: Duration = Duration::from_millis(500);
const RECONNECT_MAX: Duration = Duration::from_secs(30);

/// Everything the WS task needs; assembled by node::build_node (fields are crate-internal wiring).
pub struct WsClient {
    pub(crate) url: String,
    pub(crate) device_id: String,
    pub(crate) device_name: String,
    pub(crate) capabilities: Vec<String>,
    pub(crate) secrets: Arc<dyn SecretStore>,
    pub(crate) gate: Arc<Gate>,
    pub(crate) handlers: Arc<CapabilityRegistry>,
    // Where connection-state transitions go: the Tauri app forwards them to the Pet UI, the headless bin logs them.
    pub(crate) status: Arc<dyn StatusEmitter>,
    // The exec policy is shared with the ExecExec handler; the WS task uses it to pre-classify a command for the gate
    // (Shape B, ruling 6) — exec's decision depends on the parsed command, not just the capability name.
    pub(crate) exec_policy: Arc<ExecPolicy>,
}

impl WsClient {
    /// The reconnect loop: connect, run until the socket drops, back off, retry (tokenless-free after pairing).
    pub async fn run(self, mut pairing_rx: Receiver<String>) {
        let mut backoff = RECONNECT_MIN;
        loop {
            self.emit_status("connecting");
            match self.connect_and_run(&mut pairing_rx).await {
                Ok(()) => backoff = RECONNECT_MIN,
                Err(error) => tracing::warn!(error = %error, "ws session ended"),
            }
            self.emit_status("disconnected");
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(RECONNECT_MAX);
        }
    }

    async fn connect_and_run(&self, pairing_rx: &mut Receiver<String>) -> Result<(), String> {
        let (mut socket, _response) = connect_async(&self.url)
            .await
            .map_err(|error| error.to_string())?;
        let Some(negotiation) = self.perform_handshake(&mut socket, pairing_rx).await? else {
            return Ok(()); // auth failed / pairing abandoned — the loop reconnects fresh
        };
        let catalog_generation = 1;
        self.publish_catalog(&mut socket, &negotiation, catalog_generation)
            .await?;
        self.emit_status("connected");

        let session = Arc::new(Mutex::new(HostSession::new(
            negotiation.host_id,
            negotiation.connection_generation,
            catalog_generation,
        )));
        let (write, mut read) = socket.split();
        let write = Arc::new(Mutex::new(write));
        while let Some(message) = read.next().await {
            let message = message.map_err(|error| error.to_string())?;
            match message {
                Message::Text(text) => self.dispatch(text.as_str(), &write, &session).await,
                Message::Ping(payload) => {
                    let _ = write.lock().await.send(Message::Pong(payload)).await;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        Ok(())
    }

    // Sends connect frames until authenticated. Returns Ok(true) once connected, Ok(false) if auth failed (retry fresh).
    async fn perform_handshake(
        &self,
        socket: &mut WsStream,
        pairing_rx: &mut Receiver<String>,
    ) -> Result<Option<HostNegotiation>, String> {
        let mut token = self.secrets.get(TOKEN_KEY)?;
        let mut pairing_code: Option<String> = None;
        loop {
            let params = self.connect_params(token.clone(), pairing_code.take());
            socket
                .send(Message::text(
                    json!({ "jsonrpc": "2.0", "id": 1, "method": "connect", "params": params })
                        .to_string(),
                ))
                .await
                .map_err(|error| error.to_string())?;

            match self.read_connect_result(socket).await? {
                ConnectStep::Connected { issued_token, host } => {
                    if let Some(new_token) = issued_token {
                        self.secrets.set(TOKEN_KEY, &new_token)?; // persist once so reconnect is tokenless-free (D6)
                    }
                    return Ok(Some(host));
                }
                ConnectStep::PairingRequired => {
                    self.emit_status("pairing-required");
                    token = None;
                    pairing_code = Some(pairing_rx.recv().await.ok_or("pairing channel closed")?);
                }
                ConnectStep::AuthFailed => {
                    self.secrets.delete(TOKEN_KEY)?; // a stale token is worthless — drop it and re-pair next round
                    return Ok(None);
                }
            }
        }
    }

    // Reads frames until the connect request's response arrives (ignoring any stray notification pre-auth).
    async fn read_connect_result(&self, socket: &mut WsStream) -> Result<ConnectStep, String> {
        while let Some(message) = socket.next().await {
            let message = message.map_err(|error| error.to_string())?;
            let Message::Text(text) = message else {
                continue;
            };
            match serde_json::from_str::<ClientFrame>(text.as_str()) {
                Ok(ClientFrame::Success { result, .. }) => {
                    let parsed: ConnectResult =
                        serde_json::from_value(result).map_err(|error| error.to_string())?;
                    let host = parsed
                        .host
                        .ok_or("connect succeeded without Host negotiation")?;
                    self.validate_negotiation(&host)?;
                    return Ok(ConnectStep::Connected {
                        issued_token: parsed.token,
                        host,
                    });
                }
                Ok(ClientFrame::Error { error, .. }) => return Ok(classify_error(&error)),
                _ => {}
            }
        }
        Err("socket closed during handshake".to_string())
    }

    async fn publish_catalog(
        &self,
        socket: &mut WsStream,
        negotiation: &HostNegotiation,
        catalog_generation: u64,
    ) -> Result<(), String> {
        let request_id = next_id();
        let params = self.catalog(negotiation, catalog_generation);
        socket
            .send(Message::text(
                json!({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": "host.catalogPublish",
                    "params": params,
                })
                .to_string(),
            ))
            .await
            .map_err(|error| error.to_string())?;
        while let Some(message) = socket.next().await {
            let message = message.map_err(|error| error.to_string())?;
            match message {
                Message::Text(text) => match serde_json::from_str::<ClientFrame>(text.as_str()) {
                    Ok(ClientFrame::Success { id, result, .. }) if id_matches(&id, request_id) => {
                        let ack: HostFrameAck =
                            serde_json::from_value(result).map_err(|error| error.to_string())?;
                        return match ack {
                            HostFrameAck::Accepted => Ok(()),
                            HostFrameAck::Rejected { reason } => {
                                Err(format!("Host catalog rejected: {reason:?}"))
                            }
                        };
                    }
                    Ok(ClientFrame::Error { id, .. })
                        if id.as_ref().is_some_and(|id| id_matches(id, request_id)) =>
                    {
                        return Err("Host catalog publication failed".into());
                    }
                    _ => {}
                },
                Message::Ping(payload) => {
                    socket
                        .send(Message::Pong(payload))
                        .await
                        .map_err(|error| error.to_string())?;
                }
                Message::Close(_) => {
                    return Err("socket closed during Host catalog publication".into())
                }
                _ => {}
            }
        }
        Err("socket closed during Host catalog publication".into())
    }

    // Host-control notifications remain responsive while a blocking capability executes on a worker thread.
    async fn dispatch(&self, text: &str, write: &SharedWrite, session: &SharedSession) {
        let Ok(ClientFrame::Notification { method, params, .. }) =
            serde_json::from_str::<ClientFrame>(text)
        else {
            return; // capability.respond/challenge acks and other frames need no action
        };
        match method.as_str() {
            "capability.request" => self.dispatch_request(params, write, session).await,
            "capability.cancel" => self.dispatch_cancel(params, write, session).await,
            "capability.resume" => self.dispatch_resume(params, write, session).await,
            _ => {}
        }
    }

    async fn dispatch_request(&self, params: Value, write: &SharedWrite, session: &SharedSession) {
        let Ok(request) = serde_json::from_value::<CapabilityRequest>(params) else {
            tracing::warn!("capability.request params failed to parse; request dropped");
            return;
        };
        let capability = request.control.capability_id.clone();
        tracing::info!(
            capability = %capability,
            request_id = %request.request_id,
            "capability.request received"
        );
        match session.lock().await.begin(&request) {
            BeginDecision::Cached(response) => send_response(write, *response).await,
            BeginDecision::DuplicateInFlight => {
                tracing::debug!(request_id = %request.request_id, "duplicate in-flight capability request ignored");
            }
            BeginDecision::Rejected => {
                tracing::warn!(request_id = %request.request_id, "capability request binding rejected");
            }
            BeginDecision::Start => {
                let gate = self.gate.clone();
                let handlers = self.handlers.clone();
                let exec_policy = self.exec_policy.clone();
                let write = write.clone();
                let session = session.clone();
                // The Host identity equals this device id (validated at negotiation) — reading it through the
                // session here would re-lock a guard the match scrutinee still holds (same-task deadlock).
                let host_id = self.device_id.clone();
                tokio::spawn(async move {
                    match authorize_and_run(gate, handlers, exec_policy, request).await {
                        Authorized::Respond(response) => {
                            if let Some(response) = session.lock().await.complete(response) {
                                log_terminal(&capability, &response);
                                send_response(&write, response).await;
                            }
                        }
                        Authorized::Challenge { evidence, request } => {
                            // ask never executes and never prompts locally: emit one sealed challenge and
                            // keep the exact raw input in memory-only session state until resume/cancel.
                            let descriptor = capability_descriptor(&request.control.capability_id);
                            let outcome = match descriptor {
                                Some(descriptor) => build_challenge(&host_id, evidence, &request, &descriptor),
                                None => Err(format!(
                                    "capability {} has no descriptor",
                                    request.control.capability_id
                                )),
                            };
                            let challenge = match outcome {
                                Ok(challenge) => challenge,
                                Err(error) => {
                                    tracing::warn!(request_id = %request.request_id, error = %error,
                                        "capability challenge could not be sealed");
                                    return;
                                }
                            };
                            match session.lock().await.store_challenge(challenge.clone(), request.input) {
                                ChallengeSlot::Stored => send_challenge(&write, challenge).await,
                                slot => tracing::warn!(request_id = %challenge.request_id,
                                    slot = ?slot, "capability challenge slot was not free"),
                            }
                        }
                    }
                });
            }
        }
    }

    async fn dispatch_cancel(&self, params: Value, write: &SharedWrite, session: &SharedSession) {
        let Ok(cancel) = serde_json::from_value::<CapabilityCancel>(params) else {
            tracing::warn!("capability.cancel params failed to parse; cancel dropped");
            return;
        };
        // A pending challenge has started no effect, so retirement applies to every cancellation kind.
        if let Some(response) = session.lock().await.retire_challenge(&cancel) {
            tracing::info!(request_id = %cancel.request_id, "capability challenge retired by cancel");
            send_response(write, response).await;
            return;
        }
        if !capability_descriptor(&cancel.control.capability_id).is_some_and(|descriptor| {
            descriptor.cancellation == CapabilityCancellation::Cooperative
        }) {
            tracing::debug!(request_id = %cancel.request_id, "non-cooperative capability cancel ignored");
            return;
        }
        if let Some(response) = session.lock().await.cancel(&cancel) {
            send_response(write, response).await;
        }
    }

    // Core -> Node resume for an authorized ask: revalidate the one-shot authorization against the
    // stored challenge, consume it, execute at most once, and settle with the authorization lineage.
    async fn dispatch_resume(&self, params: Value, write: &SharedWrite, session: &SharedSession) {
        let Ok(resume) = parse_capability_resume(params) else {
            tracing::warn!("capability.resume params failed to parse; resume dropped");
            return;
        };
        let request_id = resume.request_id.clone();
        let authorized = {
            let mut guard = session.lock().await;
            let Some(pending) = guard.pending_challenge(&resume.request_id) else {
                tracing::warn!(request_id = %request_id, "capability resume matched no pending challenge");
                return;
            };
            match matches_pending_authorization(pending, &resume) {
                Ok(()) => {
                    let consumed = guard.consume_challenge(&resume.request_id);
                    consumed.map(|record| (record, resume.authorization.clone()))
                }
                Err(error) => {
                    // Fail closed: a tampered/replayed/expired resume voids the pending challenge entirely.
                    guard.consume_challenge(&resume.request_id);
                    tracing::warn!(request_id = %request_id, error = %error,
                        "capability resume authorization rejected; pending challenge voided");
                    None
                }
            }
        };
        let Some((record, authorization)) = authorized else {
            return;
        };
        let handlers = self.handlers.clone();
        let write = write.clone();
        let session = session.clone();
        let capability = record.challenge.control.capability_id.clone();
        tokio::spawn(async move {
            let response = handlers
                .respond(
                    record.challenge.request_id.clone(),
                    record.challenge.control.clone(),
                    &capability,
                    &record.input,
                )
                .with_governance(record.challenge.governance.clone())
                .with_authorization(CapabilityAuthorizationLineage {
                    authorization_id: authorization.authorization_id,
                    approval_generation: authorization.approval_generation,
                    challenge_digest: authorization.challenge_digest,
                });
            if let Some(response) = session.lock().await.complete(response) {
                log_terminal(&capability, &response);
                send_response(&write, response).await;
            }
        });
    }

    fn connect_params(&self, token: Option<String>, pairing_code: Option<String>) -> ConnectParams {
        ConnectParams {
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            role: Role::Node,
            capabilities: self.capabilities.clone(),
            token,
            pairing_code,
            host: HostDeclaration {
                protocol: HostProtocolRange {
                    min: HOST_CONTROL_PROTOCOL_VERSION,
                    max: HOST_CONTROL_PROTOCOL_VERSION,
                },
                catalog_schema_versions: vec![HOST_CATALOG_SCHEMA_VERSION],
            },
        }
    }

    fn catalog(
        &self,
        negotiation: &HostNegotiation,
        catalog_generation: u64,
    ) -> HostCatalogPublish {
        HostCatalogPublish {
            host_id: negotiation.host_id.clone(),
            label: sanitized_label(&self.device_name),
            protocol_version: negotiation.protocol_version,
            catalog_schema_version: negotiation.catalog_schema_version,
            connection_generation: negotiation.connection_generation,
            catalog_generation,
            published_at: crate::audit::iso8601_utc(SystemTime::now()),
            readiness: HostLocalReadiness::Ready,
            local_reason: None,
            capabilities: self
                .capabilities
                .iter()
                .filter_map(|name| capability_descriptor(name))
                .collect(),
            workspaces: Vec::new(),
            skills: Vec::new(),
            mcp_servers: Vec::new(),
        }
    }

    fn validate_negotiation(&self, host: &HostNegotiation) -> Result<(), String> {
        if host.host_id != self.device_id
            || host.protocol_version != HOST_CONTROL_PROTOCOL_VERSION
            || host.catalog_schema_version != HOST_CATALOG_SCHEMA_VERSION
            || host.connection_generation == 0
        {
            return Err("Core returned an invalid Host negotiation".into());
        }
        Ok(())
    }

    fn emit_status(&self, state: &str) {
        self.status.emit(state);
    }
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type SharedWrite = Arc<Mutex<futures_util::stream::SplitSink<WsStream, Message>>>;
type SharedSession = Arc<Mutex<HostSession>>;

enum ConnectStep {
    Connected {
        issued_token: Option<String>,
        host: HostNegotiation,
    },
    PairingRequired,
    AuthFailed,
}

fn classify_error(error: &Value) -> ConnectStep {
    let code = error.get("data").and_then(|data| data.get("code")).cloned();
    match code.and_then(|value| serde_json::from_value::<ErrorCode>(value).ok()) {
        Some(ErrorCode::PairingRequired) => ConnectStep::PairingRequired,
        _ => ConnectStep::AuthFailed, // AUTH_FAILED and anything else -> drop the token, re-pair
    }
}

fn next_id() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(2); // 1 is reserved for the connect request
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

enum Authorized {
    Respond(CapabilityRespond),
    Challenge {
        evidence: HostGovernanceEvidence,
        request: CapabilityRequest,
    },
}

enum Enforcement {
    Respond(Box<CapabilityRespond>),
    Ask(HostGovernanceEvidence),
}

async fn authorize_and_run(
    gate: Arc<Gate>,
    handlers: Arc<CapabilityRegistry>,
    exec_policy: Arc<ExecPolicy>,
    request: CapabilityRequest,
) -> Authorized {
    let failure_request_id = request.request_id.clone();
    let failure_control = request.control.clone();
    // The ask branch needs the exact raw input back to hold in memory-only pending state.
    let sealed_request = request.clone();
    let CapabilityRequest {
        request_id,
        control,
        input,
    } = request;
    let capability = control.capability_id.clone();
    if input_digest(&capability, &input) != control.input_digest {
        return Authorized::Respond(CapabilityRespond::err(request_id, control, crate::protocol::CapabilityErrorCode::Denied, "input digest mismatch".into()));
    }
    let joined = tokio::task::spawn_blocking(move || {
        let projection = &control.governance_projection;
        let local_allows = if capability == "exec" {
            let class = classify_exec(&exec_policy, &input);
            class.cell_key().is_some()
        } else if capability == "shell-open" {
            let class = classify_shell_open(&input);
            class != crate::gate::ShellOpenClass::Blocked
        } else {
            true
        };
        let cell_key = if capability == "exec" {
            classify_exec(&exec_policy, &input).cell_key().unwrap_or("exec:blocked")
        } else if capability == "shell-open" {
            classify_shell_open(&input).key()
        } else { capability.as_str() };
        let projected = projection.cells.iter().find(|cell| cell.key == cell_key).map(|cell| cell.posture);
        let legacy_denied = gate.legacy_denied(cell_key);
        let legacy_level_denied = !gate.legacy_level_allows_auto(cell_key);
        let local_constraint = legacy_denied || legacy_level_denied || !local_allows;
        let effective_posture = if local_constraint || projected.is_none() {
            crate::protocol::HostGovernancePosture::Deny
        } else {
            projected.unwrap_or(crate::protocol::HostGovernancePosture::Deny)
        };
        let authorized = effective_posture == crate::protocol::HostGovernancePosture::Auto;
        let evidence = crate::protocol::HostGovernanceEvidence {
            descriptor_revision: projection.descriptor_revision,
            classifier_revision: projection.classifier_revision,
            cell_key: cell_key.to_string(),
            effective_posture,
            constraint: if legacy_denied || legacy_level_denied {
                crate::protocol::HostGovernanceConstraint::LegacyDeny
            } else if !local_allows {
                crate::protocol::HostGovernanceConstraint::Local
            } else if projected.is_none() {
                crate::protocol::HostGovernanceConstraint::Hard
            } else {
                crate::protocol::HostGovernanceConstraint::None
            },
        };
        // Privacy boundary: an ask stays pending, so its exact command must NOT enter the audit trail —
        // the exec command is audited only once the attempt actually executes under auto.
        let command = (capability == "exec" && authorized)
            .then(|| input.get("command").and_then(Value::as_str).unwrap_or("").to_string());
        gate.audit_enforcement(&request_id, &capability, authorized, command.as_deref());
        if authorized {
            Enforcement::Respond(Box::new(handlers.respond(request_id, control, &capability, &input).with_governance(evidence)))
        } else if effective_posture == crate::protocol::HostGovernancePosture::Ask {
            Enforcement::Ask(evidence)
        } else {
            Enforcement::Respond(Box::new(CapabilityRespond::err(
                request_id,
                control,
                crate::protocol::CapabilityErrorCode::Denied,
                "denied".into(),
            ).with_governance(evidence)))
        }
    })
    .await;
    match joined {
        Ok(Enforcement::Ask(evidence)) => Authorized::Challenge { evidence, request: sealed_request },
        Ok(Enforcement::Respond(response)) => Authorized::Respond(*response),
        Err(error) => Authorized::Respond(CapabilityRespond::err(
            failure_request_id,
            failure_control,
            crate::protocol::CapabilityErrorCode::ExecFailed,
            error.to_string(),
        )),
    }
}

fn input_digest(capability: &str, input: &Value) -> String {
    let canonical = canonical_json(&json!({ "capabilityId": capability, "input": input }));
    format!("{:x}", Sha256::digest(canonical.as_bytes()))
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => value.to_string(),
        Value::Array(values) => format!("[{}]", values.iter().map(canonical_json).collect::<Vec<_>>().join(",")),
        Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by(|left, right| left.0.cmp(right.0));
            format!("{{{}}}", entries.into_iter().map(|(key, value)| format!("{}:{}", serde_json::to_string(key).expect("json key"), canonical_json(value))).collect::<Vec<_>>().join(","))
        }
    }
}

async fn send_response(write: &SharedWrite, response: CapabilityRespond) {
    let frame = json!({ "jsonrpc": "2.0", "id": next_id(), "method": "capability.respond", "params": response });
    let _ = write
        .lock()
        .await
        .send(Message::text(frame.to_string()))
        .await;
}

// The ask handoff: a REQUEST frame (Core acknowledges with a Host ack); the raw input stays behind in
// memory-only session state and never appears in this frame or in any log line.
async fn send_challenge(write: &SharedWrite, challenge: crate::protocol::CapabilityChallenge) {
    let frame = json!({ "jsonrpc": "2.0", "id": next_id(), "method": "capability.challenge", "params": challenge });
    let _ = write
        .lock()
        .await
        .send(Message::text(frame.to_string()))
        .await;
}

fn log_terminal(capability: &str, response: &CapabilityRespond) {
    match response {
        CapabilityRespond::Completed { .. } => {
            tracing::info!(capability, ok = true, "capability handled")
        }
        CapabilityRespond::Failed { error, .. } => {
            tracing::warn!(capability, ok = false, code = ?error.code, "capability failed");
        }
        CapabilityRespond::Cancelled { .. } => {
            tracing::info!(capability, ok = false, "capability cancelled")
        }
        CapabilityRespond::OutcomeUnknown { .. } => {
            tracing::warn!(capability, ok = false, "capability outcome unknown")
        }
    }
}

fn capability_descriptor(capability: &str) -> Option<HostCapabilityDescriptor> {
    let execution = match capability {
        "clipboard-write" | "shell-open" | "exec" => CapabilityExecutionKind::Effect,
        "screenshot" | "screenshot-ambient" | "process-list" | "clipboard-read"
        | "foreground-window" => CapabilityExecutionKind::Read,
        _ => return None,
    };
    let cancellation = match execution {
        CapabilityExecutionKind::Read => CapabilityCancellation::Cooperative,
        CapabilityExecutionKind::Effect => CapabilityCancellation::NonCooperative,
    };
    Some(HostCapabilityDescriptor {
        capability_id: capability.into(),
        execution,
        cancellation,
        governance: crate::protocol::HostCapabilityGovernanceSupport {
            descriptor_revision: 1,
            classifier_id: match capability {
                "exec" => "exec-command",
                "shell-open" => "shell-open-target",
                _ => "fixed-risk",
            }.into(),
            classifier_revision: 1,
        },
    })
}

fn sanitized_label(label: &str) -> String {
    let sanitized: String = label
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect();
    if sanitized.is_empty() {
        "TakiAgent Node".into()
    } else {
        sanitized
    }
}

fn id_matches(id: &JsonRpcId, expected: u64) -> bool {
    matches!(id, JsonRpcId::Num(actual) if *actual >= 0 && *actual as u64 == expected)
}
