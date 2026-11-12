# Research: D68 Producer-First Observability Expansion

- Query: Determine what DSH records and presents, audit existing TakiAgent Run Event producers, and define a bounded first implementation wave for useful monitoring without a second runtime or authority.
- Scope: mixed (TakiAgent source, T4/DSH research, local DSH reference source)
- Date: 2026-08-28

## Findings

### 1. Immediate answer: what DSH monitors and how the UI presents it

Verified DSH facts from the checked-in reference:

| Diagnostic concern | Durable DSH evidence | Trajectory presentation |
|---|---|---|
| Run/turn/step boundaries | `turn/start`, `turn/end`, `step/start`, `step/end` (`references/deepseek-harness-master/packages/core/session/src/types.ts:236-256`) | Thick turn grouping; compact step markers; request rows are separate from message rows (`references/deepseek-harness-master/packages/client/ui-trajectory/src/client/layout.ts:22-43,256-277`) |
| Provider/model and request context | `request/header` snapshots with provider/model/config/system/tools, plus `request/context` with route and context-window metadata (`references/deepseek-harness-master/packages/core/session/src/types.ts:196-220,305-313`) | Request-only/context rows; provider/model and prompt/tool snapshot appear in the inspector, not as raw JSON in the main ledger (`references/deepseek-harness-master/packages/client/ui-trajectory/src/client/trajectory-request-header-definition.ts:9-20,45-71`) |
| Assistant streaming | `assistant/chunk` for raw token/block stream; `assistant/message` for assembled output and optional usage (`types.ts:265-277`) | In-flight partial Assistant row; publication uses animation-frame for content chunks; usage/finish chunks do not force the same animation path (`trajectory-assistant-definition.ts:107-165,278-360`) |
| Tool use | `tool/call` with call id/name/arguments and `tool/result` with result content, `isError`, error identity, and optional tool-owned metadata (`types.ts:279-301`) | One semantic Tool row pairs call/result, shows running state before result, error state and duration after result; nested subtools are separate rows (`trajectory-tool-definition.ts:30-67,218-271`; `layout.ts:421-455,723-755,992-1041`) |
| Usage/token accounting | `assistant/chunk` usage plus final `assistant/message.usage`; DSH token-meter folds disjoint uncached input, output, cache-read, and cache-write buckets, replacing an earlier same-step sample instead of double-counting (`references/deepseek-harness-master/packages/llm/token-meter/src/usage-projection.ts:1-16,91-121`; `references/deepseek-harness-master/packages/llm/llm/src/types.ts:127-141`) | Message inspector/metrics expose input/output/reasoning and optional cache read/write; Request totals cover the loaded window (`trajectory-record.ts:72-95`; `README.md:5`) |
| Timing/latency | Assistant step start, first-token, completion, tool call/result timestamps; DSH separates TTFT and decode timing (`trajectory-assistant-definition.ts:201-227`; `layout.ts:680-721`) | Overview timeline with real start/duration; exact timing on hover; running rows intentionally leave duration blank rather than inventing it (`README.md:5,17`) |
| Errors/retries | `agent/request-error` and `llm/retry` are lifecycle facts; retry records carry reason, retry ordinal, delay, and max retries (`references/deepseek-harness-master/docs/agent-lifecycle.md:41-44,74-80`; `trajectory-assistant-definition.ts:23-28,317-335`) | Failed request/tool rows show error status and bounded explanation; retry is represented in the Assistant request state, not hidden in process logs |
| Approval/governance | DSH persistence catalog has `approval/asked`, `approval/decided`, and `approval/policy` log-only records (`references/deepseek-harness-master/docs/persistence-catalog.md:138-203`) | Governance is a classified/log-only trajectory event or inspector detail, not a raw authorization payload |
| Recovery/compaction | Compaction start/end/summary, interruption, and request failure records are durable; surface fold marks current/shadowed/log-only (`persistence-catalog.md:294-378`; `session-query/src/tracing.ts:175-213`) | Collapsed compaction/recovery rows, replacement/shadow relationships, and inspector lineage |
| Search/filter/inspection | Provider-independent filters are AND across clauses and OR within a list; literal text search is escaped, case-insensitive, whitespace-flexible (`session-query/src/filters.ts:18-37,101-117`) | Main ledger remains semantic and compact; search/category filtering, older-page loading, collapse, virtualization, stable selection, and a local inspector are first-class (`ui-trajectory/README.md:5`) |

