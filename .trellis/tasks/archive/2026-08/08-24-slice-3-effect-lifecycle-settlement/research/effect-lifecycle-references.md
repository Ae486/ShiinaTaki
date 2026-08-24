# Research: Slice 3 Effect Lifecycle Reference Design

- Query: Verify the reference design for Slice 3 intent-before-effect and settlement-after-effect across model, Tool, Host, MCP, Approval, usage, stale completion, unknown outcome, replay, Memory, and observer boundaries, then map it onto TakiAgent's existing Run/Attempt/Event authority.
- Scope: mixed (local PI and DSH references, current TakiAgent source, Trellis architecture artifacts, and project specifications)
- Date: 2026-08-24

## Findings

### 1. Reference conclusion

PI is the primary Runtime/Harness reference for Slice 3. Its verified design supplies the durable program counter, effect sandwich, reserved settlement identities, authoritative usage coupling, explicit replay posture, and separation between awaited interception hooks and passive observers. DSH is useful only for append-only event facts, durable/live separation, trajectory projection, surface classification, and observer failure isolation. It must not contribute a second Session/Agent/Task runtime authority.

OpenClaw and Hermes are not effect-lifecycle references for this slice. The parent task explicitly assigns them to trigger/product mechanisms rather than Runtime/Harness state (`.trellis/tasks/08-22-t4-agent-architecture-observability/design.md:81-96`). The existing task documents cite no OpenClaw/Hermes effect-recovery mechanism that should override PI or TakiAgent's Host/MCP contracts. Their source was therefore not used to invent settlement rules.

The TakiAgent target is:

```text
Core Run/Attempt current state         = next-action and terminal-state authority
Core Run Effect state                  = current state of each model/tool/Host/MCP/Memory effect
Core Run Event ledger                  = immutable committed evidence
Subsystem authority                    = Approval decisions, Host enforcement, MCP generation/lease, Memory epoch
Relationship Timeline / Run artifacts  = authoritative content/output stores, never Run state
Live bus / trajectory / Pino            = isolated projections and diagnostics
```

Slice 3 should install the lifecycle and settlement boundary and make current execution truthful. Slice 4 should consume those records for boot recovery, orphan reconciliation, durable queue repair, automatic safe replay, and operator-driven retry/resume.

### 2. Verified PI runtime patterns

#### 2.1 Durable current state is the program counter

PI separates immutable entries, mutable current registers, and append-only usage. Its Harness replaces one complete operation-state register after each durable transition; recovery reads that total state directly instead of folding a journal (`references/pi-main/packages/agent/docs/harness.md:101-127`). This is the direct reference for TakiAgent's existing `Run.state`, `Run.operationPhase`, `Run.stateVersion`, active Attempt, and subordinate effect state.

The existing PI source reinforces the invariant even though the full documented Harness is ahead of its executable implementation:

- `SessionState` requires consecutive sequence values and unique ids, and tracks open operations directly (`references/pi-main/packages/agent/src/harness/session/state.ts:50-70,104-143`).
- The reducer rejects multiple open operations, unknown operation ownership, records after finish, duplicate tool invocation, and tool-call mismatches (`references/pi-main/packages/agent/src/harness/reducer.ts:15-32,236-268,311-389`).
- A lane may have only one open operation in both Memory and JSONL storage (`references/pi-main/packages/agent/src/harness/session/jsonl/storage.ts:171-184`).

Adoption for TakiAgent: continue using mutable Run/Attempt state as the next-action authority. Do not make RunEvent replay or observer state decide what executes next.

#### 2.2 Intent must commit before the uncertain effect

PI's effect sandwich is explicit:

```text
commit intent and reserve settlement identities
execute the uncertain provider/tool effect
commit output, usage, and next state as settlement
```

The normative statement is at `references/pi-main/packages/agent/docs/harness.md:129-137`. The worked provider example reserves response and usage identities before the request and settles response, usage, and next state together (`harness.md:148-176`). Tool calls use the same pair of commits (`harness.md:153-155`). PI's writer-conformance tests are specifically required to catch an effect starting before its intent commit, usage becoming durable too late, or settlement ids being reserved after execution began (`harness.md:2877-2878`).

