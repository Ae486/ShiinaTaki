# First post-activation chat: application Bank unavailable

Date: 2026-10-30. Existing task: `.trellis/tasks/08-09-memory-operations-ui`.
Investigation and fix are limited to the retained failure; runtime lifecycle remains with the leader. [inference: scope from the current task instruction]

## Citation convention

All paths below are repository-relative unless absolute. `S/` means `packages/core/src/`;
`T/` means `.trellis/tasks/08-09-memory-operations-ui/`; `R/` means
`T/research/first-use-runtime/results/2026-10-29T14-28-36.047Z/`.
A tag such as `[S/memory/hindsight/hindsight-runtime-view.ts:24]` identifies a source file and line. `[log V1:1-3]` identifies the numbered
lines of the named verbatim/excerpted check block in this report. Historical call-site attribution is
explicitly marked inference where the retained log has no stack. [inference: report notation]

## Finding and classification

**Product defect in partial Run admission.** The application capability manifest is saved before the
first application snapshot and Bank binding finish. The old partial-admission decision checked only
that manifest, then attempted prompt projection even if a routed Bank had no application checkpoint
or still had its first `binding_missing` head. The projection correctly refused with
`HINDSIGHT_APPLICATION_BANK_UNAVAILABLE`. [S/memory/hindsight/hindsight-application-sync-runner.ts:118-133]
[S/memory/hindsight/hindsight-runtime-state.ts:49-53]
[S/memory/hindsight/hindsight-memory-provider-context.ts:65-81]
[S/memory/hindsight/hindsight-memory-runtime.ts:62-69]
[S/memory/hindsight/hindsight-runtime-view.ts:20-24]
[inference: old admission condition is preserved in the unified diff below]

The retained synthetic database corroborates the specific missing-Character phase: two verified v1
setup Banks, one capability admission, only the Global application checkpoint and a bound Global
Bank head. This is a **post-run** observation, not an atomic snapshot at the instant of the exception.
[log D1:1-6] [inference: timing limitation]

This is not a missing native Bank or a required-v2-action fixture defect. Native PUTs for both Banks
succeeded, setup recorded both verified, and activation completed. The current legacy path expressly
allows v1 without an application checkpoint or managed-template enrollment. The v2 action remains
later in this fixture and does not gate the first application Bank binding. [R/native.log:190]
[R/native.log:217] [R/result.json:903-933] [R/result.json:984-1008]
[S/memory/hindsight/template-lifecycle/template-runtime-selection.ts:19-26]
[S/memory/hindsight/template-lifecycle/template-runtime-selection.ts:45-59]
[S/memory/hindsight/hindsight-application-binding-runner.ts:47-55]
[T/research/first-use-runtime/native-smoke.mjs:388-403]

## Evidence and hypotheses

| Hypothesis | Discriminating evidence | Decision |
| --- | --- | --- |
| Capability admission was mistaken for Bank readiness | Both syncs were still `deferred` at chat failure; admission precedes snapshots; the deterministic cold test reproduces the exact error. [R/core-1.log:28-30] [S/memory/hindsight/hindsight-application-sync-runner.ts:118-121] [log V2:1-8] | Confirmed product cause. [inference] |
| The journey skipped required explicit v2 application | v1 has an intentional untracked runtime branch; first Bank binding precedes the optional selected-template label lookup. [S/memory/hindsight/template-lifecycle/template-runtime-selection.ts:19-26] [S/memory/hindsight/hindsight-application-binding-runner.ts:47-55] [S/memory/hindsight/hindsight-application-binding-runner.ts:98-101] | Not the cause of this failure; no fixture sequencing change. [inference] |
| Bank provisioning/authentication failed | Both native Bank PUTs returned 200; activation reports no blockers; Global application initialize/snapshot/commits returned 200. [R/native.log:190] [R/native.log:217] [R/native.log:292-293] [R/native.log:347] [R/result.json:990-1008] | Contradicted for the observed setup and Bank requests. [inference] |

The relevant first chat is the first **Hindsight** chat. A Local retain chat already succeeded at
step 2. Failed step 5 has no model-provider requests; `provider-requests.json` contains the earlier
Local main calls and Local utility work. [R/result.json:793-817] [R/result.json:1104-1115]
[R/result.json:1163] [R/provider-requests.json:4-7] [R/provider-requests.json:73]
[R/provider-requests.json:80-112]

