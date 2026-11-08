# First-use pending drain diagnosis — 2026-10-30

## Result and scope

The two reported failures are fixture sequencing/contract errors, not evidence of a permanently held lease or a broken automatic recovery worker. The settings step deliberately leaves the Global Bank in manual mode. Waiting for all Pending Memory to drain before requesting its manual synchronization removes the trigger needed to recover it. The earlier immediate manual request instead collided with an on-demand runtime lease. [log A/result.json:1453,3135; log B/result.json:1453,2866; read-only extraction E1 below; inference]

Applied a fixture-only correction: wait for each target Bank's live lease to expire/release, then submit the existing one explicit incremental sync. No product code, retry loop, timeout value, configuration, fault injection or previous template-backup fix changed. This fixes the observed admission/wait dependency; it does **not** establish that one sync always completes an asynchronous retain. That separate acceptance limitation is explicit in question 4.

Sources below are repository-relative. Log aliases:
- `A`: `research/first-use-runtime/results/2026-10-30T06-18-01.502Z`.
- `B`: `research/first-use-runtime/results/2026-10-30T06-28-53.231Z`.
- `research/` is under `.trellis/tasks/08-09-memory-operations-ui/`.
- `C/`: `packages/core/src/`.
- `F/`: `research/first-use-runtime/`.
- `E1` is the actual read-only SQLite extraction below, not a live service observation.
All SQLite times are UTC; Native's formatted log timestamps are UTC+08:00.

## 1. What holds the replica busy, and for how long?

1. The failed Global manual request was created at **06:26:05.986Z**, failed at **06:26:06.002Z**, and has **claim=null**. It never acquired a scheduler run. The request is durably failed with `HINDSIGHT_REPLICA_BUSY / explicit_retry_required`; it is not a request left holding the lease. [E1, `manual`]
2. The retained Global lease belongs to **`hindsight-runtime:4c2931f0-fb2e-46e4-a5ae-be76757004ec`**, fence **52**, with final expiry **06:26:06.087Z**. Scheduled owners instead use `hindsight:<epochId>`. Acquisition rejects a still-live lease; the failed acquisition rolls back before recording the manual claim. The scheduler catches this and records that exact request's failure. [E1, A Global `lease`; source C/memory/hindsight/hindsight-memory-subsystem.ts:72; C/db/hindsight-replica-lease-repo.ts:42; C/db/hindsight-replica-scheduler-repo.ts:117; C/memory/hindsight/hindsight-replica-scheduler.ts:183]
3. **Inference:** an on-demand runtime Bank operation, not a scheduled run or the failed manual request, held the Bank at the collision. The persisted final lease was already released/expired **85 ms after** the failed request's settlement. Release writes the current time to `expires_at`; it does not delete the row. A retained lease row is therefore not itself evidence of a live lock. [source C/db/hindsight-replica-lease-repo.ts:27; E1]
4. **UNKNOWN:** the precise acquire time, exact runtime caller (capture/recall/curator/write recovery), and exact fault-clear timestamp were not captured at the collision boundary. The final lease is not a historical lease audit. Native logs show continuing application-state I/O around 14:26:00–14:26:06, but cannot identify the JS caller. Do not assert that the outage retain itself owned the colliding lease. [log A/native.log:4414,4419,4427,4432; inference]
5. Runtime on-demand owners are created in the Bank service. Bounded write recovery uses its remaining request budget plus 1 second for the lease and releases it in `finally`. Foreground reads can renew only the same live token as successive HTTP calls progress; their overall duration is not the scheduler's 60-second bound. Core's request default is 10,000 ms. The scheduler independently defaults to a **60-second run / 61-second lease**. [source C/memory/hindsight/hindsight-runtime-bank-service.ts:37,74,81,93,99; C/config/knob-registry.ts:191; C/memory/hindsight/hindsight-replica-scheduler.ts:69; spec .trellis/spec/backend/hindsight-application-runtime.md:77,168,172; .trellis/spec/backend/memory-replica-sync.md:173]
6. In B the final Global lease expiry is **06:36:34.644Z**, while Core shuts down at **06:39:18.396Z**: the wait continued over **163 seconds after that expiry**, with no later lease acquisition preserved. All schedule rows have `run=null`; no queued manual request remains. A never-released lease does not explain B. [E1; log B/core-1.log:58]

## 2. What recovery does the contract actually promise?

