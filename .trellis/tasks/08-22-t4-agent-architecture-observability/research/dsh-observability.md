# Research: DeepSeek Harness Observability and Full Agent Traceability

- Query: Research DeepSeek Harness (DSH) observability and full agent-behavior traceability, then compare it with TakiAgent T4 requirements and current Core architecture.
- Scope: mixed (local reference source plus TakiAgent source and T4 documents)
- Date: 2026-08-22

Presentation update, 2026-09-05: this report records the reference architecture and its original adaptation.
For current user-facing field selection, [G4 and the reference comparison](uiux-useful-information-2026-09-05.md)
supersede generic technical-inspector/raw-structured-view suggestions below. Canonical evidence remains intact;
reference diagnostic capabilities are not a requirement to display internal metadata in TakiAgent pages.

## Findings

### 1. Architectural fact source: one canonical append-only session ledger

DSH makes the session event log the authoritative fact stream. The architecture document distinguishes durable `SessionEvent` facts from live coordination events: session events survive reload and are broadcast through `session/event`; `agent/*` events are live work-in-flight controls; capability events attach policy and adapters without importing the loop (`references/deepseek-harness-master/docs/architecture.md:53-61`). A step is one model request plus its tool calls, while a turn contains zero or more steps; the documented lifecycle records turn/step boundaries, user messages, raw assistant chunks, assembled assistant messages, tool calls, and tool results (`docs/architecture.md:63-84`).

The session log is explicitly the source of model context. `deriveMessages()` projects model history from the log, while raw assistant chunks preserve replay/UI fidelity; fork, resume, transcripts, telemetry, and persistence all derive from the same stream (`docs/architecture.md:92-96`). The invariant is “model-visible means logged”: anything sent to a model request must be reconstructable from the log, and new model-visible inputs require a new event type (`docs/architecture.md:94-97`).

The implementation gives each event a monotonically contiguous sequence and append timestamp. `Session.append()` snapshots and validates JSON data once, validates surface metadata, assigns `seq = log.length` and `time = Date.now()`, deep-freezes the event, commits it to the log, then publishes `session/event` observers (`packages/core/session/src/index.ts:569-648`). The append hot path never blocks on I/O; persistence plugins buffer asynchronously, and observer failures are logged/contained after the event is committed (`packages/core/session/src/index.ts:569-575`). The event list is immutable and deep-frozen for readers (`packages/core/session/src/index.ts:551-567`).

The event vocabulary is deliberately split between model-surface records and log-only facts. DSH records `turn/start`, `turn/end`, `step/start`, `step/end`, `user/message`, `assistant/chunk`, `assistant/message`, `tool/call`, and `tool/result`; request headers/context, seed boundaries, todo state, approvals, hooks, compaction, and other plugin events are also durable log-only records (`packages/core/session/src/types.ts:231-336`; `docs/persistence-catalog.md:10-90`). Only `user/message`, `assistant/message`, and `tool/result` are surface-eligible; compaction may replace earlier surface nodes with `surfaceOp` and `sourceEventSeqs`, leaving the raw ledger intact (`packages/core/session/src/types.ts:339-393`).

This design is directly relevant to T4 Run History: it provides one factual stream that can record both visible conversation and invisible autonomous execution, rather than trying to reconstruct behavior from pino text logs after the fact.

### 2. Event producer/consumer boundaries are typed and inspectable

The generated producer/consumer matrix enumerates event declaration sites, dispatchers, and listeners. It shows separate live event domains for agent lifecycle, session lifecycle, prompt assembly, LLM streaming, tool pre/execute/post/result, approvals, subagents, schedules, and telemetry (`docs/event-producer-consumer.md:8-69`). This makes observability coverage auditable: a missing producer or listener is visible in the matrix instead of being hidden behind arbitrary logger calls.