## Complete control/data flow

1. **Operator activation enters the existing producer.** The fixture completes setup, then
   `hindsight.activate`, then immediately calls `chat.send` in capture/sync step 5. The registered
   activation kind invokes `service.start`/resume; the successful retained operation is
   `6125fd8b-5f64-4a8b-bb41-af3e8be6359e`. [T/research/first-use-runtime/native-smoke.mjs:388-390]
   [T/research/first-use-runtime/native-smoke.mjs:154-159]
   [S/memory/operations/memory-operation-kind-hindsight.ts:100-113] [R/result.json:984-998]

2. **Activation transfers and verifies Local state.** It drains/fences Local, captures current coverage,
   and runs each Bank through baseline, preparation, import and verification. Promotion collects
   verified **native/B5** replica checkpoints and template digests. These are not D77 application Bank
   bindings. [S/memory/hindsight-activation/hindsight-activation-service.ts:132-149]
   [S/memory/hindsight-activation/hindsight-activation-service.ts:171-185]
   [S/memory/hindsight-activation/hindsight-activation-chain.ts:63-93]
   [S/memory/hindsight-activation/hindsight-activation-chain.ts:104-124]

3. **Authority publication is durable, followed by runtime publication.** Promotion invokes
   `promoteHindsightAuthority` with custody carry; Local is retired, then `bindHindsight` installs
   the Hindsight runtime. The binding's publish function constructs and installs a subsystem.
   The activation availability result refers to this published runtime, not a completed chat-time
   application synchronization. [S/memory/hindsight-activation/hindsight-activation-chain.ts:119-128]
   [S/memory/hindsight-activation/hindsight-activation-service.ts:147-168]
   [S/memory/hindsight-activation/hindsight-activation-service.ts:118-121]
   [S/memory/hindsight-runtime-binding.ts:73-80] [inference: distinction between publication and per-Run readiness]

4. **Recorded activation succeeded.** At 2026-10-29T14:30:49.401Z, the receipt selects Hindsight epoch
   `154bd3b9-3074-4e72-b5ee-5a52b687b9f3` under lineage
   `4a62e188-23b2-400c-bb72-ca189fe8f102`. Core logs the authority activation; the result records
   `runtimeAvailable: true`. [R/result.json:994-1017] [R/core-1.log:26]

5. **First chat must capture memory before ACK and model execution.** `chat.send` calls
   `runs.admit`; that captures a Run snapshot before durable Run admission. Snapshot capture awaits
   `memory.captureRun(characterId, signal)`. The subsystem initializes the source baseline and
   delegates to foreground capture when connection drift is `none`.
   [S/server/methods/chat-send.ts:47-74] [S/harness/run-service.ts:73-83]
   [S/harness/run-snapshot-capture.ts:61-67]
   [S/memory/hindsight/hindsight-memory-subsystem.ts:89-94]

6. **Route resolution is B3 setup-based.** Verified setup rows become `MemoryReplicaBank` routes;
   `routedBanks("taki")` returns Global then Character. Existence of these routes proves neither
   application snapshot publication nor an application Bank body.
   [S/memory/hindsight/hindsight-runtime-connection.ts:88-106]
   [S/memory/hindsight/hindsight-runtime-connection.ts:110-119]
   [S/db/hindsight-application-replica-query.ts:40-51] [inference]

7. **Foreground sync negotiates before making the replica readable.** Capture starts serial Bank
   sync under the Bank service's owned lifetime. Per Bank, `admitHindsightApplication` calls
   `onAdmission`, which saves the capability manifest; only then does full/incremental sync run.
   Full sync initializes application state, fetches the complete baseline and publishes the paired
   snapshot. The subsequent asynchronous binding loop binds the Bank and consumes its committed
   change. Therefore both “no checkpoint yet” and “checkpoint with `binding_missing`” are real
   first-sync phases. [S/memory/hindsight/hindsight-capture-sync.ts:29-40]
   [S/memory/hindsight/hindsight-capture-sync.ts:61-71]
   [S/memory/hindsight/hindsight-runtime-state.ts:49-53]
   [S/memory/hindsight/hindsight-application-sync-runner.ts:118-145]
   [S/memory/hindsight/hindsight-application-sync-runner.ts:169-192]
   [S/memory/hindsight/hindsight-application-binding-runner.ts:47-55]
   [S/memory/hindsight/hindsight-application-binding-runner.ts:159-178]

