//! INPUT: explicit Shell-local opt-in, a dedicated SecretStore credential, and Core privacy control
//! OUTPUT: one authenticated extension's latest selected source; bounded source expiry and shutdown
//! POS: shell/browser_attachment — optional loopback sensor, never an operator/Node credential export or capability grant

mod server;
mod lifecycle;
pub(crate) mod forwarder;
#[cfg(test)]
mod tests;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use crate::browser_playback_protocol::{BrowserAttachmentFrame, BrowserPlaybackSample, BrowserPlayerIdentity};
use crate::secrets::SecretStore;

pub(crate) const TOKEN_KEY: &str = "browser-attachment-token";
const FRESH_MS: u64 = 5_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalConfig { enabled: bool, port: u16 }

#[derive(Clone)]
pub(crate) struct Observation {
    pub attachment_id: String,
    pub source: BrowserPlayerIdentity,
    pub sample: BrowserPlaybackSample,
    pub received: Instant,
    pub observed_age_ms: f64,
}

struct LocalState {
    active_client: Option<String>,
    sequence: u64,
    observation: Option<Observation>,
    core_enabled: bool,
    closed: bool,
}

pub(crate) struct BrowserAttachment {
    binding: Mutex<Binding>,
    loader: Mutex<Option<lifecycle::Loader>>,
    unavailable: std::sync::atomic::AtomicBool,
    reload: watch::Sender<()>,
    configuration: watch::Sender<()>,
    state: Mutex<LocalState>,
    samples: watch::Sender<Option<Observation>>,
    permission: watch::Sender<bool>,
    stop: watch::Sender<bool>,
}

