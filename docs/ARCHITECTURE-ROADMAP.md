# Agent Architecture Roadmap

> Status: living planning baseline, not a final implementation specification.
>
> This document coordinates architecture work across existing implementation and future slices. It records stable
> invariants, identifies which boundaries are TakiAgent-specific, and tracks where PI, DSH, OpenClaw, or Hermes
> provide a reference design. A later implementation may refine this roadmap when new evidence improves the design;
> it must record the change and its compatibility impact instead of silently diverging.

## 1. Purpose and Authority

This roadmap exists to prevent a narrow first implementation from becoming an accidental final architecture. It is the
planning home for cross-module architecture optimization, while the following documents remain authoritative for their
existing decisions:

| Area | Canonical source |
|---|---|
| Domain vocabulary | `CONTEXT.md` |
| Product and process boundaries | `docs/PRODUCT.md`, `docs/TECH-STACK.md` |
| Hard architectural decisions | `docs/adr/0001` through `docs/adr/0010` |
| Layer-specific engineering contracts | `.trellis/spec/` |
| T4 autonomous execution contracts | `docs/T4-HANDOFF.md`, `.trellis/tasks/08-22-t4-agent-architecture-observability/` |
| Deferred work and completion triggers | `docs/deferred-decisions.md` |
| This document | Cross-module sequencing, dependency map, adopted architecture baseline, and implementation follow-up |

This is not a replacement for an ADR, PRD, or executable spec. A hard-to-reverse decision belongs in an ADR; a
deliverable belongs in a Trellis task; a term belongs in `CONTEXT.md`; this file records how those pieces fit together.

## 1.1 Current Task Boundary

The current architecture task is **not the T4 product implementation program**. Its primary deliverables are:

1. a PI-shaped Runtime/Harness architecture for TakiAgent;
2. a DSH-shaped execution observability and monitoring plane;
3. explicit seams that later T4 providers and other triggers can consume.

Scheduled Task, Heartbeat, proactive delivery, Procedural Knowledge, and Experience Review remain downstream product
work. They may provide requirements and compatibility cases, but they are not automatically part of this task. A T4
item enters the current task only when it is a necessary Harness or observability contract, such as trigger admission,
Run/Attempt identity, context-mode compatibility, Child Run lineage, or Run Receipt projection.

This distinction is intentional: the architecture task establishes reusable infrastructure and contracts first; T4 then
implements product-specific providers and policies against those contracts. The current task must not accidentally turn
the first T4 slice into the final Harness design.

## 2. Architectural Invariants

1. TakiAgent has one Agent Runtime execution pipeline. User messages, Heartbeat, Scheduled Task, Webhook, system
   events, maintenance work, and subagent work are different inputs or policies, not different model loops.
2. `Character` is the TakiAgent domain root. It isolates persona, voice, character memory, character tools, and the
   relationship Timeline. A generic Harness abstraction must not replace it.
3. The relationship Timeline is a user-facing relationship projection. It is not the complete execution ledger.
4. One Core-owned execution fact source must feed Run status, Run Receipt, developer trajectory, metrics, and recovery.
   Projections must not become competing authorities.
5. Core owns global execution governance and durable policy; the selected Execution Host owns local OS enforcement and
   execution. Existing Host/Approval/Extension generation contracts remain in force.
6. A Run uses an immutable effective snapshot of the policies, Host, extension catalog, model route, context inputs, and
   delivery policy that were admitted for that Run. Later changes affect later Runs.
7. Uncertain side effects are explicit across Run, model, Tool, MCP, and Host work. Intent is recorded before an effect,
   settlement is recorded after it, an unsettled external side effect becomes `outcome_unknown` or an explicitly
   recoverable state, and it is never silently replayed. Results from an old Run/Host generation cannot mutate the
   current Run; they are retained only as stale/late evidence.
8. Context assembly remains behind the Replay View seam. Relationship storage is not rewritten for model-window
   reasons, and ephemeral context does not become fake conversation content.
9. Observability is fixed framework code. It does not consume model tools, tokens, context, or steps, and it does not
   weaken privacy or authorization boundaries.
