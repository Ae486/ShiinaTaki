# Slice 1 Harness Foundation Design

## 1. Scope and Boundary

This child implements the first production Harness foundation after the staged main `9895dd3` synchronization. It
adds a Core-owned execution lifecycle around the existing AI SDK `ToolLoopAgent`; it does not implement Scheduler,
Heartbeat, delivery policy, the complete observability plane, or a second model loop.

The design follows the parent contracts in `phase-b-harness-contract.md`, `phase-c-persistence-recovery.md`, and
`phase-e-integration-map.md`. Existing production modules remain the owners of chat transport, relationship Timeline,
Memory authority, Host/Extension/Approval, and Pino diagnostics.

## 2. Runtime Flow

```text
primary / scheduled / heartbeat / webhook / subagent provider
                         |
                  TriggerRequest
                         |
                   Core Admission
             (validate, dedupe, lane, snapshot)
                         |
                    Run service
             (Run current state + Attempts)
                         |
                 existing chat adapter
                         |
                 AI SDK ToolLoopAgent
                         |
        primary Timeline output / minimal Receipt evidence
```

Every provider submits the same provider-neutral request. A request is not itself a Run and does not prove that a model
call happened. Admission creates or reuses a Run according to idempotency rules, captures the effective snapshot, and
only then creates an Attempt.

The `chat.send` acknowledgement is additively extended to `{ messageId, runId }`. Admission may await provider-neutral
snapshot reads before entering the short synchronous SQLite transaction; it must never await inside the transaction.
The acknowledgement therefore means that a durable Run was admitted/queued, not that a model call completed.

## 3. Identity and Containment

```text
Character -> Run -> Attempt(s)
                  \
                   -> Run-owned Operation current state
```

- `characterId` is the durable Character/persona/Character Memory boundary.
- `triggerRequestId` identifies provider submission and deduplication; it is not execution history.
- `runId` identifies one logical execution and is the Receipt/query/resume key.
- `attemptId` identifies one provider/model attempt, including retry lineage.
- `taskId` identifies a future Scheduled Task definition when present.
- `parentRunId` provides future Child Run lineage without introducing a second Session authority.
- `Operation` is Run-owned current program-counter state. No standalone `operationId` table or public lifecycle is
  created unless a later slice proves an independent lifecycle/query requirement.
- SDK `sessionId`, if required by an adapter, maps to an existing relationship or Run identity.

Correlation fields such as `turn`, `step`, tool-call IDs, and Host operation IDs may appear in evidence, but they do not
become new aggregates, repositories, migrations, or API authorities in this slice.

## 4. Shared Contracts

Start in `packages/shared`. Schemas should cover:

- `TriggerRequest`: request identity, provider kind/provenance, Character scope, context mode, delivery class,
  idempotency key, deadline/budget hints, optional task/parent Run links, and bounded payload/reference.
- `Run`: identity, initiator, provenance, Character/task/parent links, state, state version, snapshot reference,
  timestamps, terminal outcome, retryability, and Receipt linkage.
- `Attempt`: attempt identity, Run link, provider/model route, state, retry reason, start/deadline/settlement times,
  captured generation references, and bounded result/error summary.
- `RunSnapshot`: immutable effective Character, model/provider, Memory authority epoch, Host, Extension, MCP/Skill,
  Governance/Approval, context, delivery, deadline, budget, replay, and implementation/schema references.
- `RunReceipt` and query/status responses: redaction-safe evidence summaries, not conversation messages.
- Shared error/outcome vocabulary: explicit waiting, cancellation, failure, deadline, skip, and unknown outcome cases.

The exact Zod field layout is implementation work. The schemas must remain additive to existing shared exports and must
not replace Hindsight/Memory control-plane schemas.

## 5. Durable State and Migration

Core remains the only SQLite writer. Use one repository per real aggregate, with a single Run transition service as the
only owner of legal Run/Attempt state changes. The current Run Operation state must be sufficient to answer the next
safe action without replaying an unbounded event stream.

The first migration version is allocated only during implementation after checking that `023` is still the synchronized
lineage endpoint. Planning does not reserve a number. Before writing SQL, test:

1. fresh install;
2. historical T4 `17/18` MCP/Skill lineage;
3. a pre-`021` database applying the committed main `021-023` tail;
4. legal Hindsight authority marker and activation receipt reopen.

Slice 1 persists the minimum current Run/Attempt state, immutable snapshot/reference data, and queryable terminal/Receipt
summary. It does not create the full append-only Run Event Ledger; that is Slice 2. Transition history must not be
silently delegated to Pino or Timeline.

## 6. State Machine and Settlement

Run states:

