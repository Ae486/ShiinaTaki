# Research: PI/OpenClaw Harness Architecture

- Query: Inspect the local PI/OpenClaw reference and identify harness architecture that can improve TakiAgent T4: loop/harness boundaries, durable session and operation state, lanes and queues, steering/follow-up/abort, tool lifecycle, compaction, recovery, typed events/hooks, telemetry, and usage accounting.
- Scope: mixed (local PI source, PI documentation, and current TakiAgent code/handoff)
- Date: 2026-08-22

## Findings

### 1. PI is two layers, and the distinction matters

The low-level loop is a provider-facing state machine over `AgentMessage[]`. It only converts to provider `Message[]` at the model boundary (`references/pi-main/packages/agent/src/agent-loop.ts:1-4, 277-312`). `runLoop` handles steering before the next assistant request, tool-call turns, a stop predicate, and follow-up messages after the agent would otherwise finish (`agent-loop.ts:155-275`). Tool preparation, execution, finalization, and result-message emission are separate phases (`agent-loop.ts:411-425, 433-554, 600-751`). This is a reusable execution primitive, not the durable application runtime.

The stateful `Agent` wrapper owns the in-memory transcript, event listeners, queue modes, active abort controller, and run lifecycle (`references/pi-main/packages/agent/src/agent.ts:167-238`). It exposes `steer`, `followUp`, `abort`, `waitForIdle`, `prompt`, and `continue` (`agent.ts:240-388`). Listener promises are awaited before the run is considered idle (`agent.ts:240-253, 486-535`). This gives a useful minimal harness for interactive work, but it does not persist operation state.

The higher-level `AgentHarness` contract is intentionally separate from both. The specification defines a Session, lanes, durable operations, registries, hooks, passive events, compaction/navigation, and recovery (`references/pi-main/packages/agent/docs/harness.md:80-109`). A lane owns its cursor, configuration, queues, and at most one operation; a session also owns immutable entries, facts, and an append-only usage ledger (`harness.md:86-105`). In the checked-out implementation, this layer is not complete: `AgentHarness.create` rejects non-empty restore and most operation APIs return `HarnessNotImplemented` (`references/pi-main/packages/agent/src/harness/agent-harness.ts:305-356, 347-353, 363-452`). Therefore the report treats `docs/harness.md` as the normative architecture and the source types/storage/reducer as concrete design evidence, not as a drop-in production dependency.

### 2. Durable state is a program counter, not an inferred journal

PI's durable model has three stores: write-once conversation entries, mutable namespaced registers, and append-only usage rows (`harness.md:115-127`). The operation metadata (`op.meta`) is written once; complete operation state (`op.state`) is replaced on every transition; terminal cleanup removes operation registers and records a bounded lane result (`harness.md:101-109, 345-370`). Recovery reads the current state directly and switches on the durable phase rather than folding a history of partial writes (`harness.md:127, 1805-1858`).

The prescribed operation shape distinguishes immutable intent from total current state. `Operation` records operation id, lane, source leaf, start time, and intent kind (`run`, `compaction`, or `navigation`) (`harness.md:946-963`). `OperationState` has explicit control (`running`/`cancel_requested`), captured settings, phase, inbox, and latest assistant entry; run phases include checkpoint, assistant generation, tools, compaction, deferred, and failure drain (`harness.md:965-1036`). This is the strongest PI idea for T4's Run/Attempt foundation: an autonomous Run should have a stable logical identity and a total current state that is sufficient to resume or explain the next action.

The local source also has a simpler record-log variant. `session/types.ts` defines `operation_started`, `abort_requested`, `operation_finished`, `step_attempt`, `tool_started`, queue, deferred-write, and usage records (`references/pi-main/packages/agent/src/harness/session/types.ts:80-212`). `reducer.ts` validates one bounded lane slice, rejects impossible states, and derives open operation state, pending queues, attempt progress, tool batches, overflow recovery, and terminal failures (`references/pi-main/packages/agent/src/harness/reducer.ts:15-43, 311-389, 520-650`). This offers a useful evidence projection, but it is not the same as the normative total-register interpreter; TakiAgent should choose one authority rather than combine two competing recovery models.

