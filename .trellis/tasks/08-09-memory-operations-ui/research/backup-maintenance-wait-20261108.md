# P1-AA — Backup versus post-turn maintenance

## 1. Outcome

**DONE for the read-only diagnosis. No implementation or new runtime verification was performed.**

**The supplied evidence does not support a mutual wait between backup quiescence and maintenance. The production wait graph has no such cycle.** Backup waits for the admitted maintenance owner, while that owner performs ingestion, synchronous curator preparation, model/tool work and publication/refresh. Backup does not close the curator's separate work fence, stop its Utility Slot, or stop the replica scheduler while waiting. Reopening the backup fence resolves no promise awaited by the curator. [source packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts:137] [source packages/core/src/memory/canonical-local-write-fence.ts:51] [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:50]

The repeated **9 / 5 / 6 ms** refusal-to-provider-observation intervals are real. They are consistent with an overdue Core timer becoming runnable when synchronous preparation finally yields to I/O, rather than release waking maintenance. The contention run's 30-second timer was delivered after **62.384 seconds**. Crucially, the clean replay persisted new curator work while the backup fence was closed and Native was apparently silent. The exact stack occupying every millisecond of that interval is **UNKNOWN**: the supplied CPU profiles stop too early. Source inspection disproves the proposed fence-release dependency; it does not turn the unprofiled interval into a measured CPU breakdown. [run artifact G:/taki-post-reentry-jYzuQu/core-data/taki.db] [run artifact G:/taki-post-reentry-EGnVTq/core.log] [inference]

The three supplied replays also have **valid saved policy results**, not P1-N's malformed fixture response. Their `failed` outcomes concern incomplete publication under the whole-pass lifetime. `assessed` counts verified applied assessments, not model proposals or Native commits. The before/after-P1-T difference and contention explain different progress through that lifetime; details and remaining attribution limits follow. [source packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:31] [run artifact G:/taki-post-reentry-DFgV2j/core-data/taki.db] [run artifact G:/taki-post-reentry-EGnVTq/core-data/taki.db] [run artifact G:/taki-post-reentry-jYzuQu/core-data/taki.db]

## 2. Changes

- Created only this report, `.trellis/tasks/08-09-memory-operations-ui/research/backup-maintenance-wait-20261108.md`.
- No source, tests, prompts, templates, leader-owned records, task binding or Git state was changed. No Core, Native, PG, Home, journey, provider server or child agent was started. No original user data or credentials were accessed.
- Commands used `TEMP=TMP=G:/taki-codex-work/tmp-aa`. Analysis scripts were supplied on stdin; no scratch files were written.

Workspace observation: `H:/TakiAgent`, branch `main`, HEAD `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`; the initial status listed **458** changed/untracked entries, rather than the assignment's approximate 370. They were preserved. This is an observation of a concurrently used tree, not a claim that all entries belong to one workstream.

## 3. Evidence and checks run

### Q1. Actual await chain and the apparent release-to-model link

The named `runMaintenancePass -> maybeTidy` functions exist in `auto-memory.ts:139-151`, but they are the generic writer adapter, **not the selected Hindsight pass in these replays**. Production composition uses `createMaintenanceAutoMemory({ maintenance: () => current().maintenance })`. The probe identifies `runMaintenanceChain:129`, not `runMaintenancePass:139`. [source packages/core/src/memory/runtime-composition.ts:294] [source packages/core/src/memory/auto-memory.ts:123] [run artifact G:/taki-post-reentry-jYzuQu/core.log]

The selected chain is:

1. `onTurnCompleted` queues a per-Character continuation with `setImmediate`; `runMaintenanceChain` awaits the selected `maintenance.run`. Hindsight wraps that **entire** call in `writeFence.admit`, so its owner stays active through policy review and publication. Compaction follows after that owner returns. [source packages/core/src/memory/auto-memory.ts:100] [source packages/core/src/memory/auto-memory.ts:129] [source packages/core/src/memory/hindsight/hindsight-writer-fence.ts:32]
2. Hindsight maintenance awaits `ingestion.maybeRun` for a primary turn, then `tidy.maybeRun`. Ingestion awaits its Utility gate, the two Bank retains, and journal acknowledgement/completion. This pass is not awaiting backup completion. [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:76] [source packages/core/src/memory/hindsight/hindsight-ingestion.ts:130] [source packages/core/src/memory/hindsight/hindsight-ingestion.ts:150]
3. `createTidyAdapter` builds its report synchronously, awaits `curator.runNow`, then logs the outcome. The curator has another per-Character promise chain. Its `execute` creates the whole-pass lifetime **before** resolving Banks and processing the Global Bank first. [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:145] [source packages/core/src/memory/hindsight/hindsight-policy-curator.ts:31] [source packages/core/src/memory/hindsight/hindsight-policy-curator.ts:44]
4. `processBank` reads pending/due work, captures and verifies targets, prepares/claims durable records, captures Blocks and calls `generateAndPublish`. `await recover(...)` can be a real publication/refresh wait for a previously saved attempt. For the newly prepared records observed here it returns `false`; these resolved-promise awaits do not create a backup-dependent admission gate. Much of this loop is synchronous SQLite, decoding, hashing and validation. [source packages/core/src/memory/hindsight/hindsight-policy-curator.ts:73] [source packages/core/src/memory/hindsight/hindsight-policy-curator.ts:114] [source packages/core/src/memory/hindsight/hindsight-policy-curator-targets.ts:31]
5. `executeCuratorModel` synchronously captures its report/prompt, then awaits `awaitCuratorWork(... slot.run("hindsight-policy-curator", ...))`. Inside that serial slot it verifies the whole review and records prompt evidence for every target. The driver verifies again before `agent.generate`; SDK `prepareStep` verifies again before its provider call. [source packages/core/src/memory/hindsight/hindsight-policy-curator-execution.ts:17] [source packages/core/src/memory/hindsight/hindsight-policy-curator-execution.ts:28] [source packages/core/src/memory/hindsight/hindsight-policy-curator-model.ts:21]
6. The installed AI SDK is **7.0.17**. Its `generateText` awaits `prepareStep` before `stepModel.doGenerate`. The fixture timestamp is recorded by the **provider server after receiving/parsing the request and choosing its reply**, not at entry to Core's driver. Thus the reported 5-9 ms spans also include delivery/scheduling between processes. [source packages/core/node_modules/ai/package.json:3] [source packages/core/node_modules/ai/src/generate-text/generate-text.ts:805] [source packages/core/node_modules/ai/src/generate-text/generate-text.ts:937] [source .trellis/tasks/archive/2026-09/09-25-hindsight-native-smoke/research/smoke-fake-provider.mjs:145]

The principal synchronous amplification is visible without assuming an external library API: review verification loops over all records; Block verification revisits its sources; journal mutation checks `assertActive` around its transaction; that guard calls `bankScope -> runtime.bank -> assertConnection -> assertEvidence -> readTemplateSelectionIdentity`. These are computations/currentness checks, not waits for the backup flag to reopen. P1-T removed repeated whole-review verification **inside tools**; it deliberately left pre-model and publication verification in place. [source packages/core/src/memory/hindsight/hindsight-policy-curator-targets.ts:125] [source packages/core/src/db/hindsight-policy-work-repo.ts:136] [source packages/core/src/memory/hindsight/hindsight-runtime-state.ts:107] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:82] [source .trellis/tasks/08-09-memory-operations-ui/research/curator-stall-impl-20261107.md:3]

The wait graph is consequently:

```text
backup quiesce
  -> writeFence active count reaches zero
     -> admitted maintenance returns
        -> ingestion -> curator preparation -> Utility Slot/model/tools
           -> publication -> Bank refresh -> curator outcome

backup timeout -> rejected drain -> fenced=false -> failed backup operation
                 [no wake-up sent to the curator/Utility Slot/Bank queue]
```

Specific alternatives checked:

