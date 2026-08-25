# Slice 5A - Scheduled Task Provider Design

## 1. Boundary

Scheduled Tasks are a Trigger Provider above the existing Harness, not a second Agent runtime.

```text
Agent tool / operator method
  -> ScheduledTaskService -> schedule repository
  -> ScheduleEngine (durable boot reconciliation + live timer)
  -> occurrence outbox keyed by (taskId, scheduledFor)
  -> RunService.admit(TriggerRequest)
  -> existing Character TurnQueue + ChatAgent non-primary turn
  -> existing Run/Attempt/Event/Effect/Receipt/Recovery authority
```

PI supplies the one Harness path and immutable Run/Attempt lifecycle. OpenClaw/Hermes/platform schedulers supply
persisted definitions, coalesced catch-up, and same-row Agent/operator management. Croner is only a calendar adapter.

## 2. Data Model

### `schedules`

Append the next migration after the live registry is rechecked (029 for the aggregate/outbox, followed by 030 for the
immutable occurrence Character backfill). Store `task_id`, `revision`,
`character_id`, bounded `name`, canonical schedule JSON, timezone policy/ID, bounded `control_input`, enabled/state,
derived `next_run_at`, source-slot marker, last `run_id`, creator, and timestamps. Source wall-clock intent is
authoritative; `next_run_at` is a query index and is recomputed after restart/timezone changes.

### `schedule_occurrences`

Use `(task_id, scheduled_for)` as the primary key, with captured task revision, fired time, late flag, bounded payload
snapshot, `pending/admitted/terminal/missed` state, linked `run_id`, and timestamps. This is a scheduler-to-Harness
outbox, not a second execution history. Retain payload only until terminal reconciliation, then scrub/delete it under
one explicit tested policy.

The Run idempotency key is a deterministic encoding/hash of `{ provider: "scheduled-task", taskId, scheduledFor }`.
Claim, admit, link, start, and settle are crash-safe and repeatable: a restart reuses the same occurrence and Run.

## 3. Pattern and Time Semantics

`at` stores an ISO instant as UTC and fires once. `every` stores a positive bounded interval and anchor, deriving slots
from the anchor. `cron` stores a canonical expression plus follow-user or fixed IANA timezone. `schedule-pattern.ts` is
the only Croner importer and validates by constructing the evaluator and forcing next-run calculation.

The frozen policy is one-shot catch-up within 24 hours, recurring catch-up within half a period, one coalesced run,
explicit late evidence, and explicit missed state beyond the cutoff. All evaluators accept injected clocks. DST behavior
comes from the tested adapter; source wall-clock intent remains authoritative when User Timezone changes.

## 4. Services and Runtime Adapter

- `ScheduledTaskRepo`: strict row parsing, revision-safe CRUD, due queries, occurrence claim/linkage, and reconciliation.
- `ScheduledTaskService`: shared Agent/operator command boundary, validation, timezone resolution, and post-commit re-arm.
- `ScheduleEngine`: hydrate after Harness recovery, reconcile catch-up, arm/re-arm/stop jobs, single-flight and
  never-throw timer boundary. It never builds prompts or owns Run settlement.
- `ScheduledRunAdapter`: builds the frozen Scheduled TriggerRequest, calls RunService, acquires the existing Character
  queue, and invokes ChatAgent with `turnKind: "non-primary"`, ephemeral `controlInput`, captured Run context, and
  existing retry/cancel/failure/settle seams.

Scheduled turns must not create a fake user row, consume costume notices, run conversational auto-memory, or expose
`schedule_task`; existing Host/MCP/Skill/Memory/Approval/Effect/recovery rules remain authoritative.

## 5. API and Composition

Add strict Shared schedule schemas and method names. Thin operator-only list/create/update/pause/resume/delete methods
and one action-discriminated `schedule_task` tool call the same service. Register the tool only for primary interactive
turns. Desktop Home, delivery, Pet, and receipt projections remain later work.

Boot: migrations -> Harness composition/recovery -> scheduler repository/service/adapter -> occurrence reconciliation ->
arm timers -> normal traffic. Shutdown: stop scheduler -> seal/cancel/drain existing Runs -> close transports/database.

## 6. Dependency and Rollback

Use `croner` only behind the pattern adapter; no scheduler framework, ORM, distributed lock, or plugin container is
needed. Adding it is a new dependency and requires owner approval. The additive migration leaves existing installations
unchanged with zero schedules; application rollback leaves unused tables intact and must fail closed for scheduled
dispatch if the scheduler cannot hydrate.

Implementation evidence may change this baseline. Update PRD/design/implement and roadmap/Handoff/spec/deferred
decisions before silently changing a frozen contract or scope.
