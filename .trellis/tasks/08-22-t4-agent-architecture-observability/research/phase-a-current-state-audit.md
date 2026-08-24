# Phase A - Current-State Architecture Audit

> Scope: the current Agent Runtime/Harness and observability architecture task.
> Snapshot: live `main` at `9895dd3`, inspected read-only from `H:/TakiAgent`; T4 planning work remains in
> `H:/TakiAgent-worktrees/t4` at `c652abb`.
> This report is an architecture input, not production implementation authorization.

## 1. Audit Result

TakiAgent currently has a reliable interactive Agent loop and several strong authority/privacy boundaries, but it does
not yet have a complete durable Harness. The existing shape is best classified as:

```text
WS trigger adapter
  -> in-memory per-Character admission/cancel primitives
  -> chat-agent primary-turn adapter
  -> AI SDK ToolLoopAgent
  -> relationship Timeline / Replay View
  -> WS notifications + Pino diagnostics
```

The main architectural gap is above the model loop: there is no Core-owned durable operation state, common Run
orchestrator, append-only execution ledger, or restart recovery contract that all future triggers can share.

This is an incomplete Harness, not a failed architecture. Existing boundaries should be extended and composed rather
than replaced.

## 2. Evidence-Backed Call Graph

| Boundary | Live evidence | Classification | Current responsibility |
|---|---|---|---|
| Composition root | `packages/core/src/main.ts:97-126, 252-313` | composition | Creates DB, Timeline, Memory, extensions, Host/capability routing, turn controls, and the chat agent |
| Interactive trigger | `packages/core/src/server/methods/chat-send.ts:32-47` | trigger/transport adapter | Validates `chat.send`, acknowledges the request, and schedules the streaming pump |
| Admission | `packages/core/src/server/methods/chat-send.ts:64-73`; `packages/core/src/agents/turn-queue.ts:7-35` | in-memory control | Serializes one active turn per Character; exposes only blocking `acquire` |
| Cancellation | `packages/core/src/agents/turn-registry.ts:7-35`; `chat-send.ts:86-96` | in-memory control | Cancels the active stream; queued-but-unstarted work has no durable identity or cancellation state |
| Low-level Agent loop | `packages/core/src/agents/chat-agent.ts:120-230`; `:208` | loop/runtime adapter | Builds the request, creates `ToolLoopAgent`, streams model/tool steps, and handles abort/retry |
| Primary-turn persistence | `chat-agent.ts:146-163, 397-416`; `conversation-store.ts:39-60` | relationship projection/store | Appends user row and response tail; persists safe replay data |
| Replay/context | `conversation-store.ts:98-169`; `docs/adr/0008-replay-view-context-seam.md` | derived projection | Derives summary/window/fold/volatile request view from stored relationship history |
| Relationship Timeline | `packages/core/src/db/timeline-repo.ts:17-85, 141-145` | user-facing projection | Stores Character relationship messages and sanitized tool names, not full execution evidence |
| Extension snapshot | `packages/core/src/extensions/extension-run-context.ts:25-59`; `main.ts:252-313` | process-local snapshot | Captures governed tools/instructions/extension generations for a retryable model context |
| Host boundary | `packages/core/src/hosts/host-context.ts:12-72`; `.trellis/spec/backend/host-operation-lifecycle.md` | effect/governance boundary | Captures Host ownership/generation and defines cancellation/unknown-outcome behavior |
| Memory boundary | `packages/core/src/memory/memory-coordinator.ts:24-98`; `runtime-composition.ts:18-43` | authority/provider boundary | Validates provider, authority epoch, capability snapshot, and stale results |
| Process diagnostics | `packages/core/src/logging/logger.ts:1-22`; `.trellis/spec/backend/logging-guidelines.md` | diagnostic projection | Emits structured Pino logs while excluding prompts, secrets, and bodies |
| Live client output | `chat-send.ts:94-121`; `packages/core/src/server/timeline-subscriptions.ts` | live projection | Sends deltas/status and committed Timeline notifications; not a durable execution source |

## 3. State and Authority Classification

| State/data | Authority class | Why |
|---|---|---|
| SQLite migrations and Core repositories | durable Core authority | Single-writer rule; survives process restart |
| Memory authority selection/epoch | durable domain authority | ADR 0009 and provider coordinator reject silent authority switching |
| Host/Extension current generations | Core/Host governance authority | Stale captured calls fail closed; captured snapshots are valid only for their Run/context |
| Relationship Timeline rows | durable relationship projection | User-visible continuity; deliberately not the full execution ledger |
| Replay View | derived model-input projection | Recomputed per turn and must not rewrite relationship storage |
| `TurnQueue` tails | in-memory execution control | Provides serialization only while this process is alive; no recovery/query contract |
| `TurnRegistry` AbortControllers | in-memory execution control | Represents current active cancellation only; cannot explain queued or crashed work |
| `AgentRunContext` | process-local immutable retry snapshot | Useful precursor to a durable Run snapshot, but lost on process restart |
| Pino logs | diagnostic output | Structured and privacy-aware, but not ordered, durable, or queryable execution evidence |
| WS deltas/notifications | live projection | Useful for clients; cannot prove durable completion or recover missed events |

## 4. Strengths to Preserve