8. **The admission budget expires during that work.** Its formula is
   `min(requestTimeoutMs, floor(chatAckMs / 2))`; foreground work continues under the Bank service.
   The retained run reports both Global and Character `HINDSIGHT_DEADLINE_EXCEEDED / deferred`.
   Native logs show only Global application initialization and continuing Global application
   transactions before shutdown. [S/memory/hindsight/hindsight-memory-subsystem.ts:119-127]
   [S/memory/hindsight/hindsight-capture-sync.ts:32-40] [R/core-1.log:28-29]
   [R/native.log:292-293] [R/native.log:347-376]
   [inference: Global work consumed the wait budget before the serial Character sync could finish]

9. **Old decision admitted partial without its required replica.** With no connection drift and no
   completed refusing error, the old condition used `capabilitiesSnapshot()` alone to return
   `partial`. That method reads the saved manifest and does not resolve Banks. Runtime capture
   accepts partial, calls `assemble(characterId)`, and `captureHindsightRuntimeRows` reads both
   application Bank bindings. `bankBinding` returns undefined when there is no application
   checkpoint; the row projection throws the reported error. [S/memory/hindsight/hindsight-memory-provider-context.ts:63-81]
   [S/memory/hindsight/hindsight-memory-runtime.ts:33-35]
   [S/memory/hindsight/hindsight-memory-runtime.ts:60-69]
   [S/db/hindsight-application-replica-query.ts:40-51]
   [S/memory/hindsight/hindsight-runtime-view.ts:20-24]
   [inference: old decision shown by removed-context/added-lines diff below]

10. **The error escapes admission, so the RPC has no chat Run result.** Method-registry maps an
    unexpected Error to JSON-RPC internal error and logs its closed code. The retained RPC result is
    `-32603 / HINDSIGHT_APPLICATION_BANK_UNAVAILABLE`, before any step-5 provider request.
    [S/server/method-registry.ts:109-114] [R/result.json:1108-1115] [R/result.json:1163]
    [R/core-1.log:30]

### Raising-site attribution

| Site | Role and relevance |
| --- | --- |
| `hindsight-runtime-view.ts:24` | Requires the Bank/body/bound state during synchronous prompt capture; the deterministic reproduction reaches this failure. Historical raising stack: **UNKNOWN** because the retained Core log contains only the code; this site is the control-flow-supported attribution. [S/memory/hindsight/hindsight-runtime-view.ts:20-24] [R/core-1.log:30] [log V2:1-8] [inference] |
| `hindsight-application-binding-runner.ts:48` | Requires a live native Bank head inside sync. Both observed outcomes were still deferred, so there was no settled sync error of this code to propagate through `settle` at admission time. [S/memory/hindsight/hindsight-application-binding-runner.ts:45-48] [S/memory/hindsight/hindsight-capture-sync.ts:76-85] [R/core-1.log:28-29] [inference] |
| `hindsight-memory-provider-context.ts:102` | Guards provider Bank use. Capability snapshot reads alone do not call this Bank guard. [S/memory/hindsight/hindsight-memory-provider-context.ts:63-81] [S/memory/hindsight/hindsight-memory-provider-context.ts:99-105] |
| `hindsight-memory-write-context.ts:47` | Guards write admission. No step-5 provider/model call or retain execution was recorded; this is not the evidenced first failure. [S/memory/hindsight/hindsight-memory-write-context.ts:41-54] [R/result.json:1163] [inference] |
| `hindsight-memory-write-mutation.ts:33` | Guards a layer edit on an existing mutation job; step 5 asks for a new retain and fails earlier. [S/memory/hindsight/hindsight-memory-write-mutation.ts:20-35] [T/research/first-use-runtime/native-smoke.mjs:154-159] [inference] |

## Fix, ownership and trade-offs

- Correct the **existing partial admission decision**: read every routed Bank binding, then return the
  existing `admission_unavailable` result if one has no checkpoint or is still `binding_missing`.
  All Bank reads execute before deciding, so a thrown evidence/paired-checkpoint error is not swallowed
  by a short-circuit absence test. [S/memory/hindsight/hindsight-capture-sync.ts:46-58]
