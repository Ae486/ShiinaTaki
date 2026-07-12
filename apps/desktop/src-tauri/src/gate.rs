//! INPUT:  a capability request (requestId, capability) + a Remembered verdict / an Approver answer; or a pre-classified exec command / shell-open target
//! OUTPUT: Gate::evaluate (name-keyed); evaluate_exec (command-keyed) + evaluate_shell_open (class-keyed, A1 fix); ExecClass; ShellOpenClass; GatePolicy
//! POS:    shell/gate — the Permission Gate policy core (ruling 10); fail-closed everywhere; NO tauri:: types

pub mod approver;
pub mod decisions;

use std::collections::HashSet;
use std::sync::Arc;

use crate::audit::{AuditSink, Decision};

use self::approver::{Approver, ApproverOutcome, Scope};
use self::decisions::{DecisionStore, Remembered};

/// The pre-computed decision class for an exec command (ruling 6, Shape B): exec's policy engine (parser + mode +
/// allow/blocklist) produces this; the gate turns it into approve?+audit, staying the sole approve+audit authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecClass {
    /// A catastrophic blocklist hit — reject in every mode, no dialog (ruling 2/11).
    Block,
    /// `deny` mode — reject, no dialog (ruling 7).
    Deny,
    /// A simple allowlisted command in `allowlist` mode — auto-run (still audited) (ruling 7).
    Auto,
    /// Everything else — ask the user; ALWAYS-ask, never persisted (ruling 8).
    Escalate,
}

/// The derived risk class of a shell-open target (A1 fix): shell-open's risk is set by the TARGET, not the name, so
/// authorization keys on (capability, targetClass) — an Always earned on one class never reaches another (R1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellOpenClass {
    /// An allowlisted-scheme url (http/https/mailto) — rememberable once/session/always under its OWN class key.
    UrlSafe,
    /// A local non-executable file — always-ask, never persisted (the target varies per request, so does its risk).
    LocalFile,
    /// An executable/script/UNC target — the bypass-immune floor (R2): always >= ask, never persisted.
    LocalExec,
    /// A non-allowlisted url scheme or malformed request — refused without a dialog.
    Blocked,
}

impl ShellOpenClass {
    /// The (capability, targetClass) authorization key — what decision memory, the approver, and audit see.
    pub fn key(self) -> &'static str {
        match self {
            Self::UrlSafe => "shell-open:url-safe",
            Self::LocalFile => "shell-open:local-file",
            Self::LocalExec => "shell-open:local-exec",
            Self::Blocked => "shell-open:blocked",
        }
    }
}

/// Per-capability enable switch. v1: every capability is enabled (operator config lands with #23), but the
/// disabled branch exists and is exercised so the policy order is real, not aspirational.
pub struct GatePolicy {
    disabled: HashSet<String>,
}

impl GatePolicy {
    pub fn new() -> Self {
        Self { disabled: HashSet::new() }
    }

    #[cfg(test)]
    pub fn disable(&mut self, capability: &str) {
        self.disabled.insert(capability.to_string());
    }

    pub fn is_enabled(&self, capability: &str) -> bool {
        !self.disabled.contains(capability)
    }
}

impl Default for GatePolicy {
    fn default() -> Self {
        Self::new()
    }
}

/// The Permission Gate: evaluate a capability request against policy + remembered decisions, asking the user only
/// when nothing is remembered. Every path audits exactly once; every non-allow path denies (fail-closed).
pub struct Gate {
    policy: GatePolicy,
    decisions: Arc<DecisionStore>,
    approver: Arc<dyn Approver>,
    audit: Arc<dyn AuditSink>,
}

impl Gate {
    pub fn new(
        policy: GatePolicy,
        decisions: Arc<DecisionStore>,
        approver: Arc<dyn Approver>,
        audit: Arc<dyn AuditSink>,
    ) -> Self {
        Self { policy, decisions, approver, audit }
    }

