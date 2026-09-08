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
- Routine recovery ordering: remote pull, compatible replay, native-result proof, second pull and verified local
  application; derived maintenance continues asynchronously under Hindsight's native policy.
- `expected_revision` replay and non-blocking `superseded` outcomes for stale mutations.

## Acceptance Criteria

- [ ] Crashes during batch application expose neither a partial batch nor an advanced checkpoint.
- [ ] Chat and ordinary memory use continue while sync/reconciliation runs.
- [ ] Pending operations and retry state survive restart.
- [ ] Recoverable outages confirm safely replayed factual writes only after native-result proof and matching local
      application; unrelated or unfinished derived maintenance does not hold those writes pending.
- [ ] Later authoritative observation/model changes synchronize normally. Derived freshness remains separate from
      write confirmation, with unknown status retained when no real producer can report it.
- [ ] Unknown native results and unverified factual checkpoints never become completed writes; zero pending writes
      cannot bypass the independent authority-cutover completion/integrity gate.
- [ ] Authority never changes automatically because of health failure.
- [ ] Status exposes last attempt/success, checkpoint, lag, pending, failures, safe error, and next due/retry.

## Out of Scope

- Initial legacy import and first authority activation.
- Automatic recall projection and final operator presentation.
- Planned Local cutover or emergency takeover UX.

## Contract Clarifications (2026-09-05)

- Live B5 use starts only after B4 proves complete coverage of the frozen current Local epoch, including post-B2
  retain/edit/invalidate/restore changes, and passes the short final Local fence. B2 evidence remains immutable.
  Owner-approved offline implementation may use deterministic fixtures; Wave 3 execution was approved on 2026-09-06.
  Offline implementation and checks do not open this gate.
- The canonical result contract must represent pending receipts, policy-permitted zero-result retain, superseded/not-found
  mutations, unknown/cancelled outcomes, and per-bank partial progress. Governed tools read `error.code`; a bounded
  prerequisite fix and regression tests precede replica implementation.
- Replica sync runs are independent of B2 import, use per-Bank lease/fence and predecessor-cursor CAS, and atomically
  upsert/tombstone canonical payloads, FTS, and checkpoint. Full-record readers and Taki policy projection are required;
  identity/revision/hash listing alone is insufficient. Current checkpoints are separate from immutable activation
  receipts, and remote snapshot expiry never invalidates a verified local replica.
- Pending replay belongs to B5 recovery and is ordered after remote pull and before verified native-result/second-pull confirmation. It is
  not generic blind Effect replay and never changes authority automatically.

## Routine completion amendment (2026-09-07)

The owner accepted the second option in [G1](../09-07-hindsight-recovery-evidence/grill.md): a factual write can be
confirmed before its higher-level summaries finish. This replaces the earlier routine derived wait, while preserving
durability, idempotency, source/result identity, checkpoint correctness, ordinary derived-change synchronization and
the independent B4/provider-switch gates. The reviewed Wave 3 baseline implements the older wait. Its G1 child now
has a reviewed native-result/append implementation and real producer/SQLite evidence, with final native 69,
Shared 396 and Core 2036 tests passing. The separately approved actual-source Rust build and four contract tests
also pass; the routine native-result/append implementation gaps are closed.
See the child's `research/g1-validation-results.md` and preserve
the separate parent/manual criteria. Reuse previous grill rulings before asking further product questions.
