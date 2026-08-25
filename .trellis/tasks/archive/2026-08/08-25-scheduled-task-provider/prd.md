# Slice 5A - Scheduled Task Provider and Trigger Admission

## Goal

Implement the first Phase G / T4 consumer on top of the completed Harness foundation: durable user- and Agent-managed
Scheduled Tasks whose `at`, `every`, and `cron` occurrences enter the existing Core-owned
`TriggerRequest -> RunService -> Run/Attempt/Event/Receipt` path and execute through the existing ChatAgent runtime.

This task is the Scheduled Task wave under the architecture roadmap's broad Slice 5. It corresponds to the Scheduled
Task engine described as downstream Slice 2 in `docs/T4-HANDOFF.md`; the older product numbering remains unchanged.

## Requirements

### Domain and persistence

- `taskId` identifies one durable Scheduled Task definition. Every due occurrence creates or reuses one Run identified
  by the existing `runId`; no scheduler-specific execution/session authority is introduced.
- Store one canonical Scheduled Task aggregate per row, including Character ownership, operator-visible name, bounded
  control input, schedule form, timezone policy, enabled/state fields, optimistic revision, and derived timing state.
- Support the frozen canonical schedule forms:
  - `at`: one absolute instant persisted in UTC;
  - `every`: a bounded recurring duration with a persisted anchor;
  - `cron`: a canonical cron expression interpreted in an explicit IANA timezone.
- Core owns one persisted User Timezone. A schedule may follow that timezone or pin an IANA timezone. Persisted source
  wall-clock intent is authoritative; `nextRunAt` is derived and must be recomputed after restart or User Timezone
  changes.
- Pause, resume, edit, and delete are durable mutations over the same rows used by Agent tools and operator APIs.
- Add an internal durable occurrence/outbox record keyed by `(taskId, scheduledFor)` rather than a new public
  `occurrenceId`. It must preserve the admitted payload and bridge crash windows between due-time selection, Run
  admission, and execution without creating a second Run history.
- Schedule and pending occurrence content is canonical work configuration, not observability data. It must not be
  copied into Run Events, Pino fields, receipts, telemetry attributes, or user-facing diagnostics.

### Scheduling behavior

- Evaluate schedules deterministically with injected clocks in tests. The live timer layer must be single-flight,
  never-throwing, explicitly stoppable, and must not keep the Core process alive.
- Validate schedule form and IANA timezone at write time. Natural-language date interpretation remains the creating
  Agent's responsibility; Core persists only canonical forms.
- Apply the frozen catch-up contract:
  - an overdue one-shot may run once when no more than 24 hours late;
  - an overdue recurring task may run once when no more than half its period late;
  - arbitrary missed backlog is coalesced to at most one occurrence;
  - an executed catch-up is marked late with both scheduled and actual fire times;
  - work beyond the cutoff is recorded as missed and is not silently executed.
- A one-shot becomes terminal after its occurrence is successfully admitted or truthfully marked missed. Recurring
  tasks derive the next slot from the persisted source schedule rather than from callback completion time.
- Editing, pausing, resuming, deleting, restarting, or receiving a duplicate timer callback must not duplicate a
  `(taskId, scheduledFor)` occurrence or Run.
- Scheduled Tasks serialize through the existing per-Character turn queue with ordinary user turns.

### Harness and Agent runtime

- Every live or catch-up occurrence submits a strict `TriggerRequest` with:
  - `initiator: "scheduled"`;
  - `deliveryClass: "class_a"`;
  - `contextMode: "autonomous"`;
  - `provenance.provider: "scheduled-task"`;
  - `provenance.taskId` set to the Scheduled Task identity;
  - a deterministic occurrence idempotency key derived from `taskId` and `scheduledFor`.
- The provider must call the existing `RunService`; it must not create another model loop, Run store, Attempt store,
  event stream, receipt store, recovery coordinator, or queue identity.
- Scheduled execution uses ChatAgent as a non-primary turn with ephemeral `controlInput`. It must not append a fake
  user row, consume a costume-change notice, retract a nonexistent user row, or invoke conversational auto-memory.
- The exact pending occurrence payload must remain recoverable until the linked Run reaches a terminal state. Once
  terminal, content-bearing outbox data is removed or scrubbed while the Run ledger remains the execution evidence.
- The `schedule_task` Agent tool must be unavailable inside a Scheduled Run, preventing recursive schedule creation.
- Existing Host, MCP, Skill, Memory, Governance, Approval, Effect, deadline, budget, and recovery contracts remain in
  force. Unattended ask/approval paths fail closed or produce existing waiting/failure evidence; the scheduler does not
  bypass them.
- Provider/model failure produces a truthful Run outcome and Receipt with bounded, redacted evidence; it is never
  reported as a successful schedule execution.

### Management surfaces

- Provide strict Shared schemas and operator-only Core methods for list, create, update, pause, resume, and delete.
- Provide one compact action-discriminated `schedule_task` Agent tool over the same repository and validation service.
- Agent and operator mutations must observe the same revision/conflict rules and must re-arm the live scheduler only
  after the durable mutation commits.
