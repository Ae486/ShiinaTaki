# Slice 5A - Implementation Plan

## Protocol

Use one high-effort implementation agent and one xhigh formal check after all internal waves. The pre-implementation
explore is complete; the implementer should consume the curated context rather than repeat broad research.

## Preconditions

- Recheck worktree, branch, active task, and main drift.
- Confirm the migration registry still ends at 028 before reserving 029; any later correction must append a higher migration.
- Obtain owner approval to add `croner`; install only the pinned dependency and record lockfile changes.
- Read task PRD/design, curated manifests, backend specs, and referenced research. Keep YCE disabled.

## Wave A - Contracts and Persistence

- Add Shared strict schedule schemas/methods/results and tests.
- Add append-only schedules/occurrences migration with constraints and indexes.
- Add repository CRUD, revision conflicts, due selection, occurrence claim/link, terminal/missed reconciliation, and
  payload retention policy.
- Extend fresh/current/historical/reopen migration tests.

Rollback point: schema/repository only; no timers or Agent behavior active.

## Wave B - Calendar and Engine

- Add Croner behind one `schedule-pattern.ts` adapter.
- Implement injected-clock `at/every/cron`, IANA validation, DST, User Timezone recomputation, and anchor semantics.
- Implement shared command service and ScheduleEngine boot reconciliation, catch-up cutoffs, coalescing, single-flight,
  unref timers, re-arm, stop, and timer error isolation.

Rollback point: engine remains inert until composition is enabled.

## Wave C - Harness Integration

- Implement ScheduledRunAdapter through existing RunService, deterministic occurrence idempotency, Character queue,
  cancellation registry, non-primary ChatAgent, captured context, retry, settlement, Receipt, and recovery.
- Reconcile occurrence states across all claim/admit/link/start/settle crash boundaries.
- Prove no fake Timeline row, costume notice, conversational auto-memory, or recursive schedule tool.

## Wave D - Surfaces and Composition

- Add thin operator CRUD methods and one action-discriminated `schedule_task` tool over the same service.
- Register the tool only for primary interactive turns; wire boot/shutdown ordering and package/index/spec docs.
- Add isolated Core boot/schedule/shutdown smoke test.

## Verification

Focused tests must cover schema, repository/migration, invalid timezone/forms, DST, catch-up, occurrence idempotency,
queue serialization, non-primary behavior, recursion exclusion, methods/tool, restart, and shutdown.

Run the full proportional gate:

```text
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/shared test
pnpm --filter @taki/core typecheck
pnpm --filter @taki/core test
pnpm --filter @taki/e2e typecheck
pnpm --filter @taki/e2e exec vitest run
pnpm lint
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked
git diff --check
python ./.trellis/scripts/task.py validate 08-25-scheduled-task-provider
```

Runtime smoke uses a unique temporary data directory/port, verifies migration and recovery before hydration, creates a
short deterministic schedule, observes one Scheduled Run/Receipt with no fake user row, restarts around a pending slot,
and confirms clean timer/database shutdown. Real device sleep/resume is unavailable unless separately tested; never mark
it passed from deterministic tests.

The single xhigh check reviews scope, migration/idempotency/crash windows, calendar correctness, one Harness authority,
queue/cancel/shutdown/recovery, governance/privacy, tool recursion, test evidence, docs, and unintended changes.

## Plan Maintenance and Closeout

If implementation evidence changes scope or a frozen contract, update PRD/design/implement and affected roadmap/Handoff/
spec/deferred-decision files before code diverges. After approval: update specs, commit with an English message, archive
only this child task, and do not push.

## Implementation Evidence (2026-08-25)

Waves A-D are implemented in the worktree: strict Shared contracts; migrations 029-030; revision-safe task repository and
content-bearing occurrence outbox; the narrow Croner adapter; deterministic catch-up engine; canonical RunService and
Character-queue adapter; primary-only `schedule_task`; operator methods; boot/shutdown composition; and focused tests.

Implementation evidence refined two details without changing the single-runtime boundary:

- `core.schedule.manage` is an additive Core-local descriptor in the existing registry vocabulary; it uses the existing
  default-auto posture and does not create a second governance store or approval path.
- Core now persists a `user_timezone` singleton initialized to UTC. Fixed IANA schedules are fully active. Updating the
  Timezone Authority Device and live recomputation on a timezone change remain outside this slice because no such
  authority/update surface exists in the current product; the scheduler consumes an injected persisted resolver so
  that later wiring does not alter schedule or Run identities.

Desktop Home/history/delivery remain explicitly outside this slice.

## Formal Check Evidence (2026-08-25)

The formal review fixed and regression-tested four implementation issues before approval: immutable occurrence
Character ownership is captured by append-only migration 030; recurring catch-up selects the latest overdue source
slot before applying the half-period cutoff; failed/pending occurrences are re-armed without busy-looping admitted
waits; and scheduler shutdown awaits an in-flight pass before Core closes the database. Agent schedule management is
bound to the active Character and operator conflicts/refusals use structured application errors.

Shared/Core typechecks, Shared (346) and Core (1730, one skipped) tests, migration lineage/reopen, focused scheduler
tests, root lint, Rust tests (171 + 7 secret-key tests), Trellis validation, and `git diff --check` passed. An isolated
Core boot applied migrations 001-030, listened on a unique loopback port, and emitted a clean scheduler-aware shutdown
sequence; the interactive wrapper returned exit code 1 after SIGINT. The full E2E suite has one reproducible failure in
the pre-existing Host Approval waiting test (`effect-host-lifecycle.e2e.test.ts`); its neighboring lifecycle tests pass,
and the failure is outside Scheduled Task code. It remains a residual gate item for the parent integration run.
