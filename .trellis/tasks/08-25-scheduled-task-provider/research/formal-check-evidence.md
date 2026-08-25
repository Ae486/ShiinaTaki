# Slice 5A Formal Check Evidence

Date: 2026-08-25
Result: APPROVED

## Scope Review

The implementation remains one Scheduled Task Trigger Provider over the existing Core Harness. It does not add a
second Runtime, Run/Attempt/Event/Receipt authority, scheduler queue identity, Heartbeat loop, Delivery projection,
Home/Pet UI, Child Run system, or generic task DAG.

## Findings Fixed

- Migration 030 captures immutable occurrence Character ownership. A later Scheduled Task edit cannot redirect a claimed
  occurrence to another Character.
- Recurring catch-up selects the latest overdue source slot before applying the half-period cutoff.
- Pending/failed occurrences are re-armed for retry without busy polling admitted occurrences.
- Scheduler shutdown awaits an in-flight pass before Core closes the database.
- Agent `schedule_task` management is bound to the active Character; arbitrary Character IDs are rejected structurally.
- Operator conflicts/refusals map to structured `SCHEDULE_CONFLICT` / `SCHEDULE_REFUSED` application errors.

## Verification

- Shared typecheck: passed.
- Core typecheck: passed.
- Shared tests: 346 passed.
- Core tests: 277 files, 1,730 passed, 1 skipped.
- Root lint: passed.
- Rust tests: 171 passed; secret-key tests: 7 passed.
- Migration lineage/reopen, including 029 -> 030 backfill: passed.
- Focused scheduler tests: passed.
- Trellis validation: passed.
- `git diff --check`: passed.
- Isolated Core boot applied migrations 001-030, listened on a unique loopback port, composed the scheduler, and
  completed scheduler-aware shutdown. The wrapper exit code 1 was caused by interactive SIGINT termination.

## Residuals

- The full E2E suite has one reproducible failure outside Slice 5A in
  `e2e/src/effect-host-lifecycle.e2e.test.ts` (expected waiting Host Effect row undefined). Its neighboring Host
  lifecycle tests pass, and the failure reproduces in isolation. It remains a parent integration residual.
- User Timezone Authority Device updates and live recomputation are reserved for a later slice; the current persisted
  singleton defaults to UTC and the scheduler already consumes an injected resolver seam.
- Home/Pet, Delivery, Heartbeat, Child Run, and trajectory UI remain downstream work.