The lifecycle document shows the intended separation: durable session events are sent to `session/event`, while live coordination/status is sent through `agent/*` (`docs/agent-lifecycle.md:4-7`). The same document records queue claim/splice, pre-step admission/rejection, request/error handling, chunks, tool calls/results, turn stopping, and turn closure in order (`docs/agent-lifecycle.md:19-72`). It also states that SDK consumers needing replayable transcript data should consume `session/event`; `agent/*` is the live coordination API (`docs/agent-lifecycle.md:74-80`).

Recommendation for T4: preserve this two-plane distinction. A Run ledger should contain durable facts needed for replay/receipt; a live event bus can drive UI, cancellation, busy state, and monitoring without becoming another history authority.

### 3. Tool execution has fixed framework observation seams

The DSH tool pipeline is a framework-owned sequence: `tool/call` is logged before execution; `tools/pre-execute` handles policy/hooks/sandbox; `tools/execute` wraps the actual body for timeout/retry/metrics; `tools/post-execute` can accept/block/replace/enrich; normalization/finalization creates an authoritative result; `tools/result` synchronously observes the frozen outcome; then `tool/result` is appended to the session ledger (`docs/tool-execution-pipeline.md:4-27`, `:29-60`).

The typed event declarations make the fixed boundaries explicit. `tools/pre-execute`, `tools/execute`, and `tools/post-execute` are waterfalls; `tools/result` is an observer of the frozen, lossless-JSON final outcome (`packages/core/tools/src/index.ts:142-197`). The registry freezes the execution and contains observer failures so telemetry cannot alter the tool result (`packages/core/tools/src/index.ts:1648-1675`).

The loop writes a durable call event before dispatch and a model-ordered durable result linked by `sourceEventSeqs` after finalization (`packages/core/agent-loop/src/tool-calls.ts:145-158`, `:248-289`). Cancellation records synthetic error results for calls skipped before dispatch, preserving a valid replay transcript (`packages/core/agent-loop/src/tool-calls.ts:8-10`, `:248-258`).

This is the key answer to the T4 constraint that logging must not consume agent tools, tokens, context, or steps: instrumentation is attached to fixed Core dispatch/append code, not implemented as a model-facing tool or prompt instruction.

### 4. Persistence is append-only, durable, and crash-repairing

The persistence seam stores `SessionEvent` itself; there is no parallel persisted-message authority (`packages/session/session-persistence/README.md:1-12`). `append()` is append-only, requires contiguous sequence numbers, snapshots JSON, and returns only after the batch is durable (`README.md:13-35`). The coordinator serializes writes, uses bounded write-behind batches, and drains them at `session/flush`/teardown (`README.md:36-75`; `packages/session/session-persistence/src/coordinator.ts:1084-1137`, `:1326-1351`).

Crash handling preserves complete committed events and synthesizes only missing closers (`tool/result`, `step/end`, `turn/end {interrupted}`) for an interrupted final turn (`packages/session/session-persistence/src/coordinator.ts:891-930`). Torn physical tails are represented by an opaque backend marker and repaired durably, while middle-log corruption, sequence gaps, unsupported required event types, or invalid records refuse reconstruction (`packages/session/session-persistence/src/coordinator.ts:933-955`; `packages/session/session-persistence-jsonl/src/index.ts:306-345`). JSONL append rolls back a partial write before rethrowing so retries do not duplicate sequence numbers (`packages/session/session-persistence-jsonl/src/index.ts:646-679`).

This gives T4 a concrete reliability model: a Run/Attempt ledger should never silently truncate a started attempt. Recovery should close an interrupted attempt with an explicit unknown/aborted outcome, and only discard an actually torn physical tail.

### 5. Telemetry is a fixed-code, non-blocking side channel

The telemetry Service Definition owns capture, projection, redaction extension, and handoff; backend SDKs own batching/retry/queue/loss policy (`packages/session/session-telemetry/src/index.ts:1-14`). A `SessionTelemetryRecord` has `channel` (`ledger` or `ops`), time, severity, minimal identity attributes, and a deep-copied body (`packages/session/session-telemetry/src/index.ts:47-87`). Ledger records mirror session events; ops records cover operational facts with no session-event sequence identity (`packages/session/session-telemetry/src/index.ts:57-87`).

