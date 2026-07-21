//! INPUT:  the core WS endpoint; pairing codes via an mpsc channel; core→node capability.request notifications
//! OUTPUT: a long-lived reconnecting node client: pairs, persists its token, runs gate-authorized capabilities
//! POS:    shell/ws_client — the socket-owning task (spawned by a composition root); tauri-free (status via StatusEmitter)

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

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
use crate::protocol::{
    CapabilityRequest, CapabilityRespond, ClientFrame, ConnectParams, ConnectResult, ErrorCode, Role,
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
        let (mut socket, _response) = connect_async(&self.url).await.map_err(|error| error.to_string())?;
        if !self.perform_handshake(&mut socket, pairing_rx).await? {
            return Ok(()); // auth failed / pairing abandoned — the loop reconnects fresh
        }
        self.emit_status("connected");

        let (write, mut read) = socket.split();
        let write = Arc::new(Mutex::new(write));
        while let Some(message) = read.next().await {
            let message = message.map_err(|error| error.to_string())?;
            match message {
                Message::Text(text) => self.dispatch(text.as_str(), &write).await,
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
    ) -> Result<bool, String> {
        let mut token = self.secrets.get(TOKEN_KEY)?;
        let mut pairing_code: Option<String> = None;
        loop {
            let params = self.connect_params(token.clone(), pairing_code.take());
            socket
                .send(Message::text(json!({ "jsonrpc": "2.0", "id": 1, "method": "connect", "params": params }).to_string()))
                .await
                .map_err(|error| error.to_string())?;

            match self.read_connect_result(socket).await? {
                ConnectStep::Connected(issued) => {
                    if let Some(new_token) = issued {
                        self.secrets.set(TOKEN_KEY, &new_token)?; // persist once so reconnect is tokenless-free (D6)
                    }
                    return Ok(true);
                }
                ConnectStep::PairingRequired => {
                    self.emit_status("pairing-required");
                    token = None;
                    pairing_code = Some(pairing_rx.recv().await.ok_or("pairing channel closed")?);
                }
                ConnectStep::AuthFailed => {
                    self.secrets.delete(TOKEN_KEY)?; // a stale token is worthless — drop it and re-pair next round
                    return Ok(false);
                }
            }
        }
    }

    // Reads frames until the connect request's response arrives (ignoring any stray notification pre-auth).
    async fn read_connect_result(&self, socket: &mut WsStream) -> Result<ConnectStep, String> {
        while let Some(message) = socket.next().await {
            let message = message.map_err(|error| error.to_string())?;
            let Message::Text(text) = message else { continue };
            match serde_json::from_str::<ClientFrame>(text.as_str()) {
                Ok(ClientFrame::Success { result, .. }) => {
                    let parsed: ConnectResult = serde_json::from_value(result).map_err(|error| error.to_string())?;
                    return Ok(ConnectStep::Connected(parsed.token));
                }
                Ok(ClientFrame::Error { error, .. }) => return Ok(classify_error(&error)),
                _ => {}
            }
        }
        Err("socket closed during handshake".to_string())
    }

    // A capability.request notification -> gate -> execute -> capability.respond (all off the async reactor).
    async fn dispatch(&self, text: &str, write: &SharedWrite) {
        let Ok(ClientFrame::Notification { method, params, .. }) = serde_json::from_str::<ClientFrame>(text) else {
            return; // capability.respond acks and other frames need no action
        };
        if method != "capability.request" {
            return;
        }
        let Ok(request) = serde_json::from_value::<CapabilityRequest>(params) else {
            // A request the serde mirror rejects would otherwise vanish (the core waits out its 90s backstop) —
            // surface the drop, but never the params (they are content, R4).
            tracing::warn!("capability.request params failed to parse; request dropped");
            return;
        };
        tracing::info!(
            capability = %request.capability,
            request_id = %request.request_id,
            "capability.request received"
        );
        let capability = request.capability.clone();

        let respond = self.authorize_and_run(request).await;
        match &respond {
            CapabilityRespond::Ok { .. } => tracing::info!(capability = %capability, ok = true, "capability handled"),
            CapabilityRespond::Err { error, .. } => {
                tracing::warn!(capability = %capability, ok = false, code = ?error.code, "capability failed");
            }
        }
        let frame = json!({ "jsonrpc": "2.0", "id": next_id(), "method": "capability.respond", "params": respond });
        let _ = write.lock().await.send(Message::text(frame.to_string())).await;
    }

    // The gate decision + capability execution both block; run them on a worker thread (ruling 2/15).
    async fn authorize_and_run(&self, request: CapabilityRequest) -> CapabilityRespond {
        let gate = self.gate.clone();
        let handlers = self.handlers.clone();
        let exec_policy = self.exec_policy.clone();
        let CapabilityRequest { request_id, capability, input } = request;
        // tokio (not tauri) spawn_blocking: works under any tokio runtime — the Tauri app's and the headless bin's.
        let joined = tokio::task::spawn_blocking(move || {
            // exec is authorized via Shape B (ruling 6): its decision depends on the parsed command, so it computes an
            // ExecClass and takes the command-keyed gate path (evaluate_exec) — never the name-keyed `evaluate`, which
            // could remember "always allow exec" and bypass the gate forever (ruling 8).
            let authorized = if capability == "exec" {
                let class = classify_exec(&exec_policy, &input);
                gate.evaluate_exec(&request_id, command_of(&input), class)
            } else if capability == "shell-open" {
                // shell-open's risk is set by the TARGET, not the name (A1): classify, then authorize per
                // (capability, targetClass) so a remembered Always never crosses classes.
                let class = classify_shell_open(&input);
                let detail = handlers.detail(&capability, &input);
                gate.evaluate_shell_open(&request_id, class, detail.as_deref())
            } else {
                // The dialog detail (e.g. the shell-open target) is derived from the input by the capability itself; it
                // is shown to the user for approval but never audited or logged (ruling 4). Fixed-risk capabilities
                // (screenshot / process-list / clipboard read+write) ride the Level engine via their BARE name as the
                // cell key — so `relaxed` = yolo (no prompt), strict/standard keep the existing ask-then-remember
                // once/session/always flow (T2b batch D).
                let detail = handlers.detail(&capability, &input);
                gate.evaluate_by_class(&request_id, &capability, detail.as_deref())
            };
            if authorized {
                handlers.respond(request_id, &capability, &input)
            } else {
                CapabilityRespond::err(request_id, crate::protocol::CapabilityErrorCode::Denied, "denied".into())
            }
        })
        .await;
        joined.unwrap_or_else(|error| {
            CapabilityRespond::err(String::new(), crate::protocol::CapabilityErrorCode::ExecFailed, error.to_string())
        })
    }

    fn connect_params(&self, token: Option<String>, pairing_code: Option<String>) -> ConnectParams {
        ConnectParams {
            device_id: self.device_id.clone(),
            device_name: self.device_name.clone(),
            role: Role::Node,
            capabilities: self.capabilities.clone(),
            token,
            pairing_code,
        }
    }

    fn emit_status(&self, state: &str) {
        self.status.emit(state);
    }
}

type WsStream = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type SharedWrite = Arc<Mutex<futures_util::stream::SplitSink<WsStream, Message>>>;

enum ConnectStep {
    Connected(Option<String>),
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
