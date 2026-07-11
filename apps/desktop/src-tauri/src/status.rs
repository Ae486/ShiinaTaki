//! INPUT:  node connection state transitions from ws_client (connecting/connected/pairing-required/disconnected)
//! OUTPUT: StatusEmitter trait (the tauri-free status sink) + TracingStatusEmitter (headless: log-only)
//! POS:    shell/status — decouples the WS task from Tauri events; the AppHandle impl lives in lib.rs (composition root)

/// Where the node's connection status goes. The Tauri impl (lib.rs) forwards to the Pet UI event + the get_status
/// mirror; the headless node just logs. Infallible by design — a missed status is diagnostic, never control flow.
pub trait StatusEmitter: Send + Sync {
    fn emit(&self, state: &str);
}

/// The headless sink: the status lands in the log stream, where the e2e fixture reads it.
pub struct TracingStatusEmitter;

impl StatusEmitter for TracingStatusEmitter {
    fn emit(&self, state: &str) {
        tracing::info!(state = %state, "node status");
    }
}