The sink contract requires `emit()` to be a non-blocking enqueue because the coordinator calls it synchronously from `session/event`; errors are contained and never reach the loop (`packages/session/session-telemetry/src/index.ts:90-130`). The coordinator subscribes to `session/created`, `session/disposed`, `session/event`, `session/flush`, and `agent/error`; it deep-copies and projects events, performs fixed first-chunk reduction, redacts, and hands records to the backend. All handlers are contained per event so a failing backend cannot starve other subscribers or touch the agent loop (`packages/session/session-telemetry/src/coordinator.ts:1-12`, `:74-125`, `:138-220`).

Telemetry does not add a model request. The telemetry README explicitly states zero model-token/model-context effect (`packages/session/session-telemetry/README.md:1-10`, `:130-149`), and the OTel provider repeats that it only forwards redacted records and never contributes to a model request (`packages/session/session-telemetry-otel/README.md:44-50`).

The coordinator's handoff cursor is per in-process `Session` object and tracks the highest sequence handed to a backend, not guaranteed delivered. Re-adoption rebuilds projection state without re-handing already handed events; a missing cursor safely re-hands from the current process boundary (`packages/session/session-telemetry/src/coordinator.ts:32-43`, `:151-170`, `:217-226`). This is at-most-once handoff, not a durable outbox; the README documents crash-loss and duplicate/dedupe trade-offs (`packages/session/session-telemetry/README.md:28-33`).

T4 should adopt the fixed-code observer shape, but decide separately whether Run receipts need stronger at-least-once durability than DSH telemetry. A Run Receipt is product evidence, not merely best-effort telemetry.

### 6. Redaction/privacy is explicit, pluggable, and fail-closed on rule failure

`session-telemetry/record` is a synchronous waterfall immediately after projection. DSH ships no built-in scrubbing rules: the innermost `next()` passes records unchanged, listeners can transform or replace, and a throwing listener withholds that record fail-closed; the canonical session log is never rewritten (`packages/session/session-telemetry/src/index.ts:24-44`; `packages/session/session-telemetry/src/coordinator.ts:205-215`). Tests pin pass-through behavior, listener replacement/stacking, unchanged canonical logs, and fail-closed withholding (`packages/session/session-telemetry/tests/redact.spec.ts:39-128`).

The OTel provider defaults to `DISABLED`; `FULL` captures live records, `FEEDBACK_ONLY` replays a canonical prefix only after an explicit canonical `feedback/record`, and `DISABLED` constructs no exporter or coordinator (`packages/session/session-telemetry-otel/src/index.ts:43-67`, `:141-167`, `:237-253`; `packages/session/session-telemetry-otel/README.md:22-34`). The provider documents the privacy limitation plainly: uploading modes carry complete event data, including prompts, tool args/results, command/file output, cwd, and compaction; no redaction rules are built in, so deployments exporting beyond a trusted boundary must mount their own rules (`packages/session/session-telemetry-otel/README.md:36-38`). Credentials are structurally absent because adapter keys are constructor inputs, not session events (`README.md:38`).

TakiAgent requires stricter default handling than this DSH reference: local development observability can be full and user-toggleable, but secrets must never be displayed. Therefore adopt the redaction seam and separate canonical/private storage from user-facing projections, while providing mandatory default redaction/classification for known secrets and sensitive payloads rather than relying on deployment configuration alone.

### 7. Query, classification, relationship tracing, and user-facing presentation are separate projections

The query service reads detached logical sessions/events and provides metadata filters, event filters, semantic text search, surface classification, event tracing, and parent/child lineage tracing. Event filters cover sequence/time/type/surface/text, with AND across clauses and OR within a clause (`packages/session-query/session-query/src/filters.ts:12-38`, `:70-118`, `:140-158`). Text is compiled as a literal escaped, case-insensitive, whitespace-flexible regex, preventing regex injection (`filters.ts:100-117`).