### 3. The effect sandwich makes uncertainty explicit

Provider requests and real tool calls are bracketed by durable intent and durable settlement: reserve output/usage ids and record "about to do X", execute the uncertain effect, then atomically commit output, usage, and next state (`harness.md:129-137, 148-176`). The only genuinely uncertain durable interval is intent committed with no settlement. Recovery then applies an explicit policy: retry a provider attempt under captured policy, replay a tool only when stored and current declarations both say `safe`, or synthesize an interrupted/error result rather than blindly repeating a side effect (`harness.md:1894-1916`).

The interpreter is designed so planning is pure over bounded durable inputs, conditional commits use register sequence tokens, and dispatch occurs only after the intent commit and a serialized effect-start check (`harness.md:1530-1718`). Every procedure/provider/tool/hook/timer call crosses an injected `Effects` boundary, while passive event delivery is observation and does not gate execution (`harness.md:1735-1795`). This is directly relevant to scheduled tasks and Heartbeat: a trigger must create a durable Run/Attempt intent before model/tool effects, and duplicate/late completions must settle against immutable run/attempt identity rather than current UI state.

### 4. Queues, steering, follow-up, and abort have distinct semantics

The low-level loop polls steering before another assistant turn and follow-up only after the agent would otherwise stop (`agent-loop.ts:166-190, 259-274`). Queue modes are `all` or `one-at-a-time` (`agent.ts:125-159, 264-310`). The harness persists queue payloads as reserved ids plus `pending.entry` data; `steer` and `followUp` are admitted only while a run is open, while `nextRun` is accepted in any state but never starts a run (`harness.md:1425-1446`).

Abort is control, not a separate phase. The first abort atomically marks cancellation, records drained steering/follow-up ids, leaves their payload registers until terminal reconciliation, then pulls the harness-owned signal (`harness.md:1918-1935`). After cancellation, no new provider request/tool/hook/retry may start; already-intended work and accepted deferred writes are reconciled. This is materially stronger than an in-memory `AbortController`: it gives a durable explanation of what was cancelled, what was drained, and what may still settle.

### 5. Tool lifecycle has a safe replay contract

PI separates clearance/preparation from effect execution and post-effect finalization. A planned call first passes lookup, argument preparation/validation, and `before_tool`; then the effective arguments are persisted and the call becomes `effect_pending`; after execution, `after_tool` transforms the result before atomic result settlement (`harness.md:1308-1331`). Each tool declares `replay: "never" | "safe"`; omission is unsafe (`harness.md:2610-2679`). Parallel effects may run concurrently, but finalization and result entries are source-ordered (`harness.md:1324-1331, 1690-1720`).

The low-level source already exposes the same separation through `prepareToolCall`, `executePreparedToolCall`, and `finalizeExecutedToolCall` (`agent-loop.ts:600-751`). TakiAgent should preserve its existing Core Governance/Approval boundary and add fixed instrumentation around these phases, rather than asking an Agent to self-report execution.

### 6. Compaction is structural work with durable boundaries

PI treats threshold/overflow compaction and navigation summaries as operations using the same `deciding -> generating -> result` machinery (`harness.md:1333-1362`). Preparation is captured before the decision hook, so a crash or setting change cannot silently alter what the summarizer saw (`harness.md:1144-1161`). Overflow is normalized to an assistant error, excluded from future context, compacted once, and guarded against infinite retry (`harness.md:1279-1306, 1364-1404`).

The existing compaction implementation provides deterministic token estimation, cut-point selection, retained-tail handling, and summary generation (`references/pi-main/packages/agent/src/harness/compaction/compaction.ts:88-102, 148-247, 363-424, 500-595, 615-707`). TakiAgent already has a Replay View and rolling summaries in `conversation-store.ts`; the transferable contract is to make context selection a named, inspectable projection with a captured manifest, not to copy PI's entire conversation-tree model into T4.