```text
queued -> running -> waiting/recovering/cancel_requested -> terminal
```

Terminal states are `completed`, `failed`, `cancelled`, `skipped`, `deadline_exceeded`, and `outcome_unknown`.

Attempt states are subordinate and idempotently settleable:

```text
prepared -> intent_committed -> effect_running -> settling -> completed/failed/outcome_unknown
                                      |
                                      -> cancelled/deadline_exceeded
```

Every mutation uses an expected state version and the enclosing identity tuple. A duplicate or late callback is recorded
as stale/duplicate evidence or a no-op and cannot reopen a terminal Run, consume a newer Attempt, or redirect to a newer
Host/Extension/Memory generation.

Slice 1 establishes the durable cancellation transition and process-local `AbortSignal` bridge. After
`cancel_requested`, no new model/tool/Host/MCP/Approval/retry effect may begin. Detailed effect intent/settlement and
crash recovery are later slices, but the state contract must distinguish `outcome_unknown` from ordinary failure.

## 7. Immutable Effective Snapshot

Admission captures one snapshot before the first Attempt. It includes values that affect replay or settlement:

- Character and trigger provenance;
- model/provider route and tool/catalog generations;
- Host, Extension, Governance/Approval, and Memory authority generations;
- context mode, delivery class, deadline, and validated budget policy;
- replay declarations and implementation/schema references.

Later configuration or generation changes affect later Runs, never the current snapshot. The Run service depends on the
provider-neutral Memory coordinator and existing Extension/Host context; it must not import Hindsight-specific APIs or
recreate governance stores.

## 8. Existing Chat Integration

The integration is additive:

- `chat-send.ts` remains the WS validation, acknowledgement, delta, completion, and error boundary. It submits or
  receives a Run handle; it does not own Run persistence or retry policy.
- `turn-queue.ts` and `turn-registry.ts` remain process-local serialization and abort plumbing behind Admission.
- `chat-agent.ts` retains the existing stream, full-turn persistence, cancel/retract, overflow retry, approval, and
  immutable extension context behavior. A narrow turn-kind/autonomous input changes only primary-only assumptions.
- `conversation-store.ts` and `timeline-repo.ts` remain relationship Timeline/Replay authority. Non-primary work does
  not append a fake user row; actual Companion speech may use the ordinary relationship append path only when the later
  delivery contract permits it.
- `AutoMemory` and conversational watermarks run only for primary-compatible turns. Non-primary Memory calls remain
  provider-neutral and do not advance conversational auto-memory state.
- One-shot costume notices are consumed only by primary-compatible turns. Cancellation retracts only a real persisted
  primary user row.
- `extension-run-context.ts`, Host context, and governance snapshots are captured once and reused by overflow retries.

No Scheduler or Heartbeat implementation is placed in `chat-agent.ts` or `chat-send.ts`.

For Slice 1, non-primary turns write no relationship Timeline rows, including assistant/tool tails. Their bounded
outcomes belong to Run/Attempt state and the minimal Receipt. A later delivery slice may explicitly append whole
Companion speech through the ordinary Timeline owner.

## 9. Minimal Receipt and Query Surface

The first query surface returns Run state, active/terminal Attempt summaries, snapshot reference, and a bounded Receipt
summary by `runId`. It must expose truthful state/reason/action information without leaking raw prompts, secrets, full
tool payloads, credential values, or sensor/media content.

The Receipt is a projection/evidence record. It is not a user row, assistant message, Timeline completion authority, or
Replay View input. Full trajectories, categorized event filtering, cursors, and live monitoring belong to Slice 2.

## 10. Compatibility and Rollback

- Existing `chat.send` and `chat.cancel` behavior must remain compatible for primary turns.
- The new adapter should be feature-gated at the composition boundary only if the implementation needs a staged rollout;
  it must not create a second chat runtime or silently select a different Memory authority.
- Migration rollback is forward-compatible migration design plus restoration from the pre-migration database backup; no
  destructive down migration is assumed.
- If a Run transition or snapshot capture fails, the request fails before a model effect and leaves no fake Timeline row.
- If the new adapter cannot prove non-primary behavior is safe, the implementation must stop at the contract seam and
  report the gap rather than silently treating an autonomous turn as a primary chat turn.

## 11. Explicit Non-Goals

- Full Run Event Ledger, trajectory/projection UI, metrics, telemetry, export, or retention sweeps.
- Scheduled Task, Heartbeat, cron/DST, quiet hours, delivery, Home/Pet, D59/D61, or Experience Review.
- Durable orphan recovery worker, automatic unsafe replay, full Host/MCP/Approval effect settlement, or a second model
  loop.
- Plugin-everything refactoring or new extension marketplace semantics.