10. New triggers, providers, Characters, projections, and clients must attach to stable seams rather than fork the
    Runtime or create a second source of truth.

## 3. TakiAgent-Specific Boundaries

These are product/domain requirements, not generic PI/DSH/OpenClaw objects to be copied:

- `Character` owns a continuous relationship Timeline and the Character Memory Bank.
- Global memory and Character memory remain separate policy scopes.
- Global assistant-layer instructions and Character persona are separate prompt inputs.
- Pet, Home, and future clients are disposable projections over Core state.
- Spoken proactive output uses the ordinary Timeline path; a Run Receipt is evidence, not a Companion utterance.
- Core, Host, Memory Authority, Approval, Privacy Pause, and data-locality rules remain TakiAgent-owned.
- Character assets and future voice, emotion, costume, and persona extensions remain data-driven and per-Character.

The existing ADRs already settle these boundaries. This roadmap does not reopen them.

## 4. Reference Design Boundary

The references have different roles. TakiAgent must not create a hybrid runtime by mixing PI and DSH concepts at the
same architectural layer.

### PI is the Agent Runtime architecture baseline

Use PI as the internally coherent reference for the Runtime/Harness layer:

- low-level model loop versus higher-level Harness;
- Session/context, lane-like execution scope, operation state, and program-counter recovery;
- steering, follow-up, cancellation, compaction, and resume semantics;
- effect intent/settlement and safe-versus-unsafe replay;
- typed lifecycle boundaries around model, tool, hook, and persistence work.

PI concepts must still be adapted to Character ownership, the existing AI SDK loop, Host/Approval contracts, and the
continuous Character Timeline. PI's incomplete `AgentHarness` implementation is research evidence, not a runtime
dependency.

### DSH is an observability and extensibility reference

Use DSH primarily for the monitoring plane:

- append-only event facts with contiguous sequence numbers;
- durable versus live event planes;
- fixed producer/consumer lifecycle boundaries;
- query, trajectory, and telemetry projections from one event source;
- non-blocking observation and explicit redaction hooks.

Use DSH's plugin-oriented composition only as a design pressure toward low coupling and high cohesion. TakiAgent should
keep a small privileged Core for Run identity, governance, persistence, security, and Character boundaries. A subsystem
becomes a plugin/provider only when the project needs independent replacement, lifecycle, or deployment; “everything is
a plugin” is not an invariant.

### OpenClaw/Hermes are trigger and product-mechanism references

Use them for Trigger Provider behavior, main/isolated context policy, deterministic schedules, catch-up, Heartbeat
eligibility, and delivery policy. They do not define the Runtime/Harness state model.

### Explicitly reject cross-layer mixing

- Do not combine PI's operation/recovery model with DSH's Session/Agent/Task model as a second runtime authority.
- Do not copy DSH's Cordis composition model as TakiAgent's authority structure.
- Do not expose DSH raw telemetry as a default user-facing log.
- Do not create separate Heartbeat, Scheduler, or autonomous chat loops.
- Do not create a user-visible Session list that conflicts with ADR 0005.

## 5. Minimal Cross-Module Runtime Model

```text
Character
├── primary relationship context (implicit)
│   └── Run*
├── optional isolated/child context
│   └── Run*
└── Scheduled Task*
    └── trigger occurrence
        └── Run
            └── RunEvent(seq)*
```

The first stable execution envelope should remain small:

```text
Run {
  runId,
  characterId,
  initiator,
  scheduledTaskId?,
  sessionId?,
  parentRunId?,
  immutable snapshot,
  lifecycle state,
  attempt identity/lineage,
  deadline/budget,
  terminal outcome
}
```

`Attempt` is a stable child identity within a Run because the current T4 planning contract requires Run/Attempt
identity, retry lineage, and idempotent settlement. It is not a second execution pipeline or a second authority. The
implementation may keep Attempt storage physically subordinate to Run state when that satisfies the durable repository
and recovery contract. `turn`, `step`, `toolCall`, and Host `operation` remain event fields or subsystem-local
identities unless they later gain an independent lifecycle, recovery contract, permission boundary, or query
requirement. This prevents every correlation field from becoming a separate implementation track.

## 6. Global Optimization Areas