### 7. Events and hooks are different channels

PI's passive event stream is flat, typed, and non-transforming. Durable events fire after commit; process-local streaming events can precede persistence; event-listener failures produce `handler_error` and do not affect execution (`harness.md:2325-2450`). The event vocabulary covers run lifecycle, turns/retries, message streaming, tool start/update/end, entries, queues, config, compaction, navigation, lane creation, and usage (`harness.md:2332-2405`). The implementation's `HarnessEventBus` snapshots and buffers events so a subscriber can send a consistent snapshot before live events (`references/pi-main/packages/agent/src/harness/events.ts:20-101`).

Hooks are awaited interception points and may transform/deny execution. They run in registration order, aggregate outputs deterministically, and have explicit replay semantics (`harness.md:2479-2607`). `before_tool` fails closed on errors; other hook errors are isolated. This distinction maps well to TakiAgent observability: the fixed event ledger should observe all execution without adding Agent steps or tokens, while governance/approval remains a separate authoritative interception path.

### 8. Telemetry is typed, hierarchical, and content-safe

PI defines a vendor-neutral callback telemetry context; it does not use global async-local active spans (`harness.md:2681-2698`). Required spans include AI request, run/compaction/navigation, checkpoint, turn, retryable step, tool, hook, sleep, event handler, and session write. The generated schema makes operation/session/lane/attempt/tool/replay/recovery correlation explicit while forbidding prompts, completions, tool arguments/results, provider payloads, headers, handles, and credentials in telemetry attributes (`references/pi-main/packages/agent/docs/telemetry-schema.md:5-47, 57-87, 153-269, 327-381`).

For TakiAgent's user-facing developer log, this implies two projections from one fixed execution event source: (1) a secret-safe operational telemetry stream for metrics/traces and (2) a redacted, categorized timeline/inspector that may include controlled content for development troubleshooting. Do not overload Pino log lines with the full trajectory; Pino remains useful for process diagnostics, while the execution ledger owns run/attempt/tool/context evidence.

### 9. Usage is a durable ledger, not a derived log line

Every settled provider attempt, including retries, failures, and synthetic settlements, writes an append-only usage row; response and usage are committed together, and terminal cleanup never deletes ledger rows (`harness.md:452-464`). The telemetry schema separately records token/cost enrichment on `pi.ai.request` (`telemetry-schema.md:9-47`). TakiAgent's existing detached `onUsage` seam in `chat-agent.ts` is useful for calibration, but T4 needs an authoritative per-Run/Attempt usage record that survives process loss and is linked to the same attempt identity as output and terminal state.

## PI implications for TakiAgent T4

Recommended target shape:

```text
Trigger Provider (cron / at / every / future event providers)
  -> Trigger Event / initiator
  -> Run Orchestrator (immutable snapshot, Run + Attempt ids)
  -> Agent Runtime Adapter (existing ToolLoopAgent loop)
       -> Context Manifest / provider request
       -> Tool + Approval + Host pipeline
       -> Delivery / silence decision
  -> Execution Event Ledger (typed, append-only)
  -> Run Receipt / Timeline / developer trajectory projections
```

The trigger provider must not know how to invoke the model. It should enqueue a typed trigger event and let the Run Orchestrator capture time zone, extension/Host/policy generations, model identity, delivery class, and deadline. A future trigger provider then reuses the same Run/Attempt lifecycle.

## Adopt / Adapt / Reject Matrix

