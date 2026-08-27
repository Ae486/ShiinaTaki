# Post-acceptance Observability and Agent Experience Follow-ups

Date: 2026-08-27  
Status: planning record; no production implementation authorization

## 1. Evidence and boundary

The owner manually confirmed that primary chat, tool calls, and the first DSH-style Monitor projection are usable.
The same acceptance exposed three gaps:

- Perception and Monitor pages do not consistently re-read or apply committed changes while they remain mounted, and
  Chat tool affordances appear later than the corresponding streamed text/tool lifecycle may have arrived.
- The Monitor currently explains Run trajectory but does not yet expose enough producer-backed information for tuning,
  such as model/provider request timing, tool lifecycle, usage/tokens, context accounting, governance, delivery, and
  recovery. Cache hit/miss is not a valid field until the active provider/runtime has a real cache contract and emits it.
- `avatar_set_expression` was observed to fail on missing arguments without an apparent corrective retry, while a
  Tavily/MCP call appeared to self-correct. This is a symptom to reproduce, not evidence that the common loop is broken.

The completed child `08-27-observability-projection-ui` remains bounded to a read-only projection over the existing
Run/Event authority. It is not re-opened and is not being widened retroactively.

## 2. Reference-grounded observations

### DSH trajectory and query

The DSH trajectory reference keeps the main ledger semantic and compact: User, Assistant, Tool, nested Subtool, timing,
usage, and status are visible as meaningful rows; technical/raw detail is opened in an inspector. It supports tail
following, older-page loading, folding, search/filter, stable row keys, and visible-row mounting/overscan. The query
reference separates live coordination from durable history, validates contiguous cursors, classifies current/shadowed/
log-only records, and treats authorization as a caller responsibility.

TakiAgent must adapt those patterns to Character and Run/Attempt semantics. It must not copy DSH's session authority or
introduce a second runtime. The existing generation-safe Home connections and the per-Run `(runId, seq)` ledger cursor
remain the transport and ordering anchors; cross-Run Character aggregation stays deferred until a global cursor contract
exists (D66).

### Existing TakiAgent evidence

- `use-perception.ts` provides a one-shot card read plus an explicit refresh action; no producer currently publishes a
  perception-card update, so a durable subscription cannot be invented by the page.
- `use-chat-timeline.ts` and `chat-timeline-store.ts` append only `chat.delta` text into the in-flight row. The current
  Chat notification contract has no in-flight tool-call/tool-result channel; tool cards render from committed
  `TimelineEntry.parts` after `persistTurn` publishes `timeline.appended`. The reported icon delay is therefore a real
  protocol/read-model limitation, not merely a React repaint issue.
- `monitor-controller.ts` is generation-safe and subscribes to the per-Run observability event, but it intentionally
  projects only fields present in the current ledger.
- `set-expression-tool.ts` uses a dynamic vocabulary enum and a fire-and-forget structured result. Its execute body
  catches publication errors and returns `{ ok: false, ... }`; missing arguments can therefore fail earlier at schema
  validation, before execute runs.
- `presentationTailStop` stops a spoken step whose calls are presentation-only by inspecting tool-call names, not tool
  results. The investigation must test whether an invalid avatar call still satisfies that stop condition and prevents
  the corrective model step that an ordinary informational tool would receive.
- `chat-agent.ts` retains the AI SDK `ToolLoopAgent` as the low-level loop and has an explicit retry seam for context
  overflow. That seam is not proof of a generic invalid-tool-argument repair policy.

## 3. Reserved follow-up slices

### A. Reactive UI and streaming baseline

Goal: provide one disposable UI read-model/revalidation contract for Perception, Monitor, and Chat.

Required behavior:

1. A mounted page observes relevant committed notifications when a producer exists; otherwise it performs bounded,
   cancellable revalidation on focus/visibility/config-generation changes rather than requiring navigation.
2. Reconnect creates a new client generation, backfills from the durable cursor, restores selection and subscriptions,
   and suppresses retired-client results/events.
3. Loading, refreshing, stale, reconnecting, empty, and error states are distinct. Existing content remains visible while
   a background refresh runs, and retry actions are explicit.