### 6.1 Unified Agent Runtime and Harness

Connect `chat.send`, Scheduled Task, Heartbeat, future Webhook/system triggers, and subagents to one admission and Run
service. Preserve AI SDK `ToolLoopAgent` as the low-level loop. Add lifecycle, snapshot, cancellation, deadline,
settlement, and event seams around it.

### 6.2 Persistence, Ledger, and Recovery

Define the Core-owned Run state and append-only `RunEvent(runId, seq)` source. Keep receipts, trajectory, metrics, and
diagnostics as projections. Decide durability checkpoints, event versioning, retention, migration, orphan recovery,
and the exact process-crash policy for an in-flight effect.

### 6.3 Context, Memory, and Prompt Composition

Preserve Character/global isolation, ADR 0008 Replay View, ADR 0009 Memory Authority, and provider-neutral memory
contracts. Add only the missing cross-cutting contracts: context mode, immutable context manifest, child-context
seeding/fork rules, compaction/resume markers, and memory side-effect origin propagation.

### 6.4 Trigger Providers and Scheduling

Treat `scheduled`, `heartbeat`, `webhook`, `system`, and future commitment/activity providers as adapters that produce
admissible execution requests. Scheduler persistence, timezone/DST, catch-up, quiet hours, budgets, and delivery class
remain provider policy; execution and evidence remain Run responsibilities.

### 6.5 Capability, Host, Skill, and MCP Integration

Make every Run capture the effective Host, policy, extension, Skill, MCP, and credential generations. Preserve the
single Core Approval authority and Host-local enforcement. Extension reload, draining, reconnect, and unavailable Host
outcomes must settle through the same Run/operation contract.

### 6.6 Admission, Concurrency, and Resource Governance

Replace the current active-only turn controls with a shared admission layer that can answer what is queued, what is
running, what is blocked, and what may be cancelled. Plan per-Character serialization, background priority, fairness,
single-flight schedules, model/tool/Host budgets, backpressure, and bounded detached maintenance.

### 6.7 Observability and Diagnostics

Emit fixed typed lifecycle events at Run, model, tool, governance, Host, persistence, delivery, and recovery boundaries.
Produce DSH-like trajectory and query projections from the same source, but attach them to the PI-shaped Runtime
boundaries rather than introducing DSH runtime objects. Keep Pino for process diagnostics. Separate the always-on Core
Run Event Ledger, an optional mode-controlled Developer Trace, and the human-facing trajectory/inspector projection.
The ledger records bounded execution facts even when detail monitoring is disabled; a local `FULL`-style developer mode
may capture bounded Agent behavior detail for optimization, while secrets and authorization material remain excluded.
Use DSH-like `DISABLED`/`FEEDBACK_ONLY`/`FULL` modes and `current`/`shadowed`/`log-only` surface classification as
adapted contracts. Ordinary UI projections show readable labels, phases, statuses, outcomes, timings, counts, and
bounded error summaries, not raw protocol/database fields.

### 6.8 Delivery and Client Consistency

Keep Timeline, Home Run Receipt, Pet presentation, and future clients as projections over Core facts. Define whole-message
delivery, backfill, stale-generation rejection, idempotency, offline evidence, and reconnect restoration once for all
clients instead of per-window behavior.

### 6.9 Security, Privacy, and Data Governance

Unify secret exclusion, prompt/body logging rules, sensor fencing, cross-Run and cross-Character authorization, artifact
access, telemetry export, retention, deletion, and operator audit. Canonical events remain bounded and redacted; any
content-bearing Developer Trace is separate, local/detail-authorized, mode-controlled, and never bypasses mandatory
secret exclusion. A readable trajectory must not become a secret exfiltration path.

### 6.10 Subagents, Tasks, and Lineage

The product-level subagent direction is already established: a subagent is a delegated Child Run on the same Agent
Runtime, with an isolated/bounded context so it does not consume the parent/primary relationship context. Completion
returns a bounded structured result and linked evidence to the parent Run; the parent decides whether and how to express
that result. Child execution does not append its private transcript directly to the Relationship Timeline or claim
ordinary user delivery by default. `parentRunId` supplies lineage, while `runId` remains the child execution/query key.