The canonical surface fold classifies every raw event as `current`, `shadowed`, or `log-only`; `traceEvent` exposes replacement chains, replaced nodes, source-event links, and derived descendants (`packages/session-query/session-query/src/tracing.ts:21-104`, `:175-213`). This is useful for T4 because a Run ledger can distinguish current user-visible delivery from internal/superseded facts without deleting evidence.

Model-facing session-query tools add workspace authorization before reading other sessions. A caller may inspect its own session or same-`cwd` sessions; unauthorized targets are rejected, lineage projections replace unauthorized subtrees with `[outside workspace]`, and service-boundary errors are sanitized (`packages/session-query/tool-session-query/src/workspace-access.ts:54-107`, `:109-152`, `:173-203`; `packages/session-query/tool-session-query/src/presentation.ts:48-78`, `:108-147`). This is a useful privacy pattern for TakiAgent's operator-facing filtering, but it is not a substitute for payload redaction.

The trajectory UI is a pure consumer plugin: it registers event definitions and a conversation-view slot, consumes Session data in the browser, and contributes no service or model request (`packages/client/ui-trajectory/README.md:1-9`; `packages/client/ui-trajectory/src/client/index.ts:22-64`). It projects records into user-readable kinds (`system`, `user`, `context`, `message`, `tool`, `subtool`) with source sequence/call IDs, input/output detail, prompt/tool-schema snapshots, usage, timing, and error state (`packages/client/ui-trajectory/src/client/trajectory-record.ts:1-98`; `packages/client/ui-trajectory/src/client/layout.ts:256-330`, `:353-455`, `:680-755`, `:992-1035`).

The UI keeps raw events in the shared Session window while the Trajectory target retains assembled view state, supports stable record IDs, search, collapsing, timeline selection, older-page loading, virtualization, and a local inspector (`packages/client/ui-trajectory/README.md:1-9`; `packages/client/ui-trajectory/src/client/TrajectoryView.tsx:120-153`, `:291-339`; `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx:1690-1778`, `:2530-2640`). Search indexes visible summaries, raw input/output, schema, source blocks, prompt snapshots, and result previews without changing the canonical log (`packages/client/ui-trajectory/src/client/trajectory-search-index.ts:39-72`, `:75-132`).

This directly matches the user's requirement that logs be classified and filterable, not a raw JSON dump. T4 should expose a readable Run Timeline plus an event inspector, with category filters and raw/structured detail behind an explicit operator/developer action.

### 8. Comparison with current TakiAgent architecture

T4's handoff defines the required product facts: an Autonomous Run is Core-owned, inspectable, has an initiator, immutable effective context, one or more Attempts, explicit terminal state, and optional delivery (`docs/T4-HANDOFF.md:80-96`). Every claimed Scheduled execution and eligible Heartbeat run must write internal Run History; only actual speech enters the relationship timeline; silent/avatar-only Heartbeats create no fake user row (`docs/T4-HANDOFF.md:190-201`).

The current TakiAgent Core instead centers on `chat-agent.ts`: it appends a user timeline row unconditionally, builds instructions and tools, executes the AI SDK `ToolLoopAgent`, streams deltas, persists completed response messages/partial text, handles cancel-retract, and fires detached memory/usage hooks (`packages/core/src/agents/chat-agent.ts:137-184`, `:190-277`, `:288-316`, `:325-339`, `:397-432`). This is faithful for interactive turns but the unconditional `appendUser`, message-oriented memory assembly, and user-row-based cancellation semantics are explicitly identified by the T4 handoff as unsafe for autonomous turns (`docs/T4-HANDOFF.md:289-302`).

Interactive scheduling currently occurs at the WS boundary: `chat-send` acquires a per-character queue, starts the active cancellation registry, calls `chatAgent.stream`, and emits delta/complete/error notifications (`packages/core/src/server/methods/chat-send.ts:26-74`, `:76-121`). The queue only exposes blocking `acquire` and the registry only tracks an active controller; queued work is not represented in a durable ledger and cannot be canceled before start (`packages/core/src/agents/turn-queue.ts:7-35`; `packages/core/src/agents/turn-registry.ts:7-33`).

