# Stage 3 W6 restore drill (AC11), 2026-09-27

Result: **all 12 steps passed** (run 7, on the final code). Evidence: `restore-drill/evidence/` (`result.json`,
`run-console.log`, scrubbed Core/native/admin/pg0 logs, `proxy-log.json`, `provider-requests.json`).

The drill found two Core defects. Both are fixed with colocated tests (see "Defects found"). It also found one
intermittent native failure that was not fixed, plus three observations for the leader.

## Setup

- Harness: `restore-drill/`, copied from the archived `09-25-hindsight-native-smoke` harness (paths re-rooted; archive
  untouched). Rerun with `node restore-drill.mjs` from any directory. It takes about 9 minutes.
- Native: the read-only `H:/hindsight` checkout, its venv and bundled pg0. Three drill-owned pg0 instances
  (`taki-drill-<random>`, data under the temp root): A (original), R (restored from backup #2), O (restored from
  backup #1). The native runs with `HINDSIGHT_API_LLM_PROVIDER=mock` and the cached local embedding and reranker models.
  It is fully offline: `HF_HUB_OFFLINE`, `TRANSFORMERS_OFFLINE`, `LITELLM_LOCAL_MODEL_COST_MAP=True` and
  `PYTHON_DOTENV_DISABLED=1` are set, and a socket guard allows only 127.0.0.1 and the drill's own pg port. The drill
  sets `HINDSIGHT_API_TAKI_BACKUP_ENABLED=true` and `HINDSIGHT_API_TAKI_BACKUP_DIR=<temp>/native-<X>-backups`.
- Admin CLI: `admin_launcher.py` runs `hindsight_api.admin.cli` under the same guard and environment.
- Core: a temp data dir per instance (A, R, O). The port is random, never 8974. A fake LLM provider answers on
  127.0.0.1, and the egress guard refuses every other destination. The API key is a random throwaway, and every
  evidence file has it replaced with `<throwaway-key-redacted>`.
- Core always talks to native through a local proxy on one fixed port, so Core's configured endpoint stays the same
  across A, R and O. The proxy logs only the method, the path (without the query) and the status. For step 5 it is
  armed to reset the connections after the retain is accepted.
- Memory is written by chat Runs whose fake LLM calls the real `retain` tool (`[retain]` marker). Memory is read by a Run
  that calls `recall`.

## Steps and results

| # | Step | Result | What was checked (run 7) |
| --- | --- | --- | --- |
| 1 | Legacy -> Local onboarding -> Hindsight setup and activation on native A | pass | `setup.validate` then `setup.apply` reached `configured`; both Banks `verified`; `hindsight.activate` returned `activated`; authority `hindsight`, epoch `e7a21b2a…`, lineage `1c7c3f99…` |
| 2 | Write M1 ("red kayak") | pass | retain tool `ok:true` (tracked, `pending`); pending drained to 0; `replica.sync` completed on both Banks |
| 3 | Backup #1, route b | pass | `backup.capture` staged `core.sqlite`, `core-identity.json`, `native-request.json`; `hindsight-admin backup taki-drill-b1.zip --schema public --taki-request native-request.json` exit 0 (21 s); ZIP put in `backups/inbox/`; `backup.admit` then `backup.verify` completed with no mismatch; manifest route `operator-artifact`, 23 receipts, 0 missing |
| 4 | Write M2 ("basil") | pass | retain `ok:true`; drained; Core's global replica cursor moved from 34 to 62, so Core is now past backup #1 |
| 5 | Leave incomplete work (M3, "cello") | pass | the proxy let the retain POST through, then reset every later call on the global Bank; native finished the retain (receipt `completed`, has result; +1 document, +18 memory units); Core's pending row stayed `submitted` with no native result |
| 6 | Backup #2, route c | pass | `backup.capture` (native endpoint) then `backup.verify` completed with no mismatch; manifest route `native-endpoint`, ZIP kept on the native host, and its SHA-256 matches the manifest; 50 receipts, 0 missing; native rows identical before and after the capture; the pre-capture state was recorded |
| 7 | Stop Core A and native A | pass | both exit 0, not forced; M3 still `submitted` in the stopped Core's database |
| 8 | Isolated restore | pass | fresh pg0 R: `run-db-migration`, `restore <route-c ZIP> --yes`, `repair-bank --all`, `decommission-workers --yes`, all exit 0; restored native rows equal the capture-time rows for all 11 compared tables and groups (lineage, banks, bank state, application banks, documents, memory units and texts, native receipts, mutation receipts, application operations, changes per Bank); Core R runs on a copy of Core A's data dir, with `backups/<id>/core.sqlite` as `taki.db` (SHA-256 matches the manifest) |
| 9 | Read back | pass | authority epoch and lineage equal the record; the Bank list (scope, native id, readiness) is equal; replica checkpoint identity (lineage, generation, epoch) is equal and cursors are not behind (6 and 62); replica records and memory texts are equal; the manifest generations match the restored native; no rollback detection |
| 10 | Resume | pass | before: 1 pending on global. After `replica.sync`, M3 went to `completed`. Core read the existing native result (2 GETs of `native-results/retain/<id>`, 2 of its page) and made 0 retain POSTs. Native delta: 0 documents, 0 memory units, 0 native receipts, 0 async operations. The +19 application operations are Core's normal policy-binding commits for the units synced after the restore, not a repeated write |
| 11 | Use the restored pair | pass | a recall Run completed; the recall tool returned M1, M2 and M3; `backup.verify` of backup #2 against native R completed; backup status: native cursor 90 = replica cursor 90, 0 pending |
| 12 | Negative: behind native | pass | native O was restored from backup #1 (global cursor 34); Core O ran on backup #2's `core.sqlite` (global cursor 62). `replica.sync` on global failed with `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`. There were 0 `/snapshots` calls (no rebuild) and the Core checkpoints were unchanged. The character Bank (6 = 6) synced normally |

Isolation and cleanup (run 7, `result.json` `isolation` / `network` / `teardown`):

- the pg0 registry after the run equals the one before (hindsight-test plus the five `taki-d78-real-*` entries);
- all three drill pg0 instances were stopped, and their data and registry entries were removed;
- `~/.takiagent` was unchanged;
- 0 spawned processes still running, 0 new processes after 5 s, and no listener left on any drill port;
- the temp root was removed;
- native, admin and Core egress refusals: none; every Core fetch went to the proxy or the fake provider.

The same checks passed after runs 4, 5 and 6.

## Defects found and fixed (Core)

1. **A Run cannot write after its own recall lifts vector health to ready.**
   - Cause: the Hindsight provider reports vector health `degraded` until its first successful recall, which flips it
     to `ready` (`hindsight-memory-provider-context.ts:50`, `hindsight-memory-recall.ts:36`). A Run records its
     capabilities when it is admitted. Its own automatic recall then flips the health, and the write check compared all
     fields exactly.
   - Effect: the retain tool in that Run returned `MEMORY_AUTHORITY_MISMATCH` "memory capabilities are stale". In
     practice this is the first memory-writing Run after every Core start.
   - The archived native smoke checked only that its step-5 Run completed, not the retain tool result, and that Run was
     admitted under `degraded`. The same refusal was likely present there unseen; this is not proven.
   - Fix: `memory-capability-snapshot.ts` adds `writableMemoryCapabilities`. Before a write is sent, the stable fields
     must still match exactly and vector health must be either unchanged or `ready` (`memory-coordinator.ts`
     `capabilitiesCurrent`).
   - Unchanged: a state weaker than admitted still refuses the write, and drift during the write still returns
     `MEMORY_OUTCOME_UNKNOWN`. The two existing tests for this in `canonical-memory-run.test.ts` still pass.
   - Test: `memory-coordinator.test.ts`, "lets a captured Run write after its own recall lifted vector health to ready,
     but not after a stable capability drift". It fails without the fix.
   - Spec line updated: `.trellis/spec/backend/quality-guidelines.md`, provider coordinator capability snapshots.
   - A first, wider version (writes ignore vector health completely) ran in runs 4 and 5. It broke those two existing
     tests and hid the native failure below, so it was replaced.
2. **Rollback detection did not cover the path that runs in production.**
   - R7 was built into the plain replica runner (`hindsight-incremental-sync.ts`, via the native `/changes` 409 body).
     The production runner, however, is the application-aware one (`hindsight-application-sync-runner.ts`), and it
     reads `application-state/changes`.
   - When native is behind, that route answers 409 `state_reset_required`, with native's own checkpoint in the body.
     The runner treated every `state_reset_required` as "rebuild" and started a full snapshot.
   - Run 4 showed it: step 12 made 3 `/snapshots` calls. The rebuild then failed with `HINDSIGHT_REPLICA_SYNC_FAILED`,
     so no data was overwritten here, but R7 requires that no rebuild starts at all.
     Evidence: `evidence/run4-before-rollback-fix/`.
   - Fix: if the refusal carries a native checkpoint whose `state_cursor` is lower than Core's own checkpoint, the runner
     throws `HindsightRollbackError` (`HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`) with Core's namespace lineage and
     generation, and does not rebuild. A floor reset (`minimum_state_cursor` above Core, native not behind) still
     rebuilds as before.
   - Test: `hindsight-application-sync-runner.test.ts`, "refuses a native head behind its own checkpoint as a rollback
     without rebuilding the replica". It fails without the fix.

After these fixes, these checks pass:

- `pnpm typecheck`;
- `pnpm lint`;
- Core `vitest run`: 422 files, 3380 passed, 1 skipped;
- `git diff --check`.

No native change was made. TAKI-HS-013 was not touched.

## Native failure seen, not fixed

- `POST application-state/hydrate` sometimes returns 500 with `asyncpg SerializationError` ("could not serialize access
  due to concurrent update").
- Cause: hydrate runs in a repeatable-read transaction but writes body rows (`store.save_body`), and nothing retries a
  serialization failure (`application_state/service.py:47-67`). It collides with Core's concurrent binding commits.
- It happened in step 5 of runs 5 and 6, right after step 4's writes. Run 7 did not hit it.
- The effect in Core: the Run's recall falls back to the replica (vector `degraded`). Per the spec, that Run then
  refuses its writes, because its state is weaker than admitted. Run 6 failed this way at step 5: "memory capabilities
  are stale", no retain reached native. Evidence: `evidence/run6-step5-native-500/` (native traceback in
  `native-A.log`); run 5's instance is in `evidence/run5-superseded-fix/native-A.log`, where the wider fix hid it.
- Not fixed because it is intermittent and did not block the drill. A likely fix is a bounded retry on serialization
  failure in `ApplicationStateService.run`, as a TAKI-HS patch with a pg0 pytest.

## Observations (not changed)

- **The capture operation reads `outcome_unknown` on a restored copy.**
  - `core.sqlite` is copied while `backup.capture` is still running. On the restored Core, boot recovery
    (`observeBoot`) therefore marks that capture operation `outcome_unknown` / `producer_incomplete` (phase
    `capturing-core`), even though its sealed manifest exists and `backup.verify` passes.
  - This is expected from the capture order, but the operation list on a restored install shows its own backup as
    unknown.
- **Pending writes finish only through `replica.sync`.** Native had finished M3 within about 1 s, but Core confirmed it
  only on the next `replica.sync`. The drill calls `replica.sync` directly; in normal use the scheduler interval
  decides when this happens.
- **A rollback failure says `automatic_retry_scheduled`.** The scheduler gives every failure on an automatic Bank this
  next action. Each retry hits the same 409 and fails again with the same code, with no rebuild. The status text still
  suggests the problem will go away by itself.

## Not run

- An interrupted capture (killing Core in the middle of a capture) was not run in this drill; unit tests cover it.
- The restored pair was not run under the scheduler's own interval. The drill triggers `replica.sync` directly, so the
  real pending-recovery timing is not measured.