| PI concept | TakiAgent decision | Rationale / boundary |
|---|---|---|
| Low-level loop vs high-level harness split | **Adopt** | Keep AI SDK `ToolLoopAgent` as the loop; put Run identity, context, queues, effects, receipts, and observability in a Core-owned harness/orchestrator. |
| Session/lane abstraction | **Adapt** | Use a Character/Run lane or keyed execution scope to serialize user and autonomous work; do not import PI's full branching session tree until product requirements need it. |
| Durable operation metadata + total program counter | **Adopt** | Required for truthful resume, duplicate/late settlement, crash recovery, and Run Receipts. Store complete current attempt state, not inferred active flags. |
| Three-store model (entries/registers/usage) | **Adapt** | TakiAgent already has Timeline/SQLite and domain repositories. Add Run/Attempt state and append-only execution events using existing DB conventions; do not create a parallel generic storage engine without a migration plan. |
| Effect sandwich | **Adopt** | Every provider/Host/tool side effect gets intent, execution, settlement; unknown outcomes remain explicit and are never auto-replayed. |
| `replay: safe/never` tool declaration | **Adapt** | Add to the existing governed tool metadata, with Host operation contracts taking precedence; unsafe side effects settle `outcome_unknown` or interrupted. |
| Durable steer/follow-up/nextRun queues | **Adapt** | T4 needs queued user work visibility and future trigger extensibility. Use typed queue records and non-destructive busy probes; preserve ordinary chat semantics. |
| Abort as durable control plus reconciliation | **Adopt** | Extend existing turn cancellation so queued work and autonomous attempts have explicit cancellation and settlement states. |
| Typed passive events | **Adopt** | One fixed code-generated event taxonomy can feed filtered UI trajectory, metrics, receipts, and tests without Agent token/context cost. |
| Awaited transforming hooks | **Adapt** | Reuse governance/approval and extension seams as authoritative gates. Add hook-like lifecycle callbacks only where replay/idempotency is documented; do not make every feature a plugin. |
| PI compaction/tree navigation | **Adapt** | Reuse deterministic context projection/summary seams; keep TakiAgent's Replay View and no-fake-user-row autonomous rule. |
| Full PI session tree / multiple lanes / branching | **Reject for T4 v1** | High migration and UI cost; T4 needs one truthful Run/Attempt surface first. Keep a lane-like boundary so later parallel scopes remain possible. |
| PI telemetry schema as user log | **Reject** | Telemetry attributes must exclude content. Build a separate redacted trajectory/event projection for development and opt-in user inspection. |
| PI's unimplemented `AgentHarness` class as dependency | **Reject** | The checked-out implementation explicitly returns `HarnessNotImplemented` for core operations (`agent-harness.ts:347-452`). Borrow contracts and tests, do not depend on it at runtime. |

## Important contracts to preserve

1. **Run/Attempt identity is Core-owned.** The model cannot choose `runId`, `attemptId`, policy/Host generations, deadlines, or replay policy.
2. **One authoritative event source.** Emit fixed lifecycle events at code boundaries; project them into Pino/telemetry, readable trajectory, and receipts. Logging must not be an Agent tool or prompt instruction.
3. **Persistence ordering is explicit.** Intent before effect, settlement after effect; output, usage, and next state commit atomically where possible.
4. **No hidden replay.** A crash in an effect-pending window is unknown. Only declared idempotent/safe reads may replay automatically; Host side effects use the existing outcome-unknown contract.
5. **Snapshot immutability.** Capture extension, Host, governance, model, prompt/context inputs, trigger provenance, and delivery policy at Run start. Later config changes affect later Runs.
6. **Non-primary/autonomous turns stay outside conversational assumptions.** Do not append a fake user row, consume one-shot costume notices, retract a nonexistent user row, or run conversational auto-memory on a silent/heartbeat turn.
7. **Events are categorized and filterable.** Separate run, attempt/provider, context, tool, governance, host, delivery, memory, and error classes. Store controlled content in the developer trajectory projection, not telemetry attributes.

## Risks and unresolved questions

