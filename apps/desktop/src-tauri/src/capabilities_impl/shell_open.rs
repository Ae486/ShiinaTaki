//! INPUT:  a gate-authorized shell-open request ({ kind: "url"|"path", target })
//! OUTPUT: ShellOpenExec: launches the target via tauri-plugin-opener free fns -> ShellOpenOutput ack Value
//! POS:    shell/capabilities — the shell-open capability; reachable ONLY via the gate; the dialog shows the target (ruling 3/4)

use serde_json::Value;
use tauri_plugin_opener::{open_path, open_url};

use crate::capabilities_impl::{CapabilityExec, ExecError};
use crate::protocol::ShellOpenOutput;

const CAPABILITY: &str = "shell-open";
// URL schemes allowed to launch in v1; everything else (file:, javascript:, custom app schemes) is refused (ruling 3).
const ALLOWED_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

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

// Extracts (kind, target) from the input, or None if the shape is wrong (the gate/detail then falls back to name-only).
fn parse_target(input: &Value) -> Option<(String, String)> {
    let kind = input.get("kind").and_then(Value::as_str)?;
    let target = input.get("target").and_then(Value::as_str)?;
    Some((kind.to_string(), target.to_string()))
}

// Validates the input and, for URLs, enforces the scheme allowlist. Pure (no launch) so it is unit-testable.
fn plan_open(input: &Value) -> Result<OpenPlan, ExecError> {
    let (kind, target) = parse_target(input).ok_or_else(|| ExecError::failed("shell-open requires `kind` and `target`"))?;
    match kind.as_str() {
        "url" => {
            let scheme = target.split_once(':').map(|(scheme, _)| scheme.to_ascii_lowercase());
            match scheme {
                Some(scheme) if ALLOWED_SCHEMES.contains(&scheme.as_str()) => Ok(OpenPlan { is_url: true, target }),
                _ => Err(ExecError::failed("unsupported url scheme")),
            }
        }
        "path" => Ok(OpenPlan { is_url: false, target }),
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
    fn a_path_plan_does_not_scheme_check() {
        let plan = plan_open(&json!({ "kind": "path", "target": "C:\\Users\\me\\notes.txt" })).expect("path plan");
        assert!(!plan.is_url);
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
