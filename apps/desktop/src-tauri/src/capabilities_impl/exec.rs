//! INPUT:  a gate-authorized exec request ({ command: string }) + the shared ExecPolicy (for the sandbox config)
//! OUTPUT: ExecExec: re-parses the command and spawns it confined -> ExecOutput Value; exposes classify for the gate
//! POS:    shell/capabilities/exec — the exec capability handler (ruling 16); reachable ONLY after Gate::evaluate_exec

mod parser;
mod policy;
mod resolve;
mod sandbox;

use std::sync::Arc;

use serde_json::Value;

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::gate::ExecClass;

pub use policy::ExecPolicy;

const CAPABILITY: &str = "exec";

/// The exec capability: an opaque pass-through from the Core (the command is a bare string, parsed here — the boundary,
/// ruling 16). Holds the shared policy so `run` uses the same cwd/timeout/caps the gate classified against.
pub struct ExecExec {
    policy: Arc<ExecPolicy>,
}

impl ExecExec {
    pub fn new(policy: Arc<ExecPolicy>) -> Self {
        Self { policy }
    }
}

impl CapabilityExec for ExecExec {
    fn capability(&self) -> &str {
        CAPABILITY
    }

    fn run(&self, input: &Value) -> Result<Value, ExecError> {
        let command = read_command(input)?;
        let output = sandbox::run(command, self.policy.sandbox())?;
        // Exit metadata only — the command lives in the audit line, stdout/stderr are content (ruling 9/R4).
        tracing::info!(exit_code = ?output.exit_code, timed_out = output.timed_out, "exec completed");
        serde_json::to_value(output).map_err(|error| ExecError::failed(error.to_string()))
    }
}

/// The gate-facing classification (ruling 6): exec computes the class, `Gate::evaluate_exec` turns it into approve+audit.
/// A malformed request (no command) maps to `Disabled` — the exec-unavailable pseudo-class: a direct deny with no
/// dialog, distinct from the catastrophic `Blocked` floor (nothing to run, so nothing to classify against a cell).
pub fn classify(policy: &ExecPolicy, input: &Value) -> ExecClass {
    match input.get("command").and_then(Value::as_str) {
        Some(command) if !command.trim().is_empty() => policy.classify(command),
        _ => ExecClass::Disabled,
    }
}

/// The command string for the audit line + approver dialog (ruling 9); empty when the request is malformed.
pub fn command_of(input: &Value) -> &str {
    input.get("command").and_then(Value::as_str).unwrap_or("")
}

fn read_command(input: &Value) -> Result<&str, ExecError> {
    match input.get("command").and_then(Value::as_str) {
        Some(command) if !command.trim().is_empty() => Ok(command),
        _ => Err(ExecError::failed("exec requires a non-empty `command` string")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_missing_command_classifies_as_disabled_and_fails_to_run() {
        let policy = ExecPolicy::load(std::path::Path::new("none.json"), std::path::PathBuf::from("."));
        assert_eq!(classify(&policy, &json!({})), ExecClass::Disabled);
        assert_eq!(classify(&policy, &json!({ "command": "  " })), ExecClass::Disabled);
        assert!(ExecExec::new(Arc::new(policy)).run(&json!({})).is_err());
    }

    #[test]
    fn command_of_extracts_the_string_for_audit_and_dialog() {
        assert_eq!(command_of(&json!({ "command": "git status" })), "git status");
        assert_eq!(command_of(&json!({})), "");
    }
}
