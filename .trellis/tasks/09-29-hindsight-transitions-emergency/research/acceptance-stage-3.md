# Stage 3 independent acceptance — 2026-09-29

## Verdict

**Conditional pass for the implemented Stage 3 backup path; one confirmed medium-severity evidence defect must be addressed before Stage 4 relies on its missing-interval projection.** Current focused deterministic checks pass: **25 files, 205 tests passed, 1 platform-specific test skipped**. An additional isolated current-code probe reproduces the defect below. No production fix was made.

The current implementation contains the shutdown, inventory and explicit-full rollback fixes that postdate the original formal check. It is not accurate to carry the archived explicit-full finding forward as an unfixed defect. Conversely, the old native pytest and full restore drill are historical evidence, not executions against today's complete working tree. AC10/AC11 were source-reviewed and reconciled with that history, not rerun. AC12 workspace gates belong to the root reviewer. Owner/manual acceptance remains separate.

Stage 4 planning may continue. Do not certify a takeover's recovery interval from the current `missingInterval` numbers without checking their namespace compatibility. The independently reported Stage 1/2 `replica.sync` false-completion finding also applies when a Stage 4 prerequisite relies on that operation's terminal state; this report does not duplicate that investigation.

## Scope and environment

- Workspace: `H:/TakiAgent`; branch: `main`; HEAD: `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Worktree list was checked before inspection. No task work used the T4 or Claude worktrees.
- Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`, status `planning`. The session pointer `.trellis/.runtime/sessions/codex_01a0eaf4-aea6-7e51-9353-71ca36d634bf.json:4` names this task. The legacy `.trellis/.current-task` is empty.
- Toolchain: Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`. Package scripts/configuration and relevant fixture constructors were inspected before execution. All Vitest runs used at most two workers, sequentially.
- Reviewed root `AGENTS.md`, `CLAUDE.md`, relevant `CONTEXT.md` vocabulary, backend/frontend indexes, backup/operations/database/replica/Home contracts and `trellis-check/SKILL.md`. This report-only assignment overrides the skill's auto-fix step.
- Primary baseline: archived task `09-25-hindsight-backup-restore` PRD, design, implementation notes, check context, formal check and restore drill; `docs/HANDOFF.md:211`; completeness audit `plan-review-2026-09-18.md` PR01/PR02 and emergency clarification.
- Production source, existing tests, specs, archived tasks, service configuration and Git history were not modified. New files are confined to this report and `research/evidence-stage-3/`.
- Tests used temporary SQLite databases, injected transport/native-route doubles and scripted/failing model fixtures. No original database, real native runtime, real model or paid/external service was used. The standalone probe verified its temporary path before deleting its own fixture directory.

## Findings

### F1 — Medium: missing intervals combine different Bank histories

**Location:** `packages/core/src/memory/hindsight-backup/hindsight-backup-status.ts:32` through the interval construction at line 35. Consumer: `packages/core/src/memory/hindsight-backup/hindsight-backup-emergency.ts:28`, which embeds that status into the incident manifest. Home renders the two numbers in `apps/desktop/src/windows/home/pages/operations/memory-hindsight-backup-state.ts:136`.

**Trigger:** a last verified backup and the current replica use the same native Bank ID, but the Bank generation differs. A provider lineage change or later authority history can create the same problem. A generation change is already a supported rebuild case; this is not dependent on inventing a numeric cursor rollback within one generation.

**Cause:** `nativeCursors` is keyed only by `bankId`. The current checkpoint contributes only `endCursor`; its `providerLineageId`, `bankGeneration` and `authorityEpochId` are discarded. Inventory selection can retain older verified backups. Neither status construction nor the incident schema marks these coordinates as incomparable.

**Reproduction:** [status-history-probe.mjs](evidence-stage-3/status-history-probe.mjs), executed against current production modules with a fresh migrated SQLite fixture. The old backup is generation `33333333-3333-4333-8333-333333333333` at cursor 10. The current checkpoint has the same lineage/Bank/epoch but generation `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` at cursor 5. Output in [status-history-probe.txt](evidence-stage-3/status-history-probe.txt):

```json
{
  "bankId": "taki-hs-g",
  "fromNativeCursor": 10,
  "toReplicaCursor": 5,
  "pendingCount": 0
}
```

**Consequence:** Home presents one numeric unbacked interval spanning unrelated histories; emergency evidence records the same misleading interval. The historical backup remains a valid historical reference, but these numbers cannot prove the amount or absence of missing memory. This finding does **not** show that the ordinary backup pair verifier accepts mismatched generations; that verifier separately rejects them and its tests pass.

**Confidence:** high, reproduced in current code. The cross-generation status defect is demonstrated; emergency propagation is verified by direct source inspection of the shared helper, not by a real takeover.

**Smallest repair seam:** retain the full current checkpoint in `readHindsightBackupStatus`; compare the backup proof's lineage and Bank generation before creating a numeric interval. Preserve the historical backup ID/age but use an unknown/incomparable interval when compatibility is not proven. Stage 4 must explicitly define whether and how an epoch change preserves comparability. A reason field is optional if null already communicates the chosen product contract. Cover both same-history and changed-generation/lineage cases in status and incident fixtures. No native call is needed for this repair.

**Stage 4 disposition:** blocks using the current interval as takeover coverage/loss proof; does not block planning. It can be repaired at the projection seam or Stage 4 can fail closed on incompatible history while the projection is corrected.

## Current AC1–AC12 coverage

| AC | Current disposition | Evidence and boundary |
| --- | --- | --- |
| AC1 | Pass, deterministic | `db/sqlite.test.ts` tests an openable copy, integrity, implicit rowids, same-connection writes during copy, transaction refusal and bad targets. `hindsight-backup-store.test.ts` covers partial-file cleanup. `sqlite.ts:71` uses Node's online `backup()` primitive. |
| AC2 | Pass for pair contract | `hindsight-backup-pair.test.ts` covers lineage, Bank set/ID, generation, replica/application cursors and receipt scope/membership. `hindsight-backup-service.test.ts` covers the native-superset inter-capture write and missing native receipt. Core metadata is read before the online copy; the proof is a capture lower bound, not a later SQL read-back of every manifest field from `core.sqlite`. |
| AC3 | Pass, deterministic | Capture service failure matrix covers unavailable route, quiescence/Core/native/pair/storage failures, nothing listed, scheduler restart and fence release. `hindsight-writer-fence.test.ts` covers closed writers and open read/Run surfaces. Native timeout is raced even if the route ignores abort. This is not a measured real-native chat-latency claim. |
| AC4 | Pass, deterministic | `memory-operation-kind-backup*.test.ts` covers family registration, exclusive-family refusal in both directions, deferred claim, pre-claim cancel and restart quarantine/no redispatch. Restart test reopens the established isolated activation journey. It does not kill a real native deployment. |
| AC5 | Pass for declared trust boundary | Admit/verify tests cover malformed/version/schema/hash/size/proof/pair/identity refusals, custody and verification inventory. Route b moves the inbox entry before reading, streams/re-hashes entries, rejects non-regular input, and never extracts ZIP paths. Route c verifies a native-host digest through the authenticated client. See trust boundaries below. |
| AC6 | Pass, deterministic | Custody tests scan all fixture artifact bytes and assert catalog `resolve()`/`backup()` are not used. Missing refs produce `HINDSIGHT_BACKUP_CREDENTIAL_MISSING`; verify leaves a historical manifest untouched for host-state failures. A presence check is not a check that a current credential authenticates successfully. |
| AC7 | Pass on the implemented application-checkpoint paths; documented seed limit | Current explicit-full tests independently roll back native and state cursors and require refusal before application snapshots, unchanged checkpoint, then success after repair. Incremental rollback, reset-floor rebuild, wire `cursor_ahead` classification and scheduler hold tests pass. The B5-only seed path still rejects stale publication with `HINDSIGHT_APPLICATION_CHECKPOINT_STALE` rather than the dedicated rollback code/hold; the current spec discloses this limit. |
| AC8 | Pass for offline hook; F1 limits interval truth | Existing emergency tests prove no native snapshot request even when native hangs, correct last-backup age/ID, no-backup support and exclusion from full-backup listing. The hook has no takeover caller, does not itself freeze writers or bind an operation ID, and inherits F1. Stage 4 must supply the transition ownership/capture boundary. |
| AC9 | Pass for existing fixtures; F1 outside fixtures | Shared status schemas and Desktop backup view/render/generic-submit/controller tests pass. Unknown/no-backup/verified/staged/failure/rollback/in-flight states are covered. Cross-generation interval semantics are absent from those fixtures. Backup cancellation is available through the operator API only before claim; the Home generic row currently only exposes Cancel for `replica.sync` (see limitations). |
| AC10 | Current source review + historical native tests | Native default-off route, API-key authentication, supported-build gate, same-snapshot proof, advisory single-flight, digest-only response, CLI fallback and manifest v2 restore checks match the Core contract. Historical W5 evidence reports 35 native tests passed on owned pg0. Native pytest was not rerun here. |
| AC11 | Historical drill, not a new HEAD-level execution | Archived run 7 `result.json` is `passed`, with 12/12 steps. It covers fresh native restore, identities/cursors, copied Core, existing native-result recovery with zero retain POSTs, recall, verify and older-native refusal with zero snapshots. Current source/test fixes were reconciled below. No current real-process restore was run. |
| AC12 | Delegated/not independently repeated | Focused checks below pass; current root workspace gates and isolated Core boot are owned by the root reviewer. Historical formal check recorded those gates, but that history is not a current full-workspace acceptance. No owner/manual criterion is marked passed by this review. |

## Source review of critical paths

### Pair capture, ownership, crash and shutdown

- `hindsight-backup-service.ts:119` checks route availability before quiescence; quiesces writers, stops/awaits the scheduler, reads Core identity/custody, copies Core, obtains native snapshot, verifies pair and seals. Failure removes the partial directory; release/restart is in `finally`.
- `hindsight-backup-identity.ts:27` reads authority, runtime Bank membership, replica/application checkpoints, current-generation terminal receipt IDs and migration head inside one synchronous transaction. The mapping is pinned by `hindsight-backup-receipts.test.ts`. The full SQLite copy also carries configuration, authority markers/receipts, Pending and journals.
- `hindsight-writer-fence.ts:34` wraps native-writing tool and maintenance surfaces; recall/reflect, Run capture and primary witness remain open. Production composes that wrapper in `hindsight-memory-subsystem.ts:90`. Scheduled and foreground synchronization share storage guards but remain distinct execution owners; the capture tests do not prove a simultaneous external native-admin restore is safe.
- Store paths derive from `dataDir`, validated UUIDs and a restricted inbox filename. Partial, staged, quarantine and incident directories are not full-backup inventory. Route-b staged artifacts remain explicit status entries. Seal re-hashes data and renames the complete directory as its commit point.
- `backupCaptureKind.observeBoot` quarantines a partial capture and settles `outcome_unknown`; it never redispatches. A route-b admit can observe its already sealed pair as completed. Capture's copied in-flight row on a restored host intentionally becomes unknown even when the separate sealed manifest verifies.
- `hindsight-backup-service.ts:106` waits for active capture promises after aborting them. `main.ts:568` awaits that stop before `memoryRuntime.stop()`, preventing the capture's release from restarting a scheduler after final runtime shutdown. The current focused service test covers stop during an open Core copy.

### Admission, verification and native trust

- Only operator `memory.operations.submit` reaches backup kinds. Admission requires a Hindsight marker and exclusive-family availability; capture additionally requires the expected clean published runtime. Deferred claim rechecks runtime/epoch before invoking capture. The family owns the operation lifetime rather than the UI connection.
- Route b trusts the operator-controlled staged Core half and a compatible native CLI's proof. The ZIP's table entries, lengths and SHA-256 values are verified against its own manifest, and the proof is paired with the staged identity. Core does not parse PostgreSQL binary COPY contents to independently derive the native proof or certify restore-target compatibility. The native restore path performs column/schema checks before truncation. Do not interpret artifact integrity as authentication against an operator who can rewrite the full artifact and all hashes.
- Route c trusts the authenticated native producer to read proof and COPY bytes in one transaction. `_backup_on_connection` in `H:/hindsight/.../admin/cli.py:326` does so. The opt-in API returns proof/reference/digest only; Core never downloads the ZIP or acquires DB/OS authority from the API key.
- `api/taki_backup.py:179` holds a DB session advisory lock for endpoint captures; `_write_artifact` uses an exclusive partial file, flush/fsync via `asyncio.to_thread`, hashes and renames. The CLI fallback shares proof generation; no claim is made that all unrelated administrative CLI activity is paused by the API lock.
- Verification re-hashes the Core copy and native artifact (or queries its native-host digest), rechecks the pair and verifies credential presence. Artifact failures clear `verifiedAt`; route/native/credential/storage failures leave it unchanged. No production Core data-dir restore tool or automatic pair gate before generic Core startup is shipped (D91).

### Rollback, restore and startup

- Production composes `createHindsightApplicationSyncRunner` in `hindsight-runtime-state.ts:49`, injecting it into both recovery and foreground service paths. This is the application-aware runner, not only the older plain B5 runner.
- Incremental `state_reset_required` checks both cursor dimensions before rebuilding. `full()` reads `initializeApplication` and checks a same-generation predecessor before an application snapshot. A reset that must discover its namespace can first request one logical native snapshot. Different generation retains the intentional rebuild path.
- Scheduler repository tests verify that a dedicated rollback failure persists `explicit_retry_required`, schedules no retry/interval/full/catch-up run, permits explicit retry, and clears the hold only after success. This scheduler hold does not mean a foreground read can never attempt a fresh guarded pull.
- Seed boundary: without an application checkpoint, `hindsight-application-sync-runner.ts:164` cannot classify rollback from that predecessor. Publication at `db/hindsight-application-replica-publication.ts:134` still refuses a same-generation native cursor behind the B5 checkpoint. No absorption was found; the dedicated diagnostic/hold is narrower than the headline wording in HANDOFF.
- Runtime composition uses the durable authority/activation receipts to publish the selected binding; copied secret custody must be satisfied separately on the restored host. Backup verification is not a replacement for receipt validation or the explicit restore/runbook sequence.

## Historical evidence reconciliation

| Archived item | Current state |
| --- | --- |
| Formal-check F1 shutdown race | Fixed in `5bf80dd`; current stop-during-Core-copy test passes. |
| Formal-check F2 staged/latest inventory and re-verify | Fixed in `1e564b7` and service inventory; current status and Home tests pass. |
| Formal-check F3 synchronous native flush/fsync | Current native source delegates flush/fsync to `asyncio.to_thread`; old wording is stale. Current source hashes are recorded below. Large table buffering remains a scale limit. |
| Formal-check F4 explicit full rollback code/hold gap | Fixed in `8670f68`, which is in current history. Current explicit-full tests pass for each cursor dimension. |
| Restore-drill intermittent hydrate serialization failure | Current native `ApplicationStateService.run` retries only repeatable-read work on serialization/deadlock, three total attempts (TAKI-HS-014). Reviewed in source; its historical 50-pass/1-skip native check was not rerun. |
| Restore drill run 7 | Raw `result.json` inspected: `status=passed`, `fatal=null`, 12 steps, zero failed steps. It contains isolation/network/teardown evidence. It has no tested Core/native source-hash inventory, so it cannot independently identify every byte of the current native working tree. |

Native source reviewed at HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`; Taki patches are uncommitted per HANDOFF and the task record. No native files were changed or executed by this review. Exact SHA-256 fingerprints:

| File under `H:/hindsight/hindsight-api-slim/hindsight_api/` | SHA-256 |
| --- | --- |
| `admin/cli.py` | `9e5ae607f5f905215edf9dd85a0d08146c57c6153a28de737e73331bd9079a6d` |
| `admin/taki_backup.py` | `9ae83b41877a9033b9175396d0c9c9dbfe5ad54e042bb61d2288e36aff883654` |
| `api/taki_backup.py` | `6559f97d95d0622f06af2d39ea7b5320ea5421ef4b7c8c8ee9a920c3f87219dc` |
| `engine/application_state/service.py` | `1c18c191742a9d1590891e469b636a61984fd42a56bacd1bc61c04246c058a2d` |

## Exact current checks

All commands ran from `H:/TakiAgent`. Outputs are under `research/evidence-stage-3/`. The first run's skipped case is `hindsight-backup-store.test.ts:123`, which checks Unix owner mode bits and explicitly skips Windows.

```powershell
pnpm --filter @taki/core exec vitest run src/db/sqlite.test.ts src/memory/hindsight-backup src/memory/operations/memory-operation-kind-backup src/memory/hindsight/hindsight-writer-fence.test.ts src/memory/hindsight/hindsight-cursor-reset.test.ts src/memory/hindsight/hindsight-application-sync-runner.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts src/db/hindsight-replica-scheduler-repo.test.ts --maxWorkers=2 --reporter=dot
# 19 files: 161 passed, 1 skipped; core-tests.txt

pnpm --filter @taki/shared exec vitest run src/hindsight-backup-schema.test.ts src/memory-operation-schema.test.ts src/memory-authority-status-schema.test.ts --maxWorkers=2 --reporter=dot
# 3 files: 21 passed; shared-tests.txt

pnpm --filter @taki/desktop exec vitest run src/windows/home/pages/operations/memory-hindsight-backup-state.test.ts src/windows/home/pages/operations/memory-hindsight-backup-block.test.tsx src/windows/home/pages/operations/memory-operations-controller.test.ts --maxWorkers=2 --reporter=dot
# 3 files: 23 passed; desktop-tests.txt

node .trellis/tasks/09-29-hindsight-transitions-emergency/research/evidence-stage-3/status-history-probe.mjs
# exit 0: assertions confirm F1 is present; status-history-probe.txt
```

