//! INPUT:  a capability request (requestId, capability) + a Remembered verdict / an Approver answer; or a pre-classified exec command
//! OUTPUT: Gate::evaluate -> bool (name-keyed); Gate::evaluate_exec -> bool (command-keyed, no persistence); ExecClass; GatePolicy
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

    // Audits the decision and returns whether it authorizes the capability (the single source of the allow bit).
    fn audited(&self, request_id: &str, capability: &str, decision: Decision) -> bool {
        self.audit.record(request_id, capability, decision, None);
        matches!(
            decision,
            Decision::AllowedOnce | Decision::AllowedSession | Decision::AllowedAlways | Decision::AutoAllowed
        )
    }

    // The exec variant: identical allow logic, but the command rides the audit line (ruling 9).
    fn audited_exec(&self, request_id: &str, decision: Decision, command: &str) -> bool {
        self.audit.record(request_id, "exec", decision, Some(command));
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
}