Later implementation work must define one-shot/continuable result contracts, resource scope, delegation depth,
cancellation cascade, context seeding/fork rules, and only then consider DSH-style Task DAG/mailbox coordination. Any
SDK-specific child-session handle is an internal adapter detail and must not become a user-visible Session authority.

### 6.11 Provider, Model, and Usage Routing

Keep model/provider selection behind a route snapshot. Later support utility slots, fallback policy, cost/usage ledger,
rate limits, provider health, and per-Run budget decisions without embedding provider-specific branches in triggers or
Character logic.

### 6.12 Configuration and Operational Lifecycle

Separate operator configuration from immutable Run snapshots. Define boot validation, live config changes, generation
replacement, graceful shutdown, Core restart, orphan Run reconciliation, schema migration, and health/readiness
surfaces.

### 6.13 Character and Asset Extensibility

Keep persona, assistant layer, voice, emotion, costume, and Character tools as data/configuration or injected providers.
Adding a Character must not duplicate the Runtime, Memory engine, scheduler, or observability stack.

### 6.14 Protocol, Schema, and Verification Evolution

Shared schemas, Rust mirrors, DB migrations, event versions, replay fixtures, e2e trigger scenarios, recovery tests,
manual acceptance, and compatibility gates must evolve together. Deferred work must remain in
`docs/deferred-decisions.md` with an explicit trigger.

## 7. Architecture Optimization Phases (Current Task)

The current task is executed through the following architecture phases. These are planning and contract phases first;
production implementation is authorized only by a later, explicitly selected implementation slice.

| Phase | Main outcome | Exit gate |
|---|---|---|
| A. Current-state audit | Evidence-backed call graph, lifecycle map, authority map, persistence map, and gap inventory | Every entry point is classified as loop, harness, trigger, effect, store, or projection; authoritative versus derived state is named |
| B. Harness contract | Canonical Run/Operation/Attempt vocabulary, admission, lifecycle, snapshot, cancellation, deadline, effect, and recovery contracts | PI mapping and TakiAgent-specific adaptations are explicit; no second Session/Task authority is introduced |
| C. Persistence and recovery design | Durable current program counter, append-only execution facts, queue records, usage/effect settlement, retention and migration plan | Crash points have a defined resume, retry, wait, or `outcome_unknown` result; recovery does not fold the event log |
| D. Observability plane design | Typed events, durable/live planes, redaction, bounded payloads, query, trajectory, Receipt, telemetry, and authorization projections | Monitoring cannot affect execution; privacy defaults, retention, disabled mode, and export policy are testable |
| E. Integration mapping | Concrete seams to `chat-agent`, WS methods, queue, Replay View, Memory, Host, Approval, Extension, and Pino | Each seam has one owner and one write path; duplicate persistence or cancellation paths are rejected |
| F. T4 compatibility review | Stable adapters for future Scheduled Task, Heartbeat, delivery, and Child Run consumers | T4 policy remains outside Harness Core; providers emit requests/events and reuse the same runtime |
| G. Implementation slices and gates | Independently verifiable implementation batches, task tree, context manifests, and full quality gates | Every slice names dependencies, reserved seams, migration impact, tests, and non-goals |

### Phase ordering rules

- A-D establish the architecture contract before production code is split into implementation slices.
- E is the cross-layer design review; it prevents a correct abstract model from being wired into the wrong boundary.
- F is a compatibility pass, not T4 implementation. It records what T4 may consume and what remains T4-owned.
- G may divide implementation into batches, but a batch is not the final architecture. Changed assumptions update this
  roadmap, affected task artifacts, and compatibility evidence together.

### Current task acceptance matrix