- The first-use PRD requires bounded-outage durability/recovery without loss or duplicate application; it does not specify immediate recovery independently of selected synchronization mode. [source .trellis/tasks/08-09-memory-operations-ui/prd.md:23-24]
- Ordinary automatic polling defaults to **6 hours**; full reconciliation to **7 days**. Valid configured intervals start at 1 minute. Automatic scheduler retry delays are **1 minute, 5 minutes, 15 minutes, 1 hour, then 6 hours**. A pending retry suppresses interval wakes. **Manual mode schedules no background due or retry wake.** [spec .trellis/spec/backend/memory-replica-sync.md:122-129]
- Startup and verified reconnect request eligible catch-up. Reconnect has specific callers: successful `connection.revalidate`, or successful foreground capture while an automatic Bank is already in availability backoff. Clearing the fixture's 503 flag and reading status are neither trigger. [spec .trellis/spec/backend/memory-replica-sync.md:152-156; source C/memory/hindsight/hindsight-memory-subsystem.ts:112; C/db/hindsight-replica-scheduler-repo.ts:82; F/native-fault.mjs:30]
- An explicit `replica.sync` queues one manual scheduler request and awaits its exact durable outcome. It is not a wait-until-converged API. Manual failure exposes `explicit_retry_required`; nothing retries itself in manual mode. [spec .trellis/spec/backend/memory-operations.md:73-76,168; source C/memory/operations/memory-operation-kind-replica.ts:31,42,99]
- A normal write first durably admits its intent and invokes bounded on-demand recovery. Scheduled recovery subsequently uses the same Pending runner and advances parent write records. A foreground **read synchronization** alone calls the pull path, not Pending replay. [source C/memory/hindsight/hindsight-memory-writes.ts:33; C/memory/hindsight/hindsight-runtime-state.ts:55-66; C/memory/hindsight/hindsight-runtime-bank-service.ts:65-67,90,145-161]
- The row's `nextRetryAt` is an eligibility timestamp, **not a separately armed timer**. Claims check it; the existing Bank scheduler chooses the wake. Manual/catch-up claims may bypass row backoff. [source C/db/pending-memory-transition.ts:78; C/db/pending-memory-repo.ts:93-105; C/db/hindsight-replica-schedule-state.ts:43-65; C/memory/hindsight/hindsight-pending-recovery-runner.ts:62]
- Tracked recovery requires authenticated first pull, original frozen dispatch, verified native factual proof, and matching second-pull checkpoint. Only verified tracked `receipt_not_found` in the same identity/generation authorizes resending that frozen request. Legacy missing operations must retain uncertainty. [spec .trellis/spec/backend/memory-native-result-recovery.md:34-45; source C/memory/hindsight/hindsight-pending-native-result.ts:35-60,80]

## 3. Why did the writes not drain?

**Fixture wrong for the configured contract.** [inference from the following sources]

- Both settings-step records show Global `automatic=false`, `autoIntervalMs=1020000` (17 minutes), full interval 3 days. The interval has no automatic effect when disabled. In B its `nextDueAt` and `retryDueAt` are null; its last scheduled attempt is **06:31:40.129Z**, before the outage retain at **06:36:09.186Z**. [log A/result.json:1453; B/result.json:1453; E1; source F/native-smoke.mjs:409]
- Character Banks remain automatic at **21,600,000 ms**. In B their next scheduled pulls are **12:31:36.622Z** and **12:31:49.230Z**, almost six hours away. Neither has an outstanding scheduler retry. A 180-second observation cannot make those runs due. [E1]
- B's actual outage write is sequence 3, Global, `tracked_native_v1 / submitted`, `attempts=1`, `HINDSIGHT_UNREACHABLE`, no native acknowledgement, and row retry eligibility **06:37:12.117Z**. It stays unchanged through shutdown. This is retained recoverable work whose next recovery was never requested, not an `outcome_unknown` refusal or the earlier legacy derived-fence bug. [E1; source C/memory/hindsight/hindsight-pending-native-result.ts:42; C/memory/hindsight/hindsight-pending-recovery-runner.ts:144]
- The all-Bank drain also includes an **older mika ingestion row**, sequence 2, from **06:33:07.581Z**. In B it is queued under an old expired claim; in A it had reached submitted. It is not the 503'd retain. A later valid lease can claim it; the repo does not treat the row's old lease as a permanent lock. [E1; source C/db/pending-memory-repo.ts:93-105]
- Global sequence 1's native child has completed, but all three parent intents are still pending. Child factual completion and parent completion are distinct. The all-Bank predicate requires both. Recovery advances those parents; a pure status read cannot do so. [E1 `parent_states`; source F/native-smoke.mjs:193; C/memory/hindsight/hindsight-runtime-bank-service.ts:157; C/memory/hindsight/hindsight-memory-write-retain.ts:16-41]
- No evidence supports resetting leases, enabling an undocumented immediate retry, reclassifying unknown writes, or changing the supported-build gate again. Preserve the existing template-backup fix. [inference; source C/memory/hindsight/hindsight-pending-recovery-runner.ts:144]

