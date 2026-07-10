//! INPUT:  a capability name + input Value (from a gate-authorized capability.request)
//! OUTPUT: CapabilityRegistry::respond -> CapabilityRespond; CapabilityExec trait + ExecError
//! POS:    shell/capabilities — the pluggable handler table (invariant 7); executors reachable ONLY after the gate

pub mod screenshot;

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::protocol::{CapabilityErrorCode, CapabilityOutput, CapabilityRespond};

/// A capability execution failure, carrying a closed wire code the core surfaces to the model.
#[derive(Debug, Clone)]
pub struct ExecError {
    pub code: CapabilityErrorCode,
    pub message: String,
}

impl ExecError {
    pub fn failed(message: impl Into<String>) -> Self {
        Self { code: CapabilityErrorCode::ExecFailed, message: message.into() }
    }
}

/// One capability implementation. `run` is blocking (screen capture) — the caller runs it off the async reactor.
pub trait CapabilityExec: Send + Sync {
    fn capability(&self) -> &str;
    fn run(&self, input: &Value) -> Result<CapabilityOutput, ExecError>;
}

/// The handler table: capability name -> executor. Adding a capability is one `register` call (invariant 7).
#[derive(Default)]
pub struct CapabilityRegistry {
    handlers: HashMap<String, Arc<dyn CapabilityExec>>,
}

impl CapabilityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, exec: Arc<dyn CapabilityExec>) {
        self.handlers.insert(exec.capability().to_string(), exec);
    }

    /// Runs the capability and shapes the node's respond frame; an unknown capability is UNSUPPORTED_CAPABILITY.
    pub fn respond(&self, request_id: String, capability: &str, input: &Value) -> CapabilityRespond {
        match self.handlers.get(capability) {
            None => CapabilityRespond::err(
                request_id,
                CapabilityErrorCode::UnsupportedCapability,
                format!("unknown capability: {capability}"),
            ),
            Some(exec) => match exec.run(input) {
                Ok(output) => CapabilityRespond::ok(request_id, output),
                Err(error) => CapabilityRespond::err(request_id, error.code, error.message),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeExec;
    impl CapabilityExec for FakeExec {
        fn capability(&self) -> &str {
            "screenshot"
        }
        fn run(&self, _input: &Value) -> Result<CapabilityOutput, ExecError> {
            Ok(CapabilityOutput {
                media_type: "image/png".into(),
                data_base64: "AAAA".into(),
                width: 1920,
                height: 1080,
            })
        }
    }

    fn registry() -> CapabilityRegistry {
        let mut registry = CapabilityRegistry::new();
        registry.register(Arc::new(FakeExec));
        registry
    }

    #[test]
    fn a_fake_exec_shapes_a_success_respond_frame() {
        let respond = registry().respond("req-1".into(), "screenshot", &Value::Object(Default::default()));
        match respond {
            CapabilityRespond::Ok { request_id, ok, output } => {
                assert_eq!(request_id, "req-1");
                assert!(ok);
                assert_eq!(output.media_type, "image/png");
                assert_eq!((output.width, output.height), (1920, 1080));
            }
            other => panic!("expected an Ok respond arm, got {other:?}"),
        }
    }

    #[test]
    fn an_unknown_capability_is_unsupported() {
        let respond = registry().respond("req-2".into(), "clipboard", &Value::Null);
        match respond {
            CapabilityRespond::Err { error, .. } => {
                assert_eq!(error.code, CapabilityErrorCode::UnsupportedCapability);
            }
            other => panic!("expected an Err respond arm, got {other:?}"),
        }
    }
}
