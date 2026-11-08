Fixed. **The underlying exception was `MEMORY_AUTHORITY_FENCED`.**

The retry timer inherited the foreground provider’s `AsyncLocalStorage` owner. After the provider returned, that owner became inactive. When the timer fired, the Bank service rejected the inherited owner before recovery or HTTP—even though the work fence remained writable. The replica error normalizer masked it as `HINDSIGHT_REPLICA_SYNC_FAILED`. [source packages/core/src/memory/canonical-local-write-fence.ts:33] [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:42] [source packages/core/src/memory/hindsight/hindsight-replica-errors.ts:8]

The composed regression failed before the fix with Native calls **17 → 17** and unchanged Pending attempt time. It retains real timers and uses the actual subsystem, provider fence, scheduler, sync and Pending recovery. After the fix, it completes the original parent/child with one Native dispatch. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/red-cause.log] [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/green-root.log]

Key hunks:

- Scheduler binds its existing wake callback using `AsyncResource.bind`; no additional timer. [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:74]
- Existing Core logger receives Bank/run identity and the bounded fence cause; logger failures cannot alter settlement. [source packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:69]
- Subsystem wires the logger. [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:73]
- Composed regression and actual-fence/logging-failure tests added. [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.test.ts:26]
- Scheduler spec and directory index updated.

**Checks:** 78 tests passed across five suites (`--pool=threads --maxWorkers=2`); Core typecheck, scoped ESLint and whitespace checks passed. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/affected-tests.log]

No F1/F2 files were edited. No journey or services were run; connected settlement remains unverified.

[Full report](H:/TakiAgent/.trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/report.md) · [Baseline-relative diff](H:/TakiAgent/.trellis/tasks/08-09-memory-operations-ui/research/p1-h-scheduler-cause-20261107/changes.patch)