Adoption for TakiAgent: the current Slice 1 start transition is insufficient as an effect intent. It moves an Attempt directly from `prepared` to `effect_running` and emits `attempt.started` (`packages/core/src/db/run-repo.ts:97-118`). Slice 3 needs a distinct durable model intent transition before `ToolLoopAgent.stream()` begins. The current `chat-send` path starts the Run immediately before entering the stream (`packages/core/src/server/methods/chat-send.ts:93-99`), which is the production seam to split into intent commit, effect dispatch, and settlement.

#### 2.3 Settlement identities are reserved before dispatch

PI reserves provider response and usage ids in the intent state, and synthetic settlements write under those same ids (`references/pi-main/packages/agent/docs/harness.md:281-301,452-464`). Tool execution similarly persists effective arguments and reserved result identity before the call becomes effect-pending (`harness.md:129-137,189-205`).

Adaptation for TakiAgent:

- A model Attempt should reserve a model-effect id, output reference, and usage id before provider dispatch.
- Each executable tool call should receive a stable effect id derived from Core-owned state, not only a transient callback closure.
- A Host operation keeps its existing subsystem `operationId`/Host attempt identity but must be linked to the enclosing Core `runId` and model `attemptId`; it must not replace them.
- Approval keeps its canonical `approvalId`; MCP keeps its server/tool/generation identity; Memory keeps its request id and authority epoch. Run effect records reference these identities rather than duplicating their authorities.

This follows the parent identity rule: `runId` is the logical execution, `attemptId` is provider/model retry lineage, while tool calls and Host operations remain subordinate/event-local or subsystem-local identities unless their independent lifecycle requires a correlation record (`.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-b-harness-contract.md:29-60`).

#### 2.4 Usage belongs to the same settlement as the provider result

PI treats usage as an append-only cost ledger. Every settled provider attempt, including failures, retries, abort-related results, and synthetic settlements, writes one usage row. The response and usage row settle together, and terminal cleanup never deletes usage (`references/pi-main/packages/agent/docs/harness.md:452-464`). Its cross-cutting test contract requires every settled attempt to have response plus usage and `getStats()` to equal the ledger sum (`harness.md:2884-2887`).

Adoption for TakiAgent:

- Add a Run-owned authoritative usage record keyed to `runId`, model `attemptId`, and the reserved usage id.
- Commit provider output reference, usage, Attempt/effect settlement, and RunEvent evidence through one Core settlement transaction where the existing SQLite stores permit it.
- If a provider reports no usage, commit an explicit zero/unknown synthetic row under the reserved id; absence must not mean "probably zero".
- Retried and failed model attempts retain their usage.
- The current detached `onUsage` callback is calibration only. It fires after the stream and swallows usage-promise rejection (`packages/core/src/agents/chat-agent.ts:325-340`); it cannot be the authoritative Slice 3 ledger.

#### 2.5 Replay is a stored contract, not a guess from the error

PI's tool recovery declaration is `replay?: "never" | "safe"`, with omission treated as unsafe (`references/pi-main/packages/agent/docs/harness.md:2609-2611`). An unsafe effect found intent-committed but unsettled receives a synthetic interrupted/error result and is not repeated; a safe read may be re-executed using persisted effective arguments (`harness.md:183-205`). Deterministic/idempotent computation callbacks may repeat, while effectful hooks require an explicit replay contract (`harness.md:2221-2227`).

TakiAgent's current tool specification provides useful input but not sufficient authority. Tools document `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`, with cautious defaults; the spec also states that hints are not guarantees and deterministic Core/Host controls remain authoritative (`.trellis/spec/backend/tool-design.md:187-208`).

Adaptation for Slice 3:

- Persist a normalized replay posture on every effect intent: `safe` or `never`; unknown/omitted normalizes to `never`.
- Automatic replay eligibility requires both the stored intent and the currently installed implementation contract to say safe, plus unchanged captured authority/generation and an idempotency/read-only guarantee.
- Host classification and the Host operation contract override generic tool hints.
- MCP annotation metadata may inform the normalized posture but cannot grant authority or defeat generation/lease rules.
- Memory writes are safe only when the captured provider contract reports idempotent writes and the exact request id/idempotency identity is reused; read-only recall can be safe only under the same authority epoch and stable request contract.

Slice 3 persists and exposes this posture. Slice 4 performs automatic replay or reconciliation.

#### 2.6 Stale callbacks and duplicate settlements are normal races

