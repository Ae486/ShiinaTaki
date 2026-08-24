# TakiAgent Current Architecture Assessment

## Scope and evidence

This report is based on the T4 worktree at the time of planning. It is an assessment of current boundaries, not a claim that the production implementation is already T4-complete.

Primary evidence:

- `packages/core/src/main.ts:1-6, 87-113, 264-347` — Core composition, timeline/memory setup, turn controls, chat-agent wiring, and method registration.
- `packages/core/src/agents/chat-agent.ts:1-112, 137-184, 186-315, 325-339` — streaming Agent runtime, context/tool assembly, retry, persistence, cancellation retraction, detached writes, and usage seam.
- `packages/core/src/server/methods/chat-send.ts:1-121` — operator RPC boundary, queue acquisition, active-turn registration, streaming notifications, cancellation and error translation.
- `packages/core/src/agents/turn-queue.ts:1-36` — per-key async mutex with blocking `acquire` only.
- `packages/core/src/agents/turn-registry.ts:1-35` — active AbortController registry and cancellation.
- `packages/core/src/agents/conversation-store.ts:1-170` — SQLite timeline projection and replay-window/summary view.
- `packages/core/src/db/timeline-repo.ts:1-145` and `packages/core/src/agents/turn-mapping.ts:1-116` — names-only tool-call persistence, sanitized tool results, and replay conversion.
- `packages/core/src/logging/logger.ts:1-22` — Pino structured logger with TTY pretty output and raw JSON otherwise.

## Current runtime shape

```text
WS chat.send
  -> chatSendMethod
  -> TurnQueue.acquire(characterId)
  -> TurnRegistry.begin(characterId)
  -> ChatAgent.stream(params, TurnContext)
  -> ToolLoopAgent.stream(messages, abortSignal)
       -> memory/core/character/extension tools
       -> model/tool steps and approval boundary
  -> ConversationStore append/retract
  -> TimelineRepo + timeline subscriptions
  -> chat.delta / chat.complete / chat.error
```

`main.ts` is the composition root. It creates the database-backed timeline and memory subsystem, extension/Skill/MCP composition, host/capability routing, perception layer, and turn controls, then injects these into `createChatAgent` (`main.ts:120-160`, `main.ts:233-249`, `main.ts:257-347`).

`chat-agent.ts` is a capable but still user-turn-oriented runtime. It appends one user row before the model attempt (`chat-agent.ts:137-154`), builds a replay/context request and `ToolLoopAgent` (`chat-agent.ts:190-227`), persists SDK response messages after streaming (`chat-agent.ts:229-261`), and performs cancel-before-output retraction by deleting that user row (`chat-agent.ts:325-339`). It also fires auto-memory/image writes and usage calibration only after a committed user turn (`chat-agent.ts:288-315`).

`chat-send.ts` is responsible for operator-facing transport behavior, while queue serialization and active cancellation are separate small components (`chat-send.ts:62-73`, `turn-queue.ts:15-35`, `turn-registry.ts:16-34`).

The durable relationship timeline is intentionally sanitized: tool-call rows persist names, not raw input (`turn-mapping.ts:38-70`, `timeline-repo.ts:141-145`), and replay reconstructs empty tool-call inputs (`turn-mapping.ts:88-116`). This is a good privacy boundary but is not sufficient as a full execution trace.

## Strengths to preserve

1. **Single Core composition root and dependency injection.** `main.ts` wires the runtime explicitly, making governance, memory, extensions, and transport seams visible and testable.
2. **One existing model loop.** `ToolLoopAgent` already owns streaming, tool steps, stop conditions, abort signals, and usage. A T4 Harness should wrap this loop rather than fork or replace it.
3. **Per-character serialization and cancellation.** The queue and registry prevent interleaved timeline commits and provide an existing cancellation path.
4. **Immutable extension context for retries.** `runContext` is captured once and reused across the classified overflow retry (`chat-agent.ts:153-179`, `main.ts:312-313`), which is a useful precursor to a Run snapshot.
5. **Privacy-aware timeline projection.** Raw tool-call arguments are not stored or replayed. Any execution ledger must preserve the same redaction intent while adding diagnostic metadata.
6. **Detached maintenance seams.** Auto-memory, image-memory, and usage calibration do not add latency to the user-facing stream (`chat-agent.ts:288-315`). This supports fixed-code observability with the same non-blocking principle.

