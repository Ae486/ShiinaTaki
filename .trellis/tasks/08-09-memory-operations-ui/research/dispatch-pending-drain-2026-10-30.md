Active task: .trellis/tasks/08-09-memory-operations-ui

# Task: diagnose why an interrupted retain never recovers in the first-use journey

## Problem (one problem only)
Isolated journey `research/first-use-runtime/native-smoke.mjs`, step `pending` (fn stepPending). Steps 1-6b pass.
The step: native-fault.mjs returns 503 for POST /banks/*/(memories|retains), one `[retain]` chat runs, a durable
pending write is observed, then the fault is cleared.
- Run `results/2026-10-30T06-18-01.502Z`: immediately submitting incremental `replica.sync` failed `HINDSIGHT_REPLICA_BUSY`
  (`explicit_retry_required`).
- Leader then added `waitPendingDrained(operator, 180_000)` before that sync. Run `results/2026-10-30T06-28-53.231Z`:
  pending writes did not drain within 180 s.
Recent product fix (keep it, context only): HINDSIGHT_TEMPLATE_BACKUP_BUILD added to `nativeResultSupported` in
`packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts` (report research/first-use-derived-fence-2026-10-30.md).

## Questions to answer, each with [source file:line] / [log line] / [inference], or UNKNOWN
1. What holds the replica busy right after the fault clears, and for how long (lease, scheduler run, manual request)?
2. What is the specified recovery path for a pending write after the provider returns: automatic (which trigger,
   which interval) or explicit sync? Cite the spec in `.trellis/spec/backend/` or the PRD.
3. Why did the pending writes not drain: product defect (stuck state, lease never released, recovery never scheduled),
   or fixture wrong (waiting for something the contract does not promise; wrong timeout vs configured interval)?
4. The correct fix: either the smallest root-cause product fix plus ONE regression test that fails first, or the
   fixture change matching the documented contract. Report as a unified diff.
Write the report to `research/first-use-pending-drain-2026-10-30.md` (findings, fix, files, checks with actual output,
every trade-off).

## Hard constraints
- Read first: CLAUDE.md, CONTEXT.md, this task's prd.md/implement.md.
- Fix the root cause. No added retries/fallbacks/timeouts-raised-to-hide-it, no new abstractions, no defensive branches
  for unreachable cases. Single-user local app: no invented threat models.
- Do not weaken single-flight, lease, admission, authentication or durable-write semantics; do not resend writes the
  spec forbids resending; do not make errors disappear.
- Scope: this failure only. No UI work, no refactors of neighbouring code, no edits to unrelated files.
- Tests: at most one regression test, only for a product fix. No test batches. Run only the affected test file
  (vitest --maxWorkers=2) and `pnpm -C packages/core exec tsc --noEmit`.
- Do NOT start PG/Native/Core/browser runtimes; the leader reruns the journey. You may read the retained SQLite
  read-only and all retained logs.
- No git commit/push/reset/rebase/stash. No real keys/data/paid models.
- Do not stop early: done only when the report exists with answers 1-4 or a concrete blocker.