- Keep `rebind_required` and tombstones outside that new classification. The existing projection,
  pinned-record, authority, authentication and durable-write guards remain in their owners; no exception
  catch, retry, replacement authority or forged Bank body is added.
  [S/memory/hindsight/hindsight-capture-sync.ts:49-52]
  [S/memory/hindsight/hindsight-runtime-view.ts:24-37]
  [S/memory/hindsight/hindsight-runtime-view.ts:48-68] [inference: scoped unified diff]
- **Availability trade-off:** a cold Run may reply without memory tools/automatic recall while retaining
  Hindsight provider/epoch identity and all-false memory capabilities. This is the existing unavailable
  capture contract, now selected before invalid projection. It does **not** claim that a requested
  retain succeeded. Detached sync remains owned; the next fully initialized capture regains memory
  tools. No timeout increase or new retry is used.
  [S/memory/hindsight/hindsight-unavailable-run.ts:18-42]
  [S/memory/hindsight/hindsight-memory-runtime.ts:39-42]
  [S/memory/hindsight/hindsight-capture-sync.ts:32-40]
  [S/memory/hindsight/hindsight-capture-sync.test.ts:69-114]
- Use `admission_unavailable`, not `bank_not_ready`: the latter schedules Bank provisioning, which
  is inappropriate for these already provisioned Banks; the former submits no automatic lifecycle
  action. [S/memory/hindsight-lifecycle/hindsight-lifecycle-trigger.ts:44-53]
- A checkpoint-only patch was insufficient: the same single regression next reproduced the error
  during first binding. Covering `binding_missing` completes that demonstrated cold-state chain;
  it is not a general relaxation for arbitrary non-bound state. [log V4:1-9]
  [S/memory/hindsight/hindsight-application-sync-runner.ts:121-145]
- Exactly **one** new test uses production subsystem/capture/sync/SQLite with deterministic transport
  holds, first before Character snapshot publication, then before its first binding commit. It checks
  verified capability evidence, the bound Global Bank, the two cold Character states, budget settlement,
  truthful unavailable diagnostics, and normal memory capture after the owned work drains. Existing
  fixtures normally pre-seed the replica and `primed()` completes a capture before test actions;
  that concealed this first-use precondition.
  [S/memory/hindsight/hindsight-capture-sync.test.ts:13-18]
  [S/memory/hindsight/hindsight-capture-sync.test.ts:69-114]
  [S/testing/hindsight-runtime-composition-fixtures.ts:60-66]
- Files owned by this fix: `S/memory/hindsight/hindsight-capture-sync.ts`,
  `S/memory/hindsight/hindsight-capture-sync.test.ts`, one existing entry in
  `S/memory/hindsight/index.md`, and this report. The index edit follows the on-touch folder-index
  rule. Existing index changes are excluded from the owned diff. No fixture/journey, key UI,
  per-Bank settings or `first-use-source-review` file was edited. [CLAUDE.md:88]
  [inference: owned unified diff and session edit inventory]
- No new spec/architecture rule is introduced; this applies the existing readable-replica prerequisite
  in the Run capture contract. The report records the missing prerequisite without expanding this
  single-failure change into a spec rewrite. [.trellis/spec/backend/hindsight-application-runtime.md:172-186]
  [inference: scope choice]

## Checks and actual output

Environment: workspace `H:/TakiAgent`, branch `main`, HEAD
`e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`, Node `v24.18.0`, pnpm `10.22.0`;
Vitest identifies itself as `v4.1.10`. Existing working-tree changes were retained.
[log E1:1-5] [log V1:1] [inference: pre-edit status and owned diff]

### E1 — identity readback

Commands: `git branch --show-current`, `git rev-parse HEAD`, `Get-Location`,
`node --version`, `pnpm --version`. Output values (one per command, cwd normalized): [inference: output formatting]

```text
main
e260ff4b0bf663b5faa0187bc6ec701fd2f007cd
H:/TakiAgent
v24.18.0
10.22.0
```

### D1 — retained isolated SQLite, read only

No runtime was started. This query opened only the retained synthetic run's Core database using
SQLite `mode=ro`. It did not open the credentials directory. [inference: command below and session tool inventory]