4. Lazy/older-page loading is bounded and does not reset selection. Chat tail-following pauses while the user inspects
   older rows and resumes only under the existing scroll policy.
5. Chat rendering proves the order and timing of assistant deltas, tool-call, tool-result, approval, and completion
   notifications. Icons/cards are keyed by stable lifecycle identity and may render before final assistant text when the
   event stream says they arrived; a final assembled message must not duplicate them.

Non-goals: no new UI framework, no per-page polling loops that duplicate subscriptions, and no change to Core Run
semantics.

### B. DSH observability expansion

Goal: make the Monitor useful for diagnosis and optimization without fabricating metrics.

Producer-first order:

1. Define versioned Run Event payloads and fixed Core producer seams for model request/response, first/final stream
   markers, tool call/result, provider/model route, context manifest and token accounting, authoritative usage/cost,
   approval/governance, delivery, recovery, retry, and effect latency.
2. Record bounded summaries and classifications in the canonical ledger; keep sensitive/raw prompt, credential,
   authorization, sensor/media, and unrestricted tool/Host payloads behind mandatory redaction/exclusion rules.
3. Extend the existing projection with semantic rows, totals, filters, and inspector fields only after each field is
   replayable from durable facts. Additive indexes are a measured optimization, not a correctness shortcut.
4. Add cache hit/miss only if the active provider/runtime defines what is being cached, where the signal is authoritative,
   and how a miss/unknown state is represented. Unknown must remain unknown; zero is not a substitute.

The UI should follow DSH's semantic-first layout: compact Run/Attempt/effect rows, timing and totals in an overview,
search/category/severity/provider/tool filters, older-page loading, stable selection, and a bounded inspector. Opaque
IDs, hashes, generations, and revisions remain inspector-only (D65).

### C. Tool/loop diagnostics and avatar contract

Goal: determine whether the avatar symptom is a tool contract issue, a provider/schema issue, or a loop feedback issue.

Reproduction matrix:

| Case | Evidence to capture | Expected classification |
|---|---|---|
| Missing `name` or malformed arguments | Provider tool-call shape, SDK parse/validation result, whether execute runs | schema/provider failure or execute path |
| Unknown vocabulary name | Dynamic enum in the captured tool schema, tool result, next model step | closed-world validation and model correction behavior |
| Execute returns `{ ok: false }` | persisted tool result, model-visible follow-up input, next generated step | structured tool failure feedback |
| Execute throws | governed-tool wrapper, effect settlement, model-visible result, retry/terminal state | normalized error and retryability |
| Valid avatar call | call/result order, presentation stop, duplicate-call behavior | fire-and-forget terminal semantics |
| Invalid avatar call after spoken text | `steps[].toolCalls`, tool result, `presentationTailStop`, next model step | avatar-specific premature stop or normal repair path |
| Equivalent Tavily/MCP and local Core tool cases | same evidence fields and step budget | comparison, not assumed baseline |

The decision tree is: fix schema/description and examples if the model is being given an ambiguous contract; require a
successful presentation result before the avatar tail-stop if that stop is swallowing repair; normalize tool failures
if the model does not receive a useful result; add a bounded provider-neutral repair/retry policy only if the common
loop demonstrably lacks one and idempotency/step budgets remain safe. Do not add a DeepSeek-only branch or make repeated
avatar effects non-idempotent by default.

## 4. Dependencies and acceptance gates

The UI slice can start after the current Monitor child is committed and the existing D59/D29 generation/settlement
contracts are re-read. The DSH expansion should precede any dashboard-like UI work. The avatar investigation should begin
with research/reproduction and may proceed independently, but any code change must preserve the single ToolLoopAgent
path and update the relevant tool-design/runtime specs.

Every follow-up child must include:

- the exact producer and projection ownership;
- privacy/mode behavior and operator authorization;
- cursor/reconnect/replay semantics;
- bounded payload and retention impact;
- focused tests plus primary chat/Scheduled Task/Timeline regressions;
- explicit manual checks where visual timing or provider behavior cannot be proven headlessly.

The follow-ups are not a new architecture phase and do not close Heartbeat or other T4 product work. They refine the
observability and client seams that those later consumers will reuse.