#[derive(Clone)]
struct Binding { port: Option<u16>, token: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairingDetails { pub endpoint: String, pub token: String }

impl BrowserAttachment {
    pub(crate) fn spawn(self: &Arc<Self>) -> BrowserServerGuard {
        let attachment = self.clone();
        let task = tokio::spawn(async move { attachment.run_owned().await; });
        BrowserServerGuard { attachment: self.clone(), task }
    }
    pub(crate) fn load(data_dir: &Path, secrets: &dyn SecretStore) -> Result<Arc<Self>, String> {
        let path = data_dir.join("browser-attachment.json");
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Self::disabled()),
            Err(_) => return Err("Cannot read browser attachment config".into()),
        };
        if bytes.len() > 4096 { return Err("Browser attachment config is too large".into()); }
        let config: LocalConfig = serde_json::from_slice(&bytes).map_err(|_| "Invalid browser attachment config")?;
        if !config.enabled { return Ok(Self::disabled()); }
        if config.port < 1024 { return Err("Browser attachment requires an unprivileged loopback port".into()); }
        let token = match secrets.get(TOKEN_KEY)? {
            Some(token) => token,
            None => {
                let candidate = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
                secrets.set_if_absent(TOKEN_KEY, &candidate)?;
                secrets.get(TOKEN_KEY)?.ok_or("Browser attachment credential unavailable")?
            }
        };
        if token.len() != 64 || !token.bytes().all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase()) {
            return Err("Invalid browser attachment credential".into());
        }
        Ok(Self::new(Some(config.port), token))
    }

    fn new(port: Option<u16>, token: String) -> Arc<Self> {
        Arc::new(Self { binding: Mutex::new(Binding { port, token }), loader: Mutex::new(None),
            unavailable: std::sync::atomic::AtomicBool::new(false), reload: watch::channel(()).0, configuration: watch::channel(()).0,
            state: Mutex::new(LocalState { active_client: None, sequence: 0, observation: None, core_enabled: false, closed: false }),
            samples: watch::channel(None).0, permission: watch::channel(false).0, stop: watch::channel(false).0 })
    }
    pub(crate) fn disabled() -> Arc<Self> { Self::new(None, String::new()) }
    pub(crate) fn configured(&self) -> bool { self.port().is_some() }
    fn port(&self) -> Option<u16> { self.binding.lock().ok()?.port }
    pub(crate) fn subscribe(&self) -> watch::Receiver<Option<Observation>> { self.samples.subscribe() }
    pub(crate) fn pairing_details(&self) -> Option<PairingDetails> {
        if self.state.lock().ok()?.closed { return None; }
        let binding = self.binding.lock().ok()?;
        binding.port.map(|port| PairingDetails { endpoint: format!("ws://127.0.0.1:{port}/taki-browser"), token: binding.token.clone() })
    }
    pub(crate) fn set_core_enabled(&self, enabled: bool) {
        let Ok(mut state) = self.state.lock() else { self.permission.send_replace(false); self.samples.send_replace(None); return; };
        let enabled = enabled && !state.closed && self.configured();
        if state.core_enabled == enabled { return; }
        state.core_enabled = enabled;
        state.observation = None;
        self.samples.send_replace(None);
        self.permission.send_replace(enabled);
    }
    pub(crate) fn renew_source(&self) {
        let Ok(mut state) = self.state.lock() else { self.permission.send_replace(false); self.samples.send_replace(None); return; };
        state.observation = None;
        self.samples.send_replace(None);
    }
    pub(crate) fn close(&self) {
        self.set_core_enabled(false);
        if let Ok(mut state) = self.state.lock() { state.closed = true; }
        self.stop.send_replace(true);
    }
    pub(crate) async fn run(self: Arc<Self>) -> Result<(), String> { server::run(self).await }

    fn claim(&self, token: &str) -> Option<String> {
        {
            let binding = self.binding.lock().ok()?;
            if !constant_time_equal(token.as_bytes(), binding.token.as_bytes()) { return None; }
        }
        let mut state = self.state.lock().ok()?;
        if state.closed || state.active_client.is_some() || !self.configured() { return None; }
        let id = uuid::Uuid::new_v4().to_string();
        state.active_client = Some(id.clone()); state.sequence = 0; state.observation = None;
        self.samples.send_replace(None);
        Some(id)
    }
    fn release(&self, client: &str) {
        let Ok(mut state) = self.state.lock() else { return; };
        if state.active_client.as_deref() != Some(client) { return; }
        state.active_client = None; state.observation = None;
        self.samples.send_replace(None);
    }
    fn receive(&self, client: &str, frame: BrowserAttachmentFrame) -> bool {
        let Ok(mut state) = self.state.lock() else { return false; };
        if state.active_client.as_deref() != Some(client) || !frame.validate() || frame.sequence() <= state.sequence {
            return false;
        }
        state.sequence = frame.sequence();
        if !state.core_enabled || state.closed { return true; }
        match frame {
            BrowserAttachmentFrame::Retired { .. } => { state.observation = None; self.samples.send_replace(None); }
            BrowserAttachmentFrame::Sample { source, sample, observed_age_ms, .. } => {
                let source = *source;
                if observed_age_ms >= FRESH_MS as f64 { state.observation = None; self.samples.send_replace(None); return false; }
                let attachment_id = state.observation.as_ref().filter(|old| old.source == source)
                    .map(|old| old.attachment_id.clone()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let observation = Observation { attachment_id, source, sample, observed_age_ms, received: Instant::now() };
                state.observation = Some(observation.clone()); self.samples.send_replace(Some(observation));
            }
        }
        true
    }
    fn expire(&self) {
        let Ok(mut state) = self.state.lock() else { return; };
        if state.observation.as_ref().is_some_and(|value| value.received.elapsed().as_secs_f64() * 1000.0 + value.observed_age_ms >= FRESH_MS as f64) {
            state.observation = None; self.samples.send_replace(None);
        }
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    left.len() == 64 && right.len() == 64 && left.iter().zip(right).fold(0u8, |result, (a, b)| result | (a ^ b)) == 0
}

pub(crate) struct BrowserServerGuard { attachment: Arc<BrowserAttachment>, task: tokio::task::JoinHandle<()> }
impl Drop for BrowserServerGuard {
    fn drop(&mut self) { self.attachment.close(); self.task.abort(); }
}

impl BrowserAttachment {
    pub(crate) fn handle_core_frame(&self, text: &str, scope: &crate::protocol::HostNegotiation, revision: &mut u64) -> bool {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(text) else { return false; };
        let id = frame.get("id").and_then(|value| value.as_str()).unwrap_or_default();
        if frame.get("method").and_then(|value| value.as_str()) == Some("browser.playback.control") || id == "browser-playback-ready" {
            let value = frame.get("params").or_else(|| frame.get("result")).cloned().unwrap_or_default();
            let Ok(control) = serde_json::from_value::<crate::browser_playback_protocol::BrowserPlaybackControl>(value) else {
                self.set_core_enabled(false); return true;
            };
            if control.matches(&scope.host_id, scope.connection_generation, 1, *revision) {
                *revision = control.revision; self.set_core_enabled(control.enabled);
            }
            return true;
        }
        if id.starts_with("browser-playback-report:") {
            if frame.get("result").and_then(|value| value.get("accepted")).and_then(|value| value.as_bool()) != Some(true) {
                let reason = frame.get("result").and_then(|value| value.get("reason")).and_then(|value| value.as_str());
                if reason == Some("stale_source") { self.renew_source(); }
                else { self.set_core_enabled(false); }
            }
            return true;
        }
        false
    }
}
