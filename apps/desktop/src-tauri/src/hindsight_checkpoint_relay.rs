//! INPUT:  one current HostSession, its socket writer and a post-gate C2 invocation
//! OUTPUT: bounded per-session checkpoint request/reply; close/cancel drops every pending relay
//! POS:    shell/control — the resident cannot assert its own liveness or obtain a permit on a retired socket

use std::collections::HashMap;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use futures_util::SinkExt;
use serde_json::{json, Value};
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::Message;
use crate::capabilities_impl::TrustedHostInvocationContext;
use crate::protocol::{InjectionCheckpoint, InjectionCheckpointResult, HindsightRefusal, JsonRpcId,
    parse_deployment_checkpoint_result, parse_timestamp};
use crate::ws_client::{SharedSession, SharedWrite};

pub(crate) type CheckpointCallback = Arc<dyn Fn(InjectionCheckpoint) -> Result<InjectionCheckpointResult, HindsightRefusal> + Send + Sync>;
#[derive(Default)]
pub(crate) struct CheckpointRelay { pending: Mutex<HashMap<String, oneshot::Sender<Value>>>, closed: AtomicBool }
pub(crate) struct CheckpointTransport { pub relay: Arc<CheckpointRelay>, pub write: SharedWrite, pub session: SharedSession }

impl CheckpointRelay {
    pub fn deliver(&self, id: &JsonRpcId, result: Value) {
        let JsonRpcId::Str(id) = id else { return; };
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(sender) = pending.remove(id) { let _ = sender.send(result); }
        }
    }
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() { pending.clear(); }
    }
    fn remove(&self, id: &str) { if let Ok(mut pending) = self.pending.lock() { pending.remove(id); } }
}

pub(crate) fn checkpoint_callback(expected: TrustedHostInvocationContext, transport: CheckpointTransport) -> CheckpointCallback {
    let runtime = tokio::runtime::Handle::current();
    Arc::new(move |checkpoint| {
        if checkpoint.request_id != expected.request_id || checkpoint.control != expected.control
            || serde_json::to_value(&checkpoint.authorization).ok() != serde_json::to_value(&expected.authorization).ok()
            || !expected.live.load(Ordering::Acquire) { return Err(HindsightRefusal::SnapshotStale); }
        runtime.block_on(exchange(&expected, &transport, checkpoint))
    })
}
async fn exchange(expected: &TrustedHostInvocationContext, transport: &CheckpointTransport,
    checkpoint: InjectionCheckpoint) -> Result<InjectionCheckpointResult, HindsightRefusal> {
    if transport.relay.closed.load(Ordering::Acquire) || transport.session.lock().await.invocation_live(&expected.request_id, &expected.control).is_none() {
        return Err(HindsightRefusal::SnapshotStale);
    }
    let remaining = parse_timestamp(&expected.control.deadline_at).map_err(|_| HindsightRefusal::SnapshotStale)? - time::OffsetDateTime::now_utc();
    let duration = Duration::try_from(remaining).map_err(|_| HindsightRefusal::SnapshotStale)?.min(Duration::from_secs(90));
    let id = format!("c2-checkpoint-{}", uuid::Uuid::new_v4());
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = transport.relay.pending.lock().map_err(|_| HindsightRefusal::HostUnavailable)?;
        if pending.len() >= 64 || transport.relay.closed.load(Ordering::Acquire) { return Err(HindsightRefusal::HostUnavailable); }
        pending.insert(id.clone(), sender);
    }
    let request = json!({"jsonrpc":"2.0","id":id,"method":"host.hindsight.deployment.checkpoint","params":checkpoint});
    let result = tokio::time::timeout(duration, async {
        transport.write.lock().await.send(Message::text(request.to_string())).await.map_err(|_| HindsightRefusal::HostUnavailable)?;
        let mut receiver = receiver;
        loop {
            if !expected.live.load(Ordering::Acquire) || transport.relay.closed.load(Ordering::Acquire) { return Err(HindsightRefusal::SnapshotStale); }
            tokio::select! {
                result = &mut receiver => break result.map_err(|_| HindsightRefusal::HostUnavailable),
                () = tokio::time::sleep(Duration::from_millis(10)) => {},
            }
        }
    }).await;
    transport.relay.remove(&id);
    if !expected.live.load(Ordering::Acquire) || transport.session.lock().await.invocation_live(&expected.request_id, &expected.control).is_none() {
        return Err(HindsightRefusal::SnapshotStale);
    }
    let value = result.map_err(|_| HindsightRefusal::SnapshotStale)??;
    parse_deployment_checkpoint_result(value).map_err(|_| HindsightRefusal::SnapshotStale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivery_consumes_only_the_exact_pending_relay_once() {
        let relay = CheckpointRelay::default();
        let (sender, mut receiver) = oneshot::channel();
        relay.pending.lock().unwrap().insert("current".into(), sender);
        relay.deliver(&JsonRpcId::Str("other".into()), json!({"state":"unavailable","reason":"denied"}));
        assert!(receiver.try_recv().is_err());
        relay.deliver(&JsonRpcId::Str("current".into()), json!({"state":"unavailable","reason":"denied"}));
        assert_eq!(receiver.try_recv().unwrap()["reason"], "denied");
        assert!(relay.pending.lock().unwrap().is_empty());
        relay.deliver(&JsonRpcId::Str("current".into()), Value::Null);
    }

    #[test]
    fn session_close_retires_all_pending_checkpoint_authority() {
        let relay = CheckpointRelay::default();
        let (sender, mut receiver) = oneshot::channel();
        relay.pending.lock().unwrap().insert("old".into(), sender);
        relay.close();
        assert!(relay.closed.load(Ordering::Acquire));
        assert!(matches!(receiver.try_recv(), Err(oneshot::error::TryRecvError::Closed)));
        assert!(relay.pending.lock().unwrap().is_empty());
    }
}