| Candidate blocker | Finding |
| --- | --- |
| Backup stops the scheduler too early | Ruled out. `scheduler.stop()` is after successful write-fence quiescence. [source packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts:141] |
| Nested write admission waits for backup release | Ruled out. A live inherited owner enters immediately. A fresh fenced admission throws; it does not wait. [source packages/core/src/memory/canonical-local-write-fence.ts:30] |
| `workFence` at provider capabilities | Ruled out as this backup's blocker. It is a different instance. The provider either returns its cached capabilities or tracks a call through that fence; it has no wait-for-writable loop. Backup receives only `writeFence`. [source packages/core/src/memory/hindsight/hindsight-memory-provider.ts:25] [source packages/core/src/memory/hindsight/hindsight-memory-provider.ts:33] [source packages/core/src/memory/runtime-composition.ts:321] |
| Utility Slot serialization | Real serialization, but no backup dependency. `run()` chains to previous Utility work; backup does not use, stop or hold that slot. [source packages/core/src/memory/utility-slot.ts:49] |
| Bank refresh queue | Real possible delay, particularly **after** model results. `synchronize` waits for the previous Bank owner and then pulls; backup does not stop that owner during write-fence drain. [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:58] [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:79] |
| Quiesce release resolves a curator await | Ruled out in this source. Drain waiters resolve on `active===0`. Timeout removes its waiter and rejects; failure changes the flag. `release()` only assigns the flag. Neither path resolves Utility/curator/Bank promises. [source packages/core/src/memory/canonical-local-write-fence.ts:51] [source packages/core/src/memory/canonical-local-write-fence.ts:62] |

All times below are UTC, computed from `core.log` probe timestamps and `replay-result.json.provider[].at`:

| Replay | Quiesce begins | Refused | Provider observes policy request | Gap | Actual quiesce duration | Holder finally settles |
| --- | --- | --- | --- | ---: | ---: | --- |
| `DFgV2j` | 08:19:05.203 | 08:19:38.456 | 08:19:38.465 | 9 ms | 33.253 s | 08:20:20.363 |
| `EGnVTq` | 15:58:27.120 | 15:59:29.504 | 15:59:29.509 | 5 ms | 62.384 s | 15:59:53.414 |
| `jYzuQu` | 16:56:58.332 | 16:57:30.345 | 16:57:30.351 | 6 ms | 32.013 s | 16:58:11.561 |

[run artifact G:/taki-post-reentry-DFgV2j/core.log] [run artifact G:/taki-post-reentry-DFgV2j/replay-result.json] [run artifact G:/taki-post-reentry-EGnVTq/core.log] [run artifact G:/taki-post-reentry-EGnVTq/replay-result.json] [run artifact G:/taki-post-reentry-jYzuQu/core.log] [run artifact G:/taki-post-reentry-jYzuQu/replay-result.json]

The clean replay's `16:57:15.891` Native line is **Native's asynchronous consolidation completion**, not evidence that Core was waiting on that event. Core had already created the first curator work at `16:57:11.102`. Further work was created at `15.910`, `16.371`, `16.797`, and `17.106`, after that Native completion and before backup refusal. This directly refutes “nothing progressed until backup released.” [run artifact G:/taki-post-reentry-jYzuQu/native.log] [run artifact G:/taki-post-reentry-jYzuQu/core-data/taki.db, hindsight_policy_work.created_at]

The nominal backup timer expired at `16:57:28.332`, but its callback ran at `30.345`. The corresponding overshoots are 3.253 seconds and 32.384 seconds in the comparison runs. A passive promise waiting for a fence would not itself prevent the timer running. Synchronous/microtask work and OS scheduling delay explain delayed timer delivery and the provider observation immediately afterward. **Exact attribution between those contributors remains UNKNOWN.** The narrow “backup release unlocks policy generation” hypothesis is disproved by the source; the timer/I/O scheduling explanation is a supported inference, not a sampled call-stack measurement. [source packages/core/src/memory/canonical-local-write-fence.ts:69] [inference]

### Q2. Longer budget and starting two minutes later

