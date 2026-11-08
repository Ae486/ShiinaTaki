## 1. Outcome — done

**The three-minute failure is caused by the harness waiting for Pending settlement before triggering the synchronization that performs it. No missed due scheduler run or stuck lease is established.** `pending_memory.nextRetryAt` is retry eligibility, not an independently armed timer. The retained Global Bank’s next scheduled synchronization was **2026-11-07 01:13:02.305Z**, approximately six hours later. [source packages/core/src/db/pending-memory-repo.ts:98] [source packages/core/src/db/hindsight-replica-schedule-state.ts:43] [run artifact G:/taki-first-use-UctYDl/core-data/taki.db]

Artifact abbreviations below:

- **R:** `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T19-11-28.240Z/`
- **J17:** `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-05T18-51-25.420Z/`

**Q1. Recovery owner and trigger**

The production chain is:

`ReplicaScheduler → state.service.runner → Pending recovery → native proof + checkpoint confirmation → writes.advanceBank`

The subsystem wires and starts that scheduler. Its runner invokes Pending recovery; after recovery, `onRecovered` advances the durable parent write. [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:71] [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:96] [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:54] [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:147] [source packages/core/src/memory/hindsight/hindsight-runtime-state.ts:60]

The binding contracts state:

> “Trigger: a configured Global or Character Bank is due, receives an explicit incremental/full request, or needs verified startup/reconnection catch-up after an outage.”  
> [source .trellis/spec/backend/memory-replica-sync.md:93]

> “Ordinary polling defaults to six hours…”  
> [source .trellis/spec/backend/memory-replica-sync.md:122]

> “`createHindsightPendingRecoveryRunner(deps)` implements the existing scheduler runner’s `run`/`rebuild` interface. It reuses the replica runner, worker, lease and retry policy.”  
> [source .trellis/spec/backend/memory-replica-sync.md:272]

Consequently:

- **Scheduled sync or explicit Sync-now:** runs Pending recovery.
- **New foreground write:** invokes on-demand Bank recovery and can advance earlier Pending writes in that Bank. Its catch-up trigger bypasses row retry eligibility. [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:36] [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:89] [source packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:62]
- **Ordinary next chat/recall:** performs synchronization without Pending recovery; it is not a guaranteed settlement trigger. [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:65]
- **Restart/reconnection:** requests only eligible catch-up. With no scheduled retry and a future ordinary poll, restarting does not itself force this Pending row through recovery. [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:81]
- **Status polling:** reads state; it does not admit work. [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:154]

**Q2. Why nothing ran at 19:14:07**

The retained database contains:

| Field | Global Bank | Character Bank |
|---|---|---|
| `automatic` | `true` | `true` |
| `autoIntervalMs` | `21600000` | `21600000` |
| `lastSuccessAt` | `19:13:02.305Z` | `19:13:02.662Z` |
| `nextDueAt` | Nov 7 `01:13:02.305Z` | Nov 7 `01:13:02.662Z` |
| `retryDueAt` / `run` | `null` / `null` | `null` / `null` |
| `catchUpRequested` | `false` | `false` |
| `consecutiveFailures` | `0` | `0` |
| Retained lease expiry | `19:13:48.083Z` | `19:13:03.641Z` |

Both schedules were idle, version 4, without queued manual work or errors. The Pending row remained `submitted`, version 7, with `nextRetryAt=19:14:07.829Z`; its parent remained `pending`, revision 1. [run artifact G:/taki-first-use-UctYDl/core-data/taki.db, tables `hindsight_replica_sync_schedule`, `hindsight_replica_sync_leases`, `pending_memory`, `hindsight_memory_write_intents`]

Configuration was Hindsight enabled, endpoint `http://127.0.0.1:13903`, request timeout `10000`. Synchronization settings were persisted in the schedule rows. [run artifact G:/taki-first-use-UctYDl/core-data/taki.db, table `config`]

The foreground gateway invokes recovery directly and returns the durable Pending receipt for recognized Pending outcomes. It does **not** fail a scheduler-owned run, so it does not populate the scheduler’s separate `retryDueAt`. Scheduled execution populates that retry state through `repo.fail`. [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:35] [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:76] [source packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:78]

I evaluated the **actual production scheduling functions** against these read-only rows:

- At `19:14:07.829Z`: neither Bank due.
- At `19:16:10Z`: neither Bank due.
- At each Bank’s `01:13:02.xxxZ`: incremental interval run due.

Thus the observed quiet interval matches the scheduling policy. [source packages/core/src/db/hindsight-replica-schedule-state.ts:43] [source packages/core/src/db/hindsight-replica-schedule-state.ts:59]

Two supplied timeline premises need correction:

- There were **two** native-result GETs, including one around `19:13:18.7Z`; HTTP traffic continued until approximately `19:13:48Z`. The later GET’s response body/caller is not recorded. Source-binding synchronization also calls this endpoint without advancing Pending state, which is a plausible explanation—not proven request attribution. [run artifact R/native.log:893] [run artifact R/native.log:1322] [source packages/core/src/memory/hindsight/hindsight-application-source-binding.ts:50] [inference]
- J17 step 5 **did not demonstrate a completed retain**: its Main request lacked the `retain` tool, recorded no retain/native-result HTTP calls, and had zero completed Pending rows. Core logged `admission_unavailable`. Its 21 ms empty-queue check is not a settlement benchmark. [run artifact J17/result.json, step 5 `providerRequests`, `nativeCalls`, `observed.pending`] [run artifact J17/core-1.log:30]

