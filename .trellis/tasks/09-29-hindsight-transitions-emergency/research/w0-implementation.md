# W0 implementation evidence

Date: 2026-09-29. Workspace: `H:/TakiAgent`, branch `main`, baseline HEAD
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Implementer scope: W0 only.
Owner authorization is the parent task's approved Stage 4 execution. The legacy `.trellis/.current-task` is empty;
the parent confirmed the explicit session-bound task. No pointer, original database, native repository, commit,
push, archive, credential or external service was modified by this implementer.

## Result

R1/D84, R2 and D93 are implemented; R3's executable existing inventory refusal remains protected and its inaccurate
fence specification is corrected. Independent wave review remains the leader's next gate. No Stage 4 transition,
emergency authority replacement or original-environment/manual acceptance is claimed.

### Exact replica request attribution (R1/D84)

- Append-only migration allocation: current head was 050; added 051, `hindsight_replica_manual_requests`.
  Prior migrations and stored producer refs are not rewritten. Terminal request records reject UPDATE/DELETE.
- The operation seals a Core-minted request UUID in its producer ref before submitting it to the existing scheduler.
  Queue admission, exact claim (original lease/run/fence), settlement, lease-loss recovery and queued cancellation
  participate in the existing SQLite schedule transactions. No second scheduler or timestamp-only attribution exists.
- Original request results survive subsequent same-Bank runs. Classification reads the request's own terminal evidence,
  including at boot without a live runtime. Existing refs without a request ID remain readable and unknown at boot.
- A queued request can be cancelled while a previous run holds that Bank; a wrong ID or already-claimed request refuses.
  A supervisor failure before claim can settle only the exact attempted request for that Bank, and clears its queue
  pointer so that failed request cannot execute later. A failed persistence attempt leaves it unresolved.
- Legacy internal manual calls retain their coalescing behavior; they cannot overwrite or cancel a tracked request.

Production files: `packages/shared/src/memory-replica-request-schema.ts`, `memory-replica-schedule-schema.ts`,
`memory-operation-schema.ts`, public `index.ts`; Core `db/migrations/051-hindsight-replica-requests.ts`, registry,
`db/hindsight-replica-request-repo.ts`, `db/hindsight-replica-scheduler-repo.ts`,
`memory/hindsight/hindsight-replica-scheduler.ts`, and operation kind/contract/service.

### Backup interval compatibility (R2)

`hindsight-backup-status.ts` preserves the historical verified backup ID, age and proof cursors independently of
coverage. A numeric interval start requires matching selected/backup/replica authority epoch, provider lineage and
Bank generation. Missing checkpoints and incompatible histories produce a null start, while the current replica
coordinate remains separately visible. The offline incident hook uses this same reader; no native calls were added.
The Shared contract documents that these are local coverage coordinates, and Home explicitly states that remote-only
unsynchronized writes remain unknown, even when both coordinates match.

### Rollback and Local inventory (D93/R3)

`hindsight-application-sync-runner.ts` compares initialize's native cursor against a same-history B5-only predecessor
before application snapshots, and checks ordinary page `to_checkpoint` coordinates before event loading/publication.
Both use `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`, preserve checkpoints and enter the existing explicit-run hold.
Existing replay-floor rebuild behavior remains covered.

The Local writer wrapper skips its own Bank/baseline initialization while fenced, but the earlier lazy Bank ensure
can still add a Character. The spec now states that `quiesce()` does not close the Bank inventory. Existing D87 journey
tests prove final coverage refuses the new Bank until setup verifies it; no unsafe inventory-freezing claim remains.

Touched source directory indexes and the executable operations, replica-sync, backup and Local runtime specs are
updated. Existing fixture doubles and migration-tail assertions were adjusted to the new explicit identity/head.
The leader owns task status and final D84/D93 closure in the deferred-decision ledger after independent review.

## Regressions and checks

All commands below ran from `H:/TakiAgent`, with at most two Vitest workers per invocation and no concurrent Vitest
runs. Logs are beside this report. Counts overlap; do not sum them as distinct test coverage.

### Before repair

```powershell
pnpm exec vitest run .trellis/tasks/09-29-hindsight-transitions-emergency/research/evidence-stages-1-2/acceptance-reproductions.test.ts --maxWorkers=2 --reporter=dot
# exit 1, expected R1/R3 review counterexamples; w0-before-replica.log
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/evidence-stage-3/status-history-probe.mjs
# exit 0: diagnostic reproduced old generation cursor 10 -> unrelated generation cursor 5.
```