- **A longer budget can succeed.** There is no deadlock requiring timeout as its escape. Observed remaining maintenance lifetimes from quiesce start were **75.160 / 86.294 / 73.229 seconds**. A budget exceeding the actual lifetime could drain without refusing, provided no other failure intervenes. These numbers are observations with the original timeout, not results of a changed-budget replay. Raising the budget is not the recommended repair. [run artifact G:/taki-post-reentry-DFgV2j/core.log] [run artifact G:/taki-post-reentry-EGnVTq/core.log] [run artifact G:/taki-post-reentry-jYzuQu/core.log] [inference]
- **At chat completion + two minutes, with otherwise identical work and no new triggers, this holder would already be gone.** The observed holder finished about **76.3 / 88.4 / 74.3 seconds** after chat completion. Quiescence would therefore succeed immediately for this owner. This is a source-supported counterfactual, not a newly executed delayed-backup test, and it does not guarantee the later Native snapshot/pair check. [run artifact G:/taki-post-reentry-DFgV2j/replay-result.json] [run artifact G:/taki-post-reentry-EGnVTq/replay-result.json] [run artifact G:/taki-post-reentry-jYzuQu/replay-result.json] [inference]
- The observed retries quiesced in **0 / 1 / 1 ms**. Capture took **11.002 / 21.308 / 10.204 seconds**; the contended run was not a ten-second capture. The harness explicitly waited for observed drain before submitting a **new public capture operation**. This is not an automatic production retry. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/backup-quiescence-probe.mjs:75] [run artifact G:/taki-post-reentry-EGnVTq/replay-result.json]

### Q3. Why policy review failed, and why assessed is 0 / 0 / 4

The default policy lifetime is **60,000 ms**, created in `execute` before Bank/target preparation. It covers preparation, Utility queue wait, model/tool work, publication and refresh. Ingestion and `buildTidyReport` precede it. `alive()` checks an absolute deadline in addition to the abort timer, so delayed timer delivery does not grant extra valid publication time. `awaitCuratorWork` races owned async work against abort. On expiry, saved results remain deferred; the pass reports `failed`. **This budget is consumed by the work/delays, not by a proven wait for backup release.** [source packages/core/src/config/hindsight-policy-config.ts:8] [source packages/core/src/memory/hindsight/hindsight-policy-curator.ts:52] [source packages/core/src/memory/hindsight/hindsight-policy-curator-lifetime.ts:9] [source packages/core/src/memory/hindsight/hindsight-application-body-transfer.ts:34] [source packages/core/src/memory/hindsight/hindsight-policy-curator.ts:129]

The copied databases were opened with SQLite `mode=ro&immutable=1`; all three WALs were zero bytes. Only journal metadata and result kinds were extracted. For work created on November 7, each replay contains **ten `assessment` results and one `block-unchanged` result**. There are no new `assessment-failure` results among these eleven records. Final unresolved records retain `last_failure='publication_pending'`.

| Replay | Durable evidence | Explanation |
| --- | --- | --- |
| `DFgV2j`, before P1-T | First target created 08:19:19.135. Model observed 08:19:38.465. First publication command only prepared at **08:20:16.937**, never dispatched. All eleven work records remain saved/pending; pass settles 08:20:20.363. | Roughly **38.472 s** elapsed from model observation to preparing the first command. The pre-P1-T per-tool whole-review checking leaves almost no pass budget for publication. `assessed=0` is correct despite ten saved proposals. |
| `EGnVTq`, after P1-T, contended | First target created 15:58:50.849. Model observed 15:59:29.509. First command prepared **15:59:33.998**, dispatched 34.616, completed **35.108**. Its curator work remains saved/pending; the other ten have no command. Pass settles 53.413. | The first command reached Native quickly after tool work, but **Native completion did not become verified local application before settlement**. Preparation alone used at least **38.660 s** from first durable target to model observation. Catch-up/refresh consumes the remaining lifetime. |
| `jYzuQu`, after P1-T, clean | First target created 16:57:11.102. Model observed 30.351. First command prepared **32.369**, completed **32.906**; its work completes only at **16:58:02.696**. Three more work items complete at 04.642, 06.618, 08.613. A fifth command is prepared at 08.764 but never dispatched. Six assessments plus the Block remain pending. | First-command preparation is **2.018 s** after model observation. The first completion-to-work-completion interval is **29.790 s**, consistent with the refresh/catch-up boundary. Four verified effects fit before the pass deadline; the fifth does not. |

[run artifact G:/taki-post-reentry-DFgV2j/core-data/taki.db, hindsight_policy_work joined to hindsight_application_command_jobs] [run artifact G:/taki-post-reentry-EGnVTq/core-data/taki.db, same join] [run artifact G:/taki-post-reentry-jYzuQu/core-data/taki.db, same join] [run artifact G:/taki-post-reentry-DFgV2j/core.log] [run artifact G:/taki-post-reentry-EGnVTq/core.log] [run artifact G:/taki-post-reentry-jYzuQu/core.log]