1. **Single Core composition root.** Runtime dependencies and governance wiring are explicit in `main.ts`; a Harness
   should wrap this composition rather than create another bootstrap graph.
2. **One low-level model loop.** AI SDK `ToolLoopAgent` already owns model/tool step mechanics, stop conditions,
   streaming, and abort. The Harness must remain above it.
3. **Primary-turn correctness work is substantial.** Full response tails, cancel-retract, overflow retry, approval
   cancellation, and detached maintenance hooks address real production failure modes.
4. **Replay View is a sound context boundary.** ADR 0008 keeps relationship storage append-only and places compaction,
   windowing, and volatile context in one derived seam.
5. **Privacy and authority boundaries are explicit.** Timeline tool data is sanitized; Memory validates authority and
   provider lineage; Host/Extension generations fail closed; Pino excludes sensitive bodies.
6. **Provider-neutral Memory composition exists.** Future Harness snapshots can capture Memory authority identity without
   importing Local or Hindsight implementation details.

## 5. Harness Gaps

| Gap | Severity | Consequence | Required architecture response |
|---|---|---|---|
| No common Trigger -> Run boundary | Critical | Future chat, Scheduled, Heartbeat, Webhook, and Child Run paths may fork execution logic | Core-owned typed admission request and Run Orchestrator above `chat-agent` |
| No durable current program counter | Critical | After crash, Core cannot determine the next safe action from persisted state | PI-shaped complete mutable operation/attempt state; recovery reads it directly |
| Queue is blocking and active-only | High | Queued work cannot be inspected, cancelled, prioritized, or recovered | Shared Admission contract with durable/request identity and non-destructive status/busy probes |
| Cancellation is not durable | High | No durable explanation of cancellation, drained work, or late settlement | Cancellation state/event plus reconciliation rules; keep AbortSignal as transport mechanism |
| No unified intent/effect/settlement seam | Critical | Provider/tool/MCP/Host uncertainty is handled inconsistently | PI effect sandwich adapted to existing Host `outcome_unknown` rules |
| Timeline is carrying primary persistence, not execution truth | High | Receipts, retries, tool lifecycle, and autonomous evidence cannot be reconstructed | Separate append-only Run Event Ledger and projections |
| Pino is not a trajectory | High | Logs cannot provide ordered Run query, filters, or replay-oriented diagnostics | DSH-style typed events, durable/live planes, and query/trajectory projections |
| No Context Manifest | Medium | Cannot explain the effective context, tool catalog, generations, compaction, or token estimate | Redaction-safe manifest linked to Run/Attempt evidence |
| Usage is detached calibration only | Medium | Cost/usage evidence can be lost or detached from attempts | Authoritative per-attempt usage/effect records; retain detached calibration as a consumer |
| Steering/follow-up semantics absent | Medium | Future interactive control would need ad hoc APIs | Reserve typed queue/control contracts; implement only when a product consumer needs them |
| Recovery/orphan policy absent | Critical | Restart can silently lose, duplicate, or misreport in-flight work | Crash matrix, safe resume/retry/wait/unknown rules and reconciliation worker contract |

## 6. PI Comparison

| PI capability | Current TakiAgent state | Adaptation decision |
|---|---|---|
| Loop vs Harness split | Loop exists; Harness is incomplete | Adopt split; keep `ToolLoopAgent` as loop |
| Session/lane execution scope | Character keyed mutex only | Adapt to internal Character/Run admission scope; do not expose a user Session tree |
| Durable operation metadata + total state | Missing | Adopt as the primary recovery contract |
| Program-counter recovery | Missing | Adopt; current state is authoritative, event ledger is evidence |
| Steering/follow-up/next-run queues | Missing | Reserve typed durable queue semantics; do not add product API prematurely |
| Durable abort + reconciliation | AbortController only | Adopt durable control and explicit settlement, preserving transport abort |
| Intent/effect/settlement | Host partly has it; Runtime lacks a unified form | Adopt and adapt to Core Governance/Approval/Host contracts |
| Tool replay safety | Governance exists, replay declaration is not unified | Adapt `safe/never` semantics with Host contract taking precedence |
| Compaction/navigation | Replay View and summaries exist | Adapt by attaching a manifest and operation evidence, not PI's full tree |
| Typed passive events | No single source | Adopt fixed framework events; observer failures never block execution |
| Telemetry schema | Pino + detached usage exist | Adapt into projections; Pino remains process diagnostics |
| Full branching Session tree | Not present | Reject for current product needs; Character and Timeline are TakiAgent-specific |
| PI `AgentHarness` implementation | Reference implementation incomplete | Use contracts/source evidence only, not as runtime dependency |

## 7. Phase A Exit Decision

Phase A is complete for planning purposes. The next phase should define the Harness contract against this audit, with
the following non-negotiable constraints:

1. The Harness is above the existing model loop and below trigger-specific product policy.
2. Run/Operation/Attempt current state and execution events must have one explicit authority each.
3. Relationship Timeline, Replay View, Memory Authority, Host/Approval, and Extension generations remain separate
   TakiAgent boundaries.
4. DSH monitoring is a projection plane, not a second runtime or persistence authority.
5. T4 Scheduled/Heartbeat/Delivery requirements enter only through compatibility contracts.