## Architectural gaps for T4

### 1. No common Trigger -> Run boundary

The current entrypoint is `chat.send`. There is no typed Trigger Provider registry, Run Orchestrator, or common execution identity that a scheduler and heartbeat can share. Adding heartbeat as a timer inside `chat-agent.ts` would entangle trigger eligibility with model execution and make future providers expensive.

**Recommendation:** introduce a Core-owned `TriggerEvent` and `RunOrchestrator` above the existing Agent runtime. `chat.send`, scheduled fires, heartbeat eligibility, flush, and subagent work should all become initiators into the same Run/Attempt lifecycle.

### 2. User-turn assumptions inside the Agent runtime

`runTurn` unconditionally persists a user row (`chat-agent.ts:137-154`). Cancellation retraction assumes that row exists (`chat-agent.ts:325-339`). Detached auto-memory is called for every committed turn (`chat-agent.ts:288-296`). Costume-change notice consumption and user-message context construction also sit on this path (`chat-agent.ts:213-221`). These assumptions are correct for primary chat, but unsafe for silent/heartbeat/autonomous runs.

**Recommendation:** add a narrow turn-kind/autonomous input contract. Non-primary runs must be able to carry model control input without a synthetic user row; skip user-row retraction and conversational auto-memory; keep volatile context and costume notices explicit and policy-controlled.

### 3. Queue visibility is incomplete

`TurnQueue` exposes only a blocking `acquire` (`turn-queue.ts:7-13`). `TurnRegistry` tracks only the active controller, and its own comment states queued-but-unstarted work is not cancellable (`turn-registry.ts:7-14`). A heartbeat busy check that reads only the active registry can race with queued user work.

**Recommendation:** add a non-destructive `tryAcquire`/busy probe or a queue status API. The probe belongs to the queue, not to heartbeat-specific code, so future trigger providers can share the same serialization policy.

### 4. Timeline is not an execution ledger

`ConversationStore` and `TimelineRepo` persist relationship messages and sanitized tool projections. They have no Run ID, Attempt ID, trigger provenance, model request/response metadata, context manifest, retry lineage, or delivery outcome. Pino logs are structured but distributed across modules and are not a queryable, ordered Agent trajectory (`logging/logger.ts:1-22`).

**Recommendation:** add a separate append-only Execution Event Ledger keyed by `runId`/`attemptId`, then project Run Receipts, readable timelines, and developer detail views. Keep relationship timeline ownership unchanged.

### 5. Context assembly has no first-class manifest

`chat-agent.ts` composes instructions, replay history, volatile context, skills/avatar instructions, and tools, and estimates input usage (`chat-agent.ts:193-224`, `chat-agent.ts:304-315`). The runtime does not persist which source sections, tool catalog generation, memory provider state, compaction result, or token estimates were effective for a specific attempt.

**Recommendation:** create an internal redaction-safe Context Manifest emitted as an event and attached to the Run/Attempt receipt. It should record section IDs/hashes, counts, estimated tokens, compaction boundary, provider/model identity, and extension generations, not raw private content.

### 6. Retry and terminal semantics are local to the chat loop

The current overflow retry is useful and deliberately side-effect-aware (`chat-agent.ts:155-179`), but a future scheduler/heartbeat needs a durable Attempt record, deadline, retryability, and terminal outcome independent of a single streaming call. Otherwise a process crash can lose whether work was claimed, started, delivered, or left unknown.