The conversation store persists safe timeline projections and full response tails for replay, but it is not a typed execution ledger. Tool call persistence is names-only and the primary store is a relationship timeline projection (`packages/core/src/agents/conversation-store.ts:1-10`, `:39-63`, `:101-125`). TakiAgent's pino logger is structured and correctly avoids secrets/prompts/bodies, but it remains application logging rather than a correlated, append-only agent trajectory (`packages/core/src/logging/logger.ts:1-22`; `.trellis/spec/backend/logging-guidelines.md:1-22`).

The current runtime already has useful context capture: `AgentRunContext` can hold immutable tools/instructions and a `runContext` factory captures Host/extension context across retries (`packages/core/src/agents/chat-agent.ts:51-56`, `:75-76`, `:153-178`). However, this is an in-memory per-turn input, not a durable Run/Attempt snapshot or queryable receipt. T4 must add that durable boundary around the existing loop rather than creating a second model loop.

## DSH event taxonomy and recommended T4 projection

| DSH pattern | T4 adaptation | User-visible projection |
|---|---|---|
| `turn/start`, `turn/end` | `run/started`, `run/terminal` plus Attempt boundaries; include initiator, delivery class, reason, retryability | Run status, start/end, terminal outcome |
| `step/start`, `step/end` | `attempt/step-start`, `attempt/step-end` or a normalized step record | Step count, duration, interruption/error |
| `user/message`, `assistant/message` | Preserve relationship timeline events only for actual speech; log autonomous prompt/context separately | Chat bubble or Run Receipt preview |
| `assistant/chunk` | Development-only sampled stream evidence, or first-chunk marker + final assembled output | Streaming detail only when enabled |
| `tool/call`, `tool/result` | Fixed Core tool boundary events with call ID, name, args/result classification, outcome, latency, approval state | Tool row with input/output inspector |
| `request/header`, `request/context` | `context/snapshot` / `attempt/request` containing provider/model, prompt/tool manifest hash, effective context IDs, token counts; payload policy controls full prompt visibility | Context panel with redacted detail |
| `agent/error` / ops records | `run/error`, `run/retry`, `run/shutdown`, `delivery/*`, `approval/*` as operational evidence | Error/retry/delivery badges and filters |
| surface `current/shadowed/log-only` | classify Run events into current delivery, superseded projection, or internal evidence | Timeline filter; no evidence deletion |

Recommended projections:

1. **Canonical Run Event Ledger**: append-only, immutable, contiguous `seq`, `runId`, `attemptId`, event type, timestamp, initiator, and JSON payload. It is the source for receipts, queries, diagnostics, and replay-oriented context manifests.
2. **Attempt/Run Receipt projection**: latest status, terminal outcome, retryability, duration, provider/model, tool/failure counts, delivery state, and linked relationship timeline sequence. This is compact and Home-friendly; it must never replace the ledger.
3. **Developer Trajectory projection**: classified rows for run/attempt/context/model/tool/approval/delivery/memory/host events, stable IDs, filters by category/severity/attempt/tool/type, search, and an inspector with redacted payload and optional raw structured view.
4. **Telemetry projection**: a non-blocking, optional sink fed by fixed framework hooks. It should carry minimal indexed attributes plus a redacted body and support local-only, development-full, and explicit export modes.

Keep user-facing logs separate from canonical/private payloads. A viewer should receive a safe summary by default; privileged development inspection can request a redacted structured payload, while secrets and sensitive host data remain suppressed regardless of UI filter.

## Adopt / Adapt / Reject Matrix

