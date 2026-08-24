# Phase E - Integration Mapping

> Scope: map the adopted Harness contract to current TakiAgent seams and assign one owner per lifecycle write path.
> This is a read-only integration plan; it does not alter the production modules listed below.

## 1. Existing Seam Ownership

| Existing seam | Keep as owner of | Harness integration rule |
|---|---|---|
| `server/methods/chat-send.ts` | WS validation, acknowledgement, live delta/complete/error notifications | Convert the request into `TriggerRequest`; it must not own Run state, persistence, or retry policy |
| `agents/turn-queue.ts` / `turn-registry.ts` | Current process-local serialization and AbortSignal transport | Adapt behind Core Admission; durable queue/cancellation becomes the authority, these remain execution plumbing |
| `agents/chat-agent.ts` | AI SDK `ToolLoopAgent` construction, model/tool stream mechanics, existing primary persistence semantics | Add one narrow Run/turn-kind adapter; preserve the stream/persist/abort loop and primary cancel-retract invariants |
| `agents/conversation-store.ts` / `db/timeline-repo.ts` | Relationship Timeline and Replay View source/projection | Never use them as Autonomous Run Event Ledger or fake autonomous user rows |
| `extensions/extension-run-context.ts` | Immutable extension/Host/MCP/Skill snapshot and governed tools | Capture its snapshot in Run context; stale generations settle through Host/Extension contracts |
| `hosts/host-context.ts` | Host identity, connection/catalog generations, routing safety | Include the captured Host tuple in the immutable Run snapshot; never substitute a disconnected Host |
| `memory/memory-coordinator.ts` | Provider-neutral Memory authority/capability dispatch | Capture authority epoch/capability snapshot; Run code stays provider-neutral |
| `server/timeline-subscriptions.ts` | Live relationship notifications | Consume post-commit projections only; do not become execution completion authority |
| `logging/logger.ts` | Pino process diagnostics and privacy-safe fields | Add correlation fields where useful; do not turn Pino into ordered Run trajectory |

## 2. One Write Path Per Lifecycle Concern

- Run/Attempt current state and terminal outcomes: Core Run transition service.
- Run Event facts: Core event ledger writer, called by the same transition/settlement boundary.
- Relationship messages: existing Conversation/Timeline owner, only for primary or explicitly relationship-affecting output.
- Memory mutations: existing Memory coordinator/provider authority.
- Host capability effects: existing Host operation contract and selected Host only.
- Approval decisions: existing Core Approval authority.
- Extension publication: existing extension registry/generation lifecycle.
- Live notifications: projection/subscription consumers after commit.
- Pino diagnostics: process-level logger only.

No adapter may write both a canonical Run fact and a projection as if they were the same record. A projection may retain
the canonical `runId`/`attemptId` link but cannot invent completion or retry state.

## 3. Non-Primary Turn Adapter

The adapter supplies `initiator`/turn kind, Run context, and cancellation to the existing `chat-agent.ts`. For
non-primary turns it suppresses primary-only behavior: unconditional user-row persistence, costume-notice consumption,
user-row retraction, and conversational auto-memory. It keeps model-facing control input separate from persisted user
content and does not fork `ToolLoopAgent`.

The adapter is the only place that translates a Run's context mode into existing Replay/Memory input. Scheduler and
Heartbeat policies choose the mode; they do not reach into Timeline or Memory internals.

## 4. Generation and Stale-Result Wiring

At Run creation, capture Host, Extension, MCP/Skill catalog, Governance/Approval, Memory authority, and model route
generations. Each effect callback carries the captured tuple and an expected Run state version. A mismatch settles the
effect as stale/cancelled/unknown according to its subsystem contract; it is never redirected to a newly published
generation.

## 5. Phase E Exit Criteria

Phase E is complete when an implementation child can name the exact owner and test for every write path above, prove the
chat adapter preserves existing primary behavior, and show that projections cannot mutate or masquerade as Run truth.
