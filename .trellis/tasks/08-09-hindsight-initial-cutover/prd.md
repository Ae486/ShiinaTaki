# Initial Hindsight Import and Authority Cutover

## Goal

Perform a resumable, verifiable Local-to-Hindsight migration and activate Hindsight authority only after every source, derived mapping, replica record, and integrity gate succeeds.

## Dependencies

- `08-09-hindsight-compatibility-extensions`.
- `08-09-memory-provider-foundation`.
- `08-09-memory-legacy-migration`.
- `08-09-hindsight-connection-setup`.

## Scope

- Ensure authenticated Global and Character banks and approved template revisions.
- Import the complete current structured Local state under stable command identities; retain the older original-source
  asynchronous import API and evidence for its legacy callers.
- Verify and persist full source/object revision/hash mappings and exact committed native boundaries.
- Require the independent finite source/scope/model maintenance certificate for first activation.
- Build the first local replica from a cursor-bound logical snapshot and integrity manifest.
- Run reconciliation and atomically activate a new Hindsight Authority Epoch.

## Acceptance Criteria

- [ ] Interrupted import resumes without duplicate documents or facts.
- [ ] Every required source has a successful terminal mapping or explicit exclusion.
- [ ] Snapshot counts/hashes, one-to-many mappings, and checkpoint cursor verify before activation.
- [ ] Any failure leaves Local authoritative and preserves resumable state.
- [ ] No UI action or health result alone can bypass the cutover gates.
- [ ] Import and replica state contain no API keys, authorization headers, raw provider errors, source text in logs, or unbounded payloads.
- [ ] A stale predecessor epoch, stale manifest, expired cursor, unresolved mapping, or failed integrity check refuses promotion.
- [ ] The final promotion is one fenced SQLite transaction with no network/filesystem/async work inside it.
- [ ] Restart before and after promotion produces deterministic authority and replica state; pre-commit failure never changes the active Local epoch.
- [ ] Offline tests use injected transports/models or owned isolated PostgreSQL/HTTP/SQLite fixtures; user-service acceptance is separate and real LLM health remains explicit owner-approved work.

## Out of Scope

- Ongoing journal polling, Pending Memory replay, and planned switch-back.
- Automatic foreground recall and canonical tool exposure.
- Deleting legacy migration evidence.

## Definition of Done

- `design.md`, `implement.md`, and both context manifests are complete and validated before activation.
- Focused import, mapping, snapshot, replica, integrity, fence, promotion, restart, privacy, and operator authorization tests pass.
- Shared/Core typecheck, package tests, lint, recursive typecheck/test, `git diff --check`, and Trellis validation pass.
- The active authority remains `canonical-local` throughout offline implementation and is changed only by an explicitly approved live cutover run.
- Manual/live acceptance is recorded separately and is not inferred from mock tests.

## Technical Notes

- The 2026-09-07 [G1 routine-recovery amendment](../09-07-hindsight-recovery-evidence/grill.md) allows factual-write
  confirmation before background summaries finish. It does not relax this initial-cutover task's required derived,
  complete current-Local coverage, manifest, reconciliation or final-fence proof. Zero Pending Memory alone is not
  an activation criterion.
- The [independent cutover evidence research](../09-07-hindsight-recovery-evidence/research/g1-cutover-evidence-contract.md)
  defined the finite source/scope/model certificate now implemented by D78. Native operation completion and old model
  timestamps do not provide it. The provider produces actual input/outcome/snapshot evidence and B4 validates it;
  the healthy Hindsight-to-Local source fence belongs to planned switch-back, outside this task's scope.
- B2 archived migration artifacts provide the immutable source snapshot, canonical staging, and migration ledger input.
- B3 provides authenticated Hindsight connection, compatibility/template readiness, and operator-only setup methods.
- The B4 baseline already contains HTTP import clients, logical snapshot/staging/checkpoint storage and gated
  Hindsight epoch promotion. This slice extends those seams with current Local coverage and typed source evidence;
  D78 adds complete structured import and independent maintenance proof. Production runtime-provider, automatic recall
  and unified-tool routing remain B6 work.
- The binding authority/replica policy is [`docs/adr/0009-single-memory-authority-with-local-replica.md`](../../../docs/adr/0009-single-memory-authority-with-local-replica.md).
- Detailed live seam evidence is in [`research/taki-cutover-seams.md`](research/taki-cutover-seams.md).

## Current Local Coverage Addendum (2026-09-05)

