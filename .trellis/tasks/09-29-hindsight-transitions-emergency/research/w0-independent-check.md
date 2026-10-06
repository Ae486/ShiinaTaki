# W0 independent check

Date: 2026-09-29. Workspace: `H:/TakiAgent`, branch `main`, baseline HEAD
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Reviewer scope: W0 and bounded repairs only.
The session file `.trellis/.runtime/sessions/codex_01a0ed15-10d0-7802-90a1-48dc47ee6b41.json`
confirms this task; the empty legacy pointer is not the task authority. Cwd, branch and worktree list were checked.

## Gate

**PASS for the W0 prerequisite wave after the fixes below.** No known unresolved W0 blocker remains.
This permits the leader's next-wave gate; it does not certify W1-W8, real-data transitions, native integration,
full Stage 4 acceptance, or owner/manual acceptance. No deferred-decision ledger was closed by this reviewer.
The leader must evaluate the entire current D84/D93 ledger scope before changing their status.

Reviewed the PRD, design, implementation plan, W0 report, curated check context, prerequisite reports and independent
Stages 1/2 and Stage 3 acceptance. Findings are grounded in the working source, not just implementer statements.
No original database, native source/service, dependency, commit, push, archive or task-status file was changed.

## Findings (fixed)

### F1 — High: a committed request could execute after its operation was reported failed

- File: `packages/core/src/memory/operations/memory-operation-kind-replica.ts:31`.
- Issue: `scheduler.requestManual` commits the request and queue, then performs status projection. If that read
  throws, the adapter treated the exception as `producer_refused` and terminally failed the operation even though
  the exact request remained queued. A later scheduler tick could still execute it.
- Reproduction: real scheduler and SQLite, with the repository status reader failing after successful queue
  admission. Before repair, the new test observed `['admitted', 'failed']` while the queue still held the request.
- Fix: inspect the exact request on an admission exception. If it exists, preserve/classify its actual state;
  if evidence is unreadable, return no settlement. Only a proven absent request permits the refusal result.
- Regression: `memory-operation-kind-replica.test.ts:162` proves the queued operation remains admitted, then completes
  from its exact receipt after reads recover, with exactly one manual dispatch.

### F2 — Medium: unavailable receipt reads overwrote a successful producer outcome with failure

- File: `packages/core/src/memory/operations/memory-operation-kind-replica.ts:40`.
- Issue: the exact receipt read after `tick()` was outside the adapter's unresolved-error boundary. Its exception
  reached the generic operation service catch, which terminally recorded `producer_failed` even when the request
  had already succeeded. Terminal operation immutability then prevented correction by later reads.
- Reproduction: real scheduler/SQLite with only the request reader temporarily unavailable. The successful runner
  completed, but the new test saw `['admitted', 'failed']` before repair.
- Fix: keep the post-tick receipt read inside the same unresolved-error boundary. Subsequent observation can recover
  the factual terminal outcome without redispatch.
- Regression: `memory-operation-kind-replica.test.ts:179` proves no false terminal push and subsequent completion.

The operations spec now explicitly covers both post-commit read-failure boundaries. The source directory index
describes the unresolved read behavior and includes `cancelled` in the settlement union.

## Findings (not fixed)

None within W0. Existing limitations below remain deliberate scope boundaries, not inferred acceptance.

## Actual-path review and additional proof

