//! INPUT: native Node socket, selected Core discovery, and existing Node reconnect credential.
//! OUTPUT: same-socket server-verified challenge/proof authentication with bounded waits.
//! POS: shell/ws_client — local admission only; explicit headless/remote pairing remains in ws_client.

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;
use crate::local_auth::{self, LocalChallenge, LocalDescriptor};
use crate::protocol::{ClientFrame, ConnectResult, HostNegotiation, Role};
use crate::ws_client::{WsClient, WsStream, TOKEN_KEY};

impl WsClient {
    pub(crate) async fn local_handshake(&self, socket: &mut WsStream, descriptor: &LocalDescriptor) -> Result<HostNegotiation, String> {
        tokio::time::timeout(std::time::Duration::from_secs(15), self.prove_local_socket(socket, descriptor))
            .await.map_err(|_| "Local connection authentication timed out")?
    }

    async fn prove_local_socket(&self, socket: &mut WsStream, descriptor: &LocalDescriptor) -> Result<HostNegotiation, String> {
        let client_nonce = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let mut params = serde_json::to_value(self.connect_params(None, None)).map_err(|_| "Invalid Node identity")?;
        params["localAuth"] = json!({ "kind": "begin", "clientNonce": client_nonce });
        send(socket, params).await?;
        let frame = read(socket).await?;
        let ClientFrame::Error { error, .. } = frame else { return Err("Local Core did not provide server proof".into()); };
        let data = error.get("data").ok_or("Local Core authentication is unavailable")?;
        if data.get("code").and_then(|value| value.as_str()) != Some("LOCAL_AUTH_REQUIRED") {
            return Err("Local Core authentication is unavailable".into());
        }
        let challenge: LocalChallenge = serde_json::from_value(data.get("challenge").cloned().ok_or("Local Core challenge missing")?)
            .map_err(|_| "Local Core challenge is invalid")?;
        if challenge.client_nonce != client_nonce || challenge.device_id != self.device_id || challenge.role != Role::Node {
            return Err("Local Core challenge does not match the Node".into());
        }
        let proof = local_auth::prove(&challenge, descriptor)?;
        // Only this verified physical socket may receive the durable reconnect token.
        let mut params = serde_json::to_value(self.connect_params(self.secrets.get(TOKEN_KEY)?, None)).map_err(|_| "Invalid Node identity")?;
        params["localAuth"] = json!({ "kind": "proof", "nonce": challenge.nonce, "proof": proof });
        send(socket, params).await?;
        let ClientFrame::Success { result, .. } = read(socket).await? else {
            return Err("Local Core refused Node admission; existing identity was preserved".into());
        };
        let result: ConnectResult = serde_json::from_value(result).map_err(|_| "Invalid Node admission result")?;
        let host = result.host.ok_or("Local Core did not negotiate a Host")?;
        self.validate_negotiation(&host)?;
        if let Some(token) = result.token { self.secrets.set(TOKEN_KEY, &token)?; }
        Ok(host)
    }
}

async fn send(socket: &mut WsStream, params: serde_json::Value) -> Result<(), String> {
    socket.send(Message::text(json!({ "jsonrpc": "2.0", "id": 1, "method": "connect", "params": params }).to_string()))
        .await.map_err(|_| "Local authentication send failed".into())
}

async fn read(socket: &mut WsStream) -> Result<ClientFrame, String> {
    while let Some(message) = socket.next().await {
        match message.map_err(|_| "Local authentication receive failed")? {
            Message::Text(text) => {
                if let Ok(frame @ (ClientFrame::Success { .. } | ClientFrame::Error { .. })) = serde_json::from_str(text.as_str()) {
                    return Ok(frame);
                }
            }
            Message::Ping(payload) => socket.send(Message::Pong(payload)).await.map_err(|_| "Local authentication ping failed")?,
            Message::Close(_) => break,
            _ => {}
        }
    }
    Err("Local authentication socket closed".into())
}
