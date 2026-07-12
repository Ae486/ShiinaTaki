//! INPUT:  a gate-authorized shell-open request ({ kind: "url"|"path", target })
//! OUTPUT: ShellOpenExec (launch via opener free fns) + target::classify re-export (feeds the class-keyed gate path)
//! POS:    shell/capabilities — the shell-open capability; reachable ONLY via Gate::evaluate_shell_open (A1 fix); the dialog shows the target (ruling 3/4)

mod target;

use serde_json::Value;
use tauri_plugin_opener::{open_path, open_url};

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::gate::ShellOpenClass;
use crate::protocol::ShellOpenOutput;

pub use target::classify;
use target::parse_target;

const CAPABILITY: &str = "shell-open";

/// What the exec decided to launch, after validating the input. `open_url`/`open_path` never go through a shell, so
/// there is no argument-injection surface — the residual risk is semantic and rests on the gate + dialog (ruling 3).
#[derive(Debug)] // the negative tests use `expect_err`, which formats the Ok value on an unexpected pass
struct OpenPlan {
    is_url: bool,
    target: String,
}

/// Launches a URL or file/path with the system default app (no app override — `with: None`).
pub struct ShellOpenExec;

impl CapabilityExec for ShellOpenExec {
    fn capability(&self) -> &str {
        CAPABILITY
    }

    fn run(&self, input: &Value) -> Result<Value, ExecError> {
        let plan = plan_open(input)?;
        let launched = if plan.is_url {
            open_url(plan.target.clone(), None::<&str>)
        } else {
            open_path(plan.target.clone(), None::<&str>)
        };
        launched.map_err(|error| ExecError::failed(error.to_string()))?;
        serde_json::to_value(ShellOpenOutput { ok: true, opened: plan.target })
            .map_err(|error| ExecError::failed(error.to_string()))
    }

    fn detail(&self, input: &Value) -> Option<String> {
        // Dialog-only, NEVER logged: the operator must see WHAT is being launched before approving.
        parse_target(input).map(|(_, target)| format!("open {target}"))
    }
}

// Validates the input via the same classifier the gate authorized on. The gate refuses Blocked before the handler
// runs; re-deriving here is defense-in-depth so the handler stays safe even through a future non-gate path.
fn plan_open(input: &Value) -> Result<OpenPlan, ExecError> {
    let (kind, target) =
        parse_target(input).ok_or_else(|| ExecError::failed("shell-open requires `kind` and `target`"))?;
    match kind.as_str() {
        "url" | "path" => {
            if classify(input) == ShellOpenClass::Blocked {
                let reason = if kind == "url" { "unsupported url scheme" } else { "malformed path target" };
                return Err(ExecError::failed(reason));
            }
            Ok(OpenPlan { is_url: kind == "url", target })
        }
        other => Err(ExecError::failed(format!("unknown shell-open kind: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn allows_http_https_mailto_urls() {
        for target in ["http://x.test", "https://example.com/p?q=1", "mailto:a@b.test"] {
            let plan = plan_open(&json!({ "kind": "url", "target": target })).expect("allowed scheme");
            assert!(plan.is_url);
            assert_eq!(plan.target, target);
        }
    }

    #[test]
    fn rejects_dangerous_and_unknown_schemes_without_launching() {
        for target in ["javascript:alert(1)", "file:///etc/passwd", "ms-settings:", "notascheme"] {
            let error = plan_open(&json!({ "kind": "url", "target": target })).expect_err("rejected scheme");
            assert_eq!(error.message, "unsupported url scheme");
        }
    }

    #[test]
    fn a_path_plan_accepts_files_and_executables_alike() {
        // The gate decides WHETHER a path opens (per class); the handler only refuses Blocked shapes.
        for target in ["C:\\Users\\me\\notes.txt", "C:\\Windows\\System32\\cmd.exe"] {
            let plan = plan_open(&json!({ "kind": "path", "target": target })).expect("path plan");
            assert!(!plan.is_url);
        }
    }

    #[test]
    fn an_empty_path_target_is_refused() {
        let error = plan_open(&json!({ "kind": "path", "target": "  " })).expect_err("blocked path");
        assert_eq!(error.message, "malformed path target");
    }

    #[test]
    fn detail_shows_the_target_for_the_dialog() {
        assert_eq!(
            ShellOpenExec.detail(&json!({ "kind": "url", "target": "https://example.com" })),
            Some("open https://example.com".to_string())
        );
        // A malformed input yields no detail (name-only dialog), never a panic.
        assert_eq!(ShellOpenExec.detail(&json!({ "kind": "url" })), None);
    }
}