PI validates operation and tool ownership and ignores settled-tool progress updates after the tool has finalized (`references/pi-main/packages/agent/test/agent.test.ts:301-359,366-435`). Its documented cancellation and hook races use conditional state checks: a stale `before_run_end` result is dropped unless the operation is still at the same finish boundary (`references/pi-main/packages/agent/docs/harness.md:1462-1464`). At most one terminal transaction may commit per operation (`harness.md:2847-2849`).

Adoption for TakiAgent:

- Every callback settlement must compare `(runId, modelAttemptId, effectId, expected Run stateVersion, expected effect version, captured generation tuple)`.
- An exact duplicate returns the already committed terminal result and appends no second canonical settlement event.
- A late or stale callback cannot update current state, reopen a terminal Run, settle a replacement Attempt, or redirect to a newer Host/MCP/Memory generation.
- Stale/duplicate classification may be exposed as bounded diagnostic or log-only evidence, but it must not manufacture an ordinary success/failure event that looks current.

The current Run repository already provides part of this behavior: terminal or non-active Attempt settlement returns existing status, and SQL updates use Run/Attempt state versions (`packages/core/src/db/run-repo.ts:155-159,224-301`). Slice 3 should extend that guard to each effect and make duplicate-versus-stale classification explicit.

### 3. DSH patterns that are appropriate for Slice 3

DSH version `0.1.1-rc.2` is the inspected local reference (`references/deepseek-harness-master/package.json:1-9`). The following patterns are applicable:

- Keep append-only event facts separate from current runtime state.
- Deliver committed events through a live observer plane that is not an execution dependency.
- Classify projected evidence as `current`, `shadowed`, or `log-only` rather than deleting superseded evidence (`references/deepseek-harness-master/packages/session-query/session-query/src/types.ts:20-21,108-115`).
- Build trajectory as a pure consumer; DSH's trajectory package has no service and never reaches a model request (`references/deepseek-harness-master/packages/client/ui-trajectory/README.md:1-9`).
- Telemetry `emit()` must enqueue/non-block and owns no retry/durability guarantee; batching, loss, and retry are backend concerns (`references/deepseek-harness-master/packages/session/session-telemetry/README.zh.md:5-9`).

The applicable adaptation is already present in Slice 2. TakiAgent's live bus deduplicates by Run sequence, bounds each observer queue, marks overflow/error, and advances cursor only after successful observer handling (`packages/core/src/db/run-event-live.ts:20-75`). Slice 3 should publish its new committed effect events through that same post-commit bus. Observer failure must never roll back or change an effect settlement.

Reject DSH's raw telemetry privacy posture. Its OTel documentation states that uploading modes may carry complete prompt, tool, file/command, compaction, and cwd content unless deployment rules redact it (`references/deepseek-harness-master/packages/session/session-telemetry-otel/README.zh.md:30-38`). TakiAgent's canonical effect events must remain bounded and structurally exclude raw prompts, arguments, results, credentials, authorization material, and sensor/media bytes.

### 4. TakiAgent authority and gap map

#### 4.1 Run and Attempt authority already exists

Shared schemas already reserve the target lifecycle states: Run has queued/running/waiting/recovering/cancel-requested/terminal states; Attempt has prepared/intent-committed/effect-running/settling/terminal states (`packages/shared/src/harness-schema.ts:31-40`). Run snapshots capture Character, provider/model route, Host generations, extension snapshot, Governance/Approval generations, Memory authority/capabilities, context/replay decisions, budgets, and implementation version (`harness-schema.ts:126-150`).

`RunRepo` is already the sole SQLite owner for admission, start/retry/settlement/cancel and uses atomic transactions plus state-version compare-and-set (`packages/core/src/db/run-repo.ts:1-5,73-159,224-301`). `RunService` is the single Core lifecycle owner above repositories and below adapters (`packages/core/src/harness/run-service.ts:1-5,35-54`).

Gap: production currently skips Attempt `intent_committed` and `settling`, has no per-tool/per-Host/per-MCP/per-Memory durable effect state, and settles the overall Run only after the chat loop returns.

#### 4.2 RunEvent is evidence, not recovery state

Slice 2 currently has a closed lifecycle-only event vocabulary (`packages/shared/src/run-event-schema.ts:8-21`). Events are appended with contiguous per-Run sequence and immutable ids (`packages/core/src/db/run-event-repo.ts:12-33`). Run state mutation and lifecycle events commit in the same transaction, then publish post-commit (`packages/core/src/db/run-repo.ts:85-94,109-119,132-153,243-268`).