Important correction: DSH does not calculate cache hit/miss from absent fields. Its token usage contract defines optional `cacheReadTokens` and `cacheWriteTokens`; absence means no provider cache signal. TakiAgent must preserve `unknown/unavailable`, never synthesize `miss` or zero (`references/deepseek-harness-master/packages/llm/llm/src/types.ts:127-141`; `packages/core/src/observability/observability-query-service.ts:109-115`; `.trellis/spec/backend/observability-projection.md:38-42`).

DSH's ordinary tool surface emphasizes operation content, while its dedicated Trajectory Inspector can expose richer
payload/schema/timing information. The earlier TakiAgent adaptation allowed internal IDs/hashes/revisions in an
Inspector; the 2026-09-05 G4 owner clarification supersedes that allowance. Remove meaningless bookkeeping from
TakiAgent's user-facing primary and expanded views while keeping canonical/query identities intact. See the
[current reference comparison and field inventory](../../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).

### 2. Current TakiAgent producer inventory

The current Run/Event ledger is authoritative and append-only (`packages/core/src/db/run-event-repo.ts:5-33`; migration `packages/core/src/db/migrations/025-run-events.ts:4-28`). It has only three categories (`lifecycle`, `effect`, `usage`) and a closed event set (`packages/shared/src/run-event-schema.ts:9-35`). Existing producers are:

| Producer boundary | Current facts | Existing evidence |
|---|---|---|
| Run admission/start/retry/settlement/cancel/recovery | run/attempt state, initiator/delivery, retryability, summaries/error codes, trigger/task/parent correlation | `packages/core/src/db/run-repo.ts:83-169,183-205,266-319` |
| Effect lifecycle | effect kind/sourceRef, captured generation, approval refs, replay posture, outcome/error code, bounded summary | `packages/core/src/db/effect-repo.ts:46-51,53-68,71-101,103-152` |
| Model request execution | model effect intent/settlement around every `ToolLoopAgent` provider request; provider/model; request digest; stream interruption classification | `packages/core/src/agents/model-effect-middleware.ts:12-66`; model wrapping at `packages/core/src/agents/chat-agent.ts:219-237` |
| Model usage | authoritative `run_usage` row and `usage.settled` event; reported/estimated/unknown input/output/total | `packages/core/src/db/effect-repo.ts:140-148`; schema `packages/shared/src/effect-lifecycle-schema.ts:47-56` |
| Chat stream to operator | only `chat.delta` text notifications plus final `chat.complete/error`; the current Chat event contract has no durable/in-flight tool-call channel | `packages/core/src/agents/chat-agent.ts:263-280`; `packages/core/src/server/methods/chat-send.ts:144-181`; archived Monitor evidence, `implementation-evidence.md` post-acceptance section |
| Governed tools / approval | effect intent/wait/settlement contains source kind, approval ID/generations, stale/failed outcome; no distinct approval event kind | `packages/core/src/governance/governed-tool.ts:102-148,154-225`; `packages/shared/src/run-event-schema.ts:24-29` |
| Host/capability/MCP effects | same effect lifecycle with sourceRef/executorRef, generation lease, stale/unknown result semantics; no tool call/result semantic event separate from effect | `packages/core/src/capabilities/capability-broker.ts:47-100`; MCP binding at `packages/core/src/mcp/mcp-turn-tools.ts:103-118` |
| Context snapshot | immutable Run snapshot stores provider/model, Host/extension/governance/memory refs, context token-accounting mode and manifest digest | `packages/shared/src/harness-schema.ts:126-150`; capture in `packages/core/src/harness/run-snapshot-capture.ts:52-77` |
| Timing | Run/Attempt timestamps and effect start/settle timestamps exist in SQLite; projection derives Run duration only from `startedAt`/`terminalAt` | `packages/shared/src/harness-schema.ts:153-170,189-212`; `packages/core/src/observability/observability-query-service.ts:109-115` |
| Delivery | Run has `deliveryClass`; primary timeline append remains separate relationship projection; no delivery event/notification receipt fact | `packages/core/src/server/methods/chat-send.ts:57-74`; `packages/core/src/agents/conversation-store.ts:61-69` |

The current monitor already exposes `attemptCount`, `effectCount`, usage totals, provider/model, Run timing, semantic category/kind filters, and effect context labels, but only for facts actually produced (`packages/shared/src/observability-schema.ts:19-31`; `packages/core/src/observability/observability-query-service.ts:109-145`). It does not yet expose per-effect tool names/call IDs, request-level timing markers, context composition, approval transitions, delivery receipt state, retry details, or cache buckets.

### 3. Producer-to-projection matrix

