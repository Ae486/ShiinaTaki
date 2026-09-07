# Memory Replica Synchronization and Recovery

## Goal

Keep the structured local replica close to Hindsight authority asynchronously and preserve recoverable writes during outages without creating split-brain authority.

## Dependencies

- `08-09-hindsight-initial-cutover`.
- The Batch 0 journal, revision, and snapshot contracts.

## Scope

- Transactional change-journal application and per-bank checkpoints.
- Configurable automatic synchronization, defaulting to six hours, plus manual incremental sync.
- Configurable periodic full logical reconciliation and cursor-expiry recovery.
- Single-flight scheduling, persisted catch-up, retry/backoff, and non-blocking status telemetry.
- Durable Pending Memory outbox, last-verified-replica recall, and optional unconfirmed overlay.
- Recovery ordering: remote pull, compatible replay, derived completion, second pull.
- `expected_revision` replay and non-blocking `superseded` outcomes for stale mutations.

## Acceptance Criteria

- [ ] Crashes during batch application expose neither a partial batch nor an advanced checkpoint.
- [ ] Chat and ordinary memory use continue while sync/reconciliation runs.
- [ ] Pending operations and retry state survive restart.
- [ ] Recoverable outages converge both sides after the defined recovery sequence.
- [ ] Authority never changes automatically because of health failure.
- [ ] Status exposes last attempt/success, checkpoint, lag, pending, failures, safe error, and next due/retry.

## Out of Scope

- Initial legacy import and first authority activation.
- Automatic recall projection and final operator presentation.
- Planned Local cutover or emergency takeover UX.

## Contract Clarifications (2026-09-05)

- Live B5 use starts only after B4 proves complete coverage of the frozen current Local epoch, including post-B2
  retain/edit/invalidate/restore changes, and passes the short final Local fence. B2 evidence remains immutable.
  Owner-approved offline Waves 0-2 may use deterministic fixtures; their implementation and checks do not open this gate.
- The canonical result contract must represent pending receipts, policy-permitted zero-result retain, superseded/not-found
  mutations, unknown/cancelled outcomes, and per-bank partial progress. Governed tools read `error.code`; a bounded
  prerequisite fix and regression tests precede replica implementation.
- Replica sync runs are independent of B2 import, use per-Bank lease/fence and predecessor-cursor CAS, and atomically
  upsert/tombstone canonical payloads, FTS, and checkpoint. Full-record readers and Taki policy projection are required;
  identity/revision/hash listing alone is insufficient. Current checkpoints are separate from immutable activation
  receipts, and remote snapshot expiry never invalidates a verified local replica.
- Pending replay belongs to B5 recovery and is ordered after remote pull and before derived completion/second pull. It is
  not generic blind Effect replay and never changes authority automatically.