B4 import completeness is defined against a frozen **current Local epoch manifest**, not only the completed B2
`memory_migration_sources` rows. Before any remote mutation, capture one immutable manifest for every current Local
canonical Bank and its source, document, memory-unit, derived, lifecycle, policy, revision, and tombstone-relevant
record. The manifest binds `{localEpochId, capturedAt, schemaVersion, bankIds, sourceRevisionFence, contentDigest}` and
records the exact source set that must be imported. The B2 snapshot, migration ledger, and backup remain immutable
evidence; B4 may reference them but must not rewrite or delete them.

The run must prove that the frozen manifest covers all Local retain/edit/invalidate/restore changes since B2. If a
current Local source or revision is absent from the B2 evidence, B4 records a bounded catch-up set and either imports it
before continuing or restarts the frozen manifest after the current Local writer is quiesced. At the end of import, take
a short final fence and revalidate the Local epoch, source revision fence, and content digest. Any drift restarts the
manifest/import check and leaves `canonical-local` authoritative. A completed B2 ledger alone is therefore not a
cutover gate. Real activation additionally requires runtime/provider readiness and the full B4 integrity gates; this
addendum does not mark the live acceptance criteria passed.

## Authorized First Slice (2026-09-08)

The owner approved implementation of current Local coverage and reversible field preparation, following the Taki
G1/B5 checkpoint `dd2e15b` paired with Hindsight `8ab65b4`. The current source review and executable scope are in
[`research/current-local-first-slice.md`](research/current-local-first-slice.md) and
[`research/first-slice-execution-contract.md`](research/first-slice-execution-contract.md).

- [x] Freeze and reopen a complete current Local identity/revision/payload manifest; detect real retain, edit,
  invalidate, restore, policy, lineage, derived, Bank and missing-record changes without rewriting B2 evidence.
- [x] Persist original typed source/unit fields and prepare a versioned native item from the selected frozen Local
  records; preserve numeric/string distinctions, null/empty context, provenance and policy without truncation.
- [x] Consume confirmed exact native-object bindings through the real replica projection; reject stale/missing
  evidence and preserve native-authoritative fields and all old G1 frozen dispatch identities.
- [x] Connect current-coverage refusal and a real SQLite writer reservation to B4 readiness/promotion; an old B2-only
  ledger cannot prove current-version completeness.
- [x] Reopen fresh and both applied 035 migration histories without data or receipt loss; validate isolated startup.

All five first-slice criteria passed offline on 2026-09-08. The independent reviews, fixed defects, 3168-test final
run and startup evidence are recorded in
[`research/first-slice-validation-2026-09-08.md`](research/first-slice-validation-2026-09-08.md).

These are offline first-slice criteria. Source evidence is durable Taki provenance, not a disposable replica cache.
Hindsight-only recovery of every Taki field and arbitrary later native-edit rebinding remain D77 work. The D78
continuation below supplies current remote import and the independent certificate. Do not mark full B4 fidelity,
runtime readiness or actual authority activation complete from either slice's automated tests.

## D78 Offline Contract Criteria (2026-09-09)

The [authorized execution contract](research/d78-execution-contract.md) continues the existing task. These criteria
describe implemented mechanics; they do not replace the owner-observed acceptance criteria above.

- [x] Capture all current Canonical records, including post-B2 edits/lifecycle and empty Banks, with complete typed
  artifacts and explicit dispositions; refuse unsupported required values before submission.
- [x] Import a bounded complete native Bank atomically without extraction; enforce exact baseline/ownership and
  namespace, preserve full mappings/indexes/lifecycle, and recover committed responses without repeating writes.
- [x] Produce complete native source/scope/model input and action/no-op/outcome evidence, including partial retry,
  authored content, lifecycle/history/CAS, actual reflect/delta inputs and a sealed retained logical snapshot.
- [x] Validate and persist complete evidence and raw B4 replica/checkpoints; handle response loss/reopen, corrupted or
  missing proof, known invalidation, newer cursors and same-evidence staging reconstruction.
- [x] Use current evidence in real B4 readiness/verify/promotion guards for every bound Bank and the transaction-local
  Local fence; prove actual HTTP/SQLite readiness followed by stale-Local refusal while Local remains authoritative.

Verification commands, generator fixes, native typecheck baseline limitations and remaining rollout boundaries are in
[the D78 validation record](research/d78-validation-2026-09-09.md). D77/B6/B7 and manual/live criteria remain open.
