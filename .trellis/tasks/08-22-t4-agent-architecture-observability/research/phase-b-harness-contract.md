# Phase B - Harness Contract

> Scope: the reusable Core Runtime/Harness contract above the existing AI SDK `ToolLoopAgent` and below trigger-
> specific T4 policy. This document freezes semantic containment and authority; it does not authorize production code,
> migrations, or a second runtime loop.

## 1. Contract Outcome

The Harness is one Core-owned execution boundary shared by interactive chat, future Scheduled Task and Heartbeat
providers, system/webhook triggers, and delegated Child Runs. A provider submits a typed request; it does not create a
private Agent loop, persist a second history, or decide effect settlement.

```text
Character scope
  -> TriggerRequest (intake/provenance/idempotency)
  -> Admission + lane
  -> Run (logical execution, receipt/query/resume key)
       -> one current Operation state machine
       -> Attempt(s) (provider/model retry lineage)
       -> Tool/Host/MCP/approval/delivery effects
  -> RunEvent evidence and projections
```

The existing AI SDK `ToolLoopAgent` remains the only low-level model loop. The Harness supplies identity, context,
admission, lifecycle, cancellation, effects, settlement, recovery, and evidence around that loop.

## 2. Identity Hierarchy

The project has a special `characterId` requirement, while most other identifiers are compatibility or correlation
fields. They must not become parallel authorities or separate persistence tracks.

| Term | Canonical meaning | Authority and lifetime | What it is not |
|---|---|---|---|
| `characterId` | TakiAgent's isolated role/persona boundary, including role prompt, Character memory, and relationship scope | Core/domain identity; durable and required for Character-scoped work | A runtime attempt, queue item, or user-visible execution history |
| `triggerRequestId` | One provider submission and its idempotency/provenance key | Admission boundary; may be short-lived after deduplication | Proof that a model call happened |
| `taskId` | One persisted Scheduled Task definition | T4 scheduler/provider authority; one definition can create many Runs | A universal work-item identity |
| `runId` | One logical execution and its Receipt, query, and resume key | Core Harness authority; durable until retention/deletion policy | A chat transcript, model request, or recurring task definition |
| `parentRunId` | Optional Child Run lineage link | Core Harness lineage; points to another `runId` | A second Session or a shared mutable transcript |
| `Operation` | The current runtime state machine and program counter inside a Run | Run-scoped current state; no separate public aggregate is required | A second execution pipeline or a mandatory independent `operationId` track |
| `attemptId` | One provider/model execution attempt inside a Run, including retry lineage | Core Harness subordinate identity; each retry gets a new Attempt | A new Run, Session, or independent authority |
| `turn` / `step` / `toolCall` | Loop- or event-local correlation fields | Event/subsystem scope; introduce durable identity only if a later contract proves independent lifecycle/query needs | Additional top-level aggregates |
| Host `operation` | Host-side capability/effect identity | Host contract scope; linked to the enclosing Run/Attempt | A replacement for the Core Run |
| `sessionId` | SDK/transport adapter handle when a dependency requires it | Adapter-local mapping to an existing relationship or Run | A second history authority or user-visible session tree |

### 2.1 The `Operation` decision

PI's `Operation` concept is adopted for its total current state and recovery program counter. TakiAgent does not create
a separate operation ledger merely because the word exists in PI. The first implementation may store one Run-owned
operation state and use a run-scoped key or the `runId` as its storage key. A standalone `operationId` is justified only
if an independently addressable lifecycle (for example, compaction/navigation) is proven and documented later.

This keeps the stable public model small:

```text
Character -> Run -> Attempt(s)
                  \
                   -> Operation current state
```

Event fields may still carry `attemptId`, tool identity, Host operation identity, and provider correlation values for
diagnosis. They do not each require an aggregate, repository, migration, or API surface.

## 3. Authority and Containment Rules

| Concern | Single authority | Derived or diagnostic consumers |
|---|---|---|
| Next recoverable action | Run-owned mutable current Operation state | Recovery worker, status API, developer inspector |
| Immutable execution evidence | Append-only Run Event Ledger (planned in Phase C/D) | Receipt, trajectory, metrics, Pino correlation |
| Character continuity | Relationship Timeline and Replay View contracts | Prompt context and UI projections |
| Memory provider/authority | Existing provider-neutral Memory coordinator and authority epoch | Run snapshot and Context Manifest |
| Host/extension/approval generations | Existing Core/Host governance boundaries | Captured Run snapshot and stale-result settlement |
| Live output | WS and client projections | Never used as completion authority |
| Process diagnostics | Pino | Never used as recovery or ordered trajectory authority |

No observer, provider, Timeline row, or Pino line may become a second source of Run truth.

## 4. Trigger Request and Admission

Every entry point submits a provider-neutral request with at least:

- `triggerRequestId`, provider kind, and provider-owned provenance;
- `characterId` when the work is Character-scoped;
- requested context mode and delivery class;
- idempotency/deduplication key;
- deadline and budget hints, subject to Core validation;
- optional `taskId` or `parentRunId` when the provider contract permits it;
- a bounded request payload or reference, never an implicit prompt transcript.

The request is not a Run. Admission validates authorization and policy, chooses a lane, creates or reuses the logical
Run according to idempotency rules, captures the immutable snapshot, and only then permits an Attempt/model effect.

There is one Core Admission service. A lane is an execution scope with serialization and resource policy. The initial
default is a Character lane so relationship-affecting work remains ordered; an isolated Child Run lane is permitted
only when its context, resource, cancellation, and result contracts are explicit. A lane must expose queued, running,
blocked, deferred, and cancellable work through non-destructive status/busy probes.

Trigger-specific policy remains outside this contract: cron/DST/catch-up, Heartbeat eligibility and quiet hours,
delivery policy, and Pet/Home behavior choose whether to submit a request, not how a Run executes.

## 5. Run, Operation, and Attempt Lifecycle

### 5.1 Run states

The exact storage enum may evolve in Phase C, but the semantics are fixed:

- non-terminal: `queued`, `running`, `waiting`, `cancel_requested`, `recovering`;
- terminal: `completed`, `cancelled`, `failed`, `skipped`, `deadline_exceeded`, `outcome_unknown`.

`waiting` means the Run is intentionally paused on a known wait (for example, approval or a provider backoff), not
that the process lost it. `outcome_unknown` means an external effect may have happened but Core cannot prove its
settlement; it is never silently rewritten as success or replayed as a side effect.

### 5.2 Operation current state

The Run-owned current state is a total, versioned program counter. It must be sufficient to answer “what is the next
safe action?” without folding the full event stream. It contains, at minimum:

- control (`running` or `cancel_requested`), phase, and state version;
- active `attemptId` and bounded retry/recovery counters;
- captured snapshot reference and Context Manifest reference;
- pending queue/control reservations and known wait/deadline;
- effect intent/settlement marker when an external operation is uncertain;
- terminal outcome when the Run is closed.

An event may explain how the state was reached, but recovery reads this current state as the authority.

### 5.3 Attempt states

An Attempt is subordinate and idempotently settleable:

```text
prepared -> intent_committed -> effect_running -> settling -> completed
                                      |                    -> failed
                                      |                    -> outcome_unknown
                                      -> cancelled/deadline_exceeded
```

Provider retry, context-overflow retry, safe tool replay, Host reconnect, and unknown external effects are distinct
reasons. A single undifferentiated retry counter is not an acceptable contract.

## 6. Queue, Steering, Follow-up, and Cancellation

The queue contract is adapted from PI, but remains one Core queue/lane service:

- **ordinary queued work** is a request/Run reservation with inspectable status and cancellation;
- **steering** modifies an open Run's next model input before another assistant request; it does not create a new Run;
- **follow-up** is a reserved input accepted while the Run is open and consumed after the loop would otherwise finish;
- **next-run** is a new TriggerRequest and therefore a new `runId`, even if admitted immediately after the current Run.

Steering and follow-up are reserved contracts, not a requirement to add new product APIs in the first implementation.
They must never be encoded as fake user Timeline rows for autonomous work.

Cancellation has two layers:

1. a durable Core control transition (`cancel_requested`) with reason, initiator, timestamp, and drained reservations;
2. an `AbortSignal` used to interrupt the current process-local stream or effect.

After the durable cancellation transition, no new model/tool/Host/MCP/approval/retry effect may start. Already
intent-committed effects are reconciled through their settlement contract. A late completion can only produce evidence
and an idempotent no-op/stale result; it cannot reopen the Run or mutate a newer state version.

## 7. Deadlines, Budgets, and Immutable Snapshot

At admission, Core captures an immutable effective snapshot containing the values that can affect replay or settlement:

- Character and trigger provenance;
- model/provider route and relevant capability/tool catalog generations;
- Host, Extension, Governance/Approval, and Memory authority generations;
- context mode, delivery class, deadline, and validated budget policy;
- replay declarations and implementation version/schema references.

Later configuration or generation changes affect later Runs. They do not rewrite a running Run's effective snapshot.
Deadlines and budgets are enforced at admission, before model requests, before tool/Host effects, and at settlement.
Provider-specific budget classes remain T4 policy inputs; the Harness only enforces the captured limits and emits the
settlement reason.

## 8. Context Manifest

Every Run/Attempt that reaches the model has a redaction-safe Context Manifest reference. The manifest describes the
effective context without becoming a second transcript:

- source categories and stable source/revision references;
- selected section identifiers and bounded hashes;
- Replay View window/summary/compaction decisions;
- Memory authority epoch and provider-neutral capability snapshot;
- tool/extension catalog generation and model route;
- token estimate or accounting status and schema version.

Raw prompts, secrets, full tool inputs/results, and sensitive sensor bytes are not mandatory manifest payloads. A
developer projection may expose additional controlled detail under explicit authorization, but the base manifest is
safe to persist, query, and attach to a Receipt.

Child Runs receive an explicit bounded context seed or fork reference. They do not inherit the parent's mutable
transcript by accident, and their private transcript does not append directly to the Relationship Timeline.

## 9. Effect Intent, Settlement, and Replay

Any uncertain provider, tool, MCP, approval, Host, persistence, or delivery action crosses the same three-part seam:

```text
intent committed -> external effect executes -> settlement committed
```

The intent records the immutable Run/Attempt identity, effect kind, bounded input identity, generation/deadline, and
replay declaration. Settlement records success, failure, cancellation, or `outcome_unknown` together with the next
Operation state. Output and authoritative usage are committed with the settlement where possible.

Replay is explicit:

- `safe`: the stored and current contract both allow automatic replay and the effect is idempotent/read-only;
- `never`: do not replay automatically;
- omitted/unknown: treat as unsafe and reconcile explicitly.

Host operation rules take precedence over generic replay metadata. A process crash between intent and settlement is
not evidence of failure or success; recovery follows the effect-specific policy defined in Phase C.

## 10. Stale Completion and Terminal Semantics

Every completion is checked against the immutable tuple `(runId, attemptId, stateVersion, captured generations)`.
Completions that do not match the current active state are recorded as stale/late evidence and ignored for mutation.
Duplicate settlement of the same attempt is an idempotent read of the existing terminal result.

Receipt and query projections must preserve these distinctions:

| Outcome | Meaning |
|---|---|
| `completed` | Run reached its requested terminal work and effects settled |
| `cancelled` | Core/operator cancellation won before completion |
| `failed` | Known non-cancellation failure with no unresolved external effect |
| `skipped` | Admission/provider policy intentionally did not execute the Run |
| `deadline_exceeded` | Captured deadline prevented completion or a new effect |
| `outcome_unknown` | An external effect may have occurred without provable settlement |

These outcomes are not UI labels only; they are durable contract values used by recovery, retry, receipts, and future
T4 providers.

## 11. Single-Loop Proof and Integration Boundary

The Harness must call the existing `chat-agent.ts` adapter, which creates the AI SDK `ToolLoopAgent` and owns model
stream/tool-step mechanics. It may supply a Run snapshot, Context Manifest, cancellation signal, and effect callbacks;
it may not duplicate stream persistence, create a second stop-condition engine, or fork a separate autonomous Agent.

Non-primary turns use an additive adapter around the existing loop to suppress primary-only behavior (fake user rows,
costume-notice consumption, user-row retraction, and conversational auto-memory). Relationship Timeline and Replay
View remain their existing authorities; autonomous evidence goes to the Run/Event path and optional Receipt projection.

## 12. Phase B Exit Criteria and Deferred Work

Phase B is complete when the following are reviewable and testable in later implementation slices:

1. The identity table and containment diagram are used consistently by roadmap, handoff, schemas, and task artifacts.
2. One Core Admission service and one Run current-state authority are named; no trigger owns a private loop.
3. Run/Attempt state, cancellation, steering/follow-up reservation, deadlines, snapshots, Context Manifest, effect
   settlement, replay safety, stale completion, and terminal outcome semantics are explicit.
4. The existing `ToolLoopAgent` remains the only low-level model loop, with a narrow non-primary adapter seam.
5. Phase C owns concrete schema/migration/version/retention/crash-point decisions; Phase D owns event taxonomy,
   projections, authorization, and telemetry detail; Phase E owns code-level write-path mapping.

The following remain intentionally open for those later phases: exact table shapes and migration number, event sequence
scope, queue priority/fairness numbers, recovery worker cadence, retention/deletion implementation, projection payload
schemas, and the detailed Child Run result protocol.

## 13. Evidence

- `research/pi-harness.md` — PI loop/Harness split, total operation state, queues, durable abort, effect sandwich,
  replay safety, passive events, and usage evidence.
- `research/phase-a-current-state-audit.md` — live TakiAgent call graph and missing boundary inventory.
- `docs/ARCHITECTURE-ROADMAP.md` — project identity hierarchy, Character isolation, Run/Attempt baseline, and T4
  compatibility boundaries.
- `docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md` — autonomous Run history versus
  Character relationship Timeline and SDK `sessionId` mapping.
- `.trellis/spec/backend/agent-runtime.md` and `.trellis/spec/backend/host-operation-lifecycle.md` — existing loop,
  cancellation, privacy, Host generation, and unknown-outcome constraints.