The historical diagnostic scripts were not changed or promoted unchanged into the regression suite.

### Final relevant suites

```powershell
pnpm --filter @taki/core exec vitest run src/db/hindsight-replica-scheduler-repo.test.ts src/db/hindsight-replica-request-repo.test.ts src/db/migrations/index-list.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/memory/operations src/memory/hindsight-backup src/memory/hindsight/hindsight-replica-scheduler.test.ts src/memory/hindsight/hindsight-application-sync-runner.test.ts src/memory/hindsight-lifecycle/hindsight-lifecycle-journey.test.ts --maxWorkers=2 --reporter=dot
# exit 0; 27 files, 225 passed / 1 skipped; w0-core-check.log

pnpm --filter @taki/shared exec vitest run src/memory-replica-request-schema.test.ts src/memory-replica-schedule-schema.test.ts src/memory-operation-schema.test.ts src/hindsight-backup-schema.test.ts src/memory-authority-status-schema.test.ts --maxWorkers=2 --reporter=dot
# exit 0; 5 files / 29 passed; w0-shared-check.log

pnpm --filter @taki/desktop exec vitest run src/windows/home/pages/operations/memory-hindsight-backup-state.test.ts src/windows/home/pages/operations/memory-hindsight-backup-block.test.tsx src/windows/home/pages/operations/memory-operations-controller.test.ts --maxWorkers=2 --reporter=dot
# exit 0; 3 files / 23 passed; w0-desktop-check.log

pnpm --filter @taki/core exec vitest run src/db/hindsight-replica-request-repo.test.ts src/db/migrations/041-canonical-memory-maintenance.test.ts src/memory/operations/memory-operation-kind-replica.test.ts --maxWorkers=2 --reporter=dot
# 21 passed, 1 failed: new success-reopen request case passed; old 041 fixed-head assertion found.
# w0-core-final-delta.log. Repaired both old tail assertions; the full migration run below supersedes that failure.

pnpm --filter @taki/core exec vitest run src/db/migrations --maxWorkers=2 --reporter=dot
# exit 0; 31 files / 140 passed; w0-migrations-final.log

pnpm typecheck
# exit 0, all five workspace packages; w0-typecheck-final.log
pnpm lint
# exit 0; w0-lint-final.log
git diff --check
# exit 0; only an existing parent-task CRLF normalization warning.
```

Key new assertions use real SQLite and scheduler owners: preceding success followed by manual failure with both
equal and different timestamps; request ID carried into the actual lease claim; same-Bank queued cancellation;
unrelated Bank supervisor failure; cancellation transaction rollback; competing request refusal; exact successful,
failed and cancelled outcomes after file-backed reopen and a later Bank run; immutable terminal evidence; legacy ref
parsing; cross-generation/lineage/epoch/missing-checkpoint status; offline incident propagation; seed and ordinary-page
rollback with unchanged checkpoints and explicit hold. Existing D87 and Stage 3 suites remain covered.

## Iteration failures and limits

- First typecheck identified use of positional SQLite parameters in the new repo. The project wrapper accepts named
  bindings; changed all three calls and passed subsequent typechecks.
- Initial focused tests exposed old fake-scheduler assertions and cancellation expectations, plus the parameter issue;
  updated the tests to exercise the intended exact identity contract. The second focused run passed 41 tests.
- First lint identified a fixture function over the 50-line threshold; extracted its request-evidence helper. Final
  lint passes without suppressions.
- Extending the migration tail exposed two fixed-head assertions in the existing 041 reopen test. Updated both and
  ran the entire migration directory: 140 passed. `w0-migration-tail-final.log` preserves the intermediate second-assertion
  failure; `w0-migrations-final.log` is the successful final evidence.
- The one Core skip is the existing Unix owner-mode assertion on Windows in the backup store suite.
- No unresolved W0 failure is known. No fresh full-workspace test run, native PostgreSQL integration, actual Core-process
  boot, build, production restore, original-data authority operation, or owner/manual acceptance was performed here.
  The new migration's fresh/historical/reopen and producer boot classification are tested in isolated SQLite fixtures.
  Unknown unfinished producer work is not relabeled as successful; future transition runtime/ownership work remains W1+.
