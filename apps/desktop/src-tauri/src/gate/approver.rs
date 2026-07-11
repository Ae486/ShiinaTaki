//! INPUT:  a capability name to authorize; (real impl) a tauri AppHandle for the native dialog
//! OUTPUT: Approver trait + Scope/ApproverOutcome + TwoStepDialogApprover + ScriptedApprover (debug-only, env-driven)
//! POS:    shell/gate — the ask seam; the TRAIT is tauri-free (gate unit-tests inject a fake); only the dialog impl touches Tauri

#[cfg(debug_assertions)]
use std::collections::HashMap;
use std::sync::mpsc;
use std::time::Duration;

/// How long an allow decision is remembered (mirror of ApprovalScope).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Once,
    Session,
    Always,
}

/// The outcome of asking the user. Every non-`Allow` arm denies (fail-closed); Timeout/Unavailable are distinct
/// so the gate can audit them precisely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApproverOutcome {
    Allow(Scope),
    Deny,
    Timeout,
    Unavailable,
}

/// Asks the user to authorize a capability. `detail` is an optional human-readable string (e.g. the shell-open
/// target) rendered in the dialog only. Object-safe + tauri-free so the gate stays unit-testable.
pub trait Approver: Send + Sync {
    fn ask(&self, capability: &str, detail: Option<&str>) -> ApproverOutcome;
}

// Fail-closed: a user who never answers within a minute is a deny, not a hung capability (ruling 2/11).
const DIALOG_TIMEOUT: Duration = Duration::from_secs(60);
const ALLOW: &str = "Allow";
const ONLY_ONCE: &str = "Only once";
const THIS_SESSION: &str = "This session";
const ALWAYS: &str = "Always";

/// The native two-step dialog approver (decision 1A). Runs the blocking dialog OFF the async reactor on a worker
/// thread; a 60s no-answer maps to Timeout. The one module besides lib.rs that touches Tauri (ruling 15).
#[cfg(desktop)]
pub struct TwoStepDialogApprover {
    app: tauri::AppHandle,
}

#[cfg(desktop)]
impl TwoStepDialogApprover {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

#[cfg(desktop)]
impl Approver for TwoStepDialogApprover {
    fn ask(&self, capability: &str, detail: Option<&str>) -> ApproverOutcome {
        let (tx, rx) = mpsc::channel();
        let app = self.app.clone();
        let capability = capability.to_string();
        let detail = detail.map(str::to_string);
        // The native dialog is blocking and must never run on the main/UI thread; a worker thread keeps both the
        // UI and the async WS reactor free while the recv_timeout enforces the fail-closed 60s deadline.
        std::thread::spawn(move || {
            let _ = tx.send(run_two_step_dialog(&app, &capability, detail.as_deref()));
        });
        match rx.recv_timeout(DIALOG_TIMEOUT) {
            Ok(outcome) => outcome,
            Err(mpsc::RecvTimeoutError::Timeout) => ApproverOutcome::Timeout,
            // The dialog thread vanished without answering (panic / app teardown) — the approver is unavailable, deny.
            Err(mpsc::RecvTimeoutError::Disconnected) => ApproverOutcome::Unavailable,
        }
    }
}

#[cfg(desktop)]
fn run_two_step_dialog(app: &tauri::AppHandle, capability: &str, detail: Option<&str>) -> ApproverOutcome {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

    // The detail (e.g. the shell-open target) closes the visibility gap: the user sees WHAT is being launched (ruling 4).
    let prompt = match detail {
        Some(detail) => format!("The agent wants to use: {capability} — {detail}"),
        None => format!("The agent wants to use: {capability}"),
    };
    let allowed = app
        .dialog()
        .message(prompt)
        .title("TakiAgent — Permission")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(ALLOW.into(), "Deny".into()))
        .blocking_show();
    if !allowed {
        return ApproverOutcome::Deny;
    }

    // Button order is security-relevant: rfd 0.16 reports a dismissed (ESC/X) dialog as `Cancel`
    // (win_cid/message_dialog.rs), and tauri-plugin-dialog 2.7 remaps `Cancel` to Custom(<cancel-slot label>)
    // (desktop.rs show_message_dialog). The cancel slot therefore MUST hold the least-permissive scope —
    // with ALWAYS there, a dismiss silently granted the broadest scope (a permission fail-open).
    let scope = app
        .dialog()
        .message("Remember this decision?")
        .title("TakiAgent — Permission")
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            THIS_SESSION.into(),
            ALWAYS.into(),
            ONLY_ONCE.into(),
        ))
        .blocking_show_with_result();
    match scope {
        MessageDialogResult::Custom(label) if label == THIS_SESSION => ApproverOutcome::Allow(Scope::Session),
        MessageDialogResult::Custom(label) if label == ALWAYS => ApproverOutcome::Allow(Scope::Always),
        // Only-once, or a closed/dismissed scope prompt: authorize this call and remember nothing.
        _ => ApproverOutcome::Allow(Scope::Once),
    }
}

/// One scripted answer. The vocabulary mirrors the dialog's outcomes so a test can drive every gate path,
/// including the fail-closed timeout (mapped instantly — no 60s wait).
#[cfg(debug_assertions)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptedDirective {
    AllowOnce,
    AllowSession,
    AllowAlways,
    Deny,
    Timeout,
}