## 4. Fix, limits and unified diff

**Applied smallest correction to the demonstrated dependency error:** retain manual settings, wait read-only on the *actual target Bank lease*, then submit the original one manual sync. Use the existing 180,000 ms pre-sync budget across the Bank loop and the existing 500 ms observation cadence. Record per-Bank lease wait duration. Keep every operation failure and the final pending/parent drain assertion.

**Acceptance limitation / concrete blocker to claiming full recovery:** Native tracked retain calls `submit_async_retain` and returns its current status. One recovery pass can therefore legitimately report `HINDSIGHT_PENDING_REMAINS` before factual proof exists. Manual mode then needs another explicit recovery action; waiting alone still cannot complete it. [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:2361-2374; C/memory/hindsight/hindsight-pending-native-result.ts:60; spec .trellis/spec/backend/memory-operations.md:168]

This patch does not suppress that result or add the prohibited retry. The original single-pass `operation.state === "completed"` assertion remains visible and may expose that separate contract mismatch on the leader's run. Consequently **the reported dead wait is corrected, but guaranteed end-to-end convergence is not claimed**. Completing an automatic-recovery acceptance scenario would require an explicitly automatic fixture configuration and a budget consistent with its existing backoff, or a manual scenario exercising explicit continuation; neither has been smuggled into this fix. The current no-added-retry constraint and no-runtime constraint prevent claiming those outcomes here.

The diff is relative to the working file at dispatch, including the leader's pre-sync drain wait, not Git HEAD (the fixture was already untracked):

```diff
--- a/.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs
+++ b/.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs
@@ -291,15 +291,27 @@
     check(observed.rejectedWrites > 0, "fault never reached a Native write");
     check(status.pending.some((bank) => bank.summary.pendingCount > 0), "no durable pending write was observed", status.pending);
   } finally { ctx.fault.interrupt(false); }
-  // Replica sync is single-flight: let the owned background recovery drain before the explicit sync.
-  observed.recoveryWaitMs = await waitPendingDrained(ctx.operator, 180_000);
-  const status = await authority(ctx.operator);
-  observed.recovery = [];
-  for (const bank of status.replica) {
-    const operation = await submit(ctx.operator, { kind: "replica.sync", bankId: bank.bankId, syncKind: "incremental" });
-    observed.recovery.push(brief(operation));
-    check(operation.state === "completed", "pending recovery sync failed", brief(operation));
-  }
+  const status = await authority(ctx.operator);
+  observed.recovery = [];
+  // The settings step leaves Global manual-only. Wait for its current owner, not for writes that need this sync.
+  const leaseDeadline = Date.now() + 180_000;
+  const db = new DatabaseSync(join(ctx.coreOptions.dataDir, "taki.db"), { readOnly: true });
+  try {
+    const readLease = db.prepare("SELECT bank_id, run_id, owner_id, fence, expires_at FROM hindsight_replica_sync_leases WHERE bank_id = ?");
+    for (const bank of status.replica) {
+      const started = Date.now();
+      for (;;) {
+        const lease = readLease.get(bank.bankId);
+        if (!lease || Date.parse(lease.expires_at) <= Date.now()) break;
+        check(Date.now() < leaseDeadline, "replica Bank lease did not release", lease);
+        await sleep(500);
+      }
+      const leaseWaitMs = Date.now() - started;
+      const operation = await submit(ctx.operator, { kind: "replica.sync", bankId: bank.bankId, syncKind: "incremental" });
+      observed.recovery.push({ ...brief(operation), leaseWaitMs });
+      check(operation.state === "completed", "pending recovery sync failed", brief(operation));
+    }
+  } finally { db.close(); }
   await waitPendingDrained(ctx.operator, 180_000);
   observed.pendingAfter = (await authority(ctx.operator)).pending;
   check((await authority(ctx.operator)).authority.mode === "hindsight", "outage changed authority");
```

## Checks and actual output

- Required initial reads: `CLAUDE.md`, `CONTEXT.md`, task `prd.md` and `implement.md`; then backend recovery/scheduler/operation contracts and actual callers.
- Environment: `H:/TakiAgent`, branch `main`, HEAD `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`; Node **v24.18.0**, pnpm **10.22.0**. Existing broad dirty tree retained. Session task readback resolves the task requested by the owner.
- Used `diagnose`, `trellis-before-dev` and `trellis-check` guidance. Diagnosis feedback was retained SQL/log comparison; a fresh runtime reproduction is prohibited here. No new spec contract is needed: existing specs already describe manual mode.
- `pnpm -C packages/core exec tsc --noEmit`:

```text
stdout/stderr: (empty)
exit_code: 0
```

- **No Vitest run / no regression test:** this is a research fixture change, not a product fix. No test batches, lint batches, Native/Core/PG/browser startup, Git mutation, real credentials or paid calls.
- TypeScript checking covers Core, **not this .mjs journey's runtime behavior**. The leader must run the journey. Neither the initial failure nor future Native convergence has been re-executed here.
- SQLite opened only with Python `sqlite3.connect("file:"+root+"/core-data/taki.db?mode=ro", uri=True)`; connections closed after SELECTs. Both retained roots are the disposable roots recorded by the corresponding `result.json`.

E1 — actual extraction output (selected scheduling/Pending/lease/manual-request fields; payloads omitted):

```text
2026-10-30T06-18-01.502Z
read_only=URI mode=ro
schedule {"bankId": "taki-hs-v1-c-2c71a10de80033b01b878d32939bdbfe", "automatic": true, "autoIntervalMs": 21600000, "run": null, "pendingManualRequestId": null, "retryDueAt": null, "nextDueAt": "2026-10-30T12:21:02.058Z", "lastAttemptAt": "2026-10-30T06:20:57.069Z", "lastSuccessAt": "2026-10-30T06:21:02.058Z"}
schedule {"bankId": "taki-hs-v1-c-d60b8f9887b9060b6c4bf519d7c87b71", "automatic": true, "autoIntervalMs": 21600000, "run": null, "pendingManualRequestId": null, "retryDueAt": null, "nextDueAt": "2026-10-30T12:20:49.397Z", "lastAttemptAt": "2026-10-30T06:20:48.070Z", "lastSuccessAt": "2026-10-30T06:20:49.397Z"}
schedule {"bankId": "taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "automatic": false, "autoIntervalMs": 1020000, "run": null, "pendingManualRequestId": null, "retryDueAt": null, "nextDueAt": null, "lastAttemptAt": "2026-10-30T06:20:53.053Z", "lastSuccessAt": "2026-10-30T06:20:54.280Z"}
pending {"sequence": 1, "bankId": "taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "protocol": "tracked_native_v1", "phase": "completed", "attempts": 2, "updatedAt": "2026-10-30T06:26:01.602Z", "nextRetryAt": null, "diagnosticCode": null, "remoteOperationId": "2045ca62-f4b3-5181-a68a-1819bed5beae"}
pending {"sequence": 2, "bankId": "taki-hs-v1-c-2c71a10de80033b01b878d32939bdbfe", "protocol": "tracked_native_v1", "phase": "submitted", "attempts": 1, "updatedAt": "2026-10-30T06:22:04.464Z", "nextRetryAt": null, "diagnosticCode": null, "remoteOperationId": "6ca0234a-fea7-59e0-865c-7b39a54fccd8"}
pending {"sequence": 3, "bankId": "taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "protocol": "tracked_native_v1", "phase": "submitted", "attempts": 1, "updatedAt": "2026-10-30T06:25:59.473Z", "nextRetryAt": "2026-10-30T06:26:59.473Z", "diagnosticCode": "HINDSIGHT_UNREACHABLE", "remoteOperationId": "c0c8477f-be21-5b75-86e8-912a5d061250"}
lease ["taki-hs-v1-c-2c71a10de80033b01b878d32939bdbfe", "hindsight-runtime:4c2931f0-fb2e-46e4-a5ae-be76757004ec", 28, "2026-10-30T06:24:58.371Z"]
lease ["taki-hs-v1-c-d60b8f9887b9060b6c4bf519d7c87b71", "hindsight-runtime:4c2931f0-fb2e-46e4-a5ae-be76757004ec", 6, "2026-10-30T06:25:32.318Z"]
lease ["taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "hindsight-runtime:4c2931f0-fb2e-46e4-a5ae-be76757004ec", 52, "2026-10-30T06:26:06.087Z"]
manual {"bankId": "taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "claim": null, "createdAt": "2026-10-30T06:26:05.986Z", "errorCode": "HINDSIGHT_REPLICA_BUSY", "kind": "incremental", "lastSuccessAt": "2026-10-30T06:20:54.280Z", "nextAction": "explicit_retry_required", "requestId": "dbc72891-dbae-4fe4-a8f2-9147c72f4fa5", "settledAt": "2026-10-30T06:26:06.002Z", "state": "failed"}
parent_states [('pending', 3)]
2026-10-30T06-28-53.231Z
read_only=URI mode=ro
schedule {"bankId": "taki-hs-v1-c-2c71a10de80033b01b878d32939bdbfe", "automatic": true, "autoIntervalMs": 21600000, "run": null, "pendingManualRequestId": null, "retryDueAt": null, "nextDueAt": "2026-10-30T12:31:49.230Z", "lastAttemptAt": "2026-10-30T06:31:44.266Z", "lastSuccessAt": "2026-10-30T06:31:49.230Z"}
schedule {"bankId": "taki-hs-v1-c-d60b8f9887b9060b6c4bf519d7c87b71", "automatic": true, "autoIntervalMs": 21600000, "run": null, "pendingManualRequestId": null, "retryDueAt": null, "nextDueAt": "2026-10-30T12:31:36.622Z", "lastAttemptAt": "2026-10-30T06:31:35.369Z", "lastSuccessAt": "2026-10-30T06:31:36.622Z"}
schedule {"bankId": "taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "automatic": false, "autoIntervalMs": 1020000, "run": null, "pendingManualRequestId": null, "retryDueAt": null, "nextDueAt": null, "lastAttemptAt": "2026-10-30T06:31:40.129Z", "lastSuccessAt": "2026-10-30T06:31:41.310Z"}
pending {"sequence": 1, "bankId": "taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "protocol": "tracked_native_v1", "phase": "completed", "attempts": 2, "updatedAt": "2026-10-30T06:36:14.172Z", "nextRetryAt": null, "diagnosticCode": null, "remoteOperationId": "efb55679-b58d-5c3d-86d6-77c0c9215c21"}
pending {"sequence": 2, "bankId": "taki-hs-v1-c-2c71a10de80033b01b878d32939bdbfe", "protocol": null, "phase": "queued", "attempts": 1, "updatedAt": "2026-10-30T06:33:09.014Z", "nextRetryAt": null, "diagnosticCode": null, "remoteOperationId": "e0f5c31a-d893-5d43-836b-06711e3fa4b2"}
pending {"sequence": 3, "bankId": "taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "protocol": "tracked_native_v1", "phase": "submitted", "attempts": 1, "updatedAt": "2026-10-30T06:36:12.117Z", "nextRetryAt": "2026-10-30T06:37:12.117Z", "diagnosticCode": "HINDSIGHT_UNREACHABLE", "remoteOperationId": "b162a75e-f5f5-5eb9-9c7d-4feb2e891bcf"}
lease ["taki-hs-v1-c-2c71a10de80033b01b878d32939bdbfe", "hindsight-runtime:3c549b0f-f835-4880-acca-4be5307a40be", 28, "2026-10-30T06:35:23.082Z"]
lease ["taki-hs-v1-c-d60b8f9887b9060b6c4bf519d7c87b71", "hindsight-runtime:3c549b0f-f835-4880-acca-4be5307a40be", 6, "2026-10-30T06:35:43.331Z"]
lease ["taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633", "hindsight-runtime:3c549b0f-f835-4880-acca-4be5307a40be", 57, "2026-10-30T06:36:34.644Z"]
parent_states [('pending', 3)]
```