**Recommendation:** move Run/Attempt identity and settlement above `chat-agent.ts`; retain the existing overflow retry as one attempt-internal policy initially, while recording it in the common ledger.

## Proposed T4 target shape

```text
TriggerProviderRegistry
  -> TriggerEvent (provider + due/provenance + delivery class)
  -> RunOrchestrator
       -> Run record + immutable effective snapshot
       -> Attempt record(s)
       -> ChatAgent/AgentHarness adapter
            -> existing ToolLoopAgent
            -> existing governance/host/tool seams
       -> Delivery policy
  -> ExecutionEventLedger
       -> RunReceipt / operator timeline / trajectory / metrics
```

The Harness should own lifecycle, context manifest, cancellation/steering/follow-up, attempt settlement, and event emission. The low-level loop should continue to own model/tool step mechanics. Trigger providers should be replaceable and composable; no provider should be allowed to write directly to the relationship timeline or bypass the Run Orchestrator.

## Adopt / adapt / reject matrix

| Area | Decision | TakiAgent application |
|---|---|---|
| Agent loop vs Harness split | Adopt | Keep AI SDK loop; add a Core lifecycle/orchestration layer around it. |
| Durable Run/Attempt identity | Adopt | Use T4 `runId`/`attemptId`; do not use SDK session IDs as a second history authority. |
| Trigger providers | Adopt/adapt | Introduce typed providers for scheduled/heartbeat/etc.; keep provider mechanics outside the Agent loop. |
| Context manifest | Adapt | Record redaction-safe section IDs/hashes and token/compaction metadata, not raw prompt text by default. |
| Append-only execution events | Adopt/adapt | Add a separate ledger and projections; keep timeline rows as relationship output only. |
| Full raw prompt/tool payload logging | Reject | Violates existing privacy and secret boundaries; provide controlled developer detail instead. |
| Plugin-everything architecture | Reject/adapt | Stable Core lifecycle interfaces with optional provider adapters; do not turn every subsystem into a plugin. |
| Direct model-visible logging tool | Reject | Logging is fixed framework code and must not consume Agent budget. |
| Fixed heartbeat timer | Reject | Heartbeat is one configurable Trigger Provider; cron/at/every/events/commitments can be added later. |
| New autonomous chat loop | Reject | Reuse `ToolLoopAgent` through additive turn-kind and Run context seams. |
| Projection-oriented trajectory UI | Adopt/adapt | Readable categorized event projections with filters and inspector; never raw JSON dump. |

## Recommended first production slice

1. Shared Run/Attempt schemas and legal state transitions.
2. Immutable effective context snapshot and redaction-safe Context Manifest.
3. Core Run Orchestrator accepting typed TriggerEvents.
4. Append-only execution event ledger with fixed-code emission at Run, Attempt, model, tool, persistence, and delivery boundaries.
5. Additive autonomous turn-kind seam in `chat-agent.ts`.
6. Run Receipt query/projection and a minimal categorized event API.
7. Queue busy probe and focused tests for primary/non-primary coexistence.

Scheduler persistence and Heartbeat eligibility should follow this foundation, not precede it.

## Risks and open questions

- Event persistence policy (SQLite table, retention, payload size, detail levels) needs an explicit decision before high-volume tool traces are enabled.
- The ledger must define ordering across synchronous Core events, asynchronous model usage promises, detached memory jobs, and transport notifications.
- Developer visibility and user visibility need separate redaction/projection policies; enabling monitoring must never reveal secrets or private sensor material.
- Steering/follow-up semantics are not currently represented in `chat.send`; their authority and persistence need to be defined before adding them.
- Queue busy probes must be race-safe and must not cancel or consume a waiting user turn.

## Confidence

High confidence for the current call graph and privacy/timeline boundaries because they are directly visible in the cited source. Medium confidence for the proposed Harness/event ledger shape because it incorporates T4 requirements and is intentionally a design recommendation, not an existing implementation fact.
