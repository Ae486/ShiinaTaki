# Agent Harness Architecture and Observability Design

## 0. Scope and Phase Model

This design is for the current architecture task, not a direct T4 product implementation. The task establishes the
reusable Runtime/Harness and observability contracts that T4 and later providers consume.

```text
Current task:
  audit -> Harness contract -> persistence/recovery -> observability -> integration map -> T4 compatibility -> gates

Downstream T4:
  Scheduled Task / Heartbeat / delivery / later proactivity policies
```

The architecture phases are:

1. **Current-state audit** — map actual code paths, authorities, stores, and lifecycle gaps.
2. **Harness contract** — define admission, Run/Operation/Attempt state, snapshots, cancellation, deadlines, effects,
   and recovery without introducing a second runtime authority.
3. **Persistence and recovery** — define the durable current program counter, append-only evidence, idempotent
   settlement, migration/retention, and crash-point policy.
4. **Observability plane** — define typed events, durable/live delivery, redaction, query, trajectory, Receipt, and
   telemetry projections.
5. **Integration mapping** — assign ownership to existing Core, WS, Replay View, Memory, Host, Approval, Extension,
   and Pino seams.
6. **T4 compatibility review** — prove that downstream triggers reuse the same path without moving T4 policy into Core.
7. **Implementation gates** — split production work into independently verifiable slices with explicit tests and
   reserved future seams.

## 1. Proposed Runtime Shape

```text
Trigger Providers
  -> Trigger Event
  -> Run Orchestrator
  -> Autonomous Run (immutable snapshot, identity, provenance)
  -> Attempt(s) (retry and terminal settlement)
  -> Agent Runtime / Harness
       - context assembly and manifest
       - model/tool loop
       - tool governance and host boundaries
       - cancellation, steering, follow-up, compaction
  -> Delivery Policy
  -> ordinary Timeline / Home Receipt / Pet presentation

Every boundary emits fixed framework events
  -> append-only Execution Event Ledger
  -> filtered Timeline / Run Receipt / Trajectory / Metrics projections
```

The model loop remains AI SDK `ToolLoopAgent` initially. The proposed Harness is an orchestration and lifecycle layer around it, not a second model loop.

## 2. Core Contracts To Preserve

### Trigger provider contract

Each provider turns an external or internal stimulus into a typed `TriggerEvent`. Providers own eligibility and scheduling mechanics; they do not own Agent execution, persistence, approval, or delivery. A provider may be added without changing the Agent loop.

Required fields include provider kind, trigger identity, due time, character scope, requested delivery class, and provider-specific provenance. A trigger must be idempotently claimable and must not imply that a model call happened.

### Run and Attempt contract

`runId` identifies one autonomous execution and its receipt/query key. `attemptId` identifies each provider/model execution within that Run. The Run captures an immutable effective context snapshot, initiator, delivery class, host/extension/policy generations, deadline, and terminal outcome. Settlement is idempotent and late/stale completions cannot mutate a newer generation.

### Execution event contract

The ledger is an internal append-only fact stream. Events carry runId/attemptId, monotonic sequence, event kind/category, timestamp, source component, redaction-safe structured fields, and correlation identifiers. Event production is synchronous framework code at lifecycle boundaries or a low-overhead non-blocking sink; it is never an Agent tool and never requires prompt instructions.

Event categories should include run lifecycle, context, model, tool, approval/governance, persistence, delivery, retry/error, and system/trigger. Raw prompt, secret, full tool input, and sensitive sensor data remain excluded or separately access-controlled.

### Projection contract

The user-facing monitor reads projections rather than raw events. A readable timeline groups events by Run and category, supports filters and detail inspection, and can be disabled at the presentation/storage policy level without changing Run correctness. Developer mode may expose richer redacted details; production defaults remain privacy-safe.

## 3. Reference Roles and Integration Decision

The references are intentionally assigned to different layers. The Runtime/Harness architecture follows PI as one
coherent model. DSH contributes observability and extensibility techniques only; its Session/Agent/Task runtime model is
not combined with PI's runtime state machine.

- **PI — adopt as the Runtime/Harness baseline.** Use its loop/Harness separation, operation state and recovery
  program counter, cancellation/steering/follow-up semantics, effect intent/settlement, and typed lifecycle boundaries.
  Adapt these to Character ownership, the existing AI SDK `ToolLoopAgent`, and TakiAgent's Host/Approval/Timeline rules.
