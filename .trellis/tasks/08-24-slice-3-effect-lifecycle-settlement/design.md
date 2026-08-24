# Slice 3 Effect Lifecycle and Settlement Design

## 1. Boundary

Slice 3 adds one Core-owned effect lifecycle boundary between `RunService`/`RunRepo` and the existing domain
executors. It does not replace the AI SDK `ToolLoopAgent`, Host capability broker, MCP generation manager, Approval
authority, or Memory coordinator.

```text
Run admission / Attempt current state
  -> EffectLifecycleService.prepare / await-approval
  -> one synchronous transaction: effect intent + RunEvent + current-state advance
  -> domain effect dispatch (model/tool/Host/MCP/Memory)
  -> one synchronous transaction: effect settlement + usage/output refs + RunEvent
  -> post-commit live/projection/Pino observers
```

The Run remains the top-level execution aggregate. An effect is one actual uncertain operation subordinate to a model
Attempt. `effectId` is the Core correlation key; `kind` and `executor` distinguish the boundary. Subsystem identities
(`approvalId`, Host `operationId`, MCP generation/lease identity, Memory `requestId`) remain authoritative in their own
modules and are referenced, not duplicated as parallel Run lifecycles.

## 2. Authority and Identity

| Concern | Authority | Slice 3 integration |
| --- | --- | --- |
| Run/Attempt/effect current state | Core transition service / SQLite | CAS by Run, Attempt, effect versions; one writer |
| Immutable execution facts | Slice 2 Run Event ledger | Add closed typed effect/usage facts; append in same transaction |
| Model/tool loop | AI SDK `ToolLoopAgent` | Wrap actual model/tool seams; do not add a second loop |
| Tool policy/Approval | Core Governance and Approval | Persist wait reference; revalidate before target intent |
| Host execution | Selected Host + capability broker | Thread Core identity through existing sealed Host control |
| MCP runtime | MCP generation/lease manager | Capture generation/lease; never redirect to replacement generation |
| Memory data | Memory coordinator/provider | Use authority epoch and stable request identity |
| Relationship content | Conversation/Timeline | Preserve primary behavior; no fake non-primary rows |
| Diagnostics/projections | RunEvent live/projection/Pino | Post-commit, isolated, never settle Run |

The minimum durable effect row is intentionally one semantic shape rather than one table per provider:

```text
effectId, runId, attemptId, kind, state, version,
sourceRef, executorRef, inputDigest, replayPosture,
capturedGenerationRef, idempotencyKey,
reservedResultRef, reservedUsageRef,
startedAt, settledAt, outcome, errorCode, boundedSummary
```

`sourceRef` and generation references are bounded typed unions. No arbitrary JSON payload is accepted. Raw prompts,
completions, tool arguments/results, credentials, cwd/env, sensor/media, and unrestricted provider exceptions remain
outside canonical effect state and RunEvents.

## 3. Effect State Machine

```text
prepared -> waiting (Approval only)
prepared -> intent_committed -> effect_running -> settling -> terminal
waiting -> prepared (approved + final revalidation)
waiting -> terminal (denied/expired/cancelled/invalidated)
intent_committed/effect_running -> terminal(outcome_unknown|failed|cancelled|completed)
```

`safe` and `never` are the normalized replay postures. Missing or untrusted metadata becomes `never`. Slice 3 persists
the posture and identity required by Slice 4; it does not perform boot-time automatic replay.

Approval is not the target effect. A required approval creates a durable wait reference. Only after the canonical
decision and final policy/generation check does the target effect enter `intent_committed`; denial or expiry settles
the wait without creating a target execution intent.

## 4. Transaction Contracts

### 4.1 Intent

Before calling an uncertain effect, the Core transition boundary synchronously:

1. validates Run/Attempt/effect identity and expected versions;
2. captures bounded executor/generation/authority references and replay posture;
3. reserves result and usage identities where applicable;
4. writes effect current state and Run/Attempt phase;
5. appends the typed intent event in the Slice 2 ledger;
6. commits, then dispatches the domain effect.

If validation or event insertion fails, no external call starts and no partial state remains.

### 4.2 Settlement

The settlement boundary compares the same `(runId, attemptId, effectId, expected versions, captured generation tuple)`.
On acceptance it writes effect terminal state, output/effect references, authoritative usage, relevant Attempt/Run state,
and typed settlement event facts in one short transaction. The post-commit live bus is notified only after commit.

Exact duplicate settlement returns the existing terminal result and does not append another canonical terminal event.
Stale, late, wrong-generation, wrong-attempt, and post-terminal callbacks cannot mutate current truth. They may produce a
bounded log-only diagnostic classification.

