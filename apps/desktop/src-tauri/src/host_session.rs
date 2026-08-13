//! INPUT:  one authenticated Host negotiation plus request/cancel/terminal frames for that live generation
//! OUTPUT: generation-bound begin/cancel/complete decisions and a 256-entry insertion-order terminal cache
//! POS:    shell/host_session — transport-agnostic duplicate/cancellation owner; discarded on every reconnect

use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};

use crate::protocol::{
    CapabilityCancel, CapabilityRequest, CapabilityRespond, HostOperationControl,
};

const TERMINAL_CACHE_CAPACITY: usize = 256;

#[derive(Debug, PartialEq)]
pub(crate) enum BeginDecision {
    Start,
    Cached(Box<CapabilityRespond>),
    DuplicateInFlight,
    Rejected,
}

#[derive(Debug, Clone)]
struct AttemptBinding {
    request_id: String,
    control: HostOperationControl,
}

impl AttemptBinding {
    fn matches(&self, request_id: &str, control: &HostOperationControl) -> bool {
        self.request_id == request_id && self.control == *control
    }
}

pub(crate) struct HostSession {
    host_id: String,
    connection_generation: u64,
    catalog_generation: u64,
    active: HashMap<String, AttemptBinding>,
    terminal: TerminalAttemptCache,
    highest_policy_generation: u64,
    /// Canonical projection digests are scoped to both policy generation and
    /// capability. A single session can legitimately receive different
    /// capability projections at the same generation.
    projection_digests: HashMap<String, (u64, String)>,
}

impl HostSession {
    pub(crate) fn new(
        host_id: String,
        connection_generation: u64,
        catalog_generation: u64,
    ) -> Self {
        Self {
            host_id,
            connection_generation,
            catalog_generation,
            active: HashMap::new(),
            terminal: TerminalAttemptCache::default(),
            highest_policy_generation: 0,
            projection_digests: HashMap::new(),
        }
    }

    pub(crate) fn begin(&mut self, request: &CapabilityRequest) -> BeginDecision {
        if !self.accepts(&request.control) {
            return BeginDecision::Rejected;
        }
        if request.control.policy_generation > self.highest_policy_generation {
            self.highest_policy_generation = request.control.policy_generation;
            self.projection_digests.clear();
        }
        self.projection_digests.insert(
            request.control.capability_id.clone(),
            (
                request.control.policy_generation,
                request.control.governance_projection.digest.clone(),
            ),
        );
        let attempt_id = &request.control.attempt_id;
        if let Some(response) = self.terminal.get(attempt_id) {
            return if response.request_id() == request.request_id
                && response.control() == &request.control
            {
                BeginDecision::Cached(Box::new(response.clone()))
            } else {
                BeginDecision::Rejected
            };
        }
        if let Some(binding) = self.active.get(attempt_id) {
            return if binding.matches(&request.request_id, &request.control) {
                BeginDecision::DuplicateInFlight
            } else {
                BeginDecision::Rejected
            };
        }
        self.active.insert(
            attempt_id.clone(),
            AttemptBinding {
                request_id: request.request_id.clone(),
                control: request.control.clone(),
            },
        );
        BeginDecision::Start
    }

    pub(crate) fn cancel(&mut self, cancel: &CapabilityCancel) -> Option<CapabilityRespond> {
        if !self.accepts(&cancel.control) {
            return None;
        }
        let attempt_id = &cancel.control.attempt_id;
        let binding = self.active.get(attempt_id)?;
        if !binding.matches(&cancel.request_id, &cancel.control) {
            return None;
        }
        self.active.remove(attempt_id);
        let response =
            CapabilityRespond::cancelled(cancel.request_id.clone(), cancel.control.clone());
        self.terminal.insert(attempt_id.clone(), response.clone());
        Some(response)
    }

    pub(crate) fn complete(&mut self, response: CapabilityRespond) -> Option<CapabilityRespond> {
        let attempt_id = response.control().attempt_id.clone();
        if self.terminal.get(&attempt_id).is_some() {
            return None;
        }
        let binding = self.active.get(&attempt_id)?;
        if !binding.matches(response.request_id(), response.control()) {
            return None;
        }
        self.active.remove(&attempt_id);
        self.terminal.insert(attempt_id, response.clone());
        Some(response)
    }