Publication increments `assessed` only after `writer.run`, `refreshBank`, `writer.applied` and durable work completion. It can defer on a Pending writer result, failed application verification, or caught publication/refresh error. The whole-pass expiry path can also defer remaining saved results directly. The rows and roughly sixty-second target-to-settlement spans strongly support deadline exhaustion, but the generic `publication_pending` label does **not** preserve each caught exception. **The exact exception at the first interrupted command/refresh is UNKNOWN** without a finer trace. No evidence justifies attributing every pending item to a specific Native or queue error. [source packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:31] [source packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:45] [source packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:73] [inference]

P1-T's retained isolated measurement was 675 -> 15 Native-head reads and 3,758.7 -> 266.7 ms for fifteen assessment calls. The replay source manifests confirm that `DFgV2j` predates the tool change and that `EGnVTq`/`jYzuQu` have the same current tool-file hash. This supports the mechanism behind the much earlier first command after P1-T. It is **not** an isolated timing experiment for the entire replay: contention, preparation, Native work and refresh also vary. [source .trellis/tasks/08-09-memory-operations-ui/research/curator-stall-impl-20261107.md:42] [run artifact G:/taki-post-reentry-EGnVTq/replay-result.json, build.currentSource.taki.changedSource] [run artifact G:/taki-post-reentry-jYzuQu/replay-result.json, same field]

P1-N concerns an **earlier journey-6 response** that returned plain text instead of assessment tools. P1-P corrected the shared smoke provider to return assessments plus `policy_review_finish`. The replay imports that same provider. In all three supplied runs, the provider log contains ten `memory_policy_assess` calls plus finish, and the database proves those became valid saved results. Therefore **the earlier fixture defect is ruled out for these three policy failures**; real-model judgment quality is outside this controlled fixture. [source .trellis/tasks/08-09-memory-operations-ui/research/journey6-symptoms-diagnosis-20261107.md:195] [source .trellis/tasks/08-09-memory-operations-ui/research/provision-fence-impl-20261107.md:25] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/post-reentry-replay.mjs:20] [run artifact G:/taki-post-reentry-jYzuQu/replay-result.json, provider]

### Q4. Normal-user exposure and other quiesce callers

| Caller | Exposure and actual failure/recovery behavior |
| --- | --- |
| Home: chat, then Create backup within a minute | Reachable whenever remaining admitted maintenance exceeds the 30-second drain budget. Chat completion does not settle detached maintenance. The operation actually ends **failed**, with no capture artifact. Home already explains that memory processing has not finished and asks the user to click again later. There is no production automatic retry here. This is timing/workload dependent, not “every chat always fails.” [source packages/core/src/memory/operations/memory-operation-kind-backup.ts:47] [source apps/desktop/src/windows/home/pages/operations/memory-hindsight-backup-state.ts:36] |
| Automatic or pre-transition paired backup | No automatic paired-capture caller was found in current production code. The service's capture caller is the registered operator `backup.capture` kind. Healthy transitions create Native observation/proof data with backup-related types; that is not a backup archive. An operator/script deliberately invoking `backup.capture` before transition sees the same terminal failure and must handle it. [source packages/core/src/memory/operations/memory-operation-kind-backup-capture.ts:37] [source .trellis/spec/backend/memory-hindsight-backup.md:16] [source packages/core/src/memory/transitions/transition-template-observer.ts:19] |
| First Local -> Hindsight activation | Uses the same fence primitive on the **Local** runtime, with a 30-second quiesce, then settles Local maintenance/ingestion. It cannot be blocked by an already-selected Hindsight curator. Long Local work can cause `MEMORY_QUIESCENCE_TIMEOUT`; the attempt fails, and Local reopens only on positive predecessor-marker evidence. The operator can submit the supported continuation/new attempt; no automatic timeout retry loop exists. [source packages/core/src/memory/hindsight-activation/hindsight-activation-drain.ts:12] [source packages/core/src/memory/hindsight-activation/hindsight-activation-service.ts:155] [source packages/shared/src/memory-hindsight-operation-schema.ts:23] [source packages/core/src/memory/operations/memory-operation-kind-hindsight.ts:128] |
| Healthy Hindsight -> Local transition | Directly exposed to the same admitted Hindsight maintenance. It first drains `writeFence`, **then** quiesces `workFence` and pauses the scheduler. On a drain error it retires the old fences rather than reopening them as backup does. Execution tries a factual pre-COMMIT abort and source recovery; if that cannot be proven, it records `outcome_unknown` for explicit recovery. It does not silently retry the requested switch. [source packages/core/src/memory/transitions/transition-healthy-execution.ts:119] [source packages/core/src/memory/transitions/transition-runtime.ts:119] [source packages/core/src/memory/transitions/transition-healthy-execution.ts:75] [source packages/core/src/memory/transitions/transition-healthy-execution.ts:211] |
| Healthy Local -> Hindsight re-entry | Same healthy-driver 30-second drain policy, but against the Local runtime. Same abort/unknown recovery distinction; not the Hindsight curator's wait in these replays. [source packages/core/src/memory/transitions/transition-runtime.ts:123] |
| Template runtime `quiesce` | Different control method: retires the binding and awaits settlement, rather than calling this backup's 30-second write-fence drain. It should not be conflated with this failure signature. No template changes are proposed or made here. [source packages/core/src/memory/hindsight/template-lifecycle/template-runtime-control.ts:29] |