Slice 3 should extend the closed vocabulary with model/tool/governance/Host/MCP/Memory/usage evidence, but must retain these rules:

1. A state/effect transition and its canonical event commit together.
2. Event payloads carry bounded identity, digest, generation, timing, outcome, and counts, not raw content.
3. RunEvent cannot settle, retry, or reopen anything.
4. Exact duplicate settlement appends no second canonical terminal event.
5. Stale evidence is `log-only`/diagnostic and cannot masquerade as a current state transition.

#### 4.3 Character and relationship authority remain separate

`characterId` is the persona, Character Memory, tools, and relationship isolation boundary; `runId` is an execution/query/receipt key, not a transcript (`.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-b-harness-contract.md:29-42`). ADR 0010 keeps autonomous Run History separate from the relationship Timeline and permits only actual Companion utterances to join the conversation surface (`docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md:1-7`).

Slice 3 must not solve effect evidence by creating fake user/assistant rows. Primary chat may continue to persist actual relationship output, while non-primary output uses Run-owned evidence/artifact/Receipt references until product delivery chooses to create a real utterance.

#### 4.4 Host authority is already generation-bound and uncertainty-aware

The Host capability broker is the process-local owner of pending Host attempts and explicitly never replays after terminal uncertainty (`packages/core/src/capabilities/capability-broker.ts:1-5`). It seals run/operation identity, Host connection/catalog/policy/approval generations, exact input digest, expiry/deadline, and idempotency identity in `HostOperationControl` (`packages/core/src/capabilities/capability-broker.ts:157-176`; `.trellis/spec/backend/host-operation-lifecycle.md:47-64`).

Host settlement already provides the correct edge behavior:

- wrong Host/control/generation is rejected as stale (`packages/core/src/capabilities/capability-response.ts:16-24`);
- an effect interrupted by disconnect/deadline becomes `OUTCOME_UNKNOWN`, while a cooperative read may cancel (`packages/core/src/capabilities/capability-broker-state.ts:113-123`);
- exact repeats after settlement classify as duplicate and later responses as late (`packages/core/src/capabilities/capability-broker.ts:131-153`);
- reconnect never redirects or implicitly creates a new attempt, and unknown mutation outcome is never replayed automatically (`.trellis/spec/backend/host-operation-lifecycle.md:235-268`).

Slice 3 adaptation: wrap the existing Host dispatch in the Core Run effect sandwich. Do not replace Host verification or copy its classifier into TypeScript effect metadata. The Run settlement accepts only the broker's verified terminal outcome and records a bounded Host effect reference. The enclosing model Attempt and the Host-local operation/attempt identities must both be available for correlation.

#### 4.5 MCP authority is generation/lease owned

MCP runtime truth is process-local generations and leases rebuilt from desired truth; it is not durable executable truth (`.trellis/spec/backend/mcp-lifecycle.md:8-18`). A per-turn tool closure captures one generation; draining generations refuse new leases and never redirect calls to a replacement (`mcp-lifecycle.md:86-99`). Forced close while a leased call is in flight yields `OUTCOME_UNKNOWN` (`mcp-lifecycle.md:94-99`; `packages/core/src/mcp/mcp-generations.ts:53-87`).

Slice 3 adaptation:

- Commit the MCP tool effect intent only after the exact server/tool/config revision/generation closure has been captured and a lease is available.
- Persist the captured identity/digest and replay posture before `tools/call` dispatch.
- Settle through the same effect record after the generation closure returns.
- If forced close or transport interruption makes the result unknowable, settle `outcome_unknown`; never call the same logical effect on a newer generation automatically.
- MCP lifecycle/reconnect remains the MCP module's authority; Run records only the call's execution evidence.

#### 4.6 Approval is an authoritative wait/gate, not the external target effect

The canonical Approval service owns `approvalId`, generation, allowed choices, expiry, session ownership, decisions, revocation, and late classification. A repeated answer becomes `late`, cancellation is idempotent, and generation changes invalidate pending work (`packages/core/src/approval/approval-interaction-state.ts:80-121,171-194,271-307`; `packages/core/src/approval/approval-interaction-service.test.ts:108-130`).

Slice 3 should represent two distinct boundaries:

1. **Approval wait lifecycle**: record that the Run effect is waiting on canonical `approvalId` and captured `approvalGeneration`; record the canonical allowed/denied/expired/cancelled/invalidated settlement by reference.
2. **Target effect lifecycle**: only after approval and final policy/generation revalidation does Core commit execution intent and start the Tool/Host/MCP effect.

This prevents an approval notification or answer from being confused with proof that the target side effect ran. Approval decisions remain in the Approval authority; Run/Event projections reference them and update Run waiting/executing state.

Slice 4 owns restart reconciliation for an orphaned approval wait. Slice 3 must at least leave a truthful durable waiting marker and ensure no target effect starts after cancellation or stale authorization.

#### 4.7 Memory has two different side-effect classes

Explicit Memory operations already carry a request id, expected authority epoch, capability snapshot, provider identity/lineage, and result envelope validation. The coordinator checks the expected epoch before dispatch and rechecks provider capabilities and active authority after the call (`packages/core/src/memory/memory-coordinator.ts:24-30,52-99,142-156`). This is the correct subsystem authority to preserve.

Slice 3 should treat operations as follows:

| Memory action | Slice 3 posture |
| --- | --- |
| `recall` | Read effect; replay may be `safe` only under the same captured authority epoch/provider contract and exact bounded request. |
| `retain`, `edit`, `invalidate`, `restore`, reflective writes | Write effect; default `never`. It becomes replay-safe only when the captured capability says `idempotentWrites`, the exact request/idempotency identity is durable, and the current provider contract still agrees. |
| Primary conversational auto-memory/image memory | Detached projection today; keep primary-only and outside Run correctness unless explicitly promoted to a Run effect. |
| Non-primary/autonomous work | Suppress conversational auto-memory and fake relationship writes. Any deliberate Memory write must be an explicit Run effect with origin and authority epoch. |

The current non-primary seam correctly keeps control input ephemeral and suppresses Timeline, costume, and auto-memory writes (`packages/core/src/agents/chat-agent-non-primary.test.ts:9-26`). `chat-agent.ts` fires detached auto/image Memory only on the primary committed path (`packages/core/src/agents/chat-agent.ts:284-285,314-323`). Slice 3 must preserve this. It should not make observer/settlement code invoke Memory a second time.

### 5. Recommended Slice 3 lifecycle

#### 5.1 Core effect record

The minimum durable effect state should be Run-owned and subordinate to the model Attempt. Exact schema naming can remain an implementation decision, but the contract needs these fields:

```text
effectId
runId
modelAttemptId
kind: model | tool | host | mcp | approval_wait | memory
state/version: prepared | waiting | intent_committed | effect_running | settling | terminal
source identity: tool call / approval / Host operation / MCP ref / Memory request
bounded input digest and optional authoritative output reference
captured generations/revisions/authority epoch
replay posture: safe | never
idempotency identity
reserved usage/result ids where applicable
terminal outcome, bounded code/summary, timestamps
```

Why a subordinate effect record is warranted: one model Attempt can contain multiple tool calls, including parallel calls, and each may be waiting, effect-running, settled, stale, or unknown independently. Reusing one Attempt state for all of them would lose the program counter and make safe restart classification impossible. This does not create a second top-level runtime; the Run remains the aggregate and the model Attempt remains retry lineage.

#### 5.2 Transition order

```text
1. Prepare
   validate tool/provider identity and arguments
   capture Run snapshot tuple and subsystem authority
   no external effect yet

2. Approval/governance, when required
   persist waiting reference to canonical Approval
   await canonical decision
   revalidate generation/policy immediately before execution

3. Intent commit
   compare Run/Attempt/effect versions
   reserve result/usage identity
   persist exact bounded identity, generation, replay posture, idempotency key
   append effect-intent RunEvent in the same transaction

4. Effect dispatch
   start provider/tool/Host/MCP/Memory call only after commit succeeds

5. Settlement commit
   validate the same identity/version/generation tuple
   persist output reference and authoritative usage when applicable
   update effect and Attempt/Run current state
   append effect-settled/usage evidence in the same transaction

6. Post-commit observation
   publish committed events to the existing live bus
   update trajectory/metrics/Pino asynchronously
```

No observer, telemetry sink, Home client, Timeline subscription, or detached Memory hook participates in steps 3-5.

#### 5.3 Boundary matrix

