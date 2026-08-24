# Slice 1 Live Execution Chain

> Read-only planning audit performed from `H:/TakiAgent-worktrees/t4` on 2026-08-23. The optional context-explorer
> sub-agent failed with a service-side 503 and produced no findings or changes. The evidence below comes from one focused
> `jbcontext search`, direct file reads, and exact `rg` follow-up. YCE was disabled and not used.

## 1. Current Primary Entry and Process-Local Control

- `packages/core/src/server/methods/chat-send.ts:32` registers the operator-only `chat.send` method and immediately
  returns a `messageId` acknowledgement.
- `chat-send.ts:64` acquires the existing per-Character queue before starting work.
- `chat-send.ts:76` binds the initiating connection, `AbortController`, delta/complete/error notifications, and
  cancel-before-reply retract reporting.
- `packages/core/src/agents/turn-queue.ts:15` owns the current in-memory keyed FIFO serialization.
- `packages/core/src/agents/turn-registry.ts:16` owns the current active controller per Character and idempotent cancel.

Slice 1 must place Core Admission and durable Run state above this plumbing. `chat-send.ts` remains transport and live
notification code; the queue/registry remain process-local execution mechanics until the later durable admission and
recovery slice strengthens them.

Frozen tests:

- `packages/core/src/server/methods/chat-send.test.ts:43` - same-Character serialization.
- `chat-send.test.ts:74` - active cancellation and normal exchange closure.
- `chat-send.test.ts:126` - cancel-before-reply retract notification.
- `packages/core/src/agents/turn-queue.test.ts:6` - FIFO and cross-Character concurrency.
- `packages/core/src/agents/turn-registry.test.ts:4` - idempotent cancel and controller replacement safety.

## 2. Single Model Loop and Existing Per-Turn Flow

- `packages/core/src/agents/chat-agent.ts:39` exposes the current `ChatAgent.stream` seam.
- `chat-agent.ts:146` begins one logical primary turn.
- `chat-agent.ts:160` unconditionally appends the primary user row.
- `chat-agent.ts:162` captures one `AgentRunContext` before the overflow retry loop.
- `chat-agent.ts:199` composes each provider attempt.
- `chat-agent.ts:208` constructs the only AI SDK `ToolLoopAgent`.
- `chat-agent.ts:230` injects the one-shot costume notice and volatile turn tail into the model-facing copy.
- `chat-agent.ts:301` fires conversational auto-memory after a committed turn.
- `chat-agent.ts:412` persists completed assistant/tool messages through the existing Conversation store.

Slice 1 should adapt the input and persistence policy around this loop. It must not fork `runAttempt`, instantiate a
second autonomous `ToolLoopAgent`, or bypass the existing full-turn persistence and overflow safety logic.

Frozen tests:

- `packages/core/src/agents/chat-agent-lifecycle.test.ts:27` - full tool-call/result persistence, base prompt, partial
  persistence, and cancel-before-output retract.
- `packages/core/src/agents/chat-agent-overflow.test.ts:42` - one safe overflow retry.
- `chat-agent-overflow.test.ts:57` - one immutable Run extension context reused across retry.
- `packages/core/src/agents/chat-agent-approval.test.ts:42` - interactive Approval and unattended fail-closed behavior.
- `packages/core/src/agents/chat-agent-costume.test.ts:23` - one-shot costume notice, model-only and never persisted.
- `packages/core/src/agents/chat-agent.test.ts:112` - detached conversational auto-memory after commit.
- `chat-agent.test.ts:154` and `:179` - retract versus partial-output auto-memory behavior.
- `packages/core/src/agents/chat-agent-tail.test.ts:47` - volatile tail remains in-flight and never persisted.

## 3. Relationship Timeline and Replay Authority

- `packages/core/src/agents/conversation-store.ts:44` appends user rows.
- `conversation-store.ts:50` commits assistant/tool turn messages.
- `conversation-store.ts:52` removes the exact retracted Timeline row.
- `conversation-store.ts:54` constructs Replay View history from stored rows.
- `packages/core/src/db/timeline-repo.ts` remains the durable relationship Timeline repository.