    /// Returns true iff the capability is authorized. `detail` is an optional human-readable string (e.g. the
    /// shell-open target) shown in the approval dialog only (ruling 4) — it is never audited or logged. Blocking (the
    /// approver may show a native dialog) — the caller runs this off the async reactor (spawn_blocking).
    pub fn evaluate(&self, request_id: &str, capability: &str, detail: Option<&str>) -> bool {
        // 1. Disabled capability -> auto-deny (mirror of approval-gate.ts order).
        if !self.policy.is_enabled(capability) {
            return self.audited(request_id, capability, Decision::AutoDenied);
        }
        // 2/3. A remembered verdict short-circuits the ask.
        match self.decisions.get(capability) {
            Some(Remembered::Always) => return self.audited(request_id, capability, Decision::AutoAllowed),
            Some(Remembered::Never) => return self.audited(request_id, capability, Decision::AutoDenied),
            None => {}
        }
        // 4. Ask. Allow remembers per scope; every other arm denies without persisting (deny-once, ruling 1).
        match self.approver.ask(capability, detail) {
            ApproverOutcome::Allow(scope) => {
                self.decisions.remember(capability, scope, true);
                self.audited(request_id, capability, allow_decision(scope))
            }
            ApproverOutcome::Deny | ApproverOutcome::Unavailable => {
                self.audited(request_id, capability, Decision::Denied)
            }
            ApproverOutcome::Timeout => self.audited(request_id, capability, Decision::DeniedTimeout),
        }
    }

    /// Authorizes an exec command from its pre-computed `ExecClass` (ruling 6, Shape B). The command is threaded to the
    /// approver dialog AND the audit line (ruling 9) — exec is the ONLY capability whose command is audited. Unlike
    /// `evaluate`, this NEVER consults or writes decision memory: a remembered "always allow exec" would auto-approve
    /// every future command, so exec ESCALATE is always-ask (ruling 8). The name-keyed `evaluate` path is untouched.
    pub fn evaluate_exec(&self, request_id: &str, command: &str, class: ExecClass) -> bool {
        match class {
            // Block / deny reject without a dialog; both are audited (an error path must never skip the audit).
            ExecClass::Block | ExecClass::Deny => {
                self.audited_exec(request_id, Decision::AutoDenied, command)
            }
            ExecClass::Auto => self.audited_exec(request_id, Decision::AutoAllowed, command),
            ExecClass::Escalate => match self.approver.ask("exec", Some(command)) {
                // The remember-step answer is deliberately ignored for exec (never persisted); any Allow is once-only.
                ApproverOutcome::Allow(_) => self.audited_exec(request_id, Decision::AllowedOnce, command),
                ApproverOutcome::Deny | ApproverOutcome::Unavailable => {
                    self.audited_exec(request_id, Decision::Denied, command)
                }
                ApproverOutcome::Timeout => self.audited_exec(request_id, Decision::DeniedTimeout, command),
            },
        }
    }

    /// Authorizes a shell-open from its pre-derived target class (A1 fix). url-safe delegates to the name-keyed
    /// `evaluate` under its class-qualified key, so a remembered Always silences ONLY url-safe. The local classes are
    /// the bypass-immune floor (R2): decision memory is neither consulted nor written — no Always (legacy name-keyed,
    /// url-safe, or a future trust mode) can ever silence a local open, and any allow is once-only.
    pub fn evaluate_shell_open(&self, request_id: &str, class: ShellOpenClass, detail: Option<&str>) -> bool {
        // The enable switch stays on the bare capability name — operator config disables shell-open as a whole.
        if !self.policy.is_enabled("shell-open") {
            return self.audited(request_id, class.key(), Decision::AutoDenied);
        }
        match class {
            ShellOpenClass::Blocked => self.audited(request_id, class.key(), Decision::AutoDenied),
            ShellOpenClass::UrlSafe => self.evaluate(request_id, class.key(), detail),
            ShellOpenClass::LocalFile | ShellOpenClass::LocalExec => match self.approver.ask(class.key(), detail) {
                // The remember-step answer is deliberately dropped (never persisted, R2) — any allow is once-only.
                ApproverOutcome::Allow(_) => self.audited(request_id, class.key(), Decision::AllowedOnce),
                ApproverOutcome::Deny | ApproverOutcome::Unavailable => {
                    self.audited(request_id, class.key(), Decision::Denied)
                }
                ApproverOutcome::Timeout => self.audited(request_id, class.key(), Decision::DeniedTimeout),
            },
        }
    }

