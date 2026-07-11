//! INPUT:  a capability name to authorize; (real impl) a tauri AppHandle for the native dialog
//! OUTPUT: Approver trait + Scope/ApproverOutcome + TwoStepDialogApprover (the sanctioned tauri-plugin-dialog impl)
//! POS:    shell/gate — the ask seam; the TRAIT is tauri-free (gate unit-tests inject a fake); only this impl touches Tauri

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

    let scope = app
        .dialog()
        .message("Remember this decision?")
        .title("TakiAgent — Permission")
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            ONLY_ONCE.into(),
            THIS_SESSION.into(),
            ALWAYS.into(),
        ))
        .blocking_show_with_result();
    match scope {
        MessageDialogResult::Custom(label) if label == THIS_SESSION => ApproverOutcome::Allow(Scope::Session),
        MessageDialogResult::Custom(label) if label == ALWAYS => ApproverOutcome::Allow(Scope::Always),
        // Only-once, or a closed/dismissed scope prompt: authorize this call and remember nothing.
        _ => ApproverOutcome::Allow(Scope::Once),
    }
}