The readback selects `state_json` from `hindsight_replica_sync_schedule`, `pending_memory`, and `hindsight_replica_manual_requests`; lease columns from `hindsight_replica_sync_leases`; and `state,count(*) GROUP BY state` from `hindsight_memory_write_intents`. The named table fields and identities above make the readback reproducible against those two retained databases.

## Files and trade-offs

Changed only:
1. `research/first-use-runtime/native-smoke.mjs`: `stepPending` lease readiness observation.
2. `research/first-use-pending-drain-2026-10-30.md`: this report.

Trade-offs:
- The fixture now knows the existing lease-table shape and reads the isolated SQLite directly. This is already an accepted fixture evidence pattern; it adds no production API or second writer.
- Observing lease release is not reserving the Bank. A new runtime owner may still acquire it before the manual request; the real claim remains authoritative and a new busy result remains a visible failure. No guards are weakened and no retry conceals that race.
- Expiry is observed rather than forced. A genuinely non-settling owner still fails within the original bound with its exact lease details.
- Automatic mode/interval settings remain as exercised by Home; restart/settings evidence is not altered just to make the wait pass.
- This corrects the absent recovery trigger without turning native acceptance into factual completion. Async incompleteness, parent-write incompleteness, and earlier mika work remain observable; one successful partial action is not overall recovery acceptance.
- The exact caller/acquisition history at the first busy boundary is unavailable; owner classification and release timing are explicitly bounded by retained evidence.