Slice 1 cannot use Timeline rows as Run truth or Run Event records. Primary chat keeps its existing persistence path.
Non-primary control input must be supplied in-flight without a synthetic user row. A minimal Run Receipt remains a
separate evidence/query projection and does not enter default Replay View.

Frozen tests:

- `packages/core/src/agents/conversation-store.test.ts:41` - ordered replay.
- `conversation-store.test.ts:54` - Character isolation.
- `conversation-store.test.ts:82` - exact user-row identity for retract.
- `conversation-store.test.ts:109` - full tool-call/result persistence.
- `conversation-store.test.ts:142` - raw tool arguments excluded from storage and Replay.
- `conversation-store.test.ts:380` - Replay pipeline is idempotent and never mutates stored rows.

## 4. Immutable Extension, Host, Governance, and Memory Boundaries

- `packages/core/src/extensions/extension-composition.ts:26` composes the existing Extension surface.
- `extension-composition.ts:28` exposes `runContext` for one captured execution projection.
- `packages/core/src/extensions/extension-run-context.ts:41-57` snapshots MCP, Skills, Host capabilities, Host context,
  governed tools, instructions, and the extension registry snapshot.
- `packages/core/src/hosts/host-context.ts:31` captures Primary Host and live Host catalog context.
- `packages/core/src/main.ts:124-127` composes the provider-neutral Memory runtime and selected authority.
- `main.ts:252` composes extensions; `main.ts:260` creates turn controls; `main.ts:278-344` wires the current ChatAgent
  and chat methods.

Slice 1 should persist references/digests for the effective Memory authority epoch, Host/Extension/MCP/Skill catalog,
Governance/Approval, model route, and relevant implementation versions at Admission. It must reuse these existing
composition owners and must not import Hindsight-specific runtime APIs or duplicate governance stores.

## 5. Additive Seams Recommended by the Live Code

1. Introduce a provider-neutral Trigger Request and Admission service before `runQueued`, while keeping the current
   queue and controller as execution plumbing.
2. Introduce a Run execution input that carries initiator/turn kind, immutable snapshot reference, cancellation, and
   bounded model control input into the existing ChatAgent.
3. Make primary user-row persistence, costume consumption, retract, and conversational auto-memory conditional on the
   accepted turn kind instead of adding a second autonomous method body.
4. Keep `AgentRunContext` capture once per Run and reuse it across the existing overflow retry; the durable snapshot
   extends this contract rather than replacing it.
5. Add Run/Attempt repositories and one transition service; WS/Timeline/Pino consumers observe committed state but
   cannot settle it.
6. Add a separate minimal Run query/Receipt surface. Do not overload `timeline.history` or `chat.complete` as Run
   completion authority.

## 6. Regression Risks

- Moving persistence without preserving the exact cancel-before-output retract rule can leave phantom user rows or lose
  drafts.
- Re-capturing Extension/Host/MCP/Skill context per Attempt can redirect retries across generations.
- Treating non-primary input as an ordinary user message pollutes relationship continuity, Replay View, compaction, and
  conversational Memory watermarks.
- Reusing the one-shot costume flag for Heartbeat/Scheduled work can consume a UI state change before the user speaks.
- Retrying after completed tool steps or unknown external effects can duplicate side effects.
- Letting `chat.complete`, Timeline append, Pino, or a Receipt writer settle the Run creates competing authorities.
- A migration allocated without rechecking main can collide with post-`023` work.

## 7. Unverified Implementation Details

- Exact table names, column layout, migration number, and repository split remain implementation decisions.
- The minimum Context Manifest representation must be finalized with the Shared schema while keeping prompt bodies and
  secret/tool payloads out of normal storage.
- Whether the first primary path creates a Run before or after the existing WS acknowledgement needs implementation-level
  error/latency analysis; acknowledgement cannot falsely claim admission success.
- Full event sequencing, effect settlement, orphan recovery, and product-visible Receipt projection remain later slices.