Legacy migration/authority promotion also have methods named `quiesce`, but use their own authority-fence API, not this selected Hindsight write-fence instance. Emergency withdrawal likewise has a separate retirement/quarantine path; this report does not claim to have newly exercised any transition or activation. [source packages/core/src/memory/legacy-migration/legacy-migration-runner.ts:71] [source packages/core/src/memory/hindsight/hindsight-authority-promotion-service.ts:16] [source packages/core/src/memory/transitions/transition-runtime.ts:82]

### Commands, provenance and verification limits

Read `CLAUDE.md`, backend index, task PRD/implementation context, performance/recovery records, relevant backup/runtime/activation/transition contracts and P1-N/P1-P/P1-T records. Used direct reads and focused `rg` for named symbols/callers. One semantic query was attempted with `jbcontext search`; it returned **`Error: Connection refused: getsockopt`**. It supplied no search evidence; direct source search was the fallback. Initial incorrect path/glob lookups and a malformed PowerShell range command were corrected; they were not treated as evidence of absence.

Reproducible core checks, all from `H:/TakiAgent`:

```powershell
$env:TEMP='G:/taki-codex-work/tmp-aa'
$env:TMP=$env:TEMP
git branch --show-current
git status --short | Measure-Object
git worktree list
rg -n '\.quiesce\(' packages/core/src apps/desktop/src --glob '!*.test.ts'
rg -n 'backup\.capture|HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT' packages/core/src apps/desktop/src --glob '!*.test.ts' --glob '!*.test.tsx'
```

An inline Node script parsed each replay's `backup.fenceEvents`, `backup.attempts`, `provider`, `chat`, and `build.currentSource`; it recomputed the table's millisecond differences and compared SHA-256 values to current source. Backup service and subsystem hashes matched all three manifests; the tool hash matched the later two. The unchanged fence, curator, lifetime, execution, model and Utility Slot files have no current Git diff and were absent from those changed-source lists under the same recorded HEAD. This is the retained source manifest's provenance, not a frozen copy of every historical runtime byte.

The diagnostic SQLite query can be rerun without opening writers:

```python
import json, sqlite3
from pathlib import Path
for replay in ('DFgV2j', 'EGnVTq', 'jYzuQu'):
    p = Path(f'G:/taki-post-reentry-{replay}/core-data/taki.db')
    with sqlite3.connect(p.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute('''
            SELECT w.work_kind, w.state, w.last_failure, w.created_at,
                   w.updated_at, w.finished_at,
                   CAST(w.result_bytes AS TEXT) AS saved_result,
                   j.state AS command_state, j.prepared_at,
                   j.dispatched_at, j.updated_at AS command_updated_at
            FROM hindsight_policy_work w
            LEFT JOIN hindsight_application_command_jobs j
              ON j.authority_epoch_id=w.authority_epoch_id
             AND j.bank_id=w.bank_id AND j.request_id=w.command_request_id
            WHERE w.created_at >= '2026-11-07' ORDER BY w.created_at
        ''')
        for row in rows:
            value = dict(row)
            result = json.loads(value.pop('saved_result') or 'null')
            value['result_kind'] = result['kind'] if result else None
            print(replay, value)
```