    fn accepts(&self, control: &HostOperationControl) -> bool {
        if control.target_host_id != self.host_id
            || control.connection_generation != self.connection_generation
            || control.catalog_generation != self.catalog_generation
        {
            return false;
        }
        let projection = &control.governance_projection;
        if projection.digest.is_empty() || projection.cells.is_empty() {
            return false;
        }
        if control.policy_generation < self.highest_policy_generation {
            return false;
        }
        if control.policy_generation == self.highest_policy_generation
            && self
                .projection_digests
                .get(&control.capability_id)
                .is_some_and(|(generation, digest)| {
                    *generation == control.policy_generation && digest != &projection.digest
                })
        {
            return false;
        }
        if !validate_projection(&control.capability_id, projection)
            || projection.digest != projection_digest(projection)
        {
            return false;
        }
        true
    }
}

fn projection_digest(projection: &crate::protocol::HostGovernanceProjection) -> String {
    #[derive(serde::Serialize)]
    struct Canonical<'a> {
        #[serde(rename = "registryRevision")]
        registry_revision: u64,
        #[serde(rename = "descriptorRevision")]
        descriptor_revision: u64,
        #[serde(rename = "classifierRevision")]
        classifier_revision: u64,
        cells: &'a [crate::protocol::HostGovernanceCell],
    }
    let canonical = Canonical {
        registry_revision: projection.registry_revision,
        descriptor_revision: projection.descriptor_revision,
        classifier_revision: projection.classifier_revision,
        cells: &projection.cells,
    };
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&canonical).expect("canonical projection serializes"))
    )
}

fn validate_projection(
    capability: &str,
    projection: &crate::protocol::HostGovernanceProjection,
) -> bool {
    let expected: &[&str] = match capability {
        "shell-open" => &[
            "shell-open:url-safe",
            "shell-open:local-file",
            "shell-open:local-exec",
            "shell-open:blocked",
        ],
        "exec" => &[
            "exec:simple-allowlisted",
            "exec:compound",
            "exec:shell-reentry",
            "exec:allowlist-miss",
            "exec:blocked",
        ],
        "screenshot" | "screenshot-ambient" | "process-list" | "clipboard-read"
        | "clipboard-write" | "foreground-window" => &[capability],
        _ => return false,
    };
    let keys: Vec<&str> = projection
        .cells
        .iter()
        .map(|cell| cell.key.as_str())
        .collect();
    let mut expected = expected.to_vec();
    expected.sort_unstable();
    projection.registry_revision == 1
        && projection.descriptor_revision == 1
        && projection.classifier_revision == 1
        && keys == expected
}

#[derive(Default)]
struct TerminalAttemptCache {
    entries: HashMap<String, CapabilityRespond>,
    order: VecDeque<String>,
}

impl TerminalAttemptCache {
    fn get(&self, attempt_id: &str) -> Option<&CapabilityRespond> {
        self.entries.get(attempt_id)
    }