    // Audits the decision and returns whether it authorizes the capability (the single source of the allow bit).
    fn audited(&self, request_id: &str, capability: &str, decision: Decision) -> bool {
        self.audit.record(request_id, capability, decision, None);
        tracing::info!(capability = %capability, decision = ?decision, "gate decision");
        matches!(
            decision,
            Decision::AllowedOnce | Decision::AllowedSession | Decision::AllowedAlways | Decision::AutoAllowed
        )
    }

    // The exec variant: identical allow logic, but the command rides the audit line (ruling 9).
    fn audited_exec(&self, request_id: &str, decision: Decision, command: &str) -> bool {
        self.audit.record(request_id, "exec", decision, Some(command));
        // The command is audit-only (ruling 9/R4) — the tracing line carries the decision alone.
        tracing::info!(capability = "exec", decision = ?decision, "gate decision");
        matches!(
            decision,
            Decision::AllowedOnce | Decision::AllowedSession | Decision::AllowedAlways | Decision::AutoAllowed
        )
    }
}

fn allow_decision(scope: Scope) -> Decision {
    match scope {
        Scope::Once => Decision::AllowedOnce,
        Scope::Session => Decision::AllowedSession,
        Scope::Always => Decision::AllowedAlways,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeApprover(ApproverOutcome);
    impl Approver for FakeApprover {
        fn ask(&self, _capability: &str, _detail: Option<&str>) -> ApproverOutcome {
            self.0
        }
    }

    // Records the detail it was asked with, to prove the gate threads it through to the approver (T16).
    struct RecordingApprover {
        detail: Mutex<Option<String>>,
    }
    impl Approver for RecordingApprover {
        fn ask(&self, _capability: &str, detail: Option<&str>) -> ApproverOutcome {
            *self.detail.lock().unwrap() = detail.map(str::to_string);
            ApproverOutcome::Allow(Scope::Once)
        }
    }

    #[derive(Default)]
    struct MemoryAuditor {
        records: Mutex<Vec<AuditRecord>>,
    }
    // (requestId, capability, decision, exec command) — the exec command is Some only for exec (ruling 9).
    type AuditRecord = (String, String, Decision, Option<String>);
    impl AuditSink for MemoryAuditor {
        fn record(&self, request_id: &str, capability: &str, decision: Decision, command: Option<&str>) {
            self.records.lock().unwrap().push((
                request_id.into(),
                capability.into(),
                decision,
                command.map(str::to_string),
            ));
        }
    }

    struct Harness {
        _dir: tempfile::TempDir,
        gate: Gate,
        audit: Arc<MemoryAuditor>,
        decisions: Arc<DecisionStore>,
    }

    fn harness(policy: GatePolicy, answer: ApproverOutcome) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let decisions = Arc::new(DecisionStore::load(dir.path().join("gate-decisions.json")));
        let audit = Arc::new(MemoryAuditor::default());
        let gate = Gate::new(
            policy,
            decisions.clone(),
            Arc::new(FakeApprover(answer)),
            audit.clone() as Arc<dyn AuditSink>,
        );
        Harness { _dir: dir, gate, audit, decisions }
    }

    fn last_decision(audit: &MemoryAuditor) -> Decision {
        audit.records.lock().unwrap().last().unwrap().2
    }

    fn last_command(audit: &MemoryAuditor) -> Option<String> {
        audit.records.lock().unwrap().last().unwrap().3.clone()
    }

    #[test]
    fn table_driven_policy_order() {
        // (setup, approver answer) -> (allowed, audited-as)
        let disabled = {
            let mut p = GatePolicy::new();
            p.disable("screenshot");
            p
        };
        let cases: Vec<(GatePolicy, ApproverOutcome, bool, Decision)> = vec![
            (disabled, ApproverOutcome::Allow(Scope::Once), false, Decision::AutoDenied),
            (GatePolicy::new(), ApproverOutcome::Allow(Scope::Once), true, Decision::AllowedOnce),
            (GatePolicy::new(), ApproverOutcome::Allow(Scope::Session), true, Decision::AllowedSession),
            (GatePolicy::new(), ApproverOutcome::Allow(Scope::Always), true, Decision::AllowedAlways),
            (GatePolicy::new(), ApproverOutcome::Deny, false, Decision::Denied),
            (GatePolicy::new(), ApproverOutcome::Timeout, false, Decision::DeniedTimeout),
            // Flip-the-default: an unavailable/errored approver MUST deny. Change this arm to allow and the test fails.
            (GatePolicy::new(), ApproverOutcome::Unavailable, false, Decision::Denied),
        ];
        for (policy, answer, expect_allowed, expect_audit) in cases {
            let h = harness(policy, answer);
            let allowed = h.gate.evaluate("req", "screenshot", None);
            assert_eq!(allowed, expect_allowed, "allow bit for {answer:?}");
            assert_eq!(last_decision(&h.audit), expect_audit, "audited-as for {answer:?}");
            // Exactly one audit line per evaluation.
            assert_eq!(h.audit.records.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn remembered_always_auto_allows_without_asking() {
        let h = harness(GatePolicy::new(), ApproverOutcome::Deny); // approver would deny — but it must not be consulted
        h.decisions.remember("screenshot", Scope::Always, true);
        assert!(h.gate.evaluate("req", "screenshot", None));
        assert_eq!(last_decision(&h.audit), Decision::AutoAllowed);
    }

    #[test]
    fn remembered_never_auto_denies_without_asking() {
        let h = harness(GatePolicy::new(), ApproverOutcome::Allow(Scope::Once));
        h.decisions.remember("screenshot", Scope::Always, false); // deny+always == never
        assert!(!h.gate.evaluate("req", "screenshot", None));
        assert_eq!(last_decision(&h.audit), Decision::AutoDenied);
    }

    #[test]
    fn allow_always_persists_for_the_next_evaluation() {
        let h = harness(GatePolicy::new(), ApproverOutcome::Allow(Scope::Always));
        assert!(h.gate.evaluate("req", "screenshot", None));
        assert_eq!(h.decisions.get("screenshot"), Some(Remembered::Always));
    }

    #[test]
    fn allow_once_persists_nothing() {
        let h = harness(GatePolicy::new(), ApproverOutcome::Allow(Scope::Once));
        assert!(h.gate.evaluate("req", "screenshot", None));
        assert_eq!(h.decisions.get("screenshot"), None);
    }

    #[test]
    fn threads_the_detail_string_to_the_approver_on_ask() {
        // T16: shell-open passes its target as detail; screenshot passes None (name-only). The detail must reach the
        // approver verbatim — it is what the user sees in the dialog before authorizing a launch (ruling 4).
        let dir = tempfile::tempdir().unwrap();
        let decisions = Arc::new(DecisionStore::load(dir.path().join("gate-decisions.json")));
        let approver = Arc::new(RecordingApprover { detail: Mutex::new(None) });
        let gate = Gate::new(
            GatePolicy::new(),
            decisions,
            approver.clone(),
            Arc::new(MemoryAuditor::default()) as Arc<dyn AuditSink>,
        );

        assert!(gate.evaluate("req", "shell-open", Some("open https://x")));
        assert_eq!(*approver.detail.lock().unwrap(), Some("open https://x".to_string()));

        assert!(gate.evaluate("req", "screenshot", None));
        assert_eq!(*approver.detail.lock().unwrap(), None);
    }

    // A gate wired with a MemoryAuditor and a fixed approver answer, for the exec (Shape B) table. evaluate_exec never
    // persists (ruling 8), so the decision store is never written — a bare temp path it never touches is enough.
    fn exec_harness(answer: ApproverOutcome) -> (Gate, Arc<MemoryAuditor>, Arc<DecisionStore>) {
        let decisions = Arc::new(DecisionStore::load(
            std::env::temp_dir().join("taki-exec-gate-unused.json"),
        ));
        let audit = Arc::new(MemoryAuditor::default());
        let gate = Gate::new(
            GatePolicy::new(),
            decisions.clone(),
            Arc::new(FakeApprover(answer)),
            audit.clone() as Arc<dyn AuditSink>,
        );
        (gate, audit, decisions)
    }

    #[test]
    fn evaluate_exec_maps_each_class_to_the_right_allow_and_audit() {
        // (class, approver answer) -> (allowed, audited-as). Block/Deny never consult the approver.
        let cases = [
            (ExecClass::Block, ApproverOutcome::Allow(Scope::Once), false, Decision::AutoDenied),
            (ExecClass::Deny, ApproverOutcome::Allow(Scope::Once), false, Decision::AutoDenied),
            (ExecClass::Auto, ApproverOutcome::Deny, true, Decision::AutoAllowed),
            (ExecClass::Escalate, ApproverOutcome::Allow(Scope::Once), true, Decision::AllowedOnce),
            (ExecClass::Escalate, ApproverOutcome::Deny, false, Decision::Denied),
            (ExecClass::Escalate, ApproverOutcome::Timeout, false, Decision::DeniedTimeout),
            (ExecClass::Escalate, ApproverOutcome::Unavailable, false, Decision::Denied),
        ];
        for (class, answer, expect_allowed, expect_audit) in cases {
            let (gate, audit, _decisions) = exec_harness(answer);
            let allowed = gate.evaluate_exec("req", "git status", class);
            assert_eq!(allowed, expect_allowed, "allow bit for {class:?}/{answer:?}");
            assert_eq!(last_decision(&audit), expect_audit, "audited-as for {class:?}/{answer:?}");
            // The command rides EVERY exec audit line — allow, deny, block alike (ruling 9).
            assert_eq!(last_command(&audit), Some("git status".to_string()));
            assert_eq!(audit.records.lock().unwrap().len(), 1, "exactly one audit line per evaluation");
        }
    }

    #[test]
    fn evaluate_exec_escalate_passes_the_command_to_the_approver() {
        // Ruling 8/9: the approver sees the exact command as its detail so the user knows what they authorize.
        let dir = tempfile::tempdir().unwrap();
        let decisions = Arc::new(DecisionStore::load(dir.path().join("gate-decisions.json")));
        let approver = Arc::new(RecordingApprover { detail: Mutex::new(None) });
        let gate = Gate::new(
            GatePolicy::new(),
            decisions,
            approver.clone(),
            Arc::new(MemoryAuditor::default()) as Arc<dyn AuditSink>,
        );
        assert!(gate.evaluate_exec("req", "some-tool --flag", ExecClass::Escalate));
        assert_eq!(*approver.detail.lock().unwrap(), Some("some-tool --flag".to_string()));
    }

    #[test]
    fn evaluate_exec_never_persists_a_decision() {
        // Ruling 8: an approved exec must NOT be remembered — a remembered "always allow exec" would bypass the gate
        // for every future command. Even an Allow(Always) answer leaves the decision store empty for "exec".
        let (gate, _audit, decisions) = exec_harness(ApproverOutcome::Allow(Scope::Always));
        assert!(gate.evaluate_exec("req", "some-tool", ExecClass::Escalate));
        assert_eq!(decisions.get("exec"), None, "exec approvals are never remembered");
    }

    #[test]
    fn shell_open_url_safe_always_is_remembered_under_its_class_key_only() {
        let h = harness(GatePolicy::new(), ApproverOutcome::Allow(Scope::Always));
        assert!(h.gate.evaluate_shell_open("req", ShellOpenClass::UrlSafe, Some("open https://x")));
        assert_eq!(last_decision(&h.audit), Decision::AllowedAlways);
        assert_eq!(h.decisions.get("shell-open:url-safe"), Some(Remembered::Always));
        assert_eq!(h.decisions.get("shell-open"), None, "the bare capability name is never written");
    }

    #[test]
    fn shell_open_url_safe_always_never_authorizes_a_local_class() {
        // THE A1 regression: an Always earned on a safe url (plus a stale pre-fix name-keyed grant) must not
        // silence a local open — the approver MUST still be consulted, and here the user says no.
        let h = harness(GatePolicy::new(), ApproverOutcome::Deny);
        h.decisions.remember("shell-open:url-safe", Scope::Always, true);
        h.decisions.remember("shell-open", Scope::Always, true); // the pre-fix leaked grant must be inert

        assert!(h.gate.evaluate_shell_open("r1", ShellOpenClass::UrlSafe, None), "url-safe is silent");
        assert_eq!(last_decision(&h.audit), Decision::AutoAllowed);

        assert!(!h.gate.evaluate_shell_open("r2", ShellOpenClass::LocalExec, Some("open C:\\x\\cmd.exe")));
        assert_eq!(last_decision(&h.audit), Decision::Denied, "asked (not auto-denied) — the ask still happened");

        assert!(!h.gate.evaluate_shell_open("r3", ShellOpenClass::LocalFile, Some("open C:\\x\\a.pdf")));
        assert_eq!(last_decision(&h.audit), Decision::Denied);
    }

    #[test]
    fn shell_open_local_classes_never_persist_even_on_allow_always() {
        for class in [ShellOpenClass::LocalFile, ShellOpenClass::LocalExec] {
            let h = harness(GatePolicy::new(), ApproverOutcome::Allow(Scope::Always));
            assert!(h.gate.evaluate_shell_open("req", class, None));
            assert_eq!(last_decision(&h.audit), Decision::AllowedOnce, "{class:?} allows are once-only");
            assert_eq!(h.decisions.get(class.key()), None, "{class:?} is never remembered");
        }
    }

    #[test]
    fn shell_open_local_classes_ignore_a_seeded_remembered_always() {
        // Bypass-immunity (R2): even a decision-store entry under the local class key (tampering / a future bug)
        // must not silence the ask — the local arms never read memory at all.
        for class in [ShellOpenClass::LocalFile, ShellOpenClass::LocalExec] {
            let h = harness(GatePolicy::new(), ApproverOutcome::Deny);
            h.decisions.remember(class.key(), Scope::Always, true);
            assert!(!h.gate.evaluate_shell_open("req", class, None), "{class:?} must still ask");
            assert_eq!(last_decision(&h.audit), Decision::Denied);
        }
    }

    #[test]
    fn shell_open_blocked_auto_denies_without_asking() {
        let h = harness(GatePolicy::new(), ApproverOutcome::Allow(Scope::Always)); // would allow — must not be consulted
        assert!(!h.gate.evaluate_shell_open("req", ShellOpenClass::Blocked, None));
        assert_eq!(last_decision(&h.audit), Decision::AutoDenied);
    }

    #[test]
    fn shell_open_disabled_capability_auto_denies_every_class() {
        for class in [ShellOpenClass::UrlSafe, ShellOpenClass::LocalFile, ShellOpenClass::LocalExec] {
            let mut policy = GatePolicy::new();
            policy.disable("shell-open");
            let h = harness(policy, ApproverOutcome::Allow(Scope::Once));
            assert!(!h.gate.evaluate_shell_open("req", class, None), "{class:?} is off with the capability");
            assert_eq!(last_decision(&h.audit), Decision::AutoDenied);
        }
    }
}