| DSH idea | Decision | T4 treatment and rationale |
|---|---|---|
| Append-only canonical event log | **Adopt** | Required for truthful Run/Attempt evidence, crash recovery, and reproducible optimization. Keep relationship timeline as a separate projection per T4 ADR/contracts. |
| Contiguous seq + immutable JSON event envelope | **Adopt** | Gives deterministic ordering, event references, and corruption detection. Add `runId`/`attemptId` and event schema/version. |
| Durable-vs-live event plane (`session/event` vs `agent/*`) | **Adopt** | Use durable Run ledger events for history and a live bus for UI/cancel/status. Never infer durable facts from pino output. |
| Framework-owned tool pre/execute/post/result seams | **Adopt** | Instrument existing tool/governance boundaries in fixed code; no model-facing logging tool, prompt token, or extra step. |
| Session persistence write-behind + flush barrier | **Adapt** | Use a Core-owned Run ledger writer with bounded batching and explicit receipt durability checkpoints. Receipts may require stronger delivery than best-effort telemetry. |
| Synthetic closers for interrupted turns | **Adapt** | Close interrupted Attempts with explicit `outcome_unknown`/`interrupted` evidence; do not fabricate success or silently discard started work. |
| Session telemetry coordinator + non-blocking `emit` | **Adopt** | Use for optional observability/export. Ensure event serialization or bounded queue cannot delay agent execution; contain sink failures. |
| Handoff cursor / at-most-once telemetry | **Adapt** | Fine for dev metrics, not sufficient as authoritative Run Receipt. Add durable receipt state and receiver dedupe if external export matters. |
| Redaction waterfall with no built-in rules | **Reject as-is; adapt seam** | Keep an extensible redaction stage, but TakiAgent's secret/privacy contract requires safe defaults and mandatory masking for known secret classes. |
| FULL / FEEDBACK_ONLY / DISABLED sharing modes | **Adapt** | Provide local developer full trace, operator-configurable local trace, and explicit export/disabled modes. Do not make upload the default. |
| Query filters by type/surface/time/text | **Adopt** | Add category, severity, run/attempt, tool, trigger, delivery, and privacy-safe text filters. Escape literal search input. |
| Surface fold (`current`, `shadowed`, `log-only`) | **Adopt** | Use analogous classification to keep replaced/superseded evidence while avoiding duplicate user-facing rows. |
| Workspace/same-cwd authorization for session query | **Adapt** | Apply run/character ownership and operator roles; same workspace is not enough for secret-bearing payloads. |
| Pure trajectory UI plugin and local inspector | **Adopt** | Build a readable categorized Run Timeline and detail inspector as a projection over ledger/query APIs. |
| “Everything is a plugin” Cordis composition | **Reject as-is** | TakiAgent should keep a small privileged Core for Run identity, governance, persistence, and security. Use plugin-like extension seams only around stable contracts. |
| DSH full raw event export | **Reject as default** | Raw payload can include prompts, tool args/results, cwd, file/command output, and compaction text (`session-telemetry-otel/README.md:36-38`). User/developer views require redaction and bounded detail. |

## Risks / Limitations

- DSH telemetry is not inherently privacy-safe. The canonical log remains unredacted, the telemetry package ships no rules, and OTel FULL can export complete prompt/tool/file content unless deployment rules are mounted (`packages/session/session-telemetry-otel/README.md:36-38`). T4 must define mandatory local redaction/classification before exposing logs to users.
- `emit()` is non-blocking only by contract. A backend that performs I/O synchronously, allocates unbounded payloads, or blocks on serialization violates the hot-path guarantee. T4 needs bounded payload sizes, queue/drop policy, and metrics for observer lag/drop.
- DSH's handoff cursor is at-most-once and in-memory. It can lose records on process crash and can duplicate on re-adoption; it is unsuitable as the sole source of authoritative Run Receipt state (`packages/session/session-telemetry/src/coordinator.ts:32-43`; `packages/session/session-telemetry/README.md:28-33`).
- Full assistant chunks are expensive. DSH keeps only the first chunk in telemetry and stores raw chunks in the canonical log. T4 should make stream sampling/development retention configurable and never make chunk capture a required production path.
- Query authorization is workspace-oriented and trusted-infrastructure based. It does not redact payloads; it only restricts session targets and hides unauthorized lineage. T4 needs both target authorization and payload-level secret/privacy controls.
- Event schemas are merge-extensible in DSH. This is powerful but can create unknown-event compatibility hazards; required unknown events refuse reconstruction while explicitly ignorable events may be skipped (`packages/core/session/src/types.ts:408-426`). T4 needs a versioned closed core vocabulary plus an explicit extension registration policy.
- The current TakiAgent store persists a relationship timeline projection and names-only tool records, so it cannot presently provide DSH-level argument/result/context replay without a new Run ledger (`packages/core/src/agents/conversation-store.ts:1-10`, `:39-63`).
- The active `.trellis/.current-task` in this worktree still points at `.trellis/tasks/08-12-approval-productization`, while the requested T4 research output is under `.trellis/tasks/08-22-t4-agent-architecture-observability`; this report follows the parent dispatch's explicit output path and does not rewrite task pointers.

