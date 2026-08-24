# Slice 1 Harness Foundation

## Goal

Implement the first production Harness foundation above the existing AI SDK `ToolLoopAgent`. All current and future
trigger providers must enter one Core-owned admission and Run/Attempt lifecycle, while the existing primary chat
behavior remains compatible. This slice establishes durable execution identity, current state, immutable effective
snapshots, minimal Run Receipt/query semantics, and the non-primary turn seam needed by later providers.

## Requirements

- Preserve `characterId` as the project-specific Character/persona and Character Memory boundary.
- Use one compact identity hierarchy: `characterId -> runId -> attemptId`, with optional `triggerRequestId`, `taskId`,
  and `parentRunId` correlation/lineage fields. Do not create separate lifecycle authorities for every identifier.
- Define provider-neutral Shared schemas for Run, Attempt, initiator, provenance, delivery class, outcomes,
  retryability, timestamps, snapshot references, and minimal Receipt/query results.
- Add one Core Admission/Run service that validates a Trigger Request, applies idempotency, selects the existing lane,
  captures the immutable effective snapshot, and owns legal state transitions and terminal settlement.
- Persist Run current Operation/program-counter state and subordinate Attempts with optimistic version checks and
  idempotent settlement. Do not introduce a standalone `operationId` aggregate in this slice.
- Allocate a strictly ordered migration only after the staged `023` lineage is verified in this worktree. Cover fresh,
  historical T4, committed main, and legal Hindsight marker/receipt reopen paths.
- Adapt `chat-agent.ts` through a narrow turn-kind/autonomous input seam. Keep `ToolLoopAgent` as the only model loop.
- For non-primary turns, suppress fake user-row persistence, one-shot costume-notice consumption, user-row retraction,
  and conversational auto-memory watermark advancement. Keep autonomous control input separate from persisted content.
- Keep relationship Timeline/Replay, Memory authority, Host/Extension/Approval, and Pino ownership in their existing
  modules. Run state and Run evidence must not be written by projections or diagnostic logging.
- Provide a minimal query/status path by `runId`; a Run Receipt is evidence and must not become a synthetic conversation
  message or enter the default Replay View.

## Acceptance Criteria

- [ ] Fresh and all known synchronized historical migration lineages converge and reopen as a no-op.
- [ ] Shared/Core typecheck, lint, focused unit/integration tests, and a real Core boot pass.
- [ ] Legal Run/Attempt transitions reject invalid transitions and terminal settlement is idempotent.
- [ ] Duplicate and late callbacks cannot reopen a terminal Run, mutate a newer state version, or redirect to a newer
      Host/Extension/Memory generation.
- [ ] One Run captures one immutable effective snapshot and ordered Attempts; retries create new Attempts without
      creating a new Run.
- [ ] `completed`, `failed`, `cancelled`, `skipped`, `deadline_exceeded`, `waiting`, and `outcome_unknown` remain
      distinguishable wherever applicable.
- [ ] Primary chat lifecycle tests remain green, including full tool-call/result persistence, cancellation/retraction,
      overflow retry, approval cancellation, and Timeline/Replay behavior.
- [ ] Non-primary turn tests prove no fake user row, no costume-notice consumption, no user-row retraction, and no
      conversational auto-memory watermark advance.
- [ ] Every Run is queryable by `runId`; Receipt output is non-conversational evidence.
- [ ] No Scheduler timers, Heartbeat eligibility/budgets, proactive delivery UI, full event ledger/monitor, or second
      model loop is introduced.

## Frozen Implementation Decisions

The owner delegated implementation-level choices to the engineering lead when they are source-grounded, beneficial,
compatible, and not contradicted by stronger project requirements. The live-code audit in
`research/implementation-seams.md` supports the following decisions:

- Extend the `chat.send` acknowledgement additively to `{ messageId, runId }`, preserving `messageId` for existing
  client correlation while exposing the durable admission/query key.
- Prohibit non-primary relationship Timeline writes in Slice 1. Non-primary outcomes are represented by Run state and
  the minimal Receipt; ordinary whole-message delivery is a later slice.
- Permit Admission to await provider-neutral snapshot reads before the short synchronous SQLite transaction. Never
  await inside `db.transaction`.

## Definition of Done

- Child-specific PRD, design, implementation plan, and curated check context are complete and validated.
- Production changes are limited to the approved Slice 1 boundary and preserve existing module ownership.
- Unit, integration, migration, boot, privacy/redaction, and primary-regression evidence is recorded.
- Relevant `index.md`, executable specs, deferred decisions, and T4 handoff records are updated when contracts change.
- A final full-scope quality check passes; manual acceptance remains explicitly owner-confirmed.

## Out of Scope

- Scheduled Task parsing/CRUD, cron/at/every, timezone/DST, catch-up, or scheduler policy.
- Heartbeat eligibility, quiet hours, Class B budgets, structural silence, or autonomous delivery policy.
- Complete append-only Run Event Ledger, trajectory UI, live event plane, telemetry export, or projection rebuild system.
- Full Host/MCP/Approval effect intent-settlement integration and orphan recovery worker; Slice 1 only establishes the
  contracts and state needed by later slices.
- Child Run execution policy, procedural knowledge, Experience Review, Home/Pet UI, and D59/D61 delivery convergence.
- Replacing or duplicating the AI SDK `ToolLoopAgent`, Timeline authority, Memory provider, Approval store, or Pino
  diagnostics.

## Technical Notes

- Parent architecture and reference decisions: `../08-22-t4-agent-architecture-observability/`.
- Authoritative cross-module handoff: `docs/T4-HANDOFF.md`.
- Existing execution anchors: `packages/core/src/server/methods/chat-send.ts`, `packages/core/src/agents/chat-agent.ts`,
  `turn-queue.ts`, `turn-registry.ts`, `conversation-store.ts`, `turn-mapping.ts`, and `packages/core/src/main.ts`.
- Existing ownership maps: `research/phase-b-harness-contract.md`, `research/phase-c-persistence-recovery.md`, and
  `research/phase-e-integration-map.md` in the parent task.
- Implementation-readiness audit: `research/implementation-seams.md`.
- YCE is disabled. Any future semantic code exploration uses `jbcontext` from the T4 worktree, followed by direct reads
  and exact `rg` searches.
