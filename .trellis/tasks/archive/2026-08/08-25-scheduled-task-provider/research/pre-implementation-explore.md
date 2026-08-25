# Slice 5A Pre-Implementation Explore

## Live Seams

- `packages/shared/src/harness-schema.ts:17,42-54` already supports `initiator: "scheduled"`, `taskId` provenance,
  delivery/context modes, deadline/budget hints, and bounded `payloadRef`.
- `packages/core/src/harness/run-service.ts:36-79` is the only Core admission/lifecycle service.
- `packages/core/src/db/run-repo.ts` provides idempotent admission, atomic Run/Attempt/Event persistence, start,
  settlement, receipts, and stale callback guards.
- `packages/core/src/server/methods/chat-send.ts:57-172` is the production adapter pattern: admit, Character queue,
  cancellation registry, start, ChatAgent, settle.
- `packages/core/src/main.ts:276-292` composes RunService and scans recovery before normal dispatch.

## Reusable and Missing

Reusable: Run/Attempt/Receipt/Event/Effect/recovery migrations 024-028; Character queue and cancellation drain;
injected time helpers; config precedence; strict Shared/method/repository patterns. `scheduler/sweep-runner.ts` is only
an unref housekeeping timer and explicitly is not a product scheduler.

Missing: schedule schema/table/repository, pattern evaluator, lifecycle engine, catch-up, management methods, Agent
tool, and UI. No Croner dependency is installed.

## Autonomous Constraints

`chat-agent.ts` already supports Run/Attempt identity, `turnKind: "non-primary"`, ephemeral `controlInput`, captured
Run context, and retry callbacks. Its non-primary path suppresses user rows, costume notices, Timeline writes, usage,
auto-memory, and image side effects; existing tests prove these boundaries. Scheduled execution must reuse that seam.

## Persistence and Numbering

The live migration registry ends at 028; old research mentioning migration 005 is stale and must not be reused.
`runs.task_id` already stores `TriggerRequest.provenance.taskId`. Run idempotency alone does not preserve a queued
schedule payload across restart, so a small occurrence/outbox keyed by `(taskId, scheduledFor)` is required.

## Verification and Boundary

Test strict forms/timezones, DST, User Timezone recomputation, one-shot 24-hour and recurring half-period cutoffs,
coalescing, late/missed evidence, duplicate callbacks, single-flight/unref/stop, crash windows, Character serialization,
non-primary behavior, recursion exclusion, migration lineage, isolated boot, and shutdown.

Keep Home/Pet/delivery, Heartbeat, Child Run, knowledge/review, generic DAGs, wake-machine, distributed locks, and
third-party telemetry in later slices.

## Dependency Assessment

Existing project research runtime-probed `croner@10.0.1` as ESM, Node 18+, zero-dependency, with IANA/DST support. Use it
only in a narrow pattern adapter; Core retains persistence, catch-up, idempotency, single-flight, and recovery.
Adding it remains an explicit owner-approval gate.