```python
import sqlite3
c = sqlite3.connect('file:G:/taki-first-use-4zNTaw/core-data/taki.db?mode=ro', uri=True)
print('B3 verified v1 Banks:', c.execute("select count(*) from hindsight_bank_setup where status='verified' and template_revision='taki-bank-v1'").fetchone()[0])
print('Application capability rows:', c.execute('select count(*) from hindsight_application_runtime_admission').fetchone()[0])
print('Application checkpoints:', c.execute('select count(*) from hindsight_application_replica_checkpoints').fetchone()[0])
print('Application Bank heads:', list(c.execute("select bank_id,binding_state from hindsight_application_replica_heads where object_kind='bank'")))
print('Capability admitted_at:', c.execute('select admitted_at from hindsight_application_runtime_admission').fetchone()[0])
print('Application command states:', list(c.execute('select state,count(*) from hindsight_application_command_jobs group by state')))
c.close()
```

Output: [log D1:1-6]

```text
B3 verified v1 Banks: 2
Application capability rows: 1
Application checkpoints: 1
Application Bank heads: [('taki-hs-v1-g-d8a3a7cfaad9404dc514fb925b212633', 'bound')]
Capability admitted_at: 2026-10-29T14:30:49.956Z
Application command states: [('completed', 2)]
```

### Test commands

V1 used `pnpm -C packages/core exec vitest run src/memory/hindsight/hindsight-capture-sync.test.ts --maxWorkers=2`.
V2–V5 used the same affected file with `--pool=threads --maxWorkers=2`.
No other test file or test batch was run. Threads was selected because the default fork process
could not start in this environment. [log V1:1-6] [inference: command inventory]

V1 — default pool, exit 1; selected actual output: [log V1:1-6]

```text
 RUN  v4.1.10 H:/TakiAgent/packages/core
Error: [vitest-pool]: Failed to start forks worker for test files H:/TakiAgent/packages/core/src/memory/hindsight/hindsight-capture-sync.test.ts.
Caused by: Error: spawn EPERM
 Test Files  no tests
      Tests  no tests
     Errors  1 error
```

V2 — original production code, new cold-checkpoint regression: exit 1.
Selected actual output; the other ten tests passed. [log V2:1-8]

```text
AssertionError: expected Error: HINDSIGHT_APPLICATION_BANK_UNAVAIL… to match object { tools: {}, snapshot: { …(3) } }
+ Error {
+   "message": "HINDSIGHT_APPLICATION_BANK_UNAVAILABLE",
  }
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
   Start at  12:28:28
   Duration  27.56s (transform 4.85s, setup 0ms, import 6.53s, tests 20.75s, environment 0ms)
```

V3 — checkpoint-presence revision: exit 0. An intermediate Core `tsc --noEmit` also exited 0 with
no output. This was not accepted as final after the first-binding phase was identified. [log V3:1-4]
[inference: validation sequence]

```text
 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  12:29:34
   Duration  28.04s (transform 5.99s, setup 0ms, import 7.80s, tests 19.96s, environment 0ms)
```

V4 — same regression extended through the first binding phase, before that phase's fix: exit 1.
Selected actual output: [log V4:1-9]

```text
AssertionError: expected Error: HINDSIGHT_APPLICATION_BANK_UNAVAIL… to match object { tools: {}, snapshot: { …(3) } }
+ Error {
+   "message": "HINDSIGHT_APPLICATION_BANK_UNAVAILABLE",
  }
 ❯ src/memory/hindsight/hindsight-capture-sync.test.ts:106:36
 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
   Start at  12:32:32
   Duration  18.29s (transform 4.27s, setup 0ms, import 5.70s, tests 12.34s, environment 0ms)
```

V5 — final fix: exit 0. Actual summary: [log V5:1-4]

```text
Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  12:33:23
   Duration  16.80s (transform 3.75s, setup 0ms, import 5.00s, tests 11.55s, environment 0ms)
```

Final `pnpm -C packages/core exec tsc --noEmit`: **exit 0, stdout/stderr empty**.
Scoped `git diff --check -- packages/core/src/memory/hindsight/hindsight-capture-sync.ts packages/core/src/memory/hindsight/hindsight-capture-sync.test.ts packages/core/src/memory/hindsight/index.md`:
**exit 0, stdout/stderr empty**. No lint/package-wide/other test suite was run under the requested
check limit. [inference: final tool exit records; empty output is reported rather than invented]

Tooling limits: `jbcontext search` returned “You need to log in to JetBrains AI Platform first”;
the specialized explorer's model channel returned 503, so exact source reads and an available
read-only advisor were used. These were discovery failures, not test results. A command-based
owned-diff assembly exceeded Windows command length (206); the report instead uses Git's two clean-file
diffs plus the saved pre-edit index line. [inference: tool execution records]