| Desired Monitor field | Canonical producer to add/reuse | Current availability | First-wave disposition |
|---|---|---:|---|
| Run/Attempt state, outcome, retryability | RunRepo transition boundaries | ✅ | Keep; improve semantic labels/counts only |
| Provider/model | Run snapshot + model effect sourceRef | ✅ | Project per-attempt and per-model-effect route |
| Model request start/end and latency | Model effect middleware + effect intent/settlement timestamps | Partial | Add explicit measured duration/first-stream marker; do not derive from UI wall time |
| Input/output/total tokens | model middleware usage -> effect settlement -> `usage.settled` | ✅ reported/unknown | Project quality and per-attempt totals; preserve unknown |
| Cache read/write tokens | provider usage payload | ❌ not emitted by current AI SDK adapter | Add optional fields only when provider/runtime returns them; otherwise omit/unavailable |
| Cache hit/miss boolean | provider/runtime cache contract | ❌ no authoritative signal | Remain unavailable; no synthetic miss |
| Context window/manifest/accounting | RunSnapshot + context assembly | Partial | Add bounded context event/manifest summary; no raw prompt/tool payload |
| Tool call name/call ID/args classification | governed tool execution boundary / AI SDK tool-call observation | ❌ ledger has only effect sourceRef/toolName and digest | Add bounded semantic tool-call event (name, call ID, classification, approval state) without raw args |
| Tool result/outcome/error/latency | governed tool settlement + effect row | Partial | Add result classification, duration, retryability; keep payload redacted |
| Approval requested/decided/expired | Approval service and governed-tool wait/settle | Partial | Add explicit governance events linked to effect/approval ID; never include auth material |
| Delivery state/notification outcome | Timeline/delivery boundary | ❌ | Later producer; do not infer from `chat.complete` |
| Recovery/retry/reconciliation | RunRepo recovery/retry and effect stale/unknown paths | Partial | Add explicit retry/recovery event payloads with reason/classification |
| Stream first chunk/final marker | model middleware/ChatAgent stream boundary | ❌ | First wave should add bounded stream markers to model effect evidence |
| Cost | provider pricing/usage contract | ❌ | Defer unless a provider-neutral pricing authority exists |

### 4. Recommended bounded first wave (one impl/check)

Target one implementation/check of roughly 2–3 context windows:

1. **Versioned additive Shared event payloads** under the existing `run-event.v1` envelope, extending categories/kinds for:
   - `model.request.started` / `model.stream.first` / `model.response.settled` (provider, model, effect ID, measured duration, finish/error classification; no prompt/body);
   - `tool.call.started` / `tool.result.settled` (effect ID, stable call ID when available, normalized tool name, outcome/error, duration, approval state; no raw arguments/results);
   - `context.snapshot` (bounded source-category list, accounting quality, context-window if authoritative, manifest digest reference—not prompt/tool schema bodies);
   - optional `governance` and `retry/recovery` facts only where the existing Core boundary already knows the transition.

2. **Fixed Core producers at existing seams**, not a second loop:
   - model middleware wraps request start/first stream/finish/error;
   - governed-tool wrapper/effect repo emits call/result lifecycle around the existing execution;
   - Run snapshot/admission emits context facts;
   - RunRepo emits retry/recovery facts at transition commit.

3. **Projection expansion over the same ledger**:
   - Run summary: model request count, tool call/result counts, failure/retry counts, token quality and optional cache buckets;
   - trajectory rows: semantic Model/Tool/Context/Governance/Recovery/Usage rows with measured duration and status;
   - inspector: bounded provider/model, usage quality, error classification, approval state and context labels;
     G4 (2026-09-05) removes meaningless technical IDs from user-facing details while preserving internal linkage.

4. **Filters and UI only after producers**:
   - add provider/model/tool/category/severity/outcome filters from real fields;
   - keep semantic rows, collapse/grouping, older-page loading and useful inspection; G4 (2026-09-05) excludes internal
     metadata dumps from both primary and expanded user-facing UI.

5. **Tests**:
   - Shared strict schemas/version compatibility and forbidden raw payloads;
   - producer tests for one model success/stream interruption, one tool success/failure, usage reported/unknown, context snapshot, retry/recovery;
   - replay/restart equality from durable Run Event rows;
   - projection counts/totals/filter behavior and unknown-field omission;
   - primary chat/tool/approval regression and enabled/disabled monitor mode checks.

Non-goals for this wave: cache hit/miss invention, provider-specific branches, cost calculation without a pricing authority, raw prompt/tool payload exposure, delivery receipt implementation, Chat UI streaming redesign, or a new model loop/runtime.