| Area | Verified result |
| --- | --- |
| Exact request identity | The operation persists a Core UUID before producer invocation. `requestManual` inserts request plus pending pointer in one transaction; `claim` captures the lease/run/fence with schedule mutation. `settle` persists exact terminal diagnostics with schedule settlement and lease release. Later Bank diagnostics cannot overwrite a terminal request. |
| Cancellation | Exact cancellation clears only its queued request, including while a prior run holds the same Bank. Claimed requests and wrong IDs refuse. Legacy unqualified calls cannot cancel/replace tracked requests. Existing real-scheduler tests prove no cancelled manual dispatch. |
| Lease loss with pending work | Added a real-SQLite regression: old claimed request becomes failed with its original lease, newer request remains queued, stale callback cannot overwrite either, cancellation of the newer request survives a later automatic retry. The retry has no old manual request identity. |
| Transaction failure | Added trigger-injected failures at admission, claim and terminal settlement. Queue, exact evidence and claim/schedule roll back together; after removing the trigger, the same claim can settle. Existing cancellation rollback coverage also passes. |
| Supervisor isolation | The drain captures the attempted Bank/request before calling its producer. `failManual` requires that exact still-queued pointer and no active run; a different Bank's supervisor error cannot settle it. Storage failure preserves uncertainty. |
| Reopen and historical compatibility | Migration 051 is additive after 050; old migration SQL and producer rows remain unchanged. Exact succeeded/failed/cancelled receipts survive later runs and file-backed reopen, then settle the original operation without a live runtime. Added an active pre-051 manual run/producer fixture: upgrade retains its old claim, lease recovery succeeds without inventing any request row, and its old operation truthfully becomes `outcome_unknown/core_restart`. |
| Terminal immutability | Database triggers reject terminal UPDATE and every DELETE; the repository uses exact prior JSON CAS. Existing tests exercise both trigger guards after later same-Bank work. |
| R2 backup intervals | `hindsight-backup-status.ts:38` requires selected/checkpoint/backup epoch agreement, provider-lineage agreement and the Bank proof's generation. Historical backup ID/age remain separate; incompatible or absent checkpoint makes the start null. Status and offline incident tests pass. Home explicitly keeps remote unsynchronized writes unknown even with equal local coordinates. |
| D93 | Full/seed path checks a same-history native-only predecessor before application snapshots (`hindsight-application-sync-runner.ts:179`). Ordinary pages check both coordinates before loading/publishing events (`:216`). Expanded the page test to independently regress native and application-state cursors; both retain checkpoints. Existing seed hold and replay-floor rebuild tests pass. |
| R3 | The Local spec correctly states that quiescence does not close the lazy Character Bank inventory. Existing final coverage/refusal behavior remains required; this wave does not implement an inventory freeze. The implementer's D87 journey evidence remains separate from this review's newly executed suites. |

No new scheduling owner, runtime owner, UI ledger, native protocol or production bootstrap path was introduced.
The service's boot lookup directly reads the durable request table; legacy refs stay readable through optional
request identity fields rather than synthetic attribution. Unfinished foreign operations retain the established
unknown fallback. Automatic retry is a new scheduler run, not a rewrite/replay of a failed manual request identity.

## Verification

All commands ran from `H:/TakiAgent`; Vitest invocations were sequential and used `--maxWorkers=2`.
Counts overlap and must not be summed as unique coverage.

1. Red reproduction before F1/F2 repair:
   `pnpm --filter @taki/core exec vitest run src/memory/operations/memory-operation-kind-replica.test.ts --maxWorkers=2 --reporter=dot`
   — exit 1, 8 passed / 2 failed, both failures asserted the unwanted `failed` publication.
2. Same command after repair — exit 0, 10 passed.
3. Independent focused integration/regression run:

   ```powershell
   pnpm --filter @taki/core exec vitest run src/db/hindsight-replica-request-repo.test.ts src/memory/operations/memory-operation-kind-replica.test.ts src/memory/hindsight/hindsight-application-sync-runner.test.ts src/memory/hindsight-backup/hindsight-backup-status.test.ts src/memory/hindsight-backup/hindsight-backup-emergency.test.ts --maxWorkers=2 --reporter=dot
   ```

   — exit 0, **5 files / 38 passed**. Log: `w0-independent-core.log`.
4. After adding the active pre-051 upgrade case:
   `pnpm --filter @taki/core exec vitest run src/db/hindsight-replica-request-repo.test.ts --maxWorkers=2 --reporter=dot`
   — exit 0, **1 file / 7 passed**. Log: `w0-independent-legacy.log`.
5. `pnpm lint` — **pass**, `w0-independent-lint.log`.
6. `pnpm typecheck` — **pass**, all five workspace packages including E2E, `w0-independent-typecheck.log`.
7. `git diff --check` — **pass**, only the unrelated parent-task CRLF normalization warning.

The implementer's broader 27-file Core, 31-file migration, Shared and Desktop suite evidence was reviewed, not
rerun wholesale. These independent changes required focused regressions and fresh root lint/typecheck. No fresh
full-workspace suite, standalone Core-process boot, Desktop build, native PostgreSQL run, actual restore or owner
acceptance was performed. File-backed migration/reopen and service boot classification above are in-process tests.