## Remaining verification / UNKNOWN

- The original exception's full stack and exact per-object state at that instant are **UNKNOWN**.
  Logs, retained post-run SQLite, and the deterministic reproduction support the causal path above;
  they do not fabricate a historical stack. [R/core-1.log:30] [log D1:1-6] [log V2:1-8]
- The fixed real Home/Core/Native journey has **not been rerun**. The leader must rerun it and
  separately verify actual Hindsight retain/recall after initialization. The current step-5 fixture
  checks `chat.complete` but does not itself prove that its requested retain tool was called.
  A memory-unavailable first chat must not be reported as successful retention.
  [T/research/first-use-runtime/native-smoke.mjs:154-171]
  [S/memory/hindsight/hindsight-unavailable-run.ts:18-42] [inference: user-owned runtime boundary]
- Timing/model quality, production credentials/data, and owner UI acceptance remain **UNKNOWN** in
  this change. No PG/Native/Core/browser service, paid model call, Git mutation or original-data
  operation was performed. Local synthetic tests are not connected acceptance. [inference: execution scope]
- The existing required-pin projection guard remains unchanged; its separate test file was not run
  because only the affected file was authorized. This report does not claim a newly tested arbitrary
  combination of cold Banks and unrelated ongoing rebinding. [S/memory/hindsight/hindsight-runtime-view.ts:48-68]
  [inference: explicit verification limit]

## Owned unified diff

This diff includes only this fix's source/test/index edits; it excludes inherited working-tree changes
and the report itself. [inference: saved pre-edit index plus scoped Git diff]

