//! INPUT:  Core WS endpoint, pairing codes, Host negotiation, capability request/cancel frames
//! OUTPUT: reconnecting Node client with complete catalog publication and generation-bound terminal responses
//! POS:    shell/ws_client — socket/session owner; Tauri-free; exact control binding delegates to host_session

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc::Receiver;
use tokio::sync::Mutex;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::capabilities_impl::exec::{classify as classify_exec, command_of, ExecPolicy};
use crate::capabilities_impl::shell_open::classify as classify_shell_open;
use crate::capabilities_impl::CapabilityRegistry;
use crate::gate::Gate;
use crate::host_session::{BeginDecision, HostSession};
use crate::protocol::{
    CapabilityCancel, CapabilityCancellation, CapabilityExecutionKind, CapabilityRequest,
    CapabilityRespond, ClientFrame, ConnectParams, ConnectResult, ErrorCode,
    HostCapabilityDescriptor, HostCatalogPublish, HostDeclaration, HostFrameAck,
    HostLocalReadiness, HostNegotiation, HostProtocolRange, JsonRpcId, Role,
    HOST_CATALOG_SCHEMA_VERSION, HOST_CONTROL_PROTOCOL_VERSION,
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
            return; // capability.respond acks and other frames need no action
        };
        match method.as_str() {
            "capability.request" => self.dispatch_request(params, write, session).await,
            "capability.cancel" => self.dispatch_cancel(params, write, session).await,
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
                tokio::spawn(async move {
                    let response = authorize_and_run(gate, handlers, exec_policy, request).await;
                    if let Some(response) = session.lock().await.complete(response) {
                        log_terminal(&capability, &response);
                        send_response(&write, response).await;
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

async fn authorize_and_run(
    gate: Arc<Gate>,
    handlers: Arc<CapabilityRegistry>,
    exec_policy: Arc<ExecPolicy>,
    request: CapabilityRequest,
) -> CapabilityRespond {
    let failure_request_id = request.request_id.clone();
    let failure_control = request.control.clone();
    let CapabilityRequest {
        request_id,
        control,
        input,
    } = request;
    let capability = control.capability_id.clone();
    let joined = tokio::task::spawn_blocking(move || {
        let authorized = if capability == "exec" {
            let class = classify_exec(&exec_policy, &input);
            gate.evaluate_exec(&request_id, command_of(&input), class)
        } else if capability == "shell-open" {
            let class = classify_shell_open(&input);
            let detail = handlers.detail(&capability, &input);
            gate.evaluate_shell_open(&request_id, class, detail.as_deref())
        } else {
            let detail = handlers.detail(&capability, &input);
            gate.evaluate_by_class(&request_id, &capability, detail.as_deref())
        };
        if authorized {
            handlers.respond(request_id, control, &capability, &input)
        } else {
            CapabilityRespond::err(
                request_id,
                control,
                crate::protocol::CapabilityErrorCode::Denied,
                "denied".into(),
            )
        }
    })
    .await;
    joined.unwrap_or_else(|error| {
        CapabilityRespond::err(
            failure_request_id,
            failure_control,
            crate::protocol::CapabilityErrorCode::ExecFailed,
            error.to_string(),
        )
    })
}

async fn send_response(write: &SharedWrite, response: CapabilityRespond) {
    let frame = json!({ "jsonrpc": "2.0", "id": next_id(), "method": "capability.respond", "params": response });
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
