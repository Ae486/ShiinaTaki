# Initial Hindsight Import and Authority Cutover - Execution Plan

## Execution Protocol

- Planning remains inert until the owner reviews this package and `task.py start` changes status to `in_progress`.
- Use RED -> GREEN waves. Every wave ends with focused tests and `git diff --check`.
- Never change the active Memory Authority during preparation or automated tests.
- Do not modify `H:/hindsight`, start a real service, import real Memory, or call a real LLM in offline work.
- Preserve the B2 backup/snapshot directory and all legacy evidence.

## Wave 0 - Contract and schema inventory

**Ownership:** shared B4 import/replica/activation schemas, fixtures, and context manifests.

**Gate:** schemas reject unbounded IDs/payloads, missing expected epochs/cursors, incomplete mappings, and secret/value-shaped fields.

## Wave 1 - Deterministic import identities and ledger extension

**Ownership:** B4 additive migration, import ledger repository, deterministic operation/document identity module.

**RED:** same source/Bank/content revision produces identical IDs; different Bank or content cannot collide; reopen,
CAS/fencing, zero/one/many result mappings, retries, and safe diagnostics are covered.

**GREEN:** persist operation receipts before polling, terminal mappings after derived completion, and retryable state
without raw provider payloads. Reuse completed B2 ledger evidence instead of duplicating source normalization.

**Rollback:** remove only unshipped B4 tables/code; never rewrite B2 migrations.

## Wave 2 - Hindsight import service

**Ownership:** authenticated retain/operation/document client seam and resumable import orchestrator.

**RED:** dry-run-before-mutation, lost acknowledgement, transient retry, terminal failure, operation timeout/cancel,
one-to-many mapping, duplicate prevention, and explicit exclusion blocking.

**GREEN:** import only after B3 compatibility/template readiness. Persist source-to-document-to-fact mappings and poll
only returned operation IDs under a total deadline. No authority or runtime tool wiring.

**Rollback:** leave Local active and retain import evidence for resume.

## Wave 3 - Cursor-bound snapshot and replica staging

**Ownership:** replication snapshot client, canonical manifest/hash builder, staged replica repository/checkpoint.

**RED:** snapshot race, cursor expiry/reset, page ordering, tombstone/lifecycle preservation, hash/count mismatch,
transactional batch apply, restart persistence, and no partial visibility.

**GREEN:** capture end cursor with the same logical view, build a new staging epoch, validate manifest and all import
 mappings, then publish checkpoint only in one local transaction.

**Rollback:** discard staging rows only; keep prior verified replica/checkpoint and import ledger.

## Wave 4 - Promotion gate and authority epoch

**Ownership:** explicit authority promotion repository/service, runtime fence, startup selection tests.

**RED:** stale predecessor, unresolved mapping, stale manifest, active non-Local epoch, transaction rollback, crash
before/after commit, and post-commit restart.

**GREEN:** require authenticated compatibility, complete import, complete derived mappings, verified staged replica,
zero blocking failures, and a bounded write fence. Promote Hindsight atomically with `predecessor_epoch_id`; do not
silently revert to Local after commit.

**Rollback:** before commit, leave Local active; after commit, recover from the persisted Hindsight epoch and use the
later replica/recovery task for outage behavior. Emergency Local takeover is out of scope.

## Wave 5 - Operator protocol and privacy convergence

**Ownership:** operator-only import/cutover status methods, bounded result schemas, indexes, static privacy tests.

**RED/GREEN:** Agent/non-operator refusal, expectedRevision/expectedEpoch checks, no secret/provider/raw-memory leakage,
no Core process/filesystem imports, and no hidden authority mutation from status or health.

## Wave 6 - Quality and live-gate review

```powershell
pnpm --filter @taki/shared test
pnpm --filter @taki/core test
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm lint
pnpm -r typecheck
pnpm -r test
git diff --check
python ./.trellis/scripts/task.py validate .trellis/tasks/08-09-hindsight-initial-cutover
```

Run `trellis-check` before requesting activation/commit authorization. Live acceptance is separate and requires an
accepted Hindsight service; real LLM health remains explicit and owner-approved.

## Final Review Gate

- PRD criteria map to focused tests or the controlled live gate.
- Active authority remains `canonical-local` until the owner explicitly approves an actual cutover run.
- No B4 test or offline command imports existing user Memory into Hindsight.
- B2 evidence remains readable and untouched.

## Wave 0A - Current Local coverage preflight (required before Wave 1)

**Ownership:** B4 coverage manifest, catch-up detector, and final-fence revalidation tests. This is an import
prerequisite, not a new task and not a production cutover.

**RED:** a current Local source/revision created or changed after B2 is detected; retain/edit/invalidate/restore and
tombstone cases are represented; a manifest drift during import is refused; B2 rows remain unchanged. A completed B2
`memory_migration_sources` row without a matching current revision is not accepted as coverage.

**GREEN:** freeze one bounded current Local epoch manifest, derive a deterministic catch-up set or restart decision,
retain immutable B2 ledger/snapshot references, and perform a short final fence revalidation before activation
preparation. Any mismatch leaves Local authoritative. This wave can prove offline set completeness and drift handling;
it cannot prove a live Hindsight endpoint, runtime provider readiness, or authority activation.
