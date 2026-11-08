# P1-H scheduler-owned recovery: settled foreground async ownership

## 1. Outcome and root cause

Done for the requested implementation and automated checks. The existing retry time was correct; the timer callback inherited the foreground provider's already-settled async owner.

1. `createHindsightMemoryProvider` executes the foreground retain inside `workFence.admit`. The write gateway's Pending handoff rearms the scheduler while that owner is still current. [source packages/core/src/memory/hindsight/hindsight-memory-provider.ts:25] [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:49]
2. The original `armTimer` created its callback in that foreground context. Native timers preserve `AsyncLocalStorage` context. Once the provider returns, `admit` sets that owner's `live` flag to false. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/scheduler-before.txt] [source packages/core/src/memory/canonical-local-write-fence.ts:44]
3. The scheduled Bank service attempts a fresh `workFence.admit`, but `inherited()` finds the expired foreground owner and throws **`MEMORY_AUTHORITY_FENCED`**. This happens before recovery, sync, F2 admission resolution, connection checks inside recovery, or HTTP. The fence itself is still writable. [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:42] [source packages/core/src/memory/canonical-local-write-fence.ts:33]
4. `replicaErrorCode` cannot represent that Core fence error in its existing closed replica enum, so it returns `HINDSIGHT_REPLICA_SYNC_FAILED`; ordinary failure settlement advances backoff. [source packages/core/src/memory/hindsight/hindsight-replica-errors.ts:8] [source packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:73]

The reproduction captured the exact stack through `inherited -> enter -> admit -> own -> track -> scheduled`, `workFence.writable() === true`, Native call count **17 -> 17**, and unchanged Pending `lastAttemptAt`. This rules out actual quiescence and errors in later lease/connection/F2 paths for the reproduced failure. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/red-cause.log]

The supplied retained SQLite database was inspected through a read-only handle. It confirms scheduler attempt `20:16:08.160Z`, generic failure, retry at `20:21:08.164Z`, and the unchanged submitted child with one attempt at `20:15:07.698Z`. The current Bank-service hash matches the journey's recorded hash; the work-fence file is unchanged from the same Git HEAD. Historical Core logs do not contain the original exception stack; that stack comes from the composed regression. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/retained-readonly.log]

The previous P1-H test did not provide a work fence and replaced the production sync runner. Its fake timer callback execution also failed to preserve the async ownership inherited by a real timer. It proved retry timing and isolated recovery, but not this composed lifetime boundary. [source packages/core/src/memory/hindsight/hindsight-memory-write-deadline.test.ts:41]

## 2. Changes / diff hunks

Six existing source/spec files changed. The patch is relative to this follow-up's inherited working files; it excludes the earlier P1-H implementation and unrelated edits. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/changes.patch]

| File / hunk | Representative line and purpose |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:74` | `private readonly wake = AsyncResource.bind(...)`: capture the scheduler construction context once. |
| `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:269` | `this.timer = setTimer(this.wake, delay)`: reuse the existing timer, without inheriting whichever foreground caller rearmed it. |
| `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:242` | Pass the existing optional Core logger to run settlement. |
| `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:73` | `logger: input.logger`: wire the existing Core log sink. |
| `packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:69` | Log bounded Bank/run/code fields plus the known `MEMORY_AUTHORITY_FENCED` cause; preserve original settlement even if the logger throws. |
| `packages/core/src/memory/hindsight/hindsight-memory-subsystem.test.ts:26` | New composed provider -> scheduler timer -> Bank service -> real sync/Pending recovery regression with a fake Native client and exact original parent/child completion. |
| `packages/core/src/memory/hindsight/hindsight-memory-subsystem.test.ts:71` | Actual quiescence still refuses work; tests cover both normal and throwing log sinks. |
| `.trellis/spec/backend/memory-replica-sync.md:132` | Documents timer async ownership; the diagnostics paragraph documents bounded existing-log behavior. |
| `packages/core/src/memory/hindsight/index.md:56` | Refreshes scheduler/execution ownership and diagnostic descriptions. |

No F1 or F2 file was edited: the reproduced throw precedes those paths. No new timer, queue, loop, public error schema, persistence schema, or recovery framework was added.

## 3. Failing-then-passing reproduction and checks

The composed regression uses `hindsightRuntimeFixture().subsystem()`, including actual runtime-state construction, provider work fence, scheduler, Bank service, F2 admission wiring, application sync and Pending recovery. Only Native transport behavior is simulated. Real timers are retained; only `Date` is faked. The test shortens the wake delay and advances the clock to the child's unchanged retry eligibility, avoiding a one-minute wall-clock test while preserving the failing async context. It observes the timer's invocation before awaiting its existing scheduler execution, and asserts original parent identity, original child identity, completion, and one Native dispatch.

- Before the fix, the test failed with `MEMORY_AUTHORITY_FENCED`, schedule mode `failed`, zero additional Native calls and untouched Pending attempt time. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/red.log] [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/red-cause.log]
- After changing only callback ownership, the same regression passed. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/green-root.log]
- Final command: `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-memory-subsystem.test.ts src/memory/hindsight-runtime-composition.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts src/memory/hindsight/hindsight-memory-write-deadline.test.ts src/memory/hindsight/hindsight-runtime-bank-service.test.ts --maxWorkers=2 --pool=threads` — **5 files / 78 tests passed**. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/affected-tests.log]
- `pnpm --filter @taki/core typecheck` — passed. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/typecheck.log]
- `pnpm exec eslint` over the four changed TS files — passed. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/eslint.log]
- Scoped `git diff --check`, UTF-8/no-BOM and added-line whitespace checks passed. Temporary `[DEBUG-p1h]` instrumentation was removed from source; only retained red evidence contains it. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/changes.patch]

Installed Node typings verify `AsyncResource.bind` captures the current execution context. No external API was introduced from memory. [source node_modules/@types/node/async_hooks.d.ts:274]

Environment: Node v24.18.0, pnpm 10.22.0, Vitest 4.1.10; `H:/TakiAgent`, branch `main`. This follow-up's permission profile removed general G: workspace writes, so tests used the permitted environment temp directory `TEMP=TMP=G:/Temp`; review artifacts are inside the assigned task. Fixture databases were closed and temporary directories removed by teardown. No Core/Native/PG service was started; no journey was run.

## 4. Trade-offs

- Scheduler wakes now carry construction-time async context instead of the rearming caller's transient context. Current work-fence, lease, cancellation and deadline checks remain enforced; the quiescence tests verify that this does not grant access through a closed fence.
- Existing Core logs now expose the known internal fence cause with Bank/run identity. Durable replica status retains its existing closed enum; arbitrary exceptions remain generic and raw provider/credential text is never logged. A log-sink failure cannot alter the original run failure.
- The regression accelerates time but preserves actual timer/async ownership. It establishes correctness of the composed path, not a live Native latency measurement.

## 5. Open items / UNKNOWN

- The leader's connected journey rerun and actual automatic settlement delay after this correction remain **UNKNOWN**. They were explicitly excluded from this assignment.
- The original live exception stack was not recorded; the deterministic composed reproduction supplies the causal stack.
- No requested code/check work remains incomplete.

## 6. Outside scope

No additional verified defect was changed. F1/F2 work, leader-owned task records, templates/prompts, original user data and Git state were preserved. The supplied retained database was read only.