### 4.3 Unknown outcome

When the external system may have applied an effect but Core lacks a trusted result, settle the effect as
`outcome_unknown` or `reconciliation_required` according to the domain contract. Do not relabel it as success, do not
redirect it to a replacement Host/MCP generation, and do not silently retry. Slice 4 will consume this durable state for
reconciliation or explicit operator action.

## 5. Boundary Adapters

### Model

Wrap the model supplied to `ToolLoopAgent` at the real `chat-agent.ts` construction/stream seam. Each provider request
gets one effect identity. Intent precedes `agent.stream`; response/output reference, usage, and effect/Attempt state
settle together. Existing one-time side-effect-free context-overflow retry remains intact and is linked to the new
Attempt lineage rather than generalized.

### Core tool

Wrap the assembled governed ToolSet at the outer boundary that observes the actual tool call. Governance and Approval
run first; effective-argument digest and replay posture are captured only after validation and immediately before the
raw closure executes. Tool result persistence remains AI SDK/Timeline-compatible and canonical events contain only
bounded references and summaries.

### Host and MCP

Thread the admitted Core `runId`, model `attemptId`, and `effectId` through `routeCapability` and the existing broker
control. Preserve Host-local operation/attempt identity, generation checks, deadlines, duplicate/late suppression, and
cooperative-read versus unsafe-effect uncertainty. For MCP, acquire and retain the exact generation lease before intent;
forced close or transport ambiguity settles unknown and never switches generations.

### Approval

Persist a wait effect referencing canonical `approvalId`, owner/session, policy generation, and expiry. A decision is
accepted only by the Approval authority. The target effect must repeat final policy and generation validation after the
decision and before intent commit.

### Memory

Explicit Memory tool operations use effect identity as the stable request/idempotency identity where the provider allows
it, while preserving authority epoch/capability checks. Recall may be `safe` only under the same epoch/contract; writes
default to `never` unless exact idempotent replay is proven. Primary detached AutoMemory/image hooks remain detached
projections in this slice; non-primary turns retain their no-fake-Timeline/no-conversational-watermark guarantees.

### Usage

Add an authoritative Run-owned usage record keyed by Run, model Attempt/effect, and reserved usage identity. Every settled
provider attempt gets a row, including failure/abort/unknown with explicit `reported`, `estimated`, or `unknown` quality.
The existing detached usage callback remains calibration-only.

## 6. Event Extension

Extend the Slice 2 closed event union with real producer facts only:

```text
effect.intent_committed
effect.waiting
effect.settled
approval.wait_started / approval.settled
usage.settled
```

The exact discriminated payload names are an implementation detail, but each must carry bounded effect kind, state,
outcome, replay posture, source/generation reference, timing, error code, and counts as applicable. No placeholder events
are emitted for unintegrated domains. The existing per-Run sequence, immutable rows, redaction, transaction coupling,
post-commit live bus, and projection rules remain unchanged.

## 7. Compatibility, Migration, Rollback

- Schema changes are additive and allocated only after comparing current branch and synchronized `main` migration
  registries. Fresh, historical, and reopen/no-op lineage tests are mandatory.
- Existing Run/Attempt queries remain valid. Existing primary Timeline/Replay writes and cancellation/retraction remain
  owned by their current modules.
- Rollback is code/version rollback against additive effect/usage tables. No destructive down migration or event rewrite
  is assumed.
- Slice 4 must be able to identify unfinished effects, replay posture, captured authority, and reserved settlement ids
  without guessing from logs or raw RunEvents.

## 8. Explicit Non-Goals

No orphan worker, automatic replay executor, queue scheduler, deadline/budget policy, Scheduled Task, Heartbeat, Child
Run, delivery UI, monitor UI, external telemetry, DSH Session/Task runtime, generic plugin-defined Run authority, or
replacement model loop is introduced.

## 9. Adopt / Adapt / Reject

| Reference | Decision |
| --- | --- |
| PI current program counter and effect sandwich | Adopt as Core authority and transaction ordering |
| PI reserved result/usage identities and append-only usage | Adopt |
| PI `safe`/`never` replay | Adapt through trusted TakiAgent subsystem contracts; default unsafe |
| PI passive observers/hooks | Adopt with Slice 2 post-commit live bus |
| DSH append-only events, durable/live split, trajectory classification | Adapt |
| DSH raw telemetry/prompt export | Reject for canonical surfaces |
| DSH Session/Task runtime | Reject |
| OpenClaw/Hermes effect authority | Reject; their role remains trigger/product reference |