| Boundary | Intent must contain | Authoritative settlement | Unknown-outcome rule | Replay rule |
| --- | --- | --- | --- | --- |
| Model/provider | model route, request/context manifest digest, reserved output/usage ids, deadline, retry policy | provider response/output reference + authoritative usage + Attempt next state | provider may have accepted/billed request but no durable response | Slice 3 records posture/result; Slice 4 retries only with explicit provider-safe/idempotent policy |
| Core tool | canonical tool identity, validated effective args digest, result id, replay posture | finalized AI SDK tool result reference and tool usage, if any | unsafe tool may have changed state | read/idempotent only when stored and current contracts agree |
| Approval wait | canonical approvalId, generation, binding/effect reference, expiry | canonical Approval decision reference | pending interaction lost or invalidated, but target effect not yet started | never replay an answer; Slice 4 may recreate/reconcile a wait under explicit policy |
| Host capability | sealed Host control, input digest, Host/generation/policy/approval tuple | broker-verified Host terminal outcome/evidence | disconnect/deadline after dispatch of an effect | never redirect/replay automatically; explicit inspection/resume only |
| MCP call | server/tool/config revision, captured generation and lease, input digest | result under the same leased generation | forced close/transport ambiguity | never switch generations; safe replay only through Slice 4 under exact contract |
| Memory | request id, operation, authority epoch/provider/capability digest, request digest | validated provider envelope under same authority | write may have applied but envelope was not durably settled | read safe under same epoch; write safe only with idempotentWrites + exact identity |

### 6. Slice 3 versus Slice 4 boundary

| Concern | Slice 3 owns | Slice 4 owns |
| --- | --- | --- |
| Model/tool/Host/MCP/Memory effect state | Durable intent, effect-running, settlement, terminal classification | Boot scan of unfinished states and recovery action execution |
| Run/Attempt integration | Current-state transitions and version guards during live execution | Orphan Run reconciliation and durable ownership/generation repair |
| Usage | Reserved usage identity and authoritative append-only settlement | Missing-provider reconciliation/adjustment workflow, if explicitly supported |
| Duplicate/stale callbacks | Live compare-and-set, idempotent terminal read, no mutation of newer state | Recovery-time detection of callbacks/outcomes that arrive after restart |
| Unknown outcome | Truthful classification and terminal/pending-reconciliation marker | Status probe, explicit operator retry/resume, or final unknown settlement policy |
| Safe/unsafe replay | Persist normalized replay declaration and all required identity/generation data | Execute automatic safe replay; forbid unsafe replay; enforce retry/deadline budgets |
| Approval | Durable waiting/reference and current-generation settlement integration | Recreate/reconcile orphan waits and operator resume UX |
| Queue/admission | Prevent new effects after cancellation and expose current waits | Durable queue visibility, cancellation reconciliation, deadlines/budgets, orphan worker |
| Observer/live plane | Emit only committed events and isolate failures | Backfill/recovery events and monitor recovery state |

Slice 3 must not claim crash recovery is complete merely because it records `intent_committed`. Conversely, Slice 4 must not infer missing identity or replay posture; Slice 3 must persist everything Slice 4 needs.

### 7. Adopt, adapt, and reject

| Reference pattern | Decision | TakiAgent application |
| --- | --- | --- |
| PI total current operation state | **Adopt** | Extend Run-owned current state with subordinate effect state; recovery never folds RunEvent. |
| PI effect sandwich | **Adopt** | Intent transaction before every uncertain provider/tool/Host/MCP/Memory call; settlement transaction after it. |
| PI reserved response/usage/result identities | **Adopt** | Mint before dispatch and reuse for normal or synthetic settlement. |
| PI append-only usage ledger | **Adopt** | Run/Attempt usage is authoritative only when committed with model settlement. |
| PI `safe`/`never` replay declaration | **Adapt** | Normalize from trusted Core/tool/Host/MCP/Memory contracts; default unsafe; Host rules override hints. |
| PI hook replay semantics | **Adapt** | Keep Approval/Governance authoritative and awaited; require idempotency for any repeatable lifecycle hook. |
| PI passive events | **Adopt** | Feed existing RunEvent/live/projection plane after commit; never gate effect execution. |
| DSH append-only event and trajectory patterns | **Adapt** | Extend the existing closed redacted RunEvent vocabulary and use current/shadowed/log-only projections. |
| DSH raw event/telemetry export | **Reject** | Canonical effects carry bounded safe fields; raw content stays in separately authorized stores. |
| DSH Session/Agent/Task runtime state | **Reject** | TakiAgent retains Character -> Run -> Attempt and subsystem authorities. |
| OpenClaw/Hermes as effect authority | **Reject** | Their assigned role is trigger/product mechanism; no cited effect pattern displaces PI/Host/MCP contracts. |
| Generic retry on any failure | **Reject** | Provider retry, context overflow, safe tool replay, Host resume, MCP generation loss, and Memory idempotency are distinct. |
| Detached usage as billing truth | **Reject** | Current `onUsage` is calibration only. |
| RunEvent as recovery state | **Reject** | Events are immutable evidence; mutable current state decides the next action. |
| Observer-triggered Memory or settlement writes | **Reject** | Observers are isolated projections and must not create duplicate side effects. |