The probe is a diagnostic asserting the observed defect, not a passing regression test for desired behavior. Existing suites pass because they do not cover this history mismatch. These counts overlap other acceptance suites and must not be added to their totals as unique tests.

## Stage 4 prerequisite disposition and untested boundaries

| Prerequisite | Disposition / smallest follow-up |
| --- | --- |
| Paired artifact producer and verifier | Available; focused capture/admit/verify/custody/crash tests pass. Stage 4 can use these services rather than inventing another backup owner. |
| Emergency path while native is unavailable | Offline evidence hook available, with no native dependency. Stage 4 must own its invocation, quiescence/epoch boundary, operation binding, interruption/recovery and ordering before promotion. The hook alone grants no takeover authority. |
| Truthful missing-interval evidence | **F1 must be repaired or guarded before it is used as coverage/loss proof.** Historical backup reference and exact interval are separate claims. |
| Trustworthy sync prerequisites | **Carry Stage 1/2 report F1:** do not accept an old run's success as the requested `replica.sync` result. See `acceptance-stages-1-2.md`; no duplicate repair is proposed here. |
| Rollback protection | Present for current application-checkpoint paths; retain the B5-only seed limitation explicitly. A new Stage 4 path must carry namespace/epoch and use the existing guarded producer rather than bypassing it. |
| Real restore capability | Historical isolated drill is positive evidence; current native source matches the intended route/restore contract. A new current-code isolated restore run remains necessary if root requires a fresh end-to-end gate before real-data takeover release. It is outside this review's no-runtime boundary. |

Additional limits:

- Home exposes cancellation only when `operation.kind === "replica.sync" && state === "admitted"` (`memory-authority-state.ts:98`). Backup handlers support pre-claim API cancellation, but backup rows have no Home Cancel button. This is a UI capability limit, not a failed backend cancellation check; Stage 3 AC9 did not explicitly require that button.
- No OS-level crash/power-loss test, symlink race attacker test, large native archive scale test, production restoration, real credentials, native pytest, real-native capture latency or scheduler-interval restore timing was run. Windows owner mode bits were skipped as documented.
- The emergency hook has no production caller yet; repeated transitions, real takeover, old-authority quarantine and post-takeover merge rejection are Stage 4 responsibilities and are not accepted here.
- Retention/cleanup (D90), the production Core restore tool (D91), and unrelated `target_conflict` remedies remain deferred. No owner/manual acceptance was inferred from tests.