| Area | Required evidence |
|---|---|
| Runtime boundary | Existing `ToolLoopAgent` remains the low-level loop; one Core-owned Harness owns admission, Run state, effects, settlement, and recovery |
| State authority | Mutable current state determines the next recoverable action; the event ledger is immutable evidence, not a second recovery authority |
| Trigger boundary | Chat, future T4 providers, system events, and Child Runs enter typed admission/Run requests; none invokes a private model loop |
| Persistence | Intent-before-effect and settlement-after-effect are defined for model, tool, approval, MCP, Host, and delivery boundaries where uncertainty exists |
| Observability | One typed event source feeds Receipt, trajectory, metrics, diagnostics, and optional telemetry; optional Developer Trace and human-facing projections remain separate; Pino remains process diagnostics |
| Privacy | Secret, prompt, tool payload, sensor, Host, and artifact exposure rules are defined per layer, mode, projection, and query role |
| Context | Replay View remains the relationship-to-model seam; Context Manifest is redaction-safe and does not become fake Timeline content |
| Extensibility | Provider/plugin seams exist only for independently replaceable or lifecycle-owned components; Core identity, governance, persistence, security, and Character boundaries stay privileged |
| T4 compatibility | Scheduler, Heartbeat, delivery, and subagent requirements are compatibility contracts, not product policy implemented here |

## 8. Downstream T4/Product Delivery Plan

The following stages are downstream consumers of the current architecture task. They are not the current task's scope by
default. Each stage must preserve the architecture phases above and update this roadmap when new evidence changes the
design.

| Stage | Main outcome | Must reserve for later |
|---|---|---|
| 0. Architecture baseline | identity, authority, ledger, context, extension, recovery vocabulary and dependency map | all future trigger and child-context seams |
| 1. Unified Run foundation | Run lifecycle, immutable snapshot, Run Events, primary chat integration, receipt/query foundation | scheduler, heartbeat, subagent and richer projections |
| 2. Scheduled Task | deterministic schedule definitions and fires entering Run | external triggers, generic work items, task DAG |
| 3. Heartbeat | eligibility, Class-B policy, structural silence, bounded context and delivery | future proactive providers and feedback calibration |
| 4. Delivery/reliability | Timeline/Receipt/Pet/Home convergence, reconnect and stale-result handling | future clients and remote delivery |
| 5. Subagent/context lineage | parent/child Run, isolated child context, bounded result return, one-shot/continuable contracts | team/task coordination |
| 6. Task coordination | generic work items, dependencies, claim/revision, mailbox and multi-agent coordination | domain-specific orchestration |
| 7. Advanced operations | cost routing, richer trajectory, procedural knowledge, experience review, policy analytics | future product features |

No later stage may silently introduce a second execution loop, second Timeline authority, second Approval authority, or
second Memory Authority.

## 9. Adopted Architecture Baseline and Implementation Follow-up

The architecture-level questions in this table have been resolved by adopting the relevant PI, DSH, OpenClaw, and
Hermes patterns, with the TakiAgent-specific boundaries preserved. This section is no longer an owner-question queue.
It records the adopted baseline and the implementation details that each stage must specify without reopening the
architecture direction.