    fn insert(&mut self, attempt_id: String, response: CapabilityRespond) {
        if self.entries.contains_key(&attempt_id) {
            return;
        }
        self.entries.insert(attempt_id.clone(), response);
        self.order.push_back(attempt_id);
        while self.entries.len() > TERMINAL_CACHE_CAPACITY {
            if let Some(evicted) = self.order.pop_front() {
                self.entries.remove(&evicted);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const HOST: &str = "11111111-1111-4111-8111-111111111111";

    #[test]
    fn duplicate_terminal_delivery_reuses_the_cached_response() {
        let mut session = HostSession::new(HOST.into(), 1, 1);
        let request = request(1, 1, 1);
        assert_eq!(session.begin(&request), BeginDecision::Start);
        let response = completed(&request, json!({"value": 1}));
        assert_eq!(session.complete(response.clone()), Some(response.clone()));
        assert_eq!(
            session.begin(&request),
            BeginDecision::Cached(Box::new(response))
        );
    }

    #[test]
    fn duplicate_in_flight_delivery_never_starts_a_second_execution() {
        let mut session = HostSession::new(HOST.into(), 1, 1);
        let request = request(1, 1, 1);
        assert_eq!(session.begin(&request), BeginDecision::Start);
        assert_eq!(session.begin(&request), BeginDecision::DuplicateInFlight);
    }

    #[test]
    fn terminal_cache_evicts_in_insertion_order_after_256_attempts() {
        let mut session = HostSession::new(HOST.into(), 1, 1);
        let first = request(0, 1, 1);
        for index in 0..=TERMINAL_CACHE_CAPACITY {
            let request = request(index, 1, 1);
            assert_eq!(session.begin(&request), BeginDecision::Start);
            assert!(session.complete(completed(&request, Value::Null)).is_some());
        }
        assert_eq!(
            session.begin(&first),
            BeginDecision::Start,
            "oldest terminal entry was evicted"
        );
        let newest = request(TERMINAL_CACHE_CAPACITY, 1, 1);
        assert!(matches!(session.begin(&newest), BeginDecision::Cached(_)));
    }

    #[test]
    fn cancel_requires_the_exact_request_and_control_tuple() {
        let mut session = HostSession::new(HOST.into(), 1, 1);
        let request = request(1, 1, 1);
        assert_eq!(session.begin(&request), BeginDecision::Start);
        let mut stale = cancel(&request);
        stale.control.connection_generation = 2;
        assert_eq!(session.cancel(&stale), None);
        let mut wrong_request = cancel(&request);
        wrong_request.request_id = uuid(99);
        assert_eq!(session.cancel(&wrong_request), None);
        assert!(matches!(
            session.cancel(&cancel(&request)),
            Some(CapabilityRespond::Cancelled { .. })
        ));
        assert!(
            session.complete(completed(&request, Value::Null)).is_none(),
            "late output is suppressed"
        );
    }

    #[test]
    fn reconnect_discards_the_previous_generation_cache() {
        let old_request = request(1, 1, 1);
        let mut first = HostSession::new(HOST.into(), 1, 1);
        assert_eq!(first.begin(&old_request), BeginDecision::Start);
        assert!(first
            .complete(completed(&old_request, Value::Null))
            .is_some());

        let mut replacement = HostSession::new(HOST.into(), 2, 1);
        assert_eq!(replacement.begin(&old_request), BeginDecision::Rejected);
        let current = request(1, 2, 1);
        assert_eq!(replacement.begin(&current), BeginDecision::Start);
    }

    fn request(
        index: usize,
        connection_generation: u64,
        catalog_generation: u64,
    ) -> CapabilityRequest {
        CapabilityRequest {
            request_id: uuid(index + 1_000),
            control: HostOperationControl {
                run_id: uuid(index + 2_000),
                operation_id: uuid(index + 3_000),
                attempt_id: uuid(index + 4_000),
                target_host_id: HOST.into(),
                connection_generation,
                catalog_generation,
                policy_generation: 1,
                governance_projection: projection("screenshot", "screenshot"),
                approval_generation: 1,
                capability_id: "screenshot".into(),
                input_digest: "a".repeat(64),
                idempotency_key: uuid(index + 5_000),
                dispatched_at: "2026-08-12T00:00:00.000Z".into(),
                deadline_at: "2026-08-12T00:01:00.000Z".into(),
                expires_at: None,
            },
            input: Value::Null,
        }
    }

    fn completed(request: &CapabilityRequest, output: Value) -> CapabilityRespond {
        CapabilityRespond::ok(request.request_id.clone(), request.control.clone(), output)
    }

    fn cancel(request: &CapabilityRequest) -> CapabilityCancel {
        CapabilityCancel {
            request_id: request.request_id.clone(),
            control: request.control.clone(),
            reason: crate::protocol::CapabilityCancelReason::DeadlineExceeded,
        }
    }

    fn uuid(index: usize) -> String {
        format!("{index:08x}-0000-4000-8000-{index:012x}")
    }

    fn projection(capability: &str, cell: &str) -> crate::protocol::HostGovernanceProjection {
        let mut projection = crate::protocol::HostGovernanceProjection {
            registry_revision: 1,
            descriptor_revision: 1,
            classifier_revision: 1,
            cells: vec![crate::protocol::HostGovernanceCell {
                key: cell.into(),
                posture: crate::protocol::HostGovernancePosture::Auto,
            }],
            digest: String::new(),
        };
        assert_eq!(cell, capability);
        projection.digest = projection_digest(&projection);
        projection
    }

    #[test]
    fn projection_digest_matches_the_shared_canonical_fixture() {
        let projection = projection("screenshot", "screenshot");
        assert_eq!(
            projection.digest,
            "f30ef0476cc356181b289cb892004ef9e1250257b9a2fd60bddefddf9b171210"
        );
        let mut changed = projection.clone();
        changed.cells[0].posture = crate::protocol::HostGovernancePosture::Deny;
        assert_ne!(projection_digest(&changed), projection.digest);
    }

    #[test]
    fn projection_rejects_noncanonical_order_and_incomplete_cells() {
        let mut complete = projection("screenshot", "screenshot");
        complete.cells[0].key = "unknown".into();
        complete.digest = projection_digest(&complete);
        assert!(!validate_projection("screenshot", &complete));

        let mut exec = crate::protocol::HostGovernanceProjection {
            registry_revision: 1,
            descriptor_revision: 1,
            classifier_revision: 1,
            cells: [
                "exec:simple-allowlisted",
                "exec:compound",
                "exec:shell-reentry",
                "exec:allowlist-miss",
                "exec:blocked",
            ]
            .into_iter()
            .map(|key| crate::protocol::HostGovernanceCell {
                key: key.into(),
                posture: crate::protocol::HostGovernancePosture::Auto,
            })
            .collect(),
            digest: String::new(),
        };
        exec.digest = projection_digest(&exec);
        assert!(
            !validate_projection("exec", &exec),
            "registry order is not canonical lexical order"
        );
        exec.cells.sort_by(|left, right| left.key.cmp(&right.key));
        exec.digest = projection_digest(&exec);
        assert!(validate_projection("exec", &exec));
        exec.cells.pop();
        exec.digest = projection_digest(&exec);
        assert!(!validate_projection("exec", &exec));
    }

    #[test]
    fn policy_lineage_rejects_stale_and_same_generation_tampering() {
        let mut session = HostSession::new(HOST.into(), 1, 1);
        let first = request(10, 1, 1);
        assert_eq!(session.begin(&first), BeginDecision::Start);
        let mut stale = request(11, 1, 1);
        stale.control.policy_generation = 0;
        assert_eq!(session.begin(&stale), BeginDecision::Rejected);
        let same = request(12, 1, 1);
        assert_eq!(session.begin(&same), BeginDecision::Start);
        let mut tampered = request(13, 1, 1);
        tampered.control.governance_projection.cells[0].posture =
            crate::protocol::HostGovernancePosture::Deny;
        tampered.control.governance_projection.digest =
            projection_digest(&tampered.control.governance_projection);
        assert_eq!(session.begin(&tampered), BeginDecision::Rejected);
        let mut replacement = HostSession::new(HOST.into(), 2, 1);
        tampered.control.connection_generation = 2;
        assert_eq!(replacement.begin(&tampered), BeginDecision::Start);
    }

    #[test]
    fn policy_lineage_tracks_projection_digest_per_capability() {
        let mut session = HostSession::new(HOST.into(), 1, 1);
        let first = request(20, 1, 1);
        assert_eq!(session.begin(&first), BeginDecision::Start);

        let mut second = request(21, 1, 1);
        second.control.capability_id = "process-list".into();
        second.control.governance_projection = projection("process-list", "process-list");
        assert_eq!(session.begin(&second), BeginDecision::Start);

        let mut changed_first = request(22, 1, 1);
        changed_first.control.governance_projection.cells[0].posture =
            crate::protocol::HostGovernancePosture::Deny;
        changed_first.control.governance_projection.digest =
            projection_digest(&changed_first.control.governance_projection);
        assert_eq!(session.begin(&changed_first), BeginDecision::Rejected);
    }
}