### 5. Dependencies and migration impact

- No new runtime or framework is necessary. DSH’s useful plugin idea is a typed producer/consumer seam; TakiAgent should keep Core as the lifecycle authority and add fixed observers at existing boundaries. The current `run_events` table is JSON payload storage, so additive event kinds/payloads require no SQLite schema migration if bounded payloads fit existing columns. A migration is needed only for measured-volume indexes/materialized counters, which are an optimization rather than a correctness dependency.
- Existing `run-event.v1` is a closed discriminated union. Adding kinds is a Shared contract change and must update all producers, projection switches, fixtures, and desktop types atomically. Prefer additive optional payload fields or a new event schema version only when semantics cannot remain backward-compatible; do not silently reinterpret existing `effect.*` events.
- Existing Run snapshot already contains provider/model/context/generation references, so context producer can reuse it. Do not duplicate a second context authority in Monitor tables.
- Existing `run_usage` rows are authoritative for model usage; new projection must reconcile from `usage.settled`/`run_usage`, not detached `onUsage` calibration callbacks (`packages/core/src/agents/chat-agent.ts:337-352`).
- `FULL_LOCAL` may expose bounded redacted details; `FEEDBACK_ONLY` should keep semantic summaries/totals; `DISABLED` should keep execution correctness and canonical lifecycle evidence while rejecting monitor projections (`.trellis/spec/backend/observability-projection.md:20-42`).

### 6. Cache assessment

Current TakiAgent `ProviderStreamPart` only extracts `inputTokens.total` and `outputTokens.total` (`packages/core/src/agents/model-effect-middleware.ts:10,58-70`). The current `UsageRecord` schema likewise has only input/output/total and quality (`packages/shared/src/effect-lifecycle-schema.ts:47-56`). No provider/runtime cache read/write signal is emitted, and no cache definition exists in Core. Therefore:

- cache read/write token fields remain absent until the provider adapter exposes disjoint authoritative buckets;
- cache hit/miss remains unavailable, not `miss`, and no provider-specific DeepSeek branch may be introduced solely for Monitor;
- once a provider-neutral cache contract exists, extend `UsageRecord` and `usage.settled`, preserving DSH’s replacement/deduplication semantics for same-step samples.

### 7. Chat UI implications (only from existing protocol)

The current Core stream yields only text deltas from `ChatAgent.stream()` and `chat-send` publishes only `chat.delta`, `chat.complete`, and `chat.error` (`packages/core/src/agents/chat-agent.ts:50-51,263-280`; `packages/core/src/server/methods/chat-send.ts:144-181`). Tool call/result state is persisted in `TimelineEntry.parts` after the loop, so the existing protocol cannot render a tool icon at call-start. This is a D67 UI/protocol follow-up, not a D68 producer requirement. DSH proves the desired shape: token/block chunks are durable events and the trajectory publishes incremental block updates on animation frames while keeping stable row keys (`trajectory-assistant-definition.ts:107-165,337-360`; `ui-trajectory/README.md:5`).

## Recommended scope summary

Implement D68 as a producer-first expansion of the existing Run/Event authority. The first wave should make the Monitor answer “which model request/tool ran, when, with what outcome, usage quality, and retry/governance context?” using bounded replayable facts. It should not promise cache hit-rate, delivery receipts, cost, or streamed Chat icons until their respective authorities/protocols exist.

## Caveats / Not Found

- The active D68 task is only a stub (`.trellis/tasks/08-28-dsh-observability-expansion/prd.md`); this research intentionally does not fill PRD/design/implement artifacts or modify production code.
- No completed DSH `AgentHarness` driver exists in the local reference; DSH/PI documents and concrete session/event/token-meter code are reference contracts, not drop-in dependencies.
- Current TakiAgent Run Event categories are only lifecycle/effect/usage. The proposed model/tool/context/governance/recovery event names are recommended additions, not verified current protocol values.
- Current TakiAgent model middleware sees provider stream parts but does not expose raw tool-call chunks, first-token markers, or provider cache metadata; adding those requires confirming the installed AI SDK v7 stream part shapes during implementation.
- Delivery success/failure, per-tool call IDs, and approval decisions are not currently durable Run Event facts; do not claim those fields are available until producers are added and replay-tested.
- DSH’s UI includes raw input/output in a local inspector, but TakiAgent’s privacy contract is stricter: known secrets, credentials, authorization material, raw Host/MCP/tool payloads, and sensor/media bytes remain excluded/redacted even in `FULL_LOCAL`.
