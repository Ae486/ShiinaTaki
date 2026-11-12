//! INPUT: enabled loopback attachment plus bounded extension-origin websocket frames
//! OUTPUT: one authenticated latest-value source; exact client retirement on errors, expiry or shutdown
//! POS: shell/browser_attachment — local sensor transport; no Core token, proxy, page content or arbitrary routing

use std::sync::Arc;
use std::time::Duration;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinSet;
use tokio_tungstenite::tungstenite::{Message, protocol::WebSocketConfig};
use tokio_tungstenite::tungstenite::handshake::server::{Callback, Request, Response, ErrorResponse};
use super::BrowserAttachment;
use crate::browser_playback_protocol::BrowserAttachmentFrame;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Hello { kind: String, protocol: String, token: String }

pub(super) async fn run(attachment: Arc<BrowserAttachment>) -> Result<(), String> {
    let Some(port) = attachment.port() else { return Ok(()); };
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await.map_err(|_| "Browser attachment port unavailable")?;
    let mut stop = attachment.stop.subscribe();
    let mut expiry = tokio::time::interval(Duration::from_millis(250));
    let mut clients = JoinSet::new();
    loop {
        tokio::select! {
            _ = stop.changed() => break,
            _ = expiry.tick() => attachment.expire(),
            Some(_) = clients.join_next(), if !clients.is_empty() => {},
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { continue; };
                if !peer.ip().is_loopback() || clients.len() >= 4 { continue; }
                clients.spawn(serve(attachment.clone(), stream));
            }
        }
    }
    // Every accepted client observes the same stop signal; a bounded join is followed by exact task abortion.
    if tokio::time::timeout(Duration::from_secs(3), async { while clients.join_next().await.is_some() {} }).await.is_err() {
        clients.abort_all(); while clients.join_next().await.is_some() {}
    }
    attachment.renew_source();
    Ok(())
}

// Tungstenite owns the handshake response/error types; implement its callback contract directly.
struct ExtensionOrigin;
impl Callback for ExtensionOrigin {
    fn on_request(self, request: &Request, response: Response) -> Result<Response, ErrorResponse> {
        let valid_origin = request.headers().get("Origin").and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("chrome-extension://"))
            .is_some_and(|id| id.len() == 32 && id.bytes().all(|value| (b'a'..=b'p').contains(&value)));
        if valid_origin && request.uri().path() == "/taki-browser" && request.uri().query().is_none() { return Ok(response); }
        let mut error = ErrorResponse::new(Some("Browser extension origin required".into()));
        *error.status_mut() = tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN;
        Err(error)
    }
}

async fn serve(attachment: Arc<BrowserAttachment>, stream: TcpStream) {
    let config = WebSocketConfig::default().max_message_size(Some(16_384)).max_frame_size(Some(16_384));
    let handshake = tokio_tungstenite::accept_hdr_async_with_config(stream, ExtensionOrigin, Some(config));
    let Ok(Ok(mut socket)) = tokio::time::timeout(Duration::from_secs(3), handshake).await else { return; };
    let Ok(Some(Ok(Message::Text(text)))) = tokio::time::timeout(Duration::from_secs(3), socket.next()).await else { return; };
    let Ok(hello) = serde_json::from_str::<Hello>(&text) else { return; };
    if hello.kind != "hello" || hello.protocol != "taki.browser-attachment.v1" { return; }
    let Some(client) = attachment.claim(&hello.token) else { return; };
    let _lease = ClientLease { attachment: attachment.clone(), client: client.clone() };
    let mut permission = attachment.permission.subscribe(); let mut stop = attachment.stop.subscribe();
    let mut ping = tokio::time::interval(Duration::from_secs(15));
    let initial = *permission.borrow_and_update();
    if socket.send(control(initial)).await.is_err() { attachment.release(&client); return; }
    loop {
        tokio::select! {
            _ = stop.changed() => break,
            _ = permission.changed() => {
                let enabled = *permission.borrow_and_update();
                if socket.send(control(enabled)).await.is_err() { break; }
            },
            _ = ping.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            },
            message = socket.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    let Ok(frame) = serde_json::from_str::<BrowserAttachmentFrame>(&text) else { break; };
                    if !attachment.receive(&client, frame) { break; }
                },
                Some(Ok(Message::Ping(bytes))) => { if socket.send(Message::Pong(bytes)).await.is_err() { break; } },
                Some(Ok(Message::Pong(_))) => {},
                _ => break,
            }
        }
    }
    attachment.release(&client);
    let _ = tokio::time::timeout(Duration::from_secs(1), socket.close(None)).await;
}

fn control(enabled: bool) -> Message { Message::text(serde_json::json!({ "kind": "control", "enabled": enabled }).to_string()) }

struct ClientLease { attachment: Arc<BrowserAttachment>, client: String }
impl Drop for ClientLease { fn drop(&mut self) { self.attachment.release(&self.client); } }