The first SQLite invocation omitted `uri=True` and failed to open; the corrected immutable read above succeeded. No database path was sandbox-inaccessible. WAL size was checked before using immutable reads. No credential files or raw saved Memory bodies are reproduced in this report.

Report validation confirmed UTF-8 without BOM, exactly six required top-level sections, no trailing whitespace, and existing source paths with valid, nonblank cited lines. Timestamp differences and saved-result counts were recomputed from the retained artifacts.

**No tests/typechecks/builds were run:** this is a report-only diagnosis, and the assignment prohibits new runtimes. Existing backup regression source models long detached maintenance, but its synthetic wait is not proof of this replay's internal timing. [source packages/core/src/memory/hindsight-backup/hindsight-backup-service.test.ts:63]

The three retained CPU profiles last only 60.249 / 60.596 / 60.227 seconds and start **before** the chat. Even using chat start as a conservative upper bound, the clean profile ends by `16:57:14.138`, before the `15.891-30.345` interval. `EGnVTq` profiling ends before chat completion. Consequently, neither these profiles nor the aggregate resource summaries can prove a call-stack breakdown of the disputed gap. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/post-reentry-replay.mjs:30] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/post-reentry-replay.mjs:252] [run artifact G:/taki-post-reentry-jYzuQu/replay-result.json, profile.durationMs]

## 4. Trade-offs — Q5 fix options and recommendation

These are options for the leader, not implementation authorization. **All direct fixes below are Taki code/contract costs. No upstream Hindsight design change is necessary to eliminate the alleged circular wait, because it is not present.** Native consolidation/extraction and catch-up still contribute real work and contention; changing those would be a separate investigation. [source packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts:141] [inference]

| Option | Smallest correct boundary and benefit | Cost / what it could break | Phase |
| --- | --- | --- | --- |
| **A. Keep the truthful refusal and explicit retry** | No code fix. Existing Home explanation and a new capture after actual drain preserve current semantics. A delayed operator backup would avoid this particular holder. | The first operation still fails; policy publication still runs out of budget. Scripts must handle failure explicitly. This is a workaround or an explicit deferral, not a repair. | Only as a leader-accepted deferral; record the failure in phase-1 acceptance. |
| **B. Remove redundant synchronous validation at the actual shared boundary; preserve currentness/publication checks** | Continue P1-T at the remaining pre-model/journal/Bank-lookup cost. Verify current identity once per appropriate synchronous operation, reuse already verified data within that operation, and retain checks after actual async boundaries and before publication. Measure the whole maintenance window first. | Taki implementation/design work across curator, journal and runtime validation. Unbounded caching or removing guards could miss template/authority/record changes. The exact minimal patch is **not yet proven** by the truncated profiles. A change inside `template-lifecycle/**` needs a separately assigned owner. Does not promise every real model/large library will finish within 30 seconds. | **Recommend phase 1** for the portion causing policy failure or unresponsive/unstable operation; residual speed-only work stays phase 2. |
| **C. Narrow backup write ownership to mutation/publication segments** | Let read-only/model proposal generation proceed outside the backup write fence; retain fencing for source acknowledgement, durable policy work changes, command dispatch and publication/refresh. Preserve deferred work and revalidate it before resumption. | Larger Taki lifetime change. Merely removing `maintenance` from `fenceHindsightWriters` is incorrect: unfenced journal/Native writes could race the Core/native pair. A short safe read-only phase may not remove the earlier ingestion delay. Transition retirement still needs to own all relevant work. | A separate phase-1 design only if first-click backup completion during slow models is required; otherwise phase 2. |
| **D. Retry within the backup operation only after a positively known pre-capture quiescence failure** | Bounded wait/drain and re-attempt before any Core copy/Native request could remove the extra user click while preserving exact failures and cancellation. | New Taki operation lifecycle/UX semantics; total latency remains, new work can arrive while reopened, and backup or transition failures cannot be indiscriminately retried. Waiting while continuing to hold the fence instead is effectively a larger budget. Does not fix curator deadline exhaustion. | Phase 3 UX after phase-1 correctness, unless leader explicitly promotes the behavior requirement. |
| **E. Increase the 30-second quiesce budget** | Very small Taki code/spec change, and it can succeed for finite admitted work. | Longer global write refusal and a longer failed-operation wait; no responsiveness or policy-lifetime repair. No finite number guarantees slow model/provider completion. The recovery plan explicitly preserves deadlines rather than enlarging them. Not recommended. | Requires an explicit contract decision; not an optimization fix. |