- The local PI harness document is significantly ahead of the executable `AgentHarness` implementation. Any dependency decision must be based on the source actually installed, not only the specification.
- TakiAgent currently has timeline persistence and structured Pino logs, but no single append-only execution ledger; introducing one requires schema/version and retention/privacy decisions.
- A full PI lane/session tree could conflict with TakiAgent's Character-scoped serialization, ordinary timeline delivery, Memory watermarks, and Host generation ownership. Start with one Run lane abstraction and defer branching.
- The exact boundary between Run Receipt evidence and user-visible timeline content remains a product/privacy decision. Development logs may be opt-in and content-bearing, but secrets, credentials, raw provider payloads, and unrestricted tool arguments need redaction policy.
- Scheduler/Heartbeat triggers must be provider-agnostic. `cron`, `at`, and `every` should be adapters to a common trigger contract, not branches embedded in the Agent loop.
- Attempt retry policy must distinguish provider retry, context-overflow retry, safe tool replay, Host reconnect, and unknown side effects; one generic retry counter would be misleading.
- Before implementation, TakiAgent's current main branch must be synchronized and its provider-neutral Memory contracts re-read as required by `docs/T4-HANDOFF.md:64-78, 346-350`.

## Files and references

- `references/pi-main/README.md` — PI monorepo package boundaries, runtime/AI separation, and permission non-goal.
- `references/pi-main/packages/agent/README.md` — low-level Agent API, event flow, queue semantics, and tool execution modes.
- `references/pi-main/packages/agent/docs/harness.md` — normative harness specification, durable storage, operation graph, recovery, events, hooks, and telemetry contracts.
- `references/pi-main/packages/agent/docs/telemetry-schema.md` — generated AI/harness/session telemetry schema and content-safety attributes.
- `references/pi-main/packages/agent/src/agent-loop.ts` — low-level loop, steering/follow-up polling, context transformation, stream and tool phases.
- `references/pi-main/packages/agent/src/agent.ts` — in-memory Agent wrapper, queues, abort signal, event listener settlement.
- `references/pi-main/packages/agent/src/harness/agent-harness.ts` — public harness types plus current scaffold status (`HarnessNotImplemented`).
- `references/pi-main/packages/agent/src/harness/session/types.ts` — durable entries, operation records, step/tool/queue/usage record types.
- `references/pi-main/packages/agent/src/harness/session/jsonl/storage.ts` — serialized append queue and JSONL persistence/atomic publication.
- `references/pi-main/packages/agent/src/harness/reducer.ts` — bounded recovery validation and lane-state projection.
- `references/pi-main/packages/agent/src/harness/events.ts` — typed passive event bus and snapshot-before-live watcher buffering.
- `references/pi-main/packages/agent/src/harness/telemetry.ts` — typed span schema definitions and context-based instrumentation helper.
- `references/pi-main/packages/agent/src/harness/compaction/compaction.ts` — deterministic token estimation, cut points, and summary generation.
- `packages/core/src/agents/chat-agent.ts` — current TakiAgent single-turn loop and existing run-context/onUsage seams.
- `packages/core/src/agents/turn-queue.ts` — current per-character async mutex, with no non-destructive busy probe.
- `packages/core/src/agents/turn-registry.ts` — current active-only cancellation registry.
- `packages/core/src/agents/conversation-store.ts` — current timeline replay/persistence and context-window projection.
- `packages/core/src/logging/logger.ts` — current structured Pino logger, not an execution trajectory ledger.
- `packages/core/src/extensions/extension-run-context.ts` — current immutable extension snapshot reused across retries.
- `docs/T4-HANDOFF.md` — T4 Run/Attempt/Receipt, trigger extensibility, autonomous turn, logging, and first production batch constraints.

## Caveats / Not Found

- No external web research was required for this source-grounded report; the local PI README/docs are the authoritative reference supplied in this workspace.
- The local checkout does not contain a completed durable `AgentHarness` driver implementation; operation/recovery behavior is specified in `docs/harness.md` and represented by session types/reducer/tests.
- PI does not provide TakiAgent's Governance, Approval, Host generation, Privacy Pause, or ordinary timeline delivery contracts. Those remain TakiAgent-owned and must wrap any adopted harness concepts.
