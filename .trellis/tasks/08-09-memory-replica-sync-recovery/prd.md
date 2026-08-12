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
