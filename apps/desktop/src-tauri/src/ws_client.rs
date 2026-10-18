//! INPUT:  Core WS endpoint, pairing codes, Host negotiation, capability request/cancel/resume frames
//! OUTPUT: reconnecting Node client with catalog publication and final Host enforcement/audited terminal responses
//! POS:    shell/ws_client — socket/session owner; resume rechecks current Host floors immediately before effects

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
        let relay = Arc::new(crate::hindsight_checkpoint_relay::CheckpointRelay::default());
        let mut failure = None;
        while let Some(message) = read.next().await {
            let message = match message { Ok(message) => message, Err(error) => { failure = Some(error.to_string()); break; } };
            match message {
                Message::Text(text) => self.dispatch(text.as_str(), &write, &session, &relay).await,
                Message::Ping(payload) => {
                    let _ = write.lock().await.send(Message::Pong(payload)).await;
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        session.lock().await.close();
        relay.close();
        match failure { Some(error) => Err(error), None => Ok(()) }
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
    async fn dispatch(&self, text: &str, write: &SharedWrite, session: &SharedSession, relay: &Arc<crate::hindsight_checkpoint_relay::CheckpointRelay>) {
        match serde_json::from_str::<ClientFrame>(text) {
            Ok(ClientFrame::Success { id, result, .. }) => { relay.deliver(&id, result); return; }
            Ok(ClientFrame::Error { id: Some(id), .. }) => { relay.deliver(&id, json!({"state":"unavailable","reason":"host-unavailable"})); return; }
            _ => {},
        }
        let Ok(ClientFrame::Notification { method, params, .. }) =
            serde_json::from_str::<ClientFrame>(text)
        else {
            return; // capability.respond/challenge acks and other frames need no action
        };
        match method.as_str() {
            "capability.request" => self.dispatch_request(params, write, session).await,
            "capability.execute" => self.dispatch_execute(params, write, session, relay).await,
            "capability.cancel" => self.dispatch_cancel(params, write, session).await,
            "capability.resume" => self.dispatch_resume(params, write, session, relay).await,
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
                let exec_policy = self.exec_policy.clone();
                let write = write.clone();
                let session = session.clone();
                // The Host identity equals this device id (validated at negotiation) — reading it through the
                // session here would re-lock a guard the match scrutinee still holds (same-task deadlock).
                let host_id = self.device_id.clone();
                tokio::spawn(async move {
                    match authorize_and_run(gate, exec_policy, request).await {
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

    async fn dispatch_execute(&self, params: Value, write: &SharedWrite, session: &SharedSession, relay: &Arc<crate::hindsight_checkpoint_relay::CheckpointRelay>) {
        let Ok(execute) = serde_json::from_value::<crate::protocol::CapabilityExecute>(params) else { return; };
        let Some(record) = session.lock().await.pending_challenge(&execute.request_id).cloned() else { return; };
        if record.challenge.challenge_id != execute.challenge_id || record.challenge.control != execute.control { return; }
        let mut lineage = None;
        if let Some(raw) = execute.authorization.clone() {
            let Ok(authorization) = serde_json::from_value(raw) else { return; };
            let resume = crate::protocol::CapabilityResume { request_id: execute.request_id.clone(), control: execute.control.clone(), challenge_id: execute.challenge_id.clone(), authorization };
            if matches_pending_authorization(&record, &resume).is_err() { return; }
            lineage = Some(CapabilityAuthorizationLineage {
                authorization_id: resume.authorization.authorization_id,
                approval_generation: resume.authorization.approval_generation,
                challenge_digest: resume.authorization.challenge_digest,
            });
        }
        let authorized_ask = lineage.is_some();
        let Some(live) = session.lock().await.invocation_live(&execute.request_id, &execute.control) else { return; };
        let _ = session.lock().await.consume_challenge(&execute.request_id);
        let handlers = self.handlers.clone(); let gate = self.gate.clone(); let exec_policy = self.exec_policy.clone(); let session = session.clone(); let write = write.clone();
        let relay = relay.clone();
        tokio::spawn(async move {
            let evidence = final_host_enforcement(&gate, &exec_policy, &execute.control, &record.input);
            let approved = evidence.effective_posture == if authorized_ask { crate::protocol::HostGovernancePosture::Ask } else { crate::protocol::HostGovernancePosture::Auto };
            let response = if approved {
                // Preflight is classification-only. The one audit record belongs at this post-intent execution seam,
                // immediately before the handler is invoked.
                gate.audit_enforcement(
                    &execute.request_id,
                    &execute.control.capability_id,
                    true,
                    audit_command(&execute.control.capability_id, &record.input),
                );
                let mut context = crate::capabilities_impl::TrustedHostInvocationContext {
                    request_id: execute.request_id.clone(), control: execute.control.clone(), authorization: lineage.clone(), live, checkpoint: None,
                };
                attach_checkpoint(&mut context, &write, &session, relay);
                execute_with_context(handlers, context, record.input).await.with_governance(evidence)
            } else {
                gate.audit_enforcement(
                    &execute.request_id,
                    &execute.control.capability_id,
                    false,
                    audit_command(&execute.control.capability_id, &record.input),
                );
                CapabilityRespond::err(execute.request_id.clone(), execute.control.clone(), crate::protocol::CapabilityErrorCode::Denied, "Host governance tightened after Core intent".into()).with_governance(evidence)
            };
            let response = match lineage { Some(lineage) => response.with_authorization(lineage), None => response };
            if let Some(response) = session.lock().await.complete(response) { send_response(&write, response).await; }
        });
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
    async fn dispatch_resume(&self, params: Value, write: &SharedWrite, session: &SharedSession, relay: &Arc<crate::hindsight_checkpoint_relay::CheckpointRelay>) {
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
        let Some(live) = session.lock().await.invocation_live(&record.challenge.request_id, &record.challenge.control) else { return; };
        let handlers = self.handlers.clone();
        let gate = self.gate.clone();
        let exec_policy = self.exec_policy.clone();
        let write = write.clone();
        let session = session.clone();
        let capability = record.challenge.control.capability_id.clone();
        let relay = relay.clone();
        tokio::spawn(async move {
            let (approved, evidence) = enforce_authorized_resume(
                &gate,
                &exec_policy,
                &record.challenge.request_id,
                &record.challenge.control,
                &record.input,
            );
            let response = if approved {
                let mut context = crate::capabilities_impl::TrustedHostInvocationContext {
                    request_id: record.challenge.request_id.clone(),
                    control: record.challenge.control.clone(),
                    authorization: Some(CapabilityAuthorizationLineage {
                        authorization_id: authorization.authorization_id.clone(),
                        approval_generation: authorization.approval_generation,
                        challenge_digest: authorization.challenge_digest.clone(),
                    }),
                    live,
                    checkpoint: None,
                };
                attach_checkpoint(&mut context, &write, &session, relay);
                execute_with_context(handlers, context, record.input).await
            } else {
                CapabilityRespond::err(
                    record.challenge.request_id.clone(),
                    record.challenge.control.clone(),
                    crate::protocol::CapabilityErrorCode::Denied,
                    "Host governance tightened after Approval".into(),
                )
            }
            .with_governance(evidence)
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
pub(crate) type SharedWrite = Arc<Mutex<futures_util::stream::SplitSink<WsStream, Message>>>;
pub(crate) type SharedSession = Arc<Mutex<HostSession>>;

fn attach_checkpoint(context: &mut crate::capabilities_impl::TrustedHostInvocationContext, write: &SharedWrite,
    session: &SharedSession, relay: Arc<crate::hindsight_checkpoint_relay::CheckpointRelay>) {
    if context.control.capability_id == "hindsight-deployment" {
        context.checkpoint = Some(crate::hindsight_checkpoint_relay::checkpoint_callback(context.clone(),
            crate::hindsight_checkpoint_relay::CheckpointTransport { relay, write: write.clone(), session: session.clone() }));
    }
}

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
    Preflight(HostGovernanceEvidence),
}

async fn authorize_and_run(
    gate: Arc<Gate>,
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
        let evidence = final_host_enforcement(&gate, &exec_policy, &control, &input);
        if matches!(evidence.effective_posture, crate::protocol::HostGovernancePosture::Auto | crate::protocol::HostGovernancePosture::Ask) {
            // Preflight never executes. Core commits the target Effect before capability.execute/resume.
            Enforcement::Preflight(evidence)
        } else {
            gate.audit_enforcement(&request_id, &capability, false, audit_command(&capability, &input));
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
        Ok(Enforcement::Preflight(evidence)) => Authorized::Challenge { evidence, request: sealed_request },
        Ok(Enforcement::Respond(response)) => Authorized::Respond(*response),
        Err(error) => Authorized::Respond(CapabilityRespond::err(
            failure_request_id,
            failure_control,
            crate::protocol::CapabilityErrorCode::ExecFailed,
            error.to_string(),
        )),
    }
}

/// A custody child can wait up to its original deadline. Keep the socket reader runnable so cancellation and
/// disconnect can retire the code-owned flag; no request input or raw join failure is logged on this path.
async fn execute_with_context(
    handlers: Arc<crate::capabilities_impl::CapabilityRegistry>,
    context: crate::capabilities_impl::TrustedHostInvocationContext,
    input: Value,
) -> CapabilityRespond {
    let fallback = context.clone();
    tokio::task::spawn_blocking(move || handlers.respond_with_context(&context, &input)).await.unwrap_or_else(|_| {
        CapabilityRespond::err(fallback.request_id, fallback.control, crate::protocol::CapabilityErrorCode::ExecFailed,
            "Host execution did not complete".into())
    })
}

fn final_host_enforcement(
    gate: &Gate,
    exec_policy: &ExecPolicy,
    control: &crate::protocol::HostOperationControl,
    input: &Value,
) -> HostGovernanceEvidence {
    let capability = control.capability_id.as_str();
    let (cell_key, local_allows) = match capability {
        "exec" => {
            let class = classify_exec(exec_policy, input);
            (class.cell_key().unwrap_or("exec:blocked"), class.cell_key().is_some())
        }
        "shell-open" => {
            let class = classify_shell_open(input);
            (class.key(), class != crate::gate::ShellOpenClass::Blocked)
        }
        "hindsight-custody" => ("hindsight-custody:prepare", crate::protocol::parse_hindsight_prepare(input.clone()).is_ok()),
        "hindsight-deployment" => match crate::protocol::parse_deployment_effect(input.clone()) {
            Ok(effect) => (effect.cell(), control.core_attempt_id.is_some() && control.effect_id.is_some()),
            Err(_) => ("hindsight-deployment:create", false),
        },
        "hindsight-deployment-observe" => ("hindsight-deployment-observe:read", crate::protocol::parse_deployment_observe(input.clone()).is_ok()),
        _ => (capability, true),
    };
    let projection = &control.governance_projection;
    let projected = projection.cells.iter().find(|cell| cell.key == cell_key).map(|cell| cell.posture);
    let legacy_denied = gate.legacy_denied(cell_key);
    let legacy_level_denied = !gate.legacy_level_allows_auto(cell_key);
    let effective_posture = if legacy_denied || legacy_level_denied || !local_allows || projected.is_none() {
        crate::protocol::HostGovernancePosture::Deny
    } else {
        projected.unwrap_or(crate::protocol::HostGovernancePosture::Deny)
    };
    HostGovernanceEvidence {
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
    }
}

fn enforce_authorized_resume(
    gate: &Gate,
    exec_policy: &ExecPolicy,
    request_id: &str,
    control: &crate::protocol::HostOperationControl,
    input: &Value,
) -> (bool, HostGovernanceEvidence) {
    let evidence = final_host_enforcement(gate, exec_policy, control, input);
    let approved = evidence.effective_posture == crate::protocol::HostGovernancePosture::Ask;
    if approved {
        gate.audit_approved_enforcement(request_id, &control.capability_id, audit_command(&control.capability_id, input));
    } else {
        gate.audit_enforcement(request_id, &control.capability_id, false, audit_command(&control.capability_id, input));
    }
    (approved, evidence)
}

fn audit_command<'a>(capability: &str, input: &'a Value) -> Option<&'a str> {
    (capability == "exec").then(|| input.get("command").and_then(Value::as_str).unwrap_or(""))
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
        "clipboard-write" | "shell-open" | "exec" | "hindsight-deployment" => CapabilityExecutionKind::Effect,
        "screenshot" | "screenshot-ambient" | "process-list" | "clipboard-read"
        | "foreground-window" | "hindsight-custody" | "hindsight-deployment-observe" => CapabilityExecutionKind::Read,
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
                "hindsight-custody" => "hindsight-fixed-custody",
                "hindsight-deployment" => "hindsight-deployment-action",
                "hindsight-deployment-observe" => "hindsight-owned-observation",
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    use crate::audit::{AuditSink, Decision};
    use crate::gate::approver::{Approver, ApproverOutcome};
    use crate::gate::decisions::DecisionStore;
    use crate::gate::GatePolicy;

    #[derive(Default)]
    struct RecordingAudit {
        records: StdMutex<Vec<(String, String, Decision)>>,
    }

    impl AuditSink for RecordingAudit {
        fn record(&self, request_id: &str, capability: &str, decision: Decision, _command: Option<&str>) {
            self.records.lock().unwrap().push((request_id.into(), capability.into(), decision));
        }
    }

    struct UnusedApprover;

    impl Approver for UnusedApprover {
        fn ask(&self, _capability: &str, _detail: Option<&str>) -> ApproverOutcome {
            ApproverOutcome::Unavailable
        }
    }

    fn fixture() -> CapabilityRequest {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/shared/fixtures/protocol/capability-request.screenshot.valid.json");
        let mut request: CapabilityRequest = serde_json::from_str(
            &std::fs::read_to_string(path).expect("read capability request fixture"),
        ).expect("parse capability request fixture");
        request.control.governance_projection.cells[0].posture = crate::protocol::HostGovernancePosture::Ask;
        request
    }

    fn harness() -> (tempfile::TempDir, Gate, ExecPolicy, Arc<RecordingAudit>, Arc<DecisionStore>) {
        let dir = tempfile::tempdir().unwrap();
        let audit = Arc::new(RecordingAudit::default());
        let decisions = Arc::new(DecisionStore::load(dir.path().join("gate-decisions.json")));
        let gate = Gate::new(
            GatePolicy::new(),
            decisions.clone(),
            Arc::new(UnusedApprover),
            audit.clone(),
        );
        let policy = ExecPolicy::load(dir.path().join("exec-policy.json").as_path(), dir.path().into());
        (dir, gate, policy, audit, decisions)
    }

    #[tokio::test]
    async fn preflight_returns_classification_without_executor_access() {
        let (_dir, gate, policy, audit, _decisions) = harness();
        let mut request = fixture();
        request.control.governance_projection.cells[0].posture =
            crate::protocol::HostGovernancePosture::Ask;
        request.control.input_digest = input_digest(
            &request.control.capability_id,
            &request.input,
        );

        let outcome = authorize_and_run(Arc::new(gate), Arc::new(policy), request.clone()).await;

        match outcome {
            Authorized::Challenge { evidence, request: sealed } => {
                assert_eq!(sealed, request);
                assert_eq!(
                    evidence.effective_posture,
                    crate::protocol::HostGovernancePosture::Ask
                );
            }
            Authorized::Respond(_) => panic!("preflight must not execute or settle"),
        }
        assert!(audit.records.lock().unwrap().is_empty());
    }

    #[test]
    fn resume_refuses_when_the_host_floor_tightens_after_challenge() {
        let (_dir, gate, policy, audit, decisions) = harness();
        let request = fixture();
        assert_eq!(
            final_host_enforcement(&gate, &policy, &request.control, &request.input).effective_posture,
            crate::protocol::HostGovernancePosture::Ask,
        );
        decisions.seed_for_test("screenshot", crate::gate::approver::Scope::Session, false);

        let (approved, evidence) = enforce_authorized_resume(
            &gate, &policy, &request.request_id, &request.control, &request.input,
        );

        assert!(!approved);
        assert_eq!(evidence.effective_posture, crate::protocol::HostGovernancePosture::Deny);
        assert_eq!(audit.records.lock().unwrap().as_slice(), &[(
            request.request_id, "screenshot".into(), Decision::AutoDenied,
        )]);
    }

    #[test]
    fn approved_resume_emits_one_allowed_once_audit_row() {
        let (_dir, gate, policy, audit, _decisions) = harness();
        let request = fixture();

        let (approved, evidence) = enforce_authorized_resume(
            &gate, &policy, &request.request_id, &request.control, &request.input,
        );

        assert!(approved);
        assert_eq!(evidence.effective_posture, crate::protocol::HostGovernancePosture::Ask);
        assert_eq!(audit.records.lock().unwrap().as_slice(), &[(
            request.request_id, "screenshot".into(), Decision::AllowedOnce,
        )]);
    }

    #[test]
    fn hindsight_deployment_classifies_exact_effects_and_requires_lifecycle_ids() {
        let (_dir, gate, policy, _audit, decisions) = harness();
        let base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/shared/fixtures/protocol");
        let invocation = crate::protocol::parse_deployment_invocation(serde_json::from_str(
            &std::fs::read_to_string(base.join("hindsight-deployment-invocation.windows.valid.json")).unwrap()).unwrap()).unwrap();
        for action in ["create", "start", "inject"] {
            let input: Value = serde_json::from_str(&std::fs::read_to_string(
                base.join(format!("hindsight-deployment-effect.{action}.valid.json"))).unwrap()).unwrap();
            let mut control = invocation.control.clone();
            for posture in [crate::protocol::HostGovernancePosture::Auto, crate::protocol::HostGovernancePosture::Ask,
                crate::protocol::HostGovernancePosture::Deny] {
                for cell in &mut control.governance_projection.cells { cell.posture = posture; }
                let result = final_host_enforcement(&gate, &policy, &control, &input);
                assert_eq!(result.cell_key, format!("hindsight-deployment:{action}"));
                assert_eq!(result.effective_posture, posture);
            }
            for cell in &mut control.governance_projection.cells { cell.posture = crate::protocol::HostGovernancePosture::Auto; }
            control.effect_id = None;
            assert_eq!(final_host_enforcement(&gate, &policy, &control, &input).effective_posture,
                crate::protocol::HostGovernancePosture::Deny);
        }
        let input = serde_json::to_value(&invocation.input).unwrap();
        decisions.seed_for_test("hindsight-deployment:inject", crate::gate::approver::Scope::Session, false);
        assert_eq!(final_host_enforcement(&gate, &policy, &invocation.control, &input).effective_posture,
            crate::protocol::HostGovernancePosture::Deny);
        assert_eq!(input_digest("hindsight-deployment-plan:v1", &input["plan"]),
            "35764c5d2ba0a365c09588e4f3c5a8e609c360a23229b3a53e8b420384ebe40b");
    }
}