**Q3. Product defect or intended behavior**

This is **intended scheduling behavior plus a defective harness expectation**. The PRD requires durable writes, ordinary recovery, observable manual/automatic synchronization, and recovery without silent loss or duplicate application; it does not specify a three-minute foreground Pending settlement deadline. [source .trellis/tasks/08-09-memory-operations-ui/prd.md:10] [source .trellis/tasks/08-09-memory-operations-ui/prd.md:21]

Six-hour confirmation latency for an otherwise successful foreground write remains a **usability limitation**. Whether that delay is acceptable needs a leader/product decision; this diagnosis does not establish user acceptance or a requirement for a new timer. [inference]

The deadline-independent receipt change preserves truthful Pending after bounded recovery. It does not introduce background settlement. The real-model harness already accommodates this by explicitly submitting incremental Sync-now and recording intermediate failures separately. [source .trellis/spec/backend/hindsight-application-runtime.md:154] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/real-model-memory.mjs:285]

**Q4. Smallest correction and F2 overlap**

No production correction is justified by the demonstrated scheduling behavior. The smallest correction is confined to:

`.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs`

Correct `stepCaptureAndSync`’s drain ordering and its settlement observation. It currently waits at line 257 before submitting synchronization at line 264. **This correction overlaps none of the six F2-owned production files.** [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:249]

Relevant existing coverage, inspected but not run:

- Scheduler interval rearming/manual-only behavior: `hindsight-replica-scheduler.test.ts:94`.
- Scheduled retry precedence, manual bypass, restart catch-up: same file, lines 181, 202, 213.
- Durable Pending readback and recovery using the original identity: `hindsight-memory-write-deadline.test.ts:32`.
- Lost acknowledgements and persisted parent recovery: `hindsight-memory-writes.test.ts:117`, `:130`.
- Real connected acceptance: corrected step 5 must prove the original parent and child complete with the expected replica effects. `retainedWrite(..., true)` already provides those assertions. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:151]

**Q5. Exact honest harness change**

1. Preserve `retainedChat` and `retainedWrite`’s original request/Bank/epoch identity checks.
2. Before waiting for drain, submit registered `{kind:"replica.sync", bankId, syncKind:"incremental"}` for Banks with unresolved child/parent writes.
3. Record every operation’s actual terminal state. Within the existing bounded observation window, retry only explicit transient outcomes—following the real-model harness’s handling of `HINDSIGHT_PENDING_REMAINS`, `HINDSIGHT_REPLICA_BUSY`, and `HINDSIGHT_TIMEOUT`. Never relabel these attempts successful.
4. Require available, nonempty summaries; reject failed/unknown Pending outcomes. Require zero Pending and parent writes, then call `retainedWrite(ctx, run, true)`.
5. Continue the existing incremental/full synchronization and second-connection assertions.

[source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/real-model-memory.mjs:163] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/real-model-memory.mjs:285] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:268]

Label this evidence **manual Sync-now settlement**. Automatic settlement needs a separate observation: reuse the existing 60-second configured-interval scenario, require an attributable scheduler run, and verify the original Pending write completes without manual sync. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:295]

## 2. Changes

None. No files, task state, database state, services, or Git state were modified.

## 3. Evidence and checks run

- Read project law, assigned task context, relevant backend contracts, recovery/scheduler code, and both journey artifacts.
- Ran one focused `jbcontext search`, followed by direct source inspection.
- Used Node **v24.18.0**, verified installed `node:sqlite` typings, and opened the retained database exclusively with `new DatabaseSync(path, {readOnly:true})`.
- Ran a stdin Node script importing `replicaScheduleDue` and `replicaNextWake`; results are listed under Q2.
- Compared current SHA-256 values with R’s recorded source hashes: writes gateway, runtime state, Bank service, Pending recovery runner, and scheduler all matched. The schedule-policy and subsystem files were unchanged in Git.
- No Vitest or live service journey was run. No Core, Native, or PG process was started; nothing requires cleanup.

## 4. Trade-offs

- Existing scheduling minimizes background synchronization work but permits nearly six hours of confirmation delay after a foreground Pending result.
- Explicit Sync-now makes the journey bounded and exercises the supported recovery path; it **does not prove autonomous settlement**.
- Pending confirmation must retain original native proof and checkpoint requirements. Native completion alone cannot justify marking the row completed. [source .trellis/spec/backend/memory-native-result-recovery.md:34]

## 5. Open items / UNKNOWN

- The harness correction and connected rerun remain unperformed: this assignment was read-only.
- Actual settlement of `6481d940-…` after explicit sync or the six-hour poll is **UNKNOWN**; neither was executed against the retained instance.
- Exact caller and response payload of the later native-result GET are **UNKNOWN**.
- Whether the six-hour foreground confirmation delay satisfies the desired UX is a leader decision.

## 6. Outside scope noticed

The current generic `waitPendingDrained` accepts an empty summary array and ignores failed/unknown child counts. Step 5’s final identity assertion offers additional protection, but other callers can mistake those summaries for successful drain. This should be addressed within the proposed harness correction; it was not changed here. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:286]