- Desktop Home management UI, Run Receipt projection, Pet delivery/restoration, and user-facing schedule history are
  reserved for a later projection/client slice. This task must expose a stable readable API for those consumers.

### Compatibility and maintainability

- Append a new migration only after rechecking the live migration registry. The planning baseline ended at 028; this
  slice owns append-only migrations 029-030 and no historical research migration number may be reused.
- Reuse the existing config, repository, method-registration, tool-design, logging, and test patterns. Do not turn the
  maintenance `sweep-runner` into the product scheduler.
- Keep cron/calendar evaluation behind one narrow adapter so the rest of Core is independent of a concrete library.
- The implementation plan is a living baseline. Evidence discovered during implementation may update the task
  boundary, contracts, migration shape, or internal waves, but the planning artifacts and compatibility impact must be
  updated before the code silently diverges.

## Acceptance Criteria

- [ ] Shared schedule schemas strictly validate canonical `at`, `every`, and `cron` definitions, timezone policy,
      bounded control input, mutations, and readable results.
- [ ] A fresh database and every maintained historical lineage migrate through the new append-only schedule migration
      and reopen as a no-op.
- [ ] Repository tests prove CRUD, optimistic revision conflicts, Character ownership, pause/resume/delete behavior,
      strict row parsing, and bounded fields.
- [ ] Pattern tests prove invalid forms/timezones fail at write time and cover DST spring gaps, DST fall ambiguity,
      one-shot UTC behavior, recurring anchors, and deterministic next-slot calculation.
- [ ] Catch-up tests prove the 24-hour one-shot cutoff, recurring half-period cutoff, one-run coalescing, late evidence,
      missed evidence, and restart/timezone recomputation.
- [ ] Occurrence/outbox tests prove crash recovery and idempotency across select, persist, admit, link, start, and settle
      boundaries without a duplicate Run or lost due occurrence.
- [ ] Every occurrence enters the existing RunService with the frozen Scheduled TriggerRequest fields and is queryable
      through existing Run status, queue, event, receipt, and recovery paths.
- [ ] Scheduled execution shares the per-Character queue, runs ChatAgent as non-primary, and preserves all existing
      Timeline, costume, attachment, auto-memory, Memory effect, Effect lifecycle, and overflow-retry behavior.
- [ ] `schedule_task` is available to permitted primary Agent turns and structurally absent from Scheduled Runs.
- [ ] Operator methods and the Agent tool mutate the same rows and return actionable validation/conflict errors without
      exposing raw database or protocol internals.
- [ ] Scheduler callbacks are single-flight, never throw out of the timer boundary, use unref'd timers, and stop before
      database/RunService shutdown.
- [ ] Focused Shared/Core tests, full Shared/Core test suites, relevant E2E tests, typecheck, lint, migration lineage,
      isolated Core boot/shutdown, Trellis validation, and `git diff --check` pass.
- [ ] One implementation agent and one final formal check agent are used for this slice; the final check has no blocking
      findings before commit/archive.

## Definition of Done

- Production code, tests, migration, Shared exports, method registration, scheduler lifecycle wiring, and relevant
  package index/header documentation are complete.
- Task design, implementation plan, context manifests, roadmap/deferred-decision/spec notes, and T4 handoff evidence
  reflect the implemented contracts and residual risks.
- Automated evidence distinguishes passed, failed, skipped, unavailable, and manual-only checks.
- No push, rebase, reset, force operation, or edit outside `H:/TakiAgent-worktrees/t4` is performed.

## Out of Scope

- Heartbeat eligibility, Class B budgets, quiet hours, commitments, and `heartbeat_respond`.
- Desktop Home schedule management UI, Run Receipt UI, Pet delivery, proactive message restoration, and D59/D61
  convergence.
- Child Run/subagent execution, generic work-item/task DAGs, mailboxes, or recursive scheduling.
- Procedural Knowledge and Experience Review.
- Waking a sleeping machine, distributed/multi-process locks, remote scheduler services, and third-party telemetry.
- A separate low-level Agent runtime or provider-specific Run/Attempt/Event/Receipt system.
- Persisting raw schedule content into logs, events, receipts, telemetry, or the relationship Timeline.

## Research References

- `research/pre-implementation-explore.md` - live code seams, gaps, boundary, and verification matrix.
- `.trellis/workspace/pleia/t4-scheduler-cron.md` - verified Croner 10 behavior and comparable catch-up designs.
- `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-f-t4-compatibility.md` - frozen provider/Core boundary.
- `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-g-slices-gates.md` - Slice 5 consumer placement and gates.
- `.trellis/tasks/08-22-t4-agent-architecture-observability/research/pi-harness.md` - one Harness/runtime path and effect/recovery invariants.
- `docs/ARCHITECTURE-ROADMAP.md` and `docs/T4-HANDOFF.md` - living architecture baseline and frozen product contracts.