### 8. Verification obligations for Slice 3 planning

The implementation plan should require deterministic tests for:

1. No provider/tool/Host/MCP/Memory effect can start before its intent transaction commits.
2. Failed intent/event writes start no effect and leave no partial state.
3. Model response, authoritative usage, Attempt/effect next state, and events settle atomically or through a stable reserved-reference reconciliation contract.
4. Every stop reason, failure, retry, cancellation, and synthetic result retains authoritative usage semantics.
5. Exact duplicate settlements are idempotent and append no duplicate terminal event.
6. Stale Run version, replacement Attempt, stale Host/MCP generation, stale Approval generation, and stale Memory epoch cannot mutate current state.
7. Parallel tool callbacks settle independently but present tool results in the existing AI SDK source order.
8. Safe replay metadata is persisted; unknown and absent metadata normalize to unsafe.
9. Host/MCP interrupted effects become `outcome_unknown`; no replacement generation receives the logical effect.
10. Approval denial/expiry/cancellation settles the wait but never creates an execution intent for the target effect.
11. Non-primary Runs create no fake Timeline row, no costume consumption, and no conversational auto/image Memory write.
12. Observer exceptions, queue overflow, disconnect, or disabled Developer Trace cannot fail or change effect settlement.
13. Canonical events and effect records reject raw prompt/completion/tool payloads, credentials, authorization material, Host/MCP secrets, and sensor/media content.
14. Existing primary chat persistence, cancel-retract, approval cancellation, overflow retry, Run Receipt, and Slice 2 event sequence tests remain green.

### 9. Files found

| File | Description |
| --- | --- |
| `references/pi-main/packages/agent/docs/harness.md` | Normative PI durable Harness, effect sandwich, usage ledger, recovery/replay, hooks/events, and test invariants. |
| `references/pi-main/packages/agent/src/harness/session/state.ts` | Concrete sequence, identity, and open-operation state validation. |
| `references/pi-main/packages/agent/src/harness/reducer.ts` | Concrete bounded recovery reduction and corruption detection for operations/tool batches. |
| `references/pi-main/packages/agent/test/agent.test.ts` | Concrete late tool-update suppression and lifecycle settlement behavior. |
| `references/deepseek-harness-master/packages/session/session-telemetry/README.zh.md` | Non-blocking telemetry handoff and durable/live capture boundaries. |
| `references/deepseek-harness-master/packages/client/ui-trajectory/README.md` | Pure-consumer trajectory projection; no model/service authority. |
| `packages/shared/src/harness-schema.ts` | Current TakiAgent Run/Attempt/snapshot/Receipt authority schemas. |
| `packages/core/src/db/run-repo.ts` | Current atomic Run transitions, state-version guards, lifecycle events, and idempotent settlement behavior. |
| `packages/shared/src/run-event-schema.ts` | Current closed lifecycle-only canonical RunEvent vocabulary and privacy bounds. |
| `packages/core/src/db/run-event-repo.ts` | Contiguous per-Run append-only event writer. |
| `packages/core/src/db/run-event-live.ts` | Bounded post-commit observer plane with cursor/backfill and failure isolation. |
| `packages/core/src/harness/run-service.ts` | Single Core admission/lifecycle service above repositories. |
| `packages/core/src/server/methods/chat-send.ts` | Current production seam from Run start into AI SDK stream and final Run settlement. |
| `packages/core/src/agents/chat-agent.ts` | Current model/tool loop, primary persistence, detached usage, and detached Memory behavior. |
| `packages/core/src/capabilities/capability-broker.ts` | Existing Host pending-attempt owner, generation/control binding, duplicate/late/unknown outcomes. |
| `packages/core/src/mcp/mcp-generations.ts` | Existing MCP generation/lease/drain/forced-close lifecycle. |
| `packages/core/src/memory/memory-coordinator.ts` | Existing Memory request, authority epoch, capability, and envelope validation boundary. |
| `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-b-harness-contract.md` | Parent canonical Run/Attempt/effect/replay semantics. |
| `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-c-persistence-recovery.md` | Parent crash matrix, idempotency, usage/effect evidence, and Slice 4 recovery direction. |
| `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-e-integration-map.md` | Existing Core/Timeline/Memory/Host/Approval/Extension ownership map. |
| `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-g-slices-gates.md` | Frozen Slice 3 runtime/effect integration versus Slice 4 recovery/admission boundary. |