#[cfg(debug_assertions)]
impl ScriptedDirective {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "allow-once" => Ok(Self::AllowOnce),
            "allow-session" => Ok(Self::AllowSession),
            "allow-always" => Ok(Self::AllowAlways),
            "deny" => Ok(Self::Deny),
            "timeout" => Ok(Self::Timeout),
            other => Err(format!("unknown scripted-approver directive: {other}")),
        }
    }

    fn outcome(self) -> ApproverOutcome {
        match self {
            Self::AllowOnce => ApproverOutcome::Allow(Scope::Once),
            Self::AllowSession => ApproverOutcome::Allow(Scope::Session),
            Self::AllowAlways => ApproverOutcome::Allow(Scope::Always),
            Self::Deny => ApproverOutcome::Deny,
            Self::Timeout => ApproverOutcome::Timeout,
        }
    }
}

/// A permission-gate BYPASS for headless tests: answers from a directive spec instead of a dialog. Debug-only by
/// construction (`cfg(debug_assertions)` — the type does not exist in release) and opt-in via TAKI_GATE_AUTOAPPROVE
/// at the composition roots; it announces itself on construction and on every answer so a bypass is never silent.
///
/// Spec format (the env var's value): comma-separated entries. A bare directive or `default=<directive>` sets the
/// answer for every capability; `<capability>=<directive>` overrides one. Directives: `allow-once | allow-session |
/// allow-always | deny | timeout`. With only overrides given, unlisted capabilities are denied (fail-closed).
/// Example: `screenshot=allow-once,exec=deny` — or just `allow-once`.
#[cfg(debug_assertions)]
pub struct ScriptedApprover {
    default: ScriptedDirective,
    overrides: HashMap<String, ScriptedDirective>,
}

#[cfg(debug_assertions)]
impl ScriptedApprover {
    pub fn parse(spec: &str) -> Result<Self, String> {
        let mut default = None;
        let mut overrides = HashMap::new();
        for entry in spec.split(',').map(str::trim).filter(|entry| !entry.is_empty()) {
            match entry.split_once('=') {
                Some((name, value)) => {
                    let directive = ScriptedDirective::parse(value.trim())?;
                    match name.trim() {
                        "default" => default = Some(directive),
                        capability => {
                            overrides.insert(capability.to_string(), directive);
                        }
                    }
                }
                None => default = Some(ScriptedDirective::parse(entry)?),
            }
        }
        tracing::warn!(
            spec = %spec,
            "SCRIPTED APPROVER ACTIVE — permission dialogs are bypassed (debug build + TAKI_GATE_AUTOAPPROVE)"
        );
        Ok(Self { default: default.unwrap_or(ScriptedDirective::Deny), overrides })
    }
}

#[cfg(debug_assertions)]
impl Approver for ScriptedApprover {
    fn ask(&self, capability: &str, _detail: Option<&str>) -> ApproverOutcome {
        let directive = self.overrides.get(capability).copied().unwrap_or(self.default);
        let outcome = directive.outcome();
        tracing::warn!(
            capability = %capability,
            directive = ?directive,
            "SCRIPTED APPROVER answered — no dialog was shown"
        );
        outcome
    }
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;

    #[test]
    fn a_bare_directive_is_the_default_for_every_capability() {
        let approver = ScriptedApprover::parse("allow-once").unwrap();
        assert_eq!(approver.ask("screenshot", None), ApproverOutcome::Allow(Scope::Once));
        assert_eq!(approver.ask("exec", Some("git status")), ApproverOutcome::Allow(Scope::Once));
    }

    #[test]
    fn per_capability_overrides_beat_the_default() {
        let approver = ScriptedApprover::parse("screenshot=allow-session,exec=deny,default=allow-once").unwrap();
        assert_eq!(approver.ask("screenshot", None), ApproverOutcome::Allow(Scope::Session));
        assert_eq!(approver.ask("exec", None), ApproverOutcome::Deny);
        assert_eq!(approver.ask("clipboard-read", None), ApproverOutcome::Allow(Scope::Once));
    }

    #[test]
    fn overrides_without_a_default_deny_everything_else() {
        // Fail-closed: a spec that only names capabilities must not implicitly allow the rest.
        let approver = ScriptedApprover::parse("screenshot=allow-once").unwrap();
        assert_eq!(approver.ask("screenshot", None), ApproverOutcome::Allow(Scope::Once));
        assert_eq!(approver.ask("exec", None), ApproverOutcome::Deny);
    }

    #[test]
    fn every_directive_maps_to_its_outcome() {
        let cases = [
            ("allow-once", ApproverOutcome::Allow(Scope::Once)),
            ("allow-session", ApproverOutcome::Allow(Scope::Session)),
            ("allow-always", ApproverOutcome::Allow(Scope::Always)),
            ("deny", ApproverOutcome::Deny),
            ("timeout", ApproverOutcome::Timeout),
        ];
        for (spec, expected) in cases {
            let approver = ScriptedApprover::parse(spec).unwrap();
            assert_eq!(approver.ask("anything", None), expected, "directive {spec}");
        }
    }

    #[test]
    fn an_unknown_directive_is_a_parse_error() {
        assert!(ScriptedApprover::parse("allow").is_err());
        assert!(ScriptedApprover::parse("screenshot=yes").is_err());
    }

    #[test]
    fn whitespace_and_empty_entries_are_tolerated() {
        let approver = ScriptedApprover::parse(" screenshot = allow-once , , default = deny ").unwrap();
        assert_eq!(approver.ask("screenshot", None), ApproverOutcome::Allow(Scope::Once));
        assert_eq!(approver.ask("exec", None), ApproverOutcome::Deny);
    }
}
