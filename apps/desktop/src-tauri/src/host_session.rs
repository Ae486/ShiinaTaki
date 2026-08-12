//! INPUT:  one authenticated Host negotiation plus request/cancel/terminal frames for that live generation
//! OUTPUT: generation-bound begin/cancel/complete decisions and a 256-entry insertion-order terminal cache
//! POS:    shell/host_session — transport-agnostic duplicate/cancellation owner; discarded on every reconnect

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
        }
    }

    pub(crate) fn begin(&mut self, request: &CapabilityRequest) -> BeginDecision {
        if !self.accepts(&request.control) {
            return BeginDecision::Rejected;
        }
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
        control.target_host_id == self.host_id
            && control.connection_generation == self.connection_generation
            && control.catalog_generation == self.catalog_generation
    }
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
}
