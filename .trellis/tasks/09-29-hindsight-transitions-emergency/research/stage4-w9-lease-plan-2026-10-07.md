# W9: final healthy-publication lease guard

Date: 2026-10-07. Status: implemented and independently accepted on 2026-10-07.
Existing task: `09-29-hindsight-transitions-emergency`. No new task or schema is needed for this bounded correction.

## Problem and required behavior

The [continuation review](stage4-review-2026-10-07.md) found a missing final live-clock executor check in healthy
publication. A lease valid at entry may expire during synchronous installation/read-back, yet the transaction can
commit authority before the driver notices expiry. This is an existing contract gap, not a demonstrated data-loss
incident. Historical W0-W8 acceptance and original failure/success evidence remain preserved.

Before healthy publication returns from the atomic transaction, the original executor must still be authorized
at the actual current time. On expiry or loss of the exact owner/revision, all publication changes roll back;
the old authority remains selected and existing durable failure/recovery handling applies. An unexpired execution
must continue to publish and recover normally.

## Design constraints

Owner clarification and approval (2026-10-07): prioritize functional completion; consider extending the lease instead of
performance optimization. Current source claims/renews 300,000 ms leases, renews every 30,000 ms, and caps both
claim and admitted lease extension at 300,000 ms (`memory-transition-repo.ts:64,125,154`). Synchronous SQLite work
cannot run the timer. The review establishes the missing final guard, not that the current real journey exhausts
five minutes. A longer finite lease is compatible with functional completion but cannot replace final authority
validation. The owner explicitly approved: first add final correctness checking and regression coverage; if scoped
verification shows the normal flow needs more time, consistently extend a finite claim/renewal/validation budget
and document delayed takeover, without performance optimization. No further approval is needed for that bounded
functional adjustment. Do not rerun the real corpus merely to seek performance margin. W9 independent acceptance
must pass before downstream Stage 5 implementation.

1. Pass the production driver's injectable live clock into the publication boundary and use it after the final
   complete read-back, inside the same transaction. Preserve synchronous evidence validation and its scoped cache.
2. Validate the original executor identity and exact expected post-write revision. Do not authorize whichever row
   happens to be current. Derive any local revision increment from the real receipt mutation; use emergency's
   existing final-guard pattern as the reference, without assuming the two flows mutate identical rows.
3. Keep captured timestamps for the immutable evidence they describe. Do not globally replace evidence time with
   wall clock, extend or renew the lease after expiration, weaken full read-back, or suppress the refusal.
4. Retain atomic rollback for receipt, authority marker/target epoch, installation, custody and queued obligations.
   Native effects/fences remain governed by existing reconciliation; a Core rollback does not assert remote undo.
5. No schema, public protocol, Native, Desktop, dependency, real-data or performance expansion is intended. Expand
   only if the failing reproduction proves a necessary adjacent fix and document it before changing ownership.

## Implementation and verification

- [x] Read backend checklist, SQLite transaction isolation, transition/publication/healthy-driver specs and current
      publication/receipt/emergency code. Verify cwd, branch, session task and the owned dirty-path baseline.
- [x] Add a focused regression using the actual healthy publication fixture and real read-back. Advance the
      injected clock to `leaseUntil` only after real read-back completes; record the pre-fix failure.
- [x] Assert selected marker, target epoch, receipt, candidate installation, custody and queue state equal their
      pre-transaction values after expiry. Cover both healthy directions where their installation paths differ.
- [x] Retain an explicit just-before-deadline success case and ownership/revision refusal. Preserve existing
      genuine-exhaustion and synchronous-evidence cases; avoid elapsed wall-clock sleeps.
- [x] Implement the minimal final guard and driver clock wiring. Run the focused regression and adjacent
      publication/evidence-context/healthy-boundary/terminal/reconstruction/emergency families (at most 2 workers).
- [x] Run workspace typecheck and lint, plus `git diff --check`. If only Core changes, run the full Core suite once
      as the final integrated gate. Broaden Shared/Desktop/Native checks only if their dependency surface changes.
- [x] Dispatch one independent `trellis-check` for the complete W9 change; it verifies the exact rollback boundary,
      clock provenance, original executor/revision and unaffected emergency/recovery semantics. Reuse passing gates
      from the same unchanged sources rather than running duplicate full suites.
- [x] Record red/green evidence, final source identities and any limitations in a new W9 report; update the
      continuation review and task status documents. Do not rewrite pinned W8 reports or original corpus evidence.

## File ownership and dispatch

Verification cadence amendment during recovery (leader, 2026-10-07): the full Core run completed with 3,791 passes,
four explicit 5,000-ms timeouts in the unchanged emergency-context fixture file, and one existing skip. Its final
stack showed no other failure. Only those four test deadlines were aligned with that file's existing 30-second
cases; no assertions, fixture behavior, production lease or global test budget changed. The exact final file
passed all seven cases, with the four affected cases taking 5.3-6.2 seconds even in isolation. Preserve the failed
full result plus scoped correction as separate evidence. Verify unchanged production/other-test identities and
targeted lint rather than repeating the entire suite without a new behavioral or cross-file concern. Independent
review must verify this disposition; do not describe it as a clean second full-suite run.

One `trellis-implement` owns the complete W9 wave: `packages/core/src/db/memory-transition-publication-repo.ts`,
necessary adjacent publication types/tests, `packages/core/src/memory/transitions/transition-healthy-execution.ts`,
evidence-context and healthy publication regression fixtures/tests, relevant module indexes/spec clarification,
and a new task-owned W9 implementation report. The leader owns task PRD/design/plan/manifests and downstream
planning. Native and Desktop are read-only. One active child at a time; the independent checker follows implementation.

The owner reviewed and approved this amended scope on 2026-10-07 ("proceed with implementation dispatch"). The
existing task is already `in_progress`; re-binding is idempotent. No commit, push, finish/archive, paid call,
original-data switch, old wrapper restart or corpus conversion is included.

## Downstream order

1. Complete W9 and its independent integrated check.
2. Refresh existing B7 planning against completed Stages 1-4; preserve earlier scope and acceptance boundaries.
3. Review/activate the first grounded Stage 5 vertical slice using Trellis artifacts and real context manifests.
4. Continue managed/model/template/upgrade/Home work in explicit dependency order; Stage 6 owns complete integrated
   and owner/manual environment acceptance. D23 and D79-D83 retain their separate scope.

Stage 5 research may proceed read-only while W9 is planned. No downstream implementation is released on the
unqualified claim that Stage 4 has no remaining issue.