**Recommendation:** reject a deadlock patch, do not reorder scheduler/work-fence shutdown, and do not enlarge budgets. Keep the existing honest failed-backup/retry behavior while the leader assigns **B** as a bounded phase-1 performance-failure continuation. First extend observation through preparation, tools and publication/refresh in one permitted existing-harness run, then remove the proven redundant work at its owner. The current plan itself says timeouts, failures and unstable outcomes are phase-1 defects; P1-T deliberately left the pre-model path unchanged. A normal busy backup refusal alone is already an accepted contract, but the repeated incomplete policy pass is not evidence of successful maintenance. [source .trellis/tasks/08-09-memory-operations-ui/research/phase-plan-20261107.md:28] [source .trellis/tasks/08-09-memory-operations-ui/research/phase-plan-20261107.md:53] [source .trellis/tasks/08-09-memory-operations-ui/research/validation-recovery-plan-2026-11-06.md:38] [source .trellis/spec/backend/memory-hindsight-backup.md:87] [inference]

Moving `workFence.quiesce` or `scheduler.stop` ahead of write-owner drain could interrupt or refuse work that the admitted maintenance still needs. Skipping policy maintenance, declaring saved proposals assessed, or manufacturing a successful backup would change the requirement rather than solve this problem. No such changes were made. [source packages/core/src/memory/hindsight/hindsight-runtime-state.ts:107] [source packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:31]

## 5. Open items / UNKNOWN

- **UNKNOWN:** exact Core call stacks and CPU-versus-OS-scheduling allocation in the 14.5-second Native-silent interval. Current profile coverage is insufficient. The next authorized observation should span chat completion through fence drain, with timestamps at curator entry, slot entry, provider dispatch, tools complete, and publication/refresh completion; no prompt/body logging is needed.
- **UNKNOWN:** the precise caught exception for each `publication_pending` item, and the share of the first refresh delay attributable to an earlier Bank owner versus new catch-up work. Journal and command states establish the completed boundary, but do not encode those spans/errors separately.
- **UNKNOWN:** experimentally observed results with a longer backup budget or a backup delayed two minutes. The answers above are explicitly counterfactual; no such run was permitted here.
- **UNKNOWN:** frequency with real users, different libraries, model providers or simultaneous Characters. Three supplied replays were inspected; the assignment's fourth historical replay was not independently reanalyzed. No four-run universal failure rate is asserted.
- The exact smallest implementation for option B, independent design review and a full-span replay remain leader-owned future work. No production repair or manual acceptance is claimed.
- Resource disposition: no services/listeners were started, no database writer opened, and no resources need stopping. All short-lived inspection commands exited. The sibling Pending/scheduler files were not edited.

## 6. Anything outside scope noticed

- The first publication's Native completion can substantially precede local assessed completion: **29.790 seconds** in the clean replay. That refresh boundary, rather than model response alone, needs to be included in performance acceptance. It was investigated only enough to distinguish the reported counts; no scheduler/refresh changes were made. [run artifact G:/taki-post-reentry-jYzuQu/core-data/taki.db]
- Repeated template-selection reconstruction under Bank/currentness checks is already recorded as phase-2 work. It is reachable from the curator's synchronous checks as well. If the leader's follow-up finds it accounts for the policy timeout, that failing slice belongs with phase-1 work; changes under the excluded template boundary require a separate assignment. [source .trellis/tasks/08-09-memory-operations-ui/research/phase-plan-20261107.md:56] [source packages/core/src/memory/hindsight/hindsight-runtime-connection.ts:82]
- Native logs contain consolidation/dateparser and pool-delay observations. They are concurrent work, not evidence that backup acquired a Native lock: failed first attempts never reached Native backup capture. No upstream Hindsight changes are justified by the fence diagnosis alone. [run artifact G:/taki-post-reentry-jYzuQu/native.log] [source packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts:141]
