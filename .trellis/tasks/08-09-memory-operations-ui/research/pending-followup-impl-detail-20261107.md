# P1-H foreground Pending settlement

## 1. Outcome

**Done within the assigned implementation/check scope.** A recognized foreground Pending result now hands its Bank to the existing scheduler retry state. The scheduler recomputes its existing wake immediately. Recovery retains the original parent/native identity and existing retry policy; no new timer, queue, loop, migration, foreground deadline, wording or return semantics was introduced. [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:46] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:152] [source packages/core/src/db/hindsight-replica-schedule-state.ts:68]

The original defect was verified in the pre-change gateway/scheduler source. The supplied diagnosis's historical runtime/J17 claims were not independently rerun or used as live acceptance. [run artifact G:/taki-codex-work/tmp-h/p1-h/baseline/packages/core/src/memory/hindsight/hindsight-memory-writes.ts] [run artifact G:/taki-codex-work/tmp-h/p1-h/baseline/packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts]

## 2. Changes

The following are exact changed-file/hunk pointers; the patch compares against the inherited working files captured before my edits, not Git HEAD. [run artifact G:/taki-codex-work/tmp-h/p1-h/changes.patch]

| File / hunk | Purpose / representative line |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-memory-writes.ts:46` | Only nonterminal accepted writes hand off recovery: `retryScheduler.requestRetry(current.identity.key.bankId, dueAt)`; use the child's `nextRetryAt`, otherwise the existing first retry delay. |
| `packages/core/src/memory/hindsight/hindsight-memory-writes.ts:56` | `setRetryScheduler` binds the scheduler after construction of the write/recovery cycle. |
| `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:74` | One production composition line: `state.writes.setRetryScheduler(scheduler)`. This avoids changes to reserved `hindsight-runtime-state.ts`. |
| `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:152` | `requestRetry(bankId, dueAt)` persists the handoff and calls the existing `armTimer`; storage errors use `lastError()` without replacing the durable write receipt. |
| `packages/core/src/db/hindsight-replica-scheduler-repo.ts:85` | `requestRetry` uses the repository's existing transactional state mutation. |
| `packages/core/src/db/hindsight-replica-schedule-state.ts:68` | `requestReplicaRetry` respects manual mode/operator hold, takes the earlier wake, preserves full retry kind, and does not invent a failed attempt. |
| `packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts:106` | Existing suite extended for wake replacement, repeated Pending/backoff, manual mode, earlier retry/ordinary/full wakes, and a real SQLite retry-storage failure. |
| `packages/core/src/memory/hindsight/hindsight-memory-write-deadline.test.ts:80` | Real scheduler -> Pending runner -> Bank service -> parent advancement under controlled Native responses; verifies exact parent/child identity and one Native dispatch, automatic/manual outcomes, and no arming after completion/refusal. |
| `packages/core/src/memory/hindsight/hindsight-memory-writes.test.ts:12` | File-backed fixture root now uses `tmpdir()` so supplied TEMP/TMP route it to G:. |
| `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:249` | Step 5 requires an actual Pending retain; observes automatic scheduler ownership and excludes manual request claims, records `delayAfterChatMs`, then calls `retainedWrite(ctx, run, true)` before any explicit incremental/full sync. Existing sync and second-connection checks remain. |
| `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:317` | `waitPendingDrained` rejects null/empty summaries and failed/unknown children, waits for both child/parent drain, and optionally requires scheduler evidence. |
| `.trellis/spec/backend/memory-replica-sync.md:95` | Documents the foreground Pending trigger and retry API. |
| `.trellis/spec/backend/hindsight-application-runtime.md:157` | Documents unchanged foreground semantics and manual-only consequence. |
| `packages/core/src/memory/hindsight/index.md:56` | Updates the scheduler, subsystem and writes entries. |
| `packages/core/src/db/index.md:64` | Updates the scheduler repository and schedule-policy entries. |

There are 13 changed project files. No leader-owned records, template/prompt files, or six reserved packet files were edited. The fixture services use existing recovery implementations; their controlled publication adapter is test-only. [run artifact G:/taki-codex-work/tmp-h/p1-h/changed-files.json] [source packages/core/src/memory/hindsight/hindsight-memory-write-deadline.test.ts:41]

## 3. Evidence and checks run

Failure modes were identified before implementation: missing wake, changed original identity/duplicate dispatch, Native still Pending at recovery, accidental completed/failed arming, manual-mode auto recovery, postponing earlier work, and harness false success on missing/failed/unknown summaries.

Environment: Node v24.18.0, pnpm 10.22.0, Vitest 4.1.10; PowerShell, `H:/TakiAgent`, branch `main`. Every test/check command used `TEMP=TMP=G:/taki-codex-work/tmp-h`.

- Initial requested command: `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-replica-scheduler.test.ts --maxWorkers=2`. Default fork startup failed with `spawn EPERM`; no tests executed, so this is not a red regression result. [run artifact G:/taki-codex-work/tmp-h/p1-h/red-scheduler.log]
- Working command: `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-replica-scheduler.test.ts src/memory/hindsight/hindsight-memory-writes.test.ts src/memory/hindsight/hindsight-memory-write-deadline.test.ts --maxWorkers=2 --pool=threads`. **3 files / 56 tests passed.** [run artifact G:/taki-codex-work/tmp-h/p1-h/affected-tests-final.log]
- `pnpm --filter @taki/core typecheck`: **passed**. An initial new test-fixture undefined-versus-null error was corrected before the final pass. [run artifact G:/taki-codex-work/tmp-h/p1-h/typecheck-final.log]
- `pnpm exec eslint` over all eight changed TS files: **passed**. Exact files are the eight TS rows above, with each test file included once. [run artifact G:/taki-codex-work/tmp-h/p1-h/eslint-final.log]
- `node --check .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs`: **passed**. [run artifact G:/taki-codex-work/tmp-h/p1-h/harness-syntax.log]
- `node G:/taki-codex-work/tmp-h/p1-h/check-harness.mjs`: **10 passed**. Evaluates the exact extracted `waitPendingDrained` source with controlled read/time dependencies; this is isolated harness logic evidence, not a journey. [run artifact G:/taki-codex-work/tmp-h/p1-h/harness-checks.log]
- Scoped `git diff --check`, strict UTF-8/no-BOM checks and added-line whitespace checks passed. Baseline-relative diff and changed-file hashes are retained. [run artifact G:/taki-codex-work/tmp-h/p1-h/changes.patch] [run artifact G:/taki-codex-work/tmp-h/p1-h/changed-files.json]

No Core, Native or PG service was started. Test processes finished; fixture databases/directories were closed and removed by existing teardown. G: review artifacts remain intentionally. No original user data, Credential Manager entries, unrelated services, Git mutations or Trellis lifecycle commands were used.

## 4. Trade-offs

- Binding rule: **"Manual mode schedules no background due or retry wake."** Manual-only Banks therefore continue showing Pending until an explicit recovery action; this change does not promise automatic settlement in that mode. [source .trellis/spec/backend/memory-replica-sync.md:129] [source packages/core/src/memory/hindsight/hindsight-memory-write-deadline.test.ts:80]
- Automatic Banks perform an additional timely synchronization after a Pending foreground receipt, normally at the child's approximately one-minute retry time. This costs background I/O versus waiting for the ordinary six-hour poll. If Native remains Pending, existing retry backoff continues; the regression observes the following five-minute delay. There is no unconditional 180-second production completion guarantee. [source packages/core/src/db/hindsight-replica-schedule-state.ts:68] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts:106]
- The minimal composition seam is one late-bound scheduler reference in the existing write owner plus one subsystem line. No reserved constructor changes or new recovery owner were needed. [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:19] [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:74]
- A scheduling-storage failure preserves Pending return semantics and remains visible through the existing closed `lastError()`; prompt recovery cannot be guaranteed while schedule persistence fails. [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:152] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts:133]
- Step 5 is stricter: absent automatic ownership, manual-triggered work, empty/unavailable summaries, or failed/unknown children cannot pass. Released scheduler lease evidence supports fast runs missed between polls; if competing work has overwritten that evidence, the harness refuses attribution rather than guessing. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:270]

## 5. Open items / UNKNOWN

- Connected journey execution and actual Native settlement delay are **UNKNOWN** here: the assignment explicitly reserves the journey for the leader. Step 5 will emit `automaticSettlement.delayAfterChatMs` and original completed-write evidence when run. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:287]
- Default Vitest fork-worker execution remains unavailable under the current sandbox; the same suites passed using the installed thread pool. [run artifact G:/taki-codex-work/tmp-h/p1-h/red-scheduler.log] [run artifact G:/taki-codex-work/tmp-h/p1-h/affected-tests-final.log]
- Exact requested `-o` path is **UNKNOWN** because none was supplied. This report is saved at `G:/taki-codex-work/tmp-h/p1-h/report.md`; the final response also carries the handoff summary.
- No implementation work in this packet remains open; real journey/owner acceptance is not claimed.

## 6. Anything outside scope noticed

No additional verified defect requiring an out-of-scope change was found. The leader's historical J17 concern and concurrent F2 work remain with their owners. No fixes or task-state edits were made there.
