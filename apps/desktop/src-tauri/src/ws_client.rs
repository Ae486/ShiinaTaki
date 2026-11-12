//! INPUT:  Core WS endpoint, pairing codes, Host negotiation, capability request/cancel/resume frames
//! OUTPUT: reconnecting Node client, immediate disclosure/ACK failure settlement and final Host enforcement/audit
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
use crate::protocol::ws_challenge::{build_challenge, matches_pending_authorization, ChallengeBuildError};
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

pub(crate) const TOKEN_KEY: &str = "node-token";
const RECONNECT_MIN: Duration = Duration::from_millis(500);
const RECONNECT_MAX: Duration = Duration::from_secs(30);

/// Everything the WS task needs; assembled by node::build_node (fields are crate-internal wiring).
pub struct WsClient {
    pub(crate) local_auth: bool,
    pub(crate) browser_attachment: Arc<crate::browser_attachment::BrowserAttachment>,
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
        let _browser_server = self.browser_attachment.spawn();
        let mut backoff = RECONNECT_MIN;
        loop {
            self.emit_status("connecting");
            match self.connect_and_run(&mut pairing_rx).await {
                Ok(()) => backoff = RECONNECT_MIN,
                Err(error) => tracing::warn!(error = %error, "ws session ended"),
            }
            self.browser_attachment.set_core_enabled(false);
            self.emit_status("disconnected");
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(RECONNECT_MAX);
        }
    }

    async fn connect_and_run(&self, pairing_rx: &mut Receiver<String>) -> Result<(), String> {
        let descriptor = if self.local_auth { Some(crate::local_auth::descriptor()?) } else { None };
        let url = descriptor.as_ref().map_or(self.url.as_str(), |local| local.endpoint.as_str());
        let (mut socket, _response) = tokio::time::timeout(Duration::from_secs(15), connect_async(url))
            .await.map_err(|_| "Core socket open timed out")?
            .map_err(|error| error.to_string())?;
        let negotiation = match descriptor {
            Some(descriptor) => Some(self.local_handshake(&mut socket, &descriptor).await?),
            None => self.perform_handshake(&mut socket, pairing_rx).await?,
        };
        let Some(negotiation) = negotiation else {
            return Ok(()); // auth failed / pairing abandoned — the loop reconnects fresh
        };
        let catalog_generation = 1;
        self.publish_catalog(&mut socket, &negotiation, catalog_generation)
            .await?;
        self.emit_status("connected");

        let session = Arc::new(Mutex::new(HostSession::new(
            negotiation.host_id.clone(),
            negotiation.connection_generation,
            catalog_generation,
        )));
        let (write, mut read) = socket.split();
        let write = Arc::new(Mutex::new(write));
        let relay = Arc::new(crate::hindsight_checkpoint_relay::CheckpointRelay::default());
        let mut failure = None;
        let mut browser = self.browser_attachment.subscribe();
        let mut browser_configuration = self.browser_attachment.configuration_changes();
        let mut forwarder = crate::browser_attachment::forwarder::Forwarder::default();
        let mut browser_revision = 0;
        if self.browser_attachment.configured() {
            write.lock().await.send(Message::text(json!({ "jsonrpc": "2.0", "id": "browser-playback-ready",
                "method": "browser.playback.ready", "params": { "schemaVersion": "taki.browser-playback.v1" } }).to_string()))
                .await.map_err(|_| "Browser attachment readiness send failed")?;
        }
        loop {
            tokio::select! {
                message = read.next() => {
                    let Some(message) = message else { break; };
                    let message = match message { Ok(message) => message,
                        Err(error) => { failure = Some(error.to_string()); break; } };
                    match message {
                        Message::Text(text) => {
                            if !self.browser_attachment.handle_core_frame(text.as_str(), &negotiation, &mut browser_revision) {
                                self.dispatch(text.as_str(), &write, &session, &relay).await;
                            }
                        },
                        Message::Ping(payload) => { let _ = write.lock().await.send(Message::Pong(payload)).await; },
                        Message::Close(_) => break,
                        _ => {},
                    }
                },
                changed = browser_configuration.changed() => {
                    if changed.is_err() { break; }
                    if self.browser_attachment.configured()
                        && write.lock().await.send(Message::text(json!({ "jsonrpc": "2.0", "id": "browser-playback-ready",
                            "method": "browser.playback.ready", "params": { "schemaVersion": "taki.browser-playback.v1" } }).to_string()))
                            .await.is_err() { failure = Some("Browser attachment readiness send failed".into()); break; }
                },
                changed = browser.changed() => {
                    if changed.is_err() { break; }
                    let mut writer = write.lock().await;
                    let observation = browser.borrow_and_update().clone();
                    if let Some(report) = forwarder.frame(observation, catalog_generation) {
                        let frame = Message::text(json!({ "jsonrpc": "2.0", "id": format!("browser-playback-report:{}", uuid::Uuid::new_v4()),
                            "method": "browser.playback.report", "params": report }).to_string());
                        match tokio::time::timeout(Duration::from_secs(2), writer.send(frame)).await {
                            Ok(Ok(())) => {},
                            Ok(Err(_)) => { failure = Some("Browser observation send failed".into()); break; },
                            Err(_) => { failure = Some("Browser observation send deadline".into()); break; },
                        }
                    }
                },
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
                    return Err("Core refused the existing Node identity; credential preserved".into());
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
        let Ok(frame) = serde_json::from_str::<ClientFrame>(text) else { return; };
        let (method, params) = match frame {
            ClientFrame::Notification { method, params, .. } => (method, params),
            ClientFrame::Success { id, result, .. } => {
                relay.deliver(&id, result.clone());
                settle_challenge_ack(&id, Some(result), write, session).await;
                return;
            }
            ClientFrame::Error { id: Some(id), .. } => {
                relay.deliver(&id, json!({"state":"unavailable","reason":"host-unavailable"}));
                settle_challenge_ack(&id, None, write, session).await;
                return;
            }
            ClientFrame::Error { id: None, .. } => return,
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
                            publish_challenge(&host_id, evidence, request, &write, &session).await;
                        }
                    }
                });
            }
        }
    }

    async fn dispatch_execute(&self, params: Value, write: &SharedWrite, session: &SharedSession, relay: &Arc<crate::hindsight_checkpoint_relay::CheckpointRelay>) {
        let Ok(execute) = serde_json::from_value::<crate::protocol::CapabilityExecute>(params) else { return; };
        let (record, lineage, live) = {
            let mut guard = session.lock().await;
            let Some(pending) = guard.pending_challenge(&execute.request_id) else { return; };
            if pending.challenge.challenge_id != execute.challenge_id || pending.challenge.control != execute.control { return; }
            let lineage = if let Some(raw) = execute.authorization.clone() {
                let Ok(authorization) = serde_json::from_value(raw) else { return; };
                let resume = crate::protocol::CapabilityResume { request_id: execute.request_id.clone(), control: execute.control.clone(), challenge_id: execute.challenge_id.clone(), authorization };
                if matches_pending_authorization(pending, &resume).is_err() { return; }
                Some(CapabilityAuthorizationLineage {
                    authorization_id: resume.authorization.authorization_id,
                    approval_generation: resume.authorization.approval_generation,
                    challenge_digest: resume.authorization.challenge_digest,
                })
            } else { None };
            let Some(live) = guard.invocation_live(&execute.request_id, &execute.control) else { return; };
            // Exact validation, liveness capture and consumption share the authoritative pending-slot lock.
            let Some(record) = guard.consume_challenge(&execute.request_id) else { return; };
            (record, lineage, live)
        };
        let authorized_ask = lineage.is_some();
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
        let (authorized, refused) = {
            let mut guard = session.lock().await;
            let Some(pending) = guard.pending_challenge(&resume.request_id) else {
                tracing::warn!(request_id = %request_id, "capability resume matched no pending challenge");
                return;
            };
            // A stale or foreign tuple cannot void another challenge that reuses this request ID.
            if pending.challenge.challenge_id != resume.challenge_id || pending.challenge.control != resume.control {
                return;
            }
            match matches_pending_authorization(pending, &resume) {
                Ok(()) => {
                    let consumed = guard.consume_challenge(&resume.request_id);
                    (consumed.map(|record| (record, resume.authorization.clone())), None)
                }
                Err(error) => {
                    // This exact pending operation has not executed. Retire raw input AND its
                    // active binding atomically, then deliver the finite denial after unlocking.
                    let refused = guard.complete_challenge_failure(&resume.request_id, &resume.challenge_id,
                        "审批授权已失效，已拒绝执行。请重新发起操作。");
                    tracing::warn!(request_id = %request_id, error = %error,
                        "capability resume authorization rejected; pending challenge voided");
                    (None, refused)
                }
            }
        };
        if let Some(response) = refused {
            log_terminal(&resume.control.capability_id, &response);
            send_response(write, response).await;
        }
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

    pub(crate) fn connect_params(&self, token: Option<String>, pairing_code: Option<String>) -> ConnectParams {
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

    pub(crate) fn validate_negotiation(&self, host: &HostNegotiation) -> Result<(), String> {
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

pub(crate) type WsStream =
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
        _ => ConnectStep::AuthFailed, // Refusal never destroys a durable identity or silently re-enrolls it.
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

// Core receives only the sealed permitted projection; the original executable input remains in the
// session. A correlated ACK confirms receipt, never authorization or execution.
async fn send_challenge(write: &SharedWrite, challenge: &crate::protocol::CapabilityChallenge) -> Result<(), ()> {
    let id = if challenge.presentation.command_disclosure.is_some() {
        json!(format!("challenge:{}:{}", challenge.request_id, challenge.challenge_id))
    } else { json!(next_id()) };
    let frame = json!({ "jsonrpc": "2.0", "id": id, "method": "capability.challenge", "params": challenge });
    write
        .lock()
        .await
        .send(Message::text(frame.to_string()))
        .await.map_err(|_| ())
}

async fn settle_challenge_ack(id: &JsonRpcId, result: Option<Value>, write: &SharedWrite, session: &SharedSession) {
    let response = session.lock().await.acknowledge_challenge(id, result);
    if let Some(response) = response {
        log_terminal("exec", &response);
        send_response(write, response).await;
    }
}

async fn publish_challenge(
    host_id: &str,
    evidence: HostGovernanceEvidence,
    request: CapabilityRequest,
    write: &SharedWrite,
    session: &SharedSession,
) {
    let outcome = capability_descriptor(&request.control.capability_id)
        .ok_or(ChallengeBuildError::MissingDescriptor)
        .and_then(|descriptor| build_challenge(host_id, &evidence, &request, &descriptor));
    let challenge = match outcome {
        Ok(challenge) => challenge,
        Err(category) => {
            tracing::warn!(request_id = %request.request_id, ?category, "capability challenge could not be sealed");
            let response = CapabilityRespond::err(request.request_id, request.control,
                crate::protocol::CapabilityErrorCode::Denied,
                "无法完整、安全地展示此命令审批，已拒绝执行。请调整命令后重试。".into())
                .with_governance(evidence);
            let completed = session.lock().await.complete(response);
            if let Some(response) = completed { send_response(write, response).await; }
            return;
        }
    };
    let slot = session.lock().await.store_challenge(challenge.clone(), request.input);
    if slot != ChallengeSlot::Stored { return; }
    if send_challenge(write, &challenge).await.is_err() {
        // The socket may be gone. Release local raw state; remote settlement remains the existing
        // disconnect/deadline contract, never a claim of successful terminal delivery.
        session.lock().await.complete_challenge_failure(&challenge.request_id, &challenge.challenge_id,
            "完整命令审批发送失败，已停止本次执行。");
    }
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

    type AuditRecord = (String, String, Decision, Option<String>);

    #[derive(Default)]
    struct RecordingAudit {
        records: StdMutex<Vec<AuditRecord>>,
    }

    impl AuditSink for RecordingAudit {
        fn record(&self, request_id: &str, capability: &str, decision: Decision, command: Option<&str>) {
            self.records.lock().unwrap().push((request_id.into(), capability.into(), decision, command.map(str::to_owned)));
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
            request.request_id, "screenshot".into(), Decision::AutoDenied, None,
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
            request.request_id, "screenshot".into(), Decision::AllowedOnce, None,
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

    fn exec_request(command: &str) -> CapabilityRequest {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/shared/fixtures/protocol/capability-challenge.exec-disclosure.valid.json");
        let template = crate::protocol::parse_capability_challenge(serde_json::from_str(
            &std::fs::read_to_string(path).unwrap()).unwrap()).unwrap();
        let mut request = CapabilityRequest { request_id: template.request_id, control: template.control,
            input: json!({"command": command}) };
        // The golden disclosure fixture remains historical wire evidence; runtime admission uses the current registry.
        request.control.governance_projection.registry_revision = 4;
        request.control.governance_projection.digest = crate::host_session::projection_digest(&request.control.governance_projection);
        request.control.input_digest = input_digest("exec", &request.input);
        request
    }

    #[test]
    fn approved_exec_audits_the_original_command_once_not_the_masked_projection() {
        let (_dir, gate, policy, audit, _decisions) = harness();
        let command = "whoami   --token=RAW_SECRET_SENTINEL  tail";
        let request = exec_request(command);
        let evidence = final_host_enforcement(&gate, &policy, &request.control, &request.input);
        let challenge = build_challenge(&request.control.target_host_id, &evidence, &request, &capability_descriptor("exec").unwrap()).unwrap();
        assert!(!serde_json::to_string(&challenge.presentation).unwrap().contains("RAW_SECRET_SENTINEL"));
        let (approved, _) = enforce_authorized_resume(&gate, &policy, &request.request_id, &request.control, &request.input);
        assert!(approved);
        assert_eq!(audit.records.lock().unwrap().as_slice(), &[(request.request_id, "exec".into(), Decision::AllowedOnce, Some(command.into()))]);
    }

    struct CountingExec(std::sync::atomic::AtomicUsize);

    impl crate::capabilities_impl::CapabilityExec for CountingExec {
        fn capability(&self) -> &str { "exec" }
        fn run(&self, _: &Value) -> Result<Value, crate::capabilities_impl::ExecError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Ok(json!({}))
        }
    }

    type TestSocket = tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>;

    async fn receive_test_frame(socket: &mut TestSocket) -> Value {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next()).await
            .expect("Host frame deadline").expect("Host socket open").expect("Host text frame");
        serde_json::from_str(message.to_text().unwrap()).unwrap()
    }

    async fn reply_test_frame(socket: &mut TestSocket, frame: Value) {
        socket.send(Message::text(frame.to_string())).await.unwrap();
    }

    async fn accept_test_host(socket: &mut TestSocket, host_id: &str) {
        let connect = receive_test_frame(socket).await;
        assert_eq!(connect["method"], "connect");
        assert_eq!(connect["params"]["token"], "existing-test-token");
        assert_eq!(connect["params"]["host"]["protocol"]["max"], 3);
        reply_test_frame(socket, json!({"jsonrpc":"2.0", "id":connect["id"], "result": {
            "status":"ok", "host": {"hostId":host_id, "protocolVersion":3, "catalogSchemaVersion":2, "connectionGeneration":1}
        }})).await;
        let catalog = receive_test_frame(socket).await;
        assert_eq!(catalog["method"], "host.catalogPublish");
        reply_test_frame(socket, json!({"jsonrpc":"2.0", "id":catalog["id"], "result":{"accepted":true}})).await;
    }

    async fn reject_test_disclosure(socket: &mut TestSocket, request: &CapabilityRequest) -> Value {
        let frame = receive_test_frame(socket).await;
        assert_eq!(frame["method"], "capability.challenge");
        let challenge = crate::protocol::parse_capability_challenge(frame["params"].clone()).unwrap();
        assert_eq!(frame["id"], format!("challenge:{}:{}", request.request_id, challenge.challenge_id));
        assert!(challenge.presentation.command_disclosure.is_some());
        assert!(!frame.to_string().contains("RAW_SECRET_SENTINEL"));
        // This models an older strict Core's INVALID_PARAMS, including arbitrary peer diagnostics.
        // Duplicating it exercises the actual frame dispatch, not only the session helper.
        let error = json!({"jsonrpc":"2.0", "id":frame["id"], "error": {
            "code":-32602, "message":"PEER_SECRET_SENTINEL", "data":{"issues":"PEER_SECRET_SENTINEL"}
        }});
        reply_test_frame(socket, error.clone()).await;
        reply_test_frame(socket, error).await;
        receive_test_frame(socket).await
    }

    #[tokio::test]
    async fn actual_socket_disclosure_failures_settle_once_without_execution_audit_or_token_loss() {
        for (command, rejected_ack) in [
            ("whoami --token=RAW_SECRET_SENTINEL tail".to_string(), true),
            (format!("whoami {}", "x".repeat(48_001)), false),
            ("whoami --token='RAW_SECRET_SENTINEL".to_string(), false),
        ] {
            let (_dir, gate, policy, audit, _) = harness();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("ws://{}", listener.local_addr().unwrap());
            let mut request = exec_request(&command);
            let now = time::OffsetDateTime::now_utc();
            request.control.dispatched_at = now.format(&time::format_description::well_known::Rfc3339).unwrap();
            request.control.deadline_at = (now + time::Duration::seconds(60)).format(&time::format_description::well_known::Rfc3339).unwrap();
            let host_id = request.control.target_host_id.clone();
            let handler = Arc::new(CountingExec(std::sync::atomic::AtomicUsize::new(0)));
            let mut registry = CapabilityRegistry::new();
            registry.register(handler.clone());
            let secrets = Arc::new(crate::secrets::InMemoryStore::new());
            secrets.set(TOKEN_KEY, "existing-test-token").unwrap();
            let client = WsClient { local_auth: false, browser_attachment: crate::browser_attachment::BrowserAttachment::disabled(), url, device_id: host_id.clone(), device_name: "Disclosure test".into(),
                capabilities: vec!["exec".into()], secrets: secrets.clone(), gate: Arc::new(gate),
                handlers: Arc::new(registry), status: Arc::new(crate::status::TracingStatusEmitter), exec_policy: Arc::new(policy) };
            let server = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                accept_test_host(&mut socket, &host_id).await;
                reply_test_frame(&mut socket, json!({"jsonrpc":"2.0", "method":"capability.request", "params":request})).await;
                let terminal = if rejected_ack { reject_test_disclosure(&mut socket, &request).await }
                    else { receive_test_frame(&mut socket).await };
                assert_eq!(terminal["method"], "capability.respond");
                assert_eq!(terminal["params"]["control"], serde_json::to_value(&request.control).unwrap());
                assert_eq!(terminal["params"]["error"]["code"], "DENIED");
                assert_eq!(terminal["params"]["governance"]["effectivePosture"], "ask");
                assert!(terminal["params"].get("authorization").is_none());
                assert!(!terminal.to_string().contains("RAW_SECRET_SENTINEL"));
                assert!(!terminal.to_string().contains("PEER_SECRET_SENTINEL"));
                assert!(tokio::time::timeout(Duration::from_millis(75), socket.next()).await.is_err(), "no duplicate terminal");
                socket.send(Message::Close(None)).await.unwrap();
            });
            let (_tx, mut rx) = tokio::sync::mpsc::channel(1);
            tokio::time::timeout(Duration::from_secs(10), client.connect_and_run(&mut rx)).await.unwrap().unwrap();
            server.await.unwrap();
            assert_eq!(handler.0.load(Ordering::SeqCst), 0);
            assert!(audit.records.lock().unwrap().is_empty());
            assert_eq!(secrets.get(TOKEN_KEY).unwrap().as_deref(), Some("existing-test-token"));
        }
    }

    #[tokio::test]
    async fn actual_socket_resume_mismatch_only_retires_its_exact_pending_binding() {
        for mismatch in ["challenge", "control", "authorization"] {
            let (_dir, gate, policy, audit, _) = harness();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("ws://{}", listener.local_addr().unwrap());
            let request = exec_request("whoami --token=RAW_SECRET_SENTINEL");
            let host_id = request.control.target_host_id.clone();
            let handler = Arc::new(CountingExec(std::sync::atomic::AtomicUsize::new(0)));
            let mut registry = CapabilityRegistry::new();
            registry.register(handler.clone());
            let secrets = Arc::new(crate::secrets::InMemoryStore::new());
            secrets.set(TOKEN_KEY, "existing-test-token").unwrap();
            let client = WsClient { local_auth: false, browser_attachment: crate::browser_attachment::BrowserAttachment::disabled(), url, device_id: host_id.clone(), device_name: "Resume test".into(),
                capabilities: vec!["exec".into()], secrets: secrets.clone(), gate: Arc::new(gate),
                handlers: Arc::new(registry), status: Arc::new(crate::status::TracingStatusEmitter), exec_policy: Arc::new(policy) };
            let server = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
                accept_test_host(&mut socket, &host_id).await;
                reply_test_frame(&mut socket, json!({"jsonrpc":"2.0", "method":"capability.request", "params":request})).await;
                let frame = receive_test_frame(&mut socket).await;
                let challenge = crate::protocol::parse_capability_challenge(frame["params"].clone()).unwrap();
                let now = time::OffsetDateTime::now_utc();
                let mut resume = json!({"requestId": request.request_id, "control": request.control, "challengeId": challenge.challenge_id,
                    "authorization": {"authorizationId": "88888888-8888-4888-8888-888888888888", "approvalGeneration": challenge.control.approval_generation, "decisionScope": "once",
                        "controlDigest": challenge.control_digest, "challengeDigest": challenge.challenge_digest, "decisionScopeDigest": challenge.decision_scope_digest,
                        "issuedAt": now.format(&time::format_description::well_known::Rfc3339).unwrap(),
                        "expiresAt": (now + time::Duration::seconds(60)).format(&time::format_description::well_known::Rfc3339).unwrap() }});
                match mismatch {
                    "challenge" => resume["challengeId"] = json!("99999999-9999-4999-8999-999999999999"),
                    "control" => resume["control"]["inputDigest"] = json!("f".repeat(64)),
                    _ => resume["authorization"]["challengeDigest"] = json!("f".repeat(64)),
                }
                reply_test_frame(&mut socket, json!({"jsonrpc":"2.0", "method":"capability.resume", "params":resume})).await;
                if mismatch != "authorization" {
                    assert!(tokio::time::timeout(Duration::from_millis(75), socket.next()).await.is_err(), "a different binding is ignored");
                    reply_test_frame(&mut socket, json!({"jsonrpc":"2.0", "id":frame["id"], "error": {"code":-32602, "message":"PEER_SECRET_SENTINEL"}})).await;
                }
                let terminal = receive_test_frame(&mut socket).await;
                assert_eq!(terminal["method"], "capability.respond");
                assert_eq!(terminal["params"]["control"], serde_json::to_value(&request.control).unwrap());
                assert_eq!(terminal["params"]["error"]["code"], "DENIED");
                assert_eq!(terminal["params"]["governance"]["effectivePosture"], "ask");
                assert!(terminal["params"].get("authorization").is_none());
                assert!(!terminal.to_string().contains("SENTINEL"));
                reply_test_frame(&mut socket, json!({"jsonrpc":"2.0", "id":frame["id"], "result":{"accepted":false, "reason":"late"}})).await;
                assert!(tokio::time::timeout(Duration::from_millis(75), socket.next()).await.is_err(), "settlement is once-only");
                socket.send(Message::Close(None)).await.unwrap();
            });
            let (_tx, mut rx) = tokio::sync::mpsc::channel(1);
            tokio::time::timeout(Duration::from_secs(10), client.connect_and_run(&mut rx)).await.unwrap().unwrap();
            server.await.unwrap();
            assert_eq!(handler.0.load(Ordering::SeqCst), 0);
            assert!(audit.records.lock().unwrap().is_empty());
            assert_eq!(secrets.get(TOKEN_KEY).unwrap().as_deref(), Some("existing-test-token"));
        }
    }
}