- **DSH — adopt for observability.** Use its append-only event facts, contiguous sequence, durable/live event split,
  fixed producer/consumer boundaries, query/trajectory projections, non-blocking telemetry, and redaction seam. The
  TakiAgent Run Event ledger is attached to PI-shaped lifecycle boundaries; it is not a second DSH Session authority.
- **DSH — use selectively for extensibility.** Its plugin-oriented composition is a reference for low coupling and
  high cohesion. TakiAgent retains a privileged Core for identity, governance, persistence, security, and Character
  boundaries. Only independently replaceable or lifecycle-owned concerns become providers/plugins.
- **OpenClaw/Hermes — adopt as trigger/product references.** Use their schedule, Heartbeat, context selection, catch-up,
  and delivery mechanisms; they do not define the Runtime/Harness state model.
- **Reject hybrid authority.** Do not combine PI operation state with DSH Session/Agent/Task state, create a second
  execution loop, make logging a model-facing tool, persist secrets/raw payloads by default, or let trigger providers
  own execution state.

## 4. Main Risks

1. Adding a Harness around the existing loop can duplicate persistence or cancellation unless ownership is explicit.
2. Event volume can grow rapidly; the ledger needs redaction, retention, sampling/detail levels, and bounded payloads before production enablement.
3. Queue visibility is incomplete today: an active-turn registry does not show queued work, which weakens busy deferral and operator diagnosis.
4. Timeline rows are a relationship projection, not an execution ledger; autonomous evidence must not be forced into fake user/assistant rows.
5. Context replay currently exposes no first-class manifest of source sections, token estimates, compaction decisions, or tool catalog generation, limiting later optimization analysis.

## 5. Research and Architecture Gate

The research outcome is an adopted architecture baseline, not an implementation authorization. The first implementation
slice belongs to the Harness foundation and observability contracts. Scheduler, Heartbeat, Delivery, and Subagent work
are compatibility consumers or later product tasks; they must consume the common seam rather than create separate
execution loops or authorities.

The cross-module baseline is recorded in `docs/ARCHITECTURE-ROADMAP.md`. The implementation task must treat the
following as already settled at architecture level:

- PI is the Runtime/Harness reference; DSH is the observability reference; OpenClaw/Hermes are trigger/product
  references.
- `Run/Attempt.currentState` is the recoverable program counter and `RunEvent` is append-only evidence; both are
  committed through one Core transition/settlement boundary.
- `intent -> effect -> settlement` governs uncertain work; unsettled external effects are never silently replayed.
- `taskId` remains Scheduled Task definition identity; each fire creates a new `runId`.
- Admission is one Core service; Character serialization, Heartbeat busy/defer, Scheduled single-flight, and Run-level
  budgets are policies on that shared seam.
- Subagents are Child Runs with bounded isolated context and structured result return to the parent Run; they do not
  directly write the relationship Timeline or become a second user-facing Session authority.

Concrete schemas, migrations, sequence scope, retention, redaction matrices, queue numbers, recovery workers, and
child-result details remain implementation contracts and may evolve with evidence under the roadmap maintenance rules.

Phase B's canonical contract is persisted in `research/phase-b-harness-contract.md`. It deliberately keeps the public
identity hierarchy small: `characterId` is the project-specific isolation boundary, `runId` is the logical execution
key, `attemptId` is subordinate retry lineage, and `Operation` is Run-owned current state rather than a mandatory
parallel `operationId` aggregate. Event-local identifiers remain correlation fields until an independent lifecycle is
proven.

## 6. Phase Exit Criteria

| Phase | Exit evidence |
|---|---|
| Current-state audit | Call graph, lifecycle map, authority map, persistence map, and explicit gap inventory grounded in live files |
| Harness contract | PI-to-TakiAgent mapping, canonical terms, state machine, admission/cancellation/deadline semantics, and no-second-loop proof |
| Persistence/recovery | Current-state authority, event authority, effect sandwich, crash matrix, migration/retention plan, and idempotent settlement rules |
| Observability | Versioned event taxonomy, producer boundaries, durable/live planes, projection schemas, privacy/redaction matrix, and query authorization |
| Integration mapping | One owner per write path for chat, queue, context, Memory, Host, Approval, Extension, delivery, and Pino; duplicate paths rejected |
| T4 compatibility | Trigger request shape, Run/Attempt/Receipt compatibility, Child Run/context requirements, and explicit T4-owned policy list |
| Implementation gates | Child task boundaries, context manifests, migration allocation rule, test matrix, boot proof, and full quality gate |