```diff
diff --git a/packages/core/src/memory/hindsight/hindsight-capture-sync.test.ts b/packages/core/src/memory/hindsight/hindsight-capture-sync.test.ts
index e959596..a4f456b 100644
--- a/packages/core/src/memory/hindsight/hindsight-capture-sync.test.ts
+++ b/packages/core/src/memory/hindsight/hindsight-capture-sync.test.ts
@@ -3,7 +3,7 @@ import type { TakiApplicationCommitReceipt } from "@taki/shared";
 import { APPLICATION_TEST_AT, applicationTestEvent, applicationTestMemoryPayload, applicationTestNative,
   type ApplicationNativeFixture } from "../../testing/hindsight-application-fixtures.ts";
 import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
-import type { CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
+import { curatorTestBank, type CuratorTestBank } from "./hindsight-policy-curator-fixtures.ts";
 
 const fixtures: HindsightRuntimeFixture[] = [];
 afterEach(async () => {
@@ -67,6 +67,51 @@ function syncLogs(f: HindsightRuntimeFixture) {
 }
 
 describe("Run-admission Hindsight sync resilience", () => {
+  it("keeps cold Runs memory-unavailable until both Bank replicas are first bound, then admits memory after sync", async () => {
+    vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT);
+    const global = curatorTestBank(); const character = curatorTestBank({ bankId: "bank-taki", characterId: "taki", memories: [] });
+    const native = character.native[0]!;
+    character.native = [{ ...native, head: { ...native.head, binding_state: "binding_missing", bound_artifact: null } }];
+    character.artifacts = [];
+    const f = hindsightRuntimeFixture({ seed: false, banks: [global, character] }); fixtures.push(f);
+    const subsystem = f.subsystem();
+    let releaseSnapshot!: () => void; let snapshotStarted!: () => void; let releaseBinding!: () => void; let bindingStarted!: () => void;
+    const heldSnapshot = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
+    const reachedSnapshot = new Promise<void>((resolve) => { snapshotStarted = resolve; });
+    const heldBinding = new Promise<void>((resolve) => { releaseBinding = resolve; });
+    const reachedBinding = new Promise<void>((resolve) => { bindingStarted = resolve; });
+    const snapshot = f.remote.client.createApplicationSnapshot;
+    vi.spyOn(f.remote.client, "createApplicationSnapshot").mockImplementation(async (input) => {
+      if (input.bankId === character.scope.bankId) { snapshotStarted(); await heldSnapshot; }
+      return snapshot(input);
+    });
+    const commit = character.server.client.commitApplication;
+    character.server.client.commitApplication = async (input) => { bindingStarted(); await heldBinding; return commit(input); };
+    let settled = false;
+    const captured = subsystem.captureRun("taki").then((run) => { settled = true; return run; },
+      (error: unknown) => { settled = true; return error; });
+    try {
+      await reachedSnapshot;
+      expect(subsystem.state.provider.capabilitiesSnapshot()?.recall).toBe(true);
+      expect(f.replica.bankBinding(global.scope.bankId)?.bindingState).toBe("bound");
+      expect(f.replica.bankBinding(character.scope.bankId)).toBeUndefined();
+      await vi.advanceTimersByTimeAsync(7499); expect(settled).toBe(false);
+      await vi.advanceTimersByTimeAsync(1);
+      expect(await captured).toMatchObject({ tools: {}, snapshot: { providerId: "hindsight", authorityEpochId: "epoch",
+        capabilities: { recall: false, retain: false } } });
+      releaseSnapshot(); await reachedBinding;
+      expect(f.replica.bankBinding(character.scope.bankId)).toMatchObject({ bindingState: "binding_missing", bank: undefined });
+      const bindingCapture = subsystem.captureRun("taki").catch((error: unknown) => error);
+      await vi.advanceTimersByTimeAsync(7500);
+      expect(await bindingCapture).toMatchObject({ tools: {}, snapshot: { providerId: "hindsight", authorityEpochId: "epoch",
+        capabilities: { recall: false, retain: false } } });
+      expect(f.logs.filter((log) => log.msg === "Hindsight Run admitted without memory").map((log) => log.obj))
+        .toEqual([{ characterId: "taki", code: "admission_unavailable" }, { characterId: "taki", code: "admission_unavailable" }]);
+    } finally { releaseSnapshot(); releaseBinding(); await subsystem.state.service.settle(); }
+    expect(f.replica.bankBinding(character.scope.bankId)?.bindingState).toBe("bound");
+    expect(Object.keys((await subsystem.captureRun("taki")).tools)).toContain("recall");
+  });
+
   it("re-pulls and rebinds when native consolidation races the foreground binding commit (D1)", async () => {
     const { f, subsystem, bank } = await primed(); const [id] = remoteUnits(bank, 1); raceCommits(bank, 1, id!);
     const run = await subsystem.captureRun("taki");
diff --git a/packages/core/src/memory/hindsight/hindsight-capture-sync.ts b/packages/core/src/memory/hindsight/hindsight-capture-sync.ts
index 3682191..e7e6633 100644
--- a/packages/core/src/memory/hindsight/hindsight-capture-sync.ts
+++ b/packages/core/src/memory/hindsight/hindsight-capture-sync.ts
@@ -44,6 +44,12 @@ export async function synchronizeHindsightCapture(state: HindsightRuntimeState,
   const drift = run.outcomes.every((outcome) => outcome === "synced") ? "none" : connectionDrift(state);
   if (drift !== "none") return drift;
   const partial = settle(input, run.outcomes);
+  // Capability negotiation precedes the first Bank snapshots. A partial Run can
+  // use the replica only after both routed Banks have their first application binding.
+  if (partial) {
+    const bindings = input.banks.map((bank) => state.replica.bankBinding(bank.bankId));
+    if (bindings.some((binding) => binding === undefined || binding.bindingState === "binding_missing")) return "admission_unavailable";
+  }
   // A readable replica does not prove negotiated capabilities. Missing evidence
   // must not start an implicit coordinator admission without this caller's signal;
   // an unfinished or failed sync degrades this Run instead of refusing the chat turn.
--- a/packages/core/src/memory/hindsight/index.md
+++ b/packages/core/src/memory/hindsight/index.md
@@ -92,1 +92,1 @@
-- hindsight-capture-sync.ts — Run-admission Bank sync bounded by the admission budget (min of request timeout and half the live chat ack deadline, composed in the subsystem): unfinished work continues in the Bank service, non-integrity failures degrade the Run, integrity/authority/cancellation refuse it, a connection drift seen after an incomplete sync degrades it to memory-unavailable; one closed-code event per unsynced Bank
+- hindsight-capture-sync.ts — Run-admission Bank sync bounded by the admission budget (min of request timeout and half the live chat ack deadline, composed in the subsystem): partial captures require both initial application Bank bindings and negotiated capabilities; unfinished work continues in the Bank service, non-integrity failures degrade the Run, integrity/authority/cancellation refuse it, a connection drift seen after an incomplete sync degrades it to memory-unavailable; one closed-code event per unsynced Bank
```