## Related TakiAgent specs and documents

- `docs/T4-HANDOFF.md:80-121, 190-240, 260-302, 360-455` — Run/Attempt/Receipt identity, trigger classes, heartbeat silence, privacy, and existing agent seams.
- `.trellis/spec/backend/agent-runtime.md` — full tool-call persistence, truthfulness floor, presentation/informational tool taxonomy, untrusted fences, and privacy layers.
- `.trellis/spec/backend/logging-guidelines.md` — pino levels, secret/prompt/body exclusions, and separate append-only Permission Gate audit log.
- `.trellis/spec/backend/host-operation-lifecycle.md` — common outcome/receipt semantics for Host-bound operations.
- `.trellis/spec/backend/database-guidelines.md` — SQLite single-writer and migration constraints relevant to a Run ledger.
- `.trellis/spec/backend/index.md` — backend package scope and quality gate.

## External references and versions

- DSH local reference repository: `references/deepseek-harness-master`, root package `@deepseek-ai/dsh-root` version `0.1.1-rc.2` (`references/deepseek-harness-master/package.json:2-3`).
- DSH source package versions for this report: `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-session-telemetry`, and `@deepseek-ai/dsh-client-ui-trajectory`, all `0.1.1-rc.2` in their package manifests.
- No network source was required; all behavior claims are grounded in the local DSH docs/source and TakiAgent docs/source listed above.

## Caveats / Not Found

- No DSH universal built-in PII/secret scrubber was found. The telemetry redaction hook is extensible but pass-through by default; deployment policy owns actual rules.
- No DSH guarantee was found that external telemetry delivery is at-least-once or crash durable. The documented contract is non-blocking handoff with backend-defined batching/loss and receiver dedupe.
- No T4 implementation code was changed or evaluated at runtime in this research pass. The T4 comparison is based on the handoff and current source snapshots.
- The report does not claim that the current TakiAgent branch is synchronized with live `main`; `docs/T4-HANDOFF.md` requires that check before implementation.

## Completed

- Read DSH architecture, lifecycle, event producer/consumer, persistence, tool pipeline, telemetry, OTel, query, authorization, and trajectory/UI documentation.
- Inspected concrete DSH session append, persistence coordinator, JSONL backend, tool pipeline, telemetry coordinator, redaction tests, query filters/tracing, workspace authorization, and trajectory projection/UI code.
- Inspected T4 handoff, current TakiAgent chat loop, queue/registry, conversation store, WS send boundary, logger, and relevant backend specs.
- Produced the event taxonomy, projection recommendations, adopt/adapt/reject matrix, and risk analysis above.

## Incomplete

- No implementation design files or schema proposals were modified; those belong to the parent T4 planning task.
- No full repository-wide TakiAgent event inventory was attempted beyond the agent/runtime seams relevant to this research topic.

## Unverified

- No live DSH process, telemetry collector, or TakiAgent UI was launched.
- No performance benchmark was run for append/telemetry/query/trajectory behavior.
- No external collector privacy configuration was validated.

## Extra Changes

- None. Only this research file was written.

## Residual Risk

The strongest residual risk is treating observability as ordinary logs or exporting canonical payloads directly. T4 should first establish a Core-owned Run ledger and typed event taxonomy, then derive receipts, developer trajectory, and optional telemetry from it. Secret masking, payload bounds, authorization, and explicit local/export modes must be part of the framework contract before user-facing traceability is enabled.
