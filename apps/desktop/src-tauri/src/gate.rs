//! INPUT:  a capability request (requestId, capability) + a Remembered verdict / an Approver answer
//! OUTPUT: Gate::evaluate -> bool (authorized?) auditing exactly one decision; GatePolicy (per-capability switch)
//! POS:    shell/gate — the Permission Gate policy core (ruling 10); fail-closed everywhere; NO tauri:: types

pub mod approver;
pub mod decisions;

use std::collections::HashSet;
use std::sync::Arc;

use crate::audit::{AuditSink, Decision};

use self::approver::{Approver, ApproverOutcome, Scope};
use self::decisions::{DecisionStore, Remembered};

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

    // Audits the decision and returns whether it authorizes the capability (the single source of the allow bit).
    fn audited(&self, request_id: &str, capability: &str, decision: Decision) -> bool {
        self.audit.record(request_id, capability, decision);
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
        records: Mutex<Vec<(String, String, Decision)>>,
    }
    impl AuditSink for MemoryAuditor {
        fn record(&self, request_id: &str, capability: &str, decision: Decision) {
            self.records.lock().unwrap().push((request_id.into(), capability.into(), decision));
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
}