### 10. External references and versions

- PI local reference: `@earendil-works/pi-agent-core` version `0.84.2` (`references/pi-main/packages/agent/package.json:1-4`). The detailed `docs/harness.md` is normative design evidence; the checked-out executable `AgentHarness` is not a drop-in dependency.
- DSH local reference: root and inspected workspace packages version `0.1.1-rc.2` (`references/deepseek-harness-master/package.json:1-9`).
- No network source was required. All claims are grounded in local source, tests, specifications, and task artifacts.

### 11. Related specs

- `.trellis/spec/backend/agent-runtime.md` — primary/non-primary turn persistence, cancel-retract, detached Memory, and truthfulness constraints.
- `.trellis/spec/backend/host-operation-lifecycle.md` — Host identity/generation, receipt, waiting, outcome-unknown, and no-replay rules.
- `.trellis/spec/backend/mcp-lifecycle.md` — MCP desired/runtime authority, generations, leases, forced-close uncertainty, and no redirect/replay.
- `.trellis/spec/backend/permission-authorization.md` — canonical Governance/Approval generation and stricter-only final enforcement.
- `.trellis/spec/backend/tool-design.md` — read/idempotency/destructive/open-world posture and the rule that hints are not authority.
- `.trellis/spec/backend/database-guidelines.md` — Core single-writer and transaction/migration discipline.
- `.trellis/spec/backend/logging-guidelines.md` — Pino diagnostic scope and sensitive-field exclusions.
- `.trellis/spec/guides/source-grounding-guide.md` — source-backed design and installed/reference truth requirements.
- `docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md` — Character relationship Timeline versus autonomous Run History.

## Caveats / Not Found

- PI's detailed Harness specification is ahead of the checked-out executable Harness. The design is suitable as a reference and test oracle, not as an install-and-delegate runtime dependency.
- Current TakiAgent Run schemas reserve `intent_committed`, `settling`, `waiting`, and `recovering`, but production transitions do not yet use the full state graph. Slice 3 must not mistake reserved enum values for implemented lifecycle behavior.
- Current RunEvent schemas are lifecycle-only. Exact new effect event names and payload schemas are not frozen by this research; they must remain a closed, versioned, redaction-safe union and preserve Slice 2 transaction/sequence rules.
- The current Host broker accepts optional Run/operation identity but generates its own Host attempt id. The final integration must explicitly preserve both the enclosing model Attempt and Host-local attempt identity rather than overloading one field silently.
- The current Memory coordinator verifies epoch/provider identity and supports stable request ids, but it does not itself provide a durable Run effect record. Memory write replay safety must be proven from the exact provider contract and idempotency behavior; `idempotentWrites` alone is not permission to replay with a new request id.
- No current persistent orphan worker, automatic safe-replay executor, or durable approval-wait recovery path was found. Those are Slice 4 responsibilities, but Slice 3 must persist sufficient identity and posture for them.
- No relevant OpenClaw/Hermes effect-lifecycle pattern was explicitly cited by the active task documents. They were intentionally excluded from the core recommendation rather than treated as unsupported runtime authorities.
- No production code, Trellis spec, task pointer, Git state, or implementation status was modified by this research.

## Memory-derived Operating Caveat

Workspace memory was consulted only for the already-recorded T4 boundary and source-grounding rules: stay in the T4 worktree, keep implementation authorization separate from research, and treat Host/Run/Attempt/generation facts as requiring live verification. Those points were rechecked against current files above; memory was not used as runtime evidence.