| Topic | Adopted baseline and implementation follow-up | Suggested stage |
|---|---|---|
| Run state versus Run Event authority | **Resolved by adopting PI's durable program-counter pattern and DSH's canonical event-fact pattern:** `Run/Attempt.currentState` is the complete mutable recovery cursor; `RunEvent` is immutable append-only evidence for Receipt, trajectory, metrics, audit, and diagnostics. A single Core transition/settlement boundary writes the state change and authoritative event together. Recovery reads the current state directly and does not fold the event ledger; live bus/telemetry are non-authoritative projections. | 0/1 |
| Event durability and crash recovery | **Resolved by adopting PI's effect sandwich and TakiAgent's existing Host-generation contract:** persist intent before uncertain work, settle output/state atomically after it, never silently replay an unsettled external effect, and retain `outcome_unknown`/explicit recovery when needed. DSH-style live telemetry is not a recovery source. Concrete checkpoints, recovery workers, and event vocabulary remain implementation work. | 0/1 |
| Context policy | **Resolved at planning level:** context mode is a Run policy, not a second user-visible Session/history authority. Primary relationship context is used only when the run is intentionally part of the Character's conversational continuity; Heartbeat uses its already-decided thin provider-neutral context; Scheduled Task uses a bounded context assembled for the task and may read a Character-context projection without directly appending relationship content. Isolated/child context is reserved for explicit future lineage/delegation contracts, not inferred from every background trigger. Concrete manifests, seeding/fork rules, and projection schema remain implementation work. | 0/2/3/5 |
| Scheduled Task versus generic Task | **Resolved by adapting OpenClaw/Hermes's trigger-definition versus execution-history split:** `taskId` remains the identity of one persisted Scheduled Task definition; every fire creates a new `runId`. A future generic work item/DAG must be introduced as a separate abstraction rather than widening `taskId` into a universal task identity. | 2/5/6 |
| Admission and budgets | **Resolved at baseline level by adapting PI's lane/queue/abort model and TakiAgent's existing per-Character contracts:** one Core Admission service owns queued/running/blocked/cancelled work; ordinary relationship-affecting work remains serialized per Character; Heartbeat uses non-destructive busy/defer admission; Scheduled Task uses durable queue/single-flight admission; future child-context runs may receive an explicit separate lane only when lineage/resource contracts exist. Budgets belong to the admitted Run policy and are enforced at model/tool/Host boundaries, not in trigger providers. Detailed priority/fairness numbers and budget tables remain implementation policy. | 1/2/5 |
| Observability privacy | **Resolved at architecture level by combining PI's content-free telemetry with DSH's durable/live/query projection model, adapted to TakiAgent's stricter privacy contract:** canonical Run evidence is Core-owned and bounded; user-facing and exported views are separate redacted projections; telemetry is opt-in/non-blocking; known secrets and sensitive Host/sensor data are always excluded. Retention tables, redaction rules, and role/query matrices remain implementation policy. | 1/4 |
| Restart and supervision | **Resolved at architecture level by adopting PI's direct program-counter restore and TakiAgent's generation-safe Host semantics:** pre-effect and explicitly safe states may resume under the captured snapshot; approval waits resume the same Run; unsettled external effects never silently replay and may become `outcome_unknown`; terminal Runs never restart; stale Host results are evidence only. The exact reconciliation worker and operator UX remain implementation work. | 1/4/5 |
| Model/provider routing | **Resolved at architecture level by adapting PI's captured operation settings and preserving TakiAgent's owner ruling:** one global Main Model remains shared across Characters and semantic initiators; Utility Slot remains for internal maintenance; each Run captures an immutable provider/model route snapshot. Fallback, health, cost, and rate-limit policy are later routing features, not trigger-specific branches. | 1/7 |

Each grill item must first cite existing evidence and state what is already frozen. Questions answered by current code,
ADR, or reference research should be resolved by reading rather than asking the owner again.

## 10. Roadmap Maintenance Rules

1. Every new architecture task names the roadmap section and stage it changes.
2. A deferred item is added to `docs/deferred-decisions.md` with a completion trigger.
3. A hard-to-reverse, surprising trade-off becomes an ADR; this file links to it but does not duplicate its rationale.
4. A resolved domain term is added to `CONTEXT.md`; implementation details stay out of the glossary.
5. When implementation invalidates a planned assumption, update the roadmap, affected task artifacts, specs, and tests in
   the same planning change.
6. Before starting a later stage, review all earlier open items and prove that no deferred contract was lost.
7. A stage may be split into batches for delivery, but the stage's future dependencies and reserved seams must remain
   visible in the task tree.

## 11. Primary References

- `docs/adr/0001-ts-core-rust-shell-split.md` through `docs/adr/0010-separate-autonomous-run-history-from-relationship-timeline.md`
- `docs/T4-HANDOFF.md`
- `.trellis/tasks/08-22-t4-agent-architecture-observability/`
- `.trellis/workspace/pleia/t4-decisions.md`
- `.trellis/workspace/pleia/t4-second-grill-prep.md`
- `.trellis/spec/backend/agent-runtime.md`
- `.trellis/spec/backend/host-operation-lifecycle.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/logging-guidelines.md`
- `references/pi-main/packages/agent/docs/harness.md`
- `references/deepseek-harness-master/docs/architecture.md`
- `references/deepseek-harness-master/docs/persistence-catalog.md`
- `references/deepseek-harness-master/docs/agent-lifecycle.md`
- `references/deepseek-harness-master/packages/session/session-telemetry/`
- OpenClaw/Hermes research under `.trellis/workspace/pleia/`
