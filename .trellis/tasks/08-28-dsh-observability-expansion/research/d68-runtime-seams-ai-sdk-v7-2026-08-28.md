# D68 runtime seams: AI SDK v7 and Core producer evidence

Date: 2026-08-28
Scope: read-only runtime/API preflight for D68-A; no production code changes.
Active task verified with `python ./.trellis/scripts/task.py current --source`:
`.trellis/tasks/08-28-dsh-observability-expansion`.

## Executive conclusion

The installed runtime is AI SDK `7.0.17`, OpenAI-compatible adapter `3.0.5`, provider package `4.0.3`, and Node
`24.18.0`. The production path already has a single, reliable model-effect seam: `chat-agent.ts` wraps the selected
model with `wrapLanguageModel`, `model-effect-middleware.ts` prepares/settles one Core effect per provider request, and
`effect-repo.ts` atomically appends effect and usage events. The current middleware deliberately narrows stream parts
to only `type` plus input/output totals, so it is the exact loss point for D68 model timing, finish, first-stream,
provider metadata, cache buckets, and normalized tool evidence.

AI SDK v7 provides the required callbacks without a second loop: `onLanguageModelCallStart` and
`onLanguageModelCallEnd` are per provider call; `onToolExecutionStart` and `onToolExecutionEnd` are per normalized tool
execution; `onStepStart`/`onStepEnd` are broader LLM-step boundaries; `onEnd` contains all-step totals. A synthetic
two-step `ToolLoopAgent` probe confirmed callback order and shapes. Therefore D68-A can dispatch against verified seams;
it does not need to guess callback names, usage fields, or tool call/result discriminators. Payload/event names and
privacy bounds remain design choices to finalize in Shared before wiring.

The OpenAI-compatible chat adapter is provider-neutral and already maps authoritative cache/reasoning fields when a
provider supplies them. With `prompt_tokens=10`, `cached_tokens=4`, `completion_tokens=7`, and `reasoning_tokens=2`,
the adapter produced input total `10`, input no-cache `6`, input cache-read `4`, output total `7`, output text `5`,
output reasoning `2`, total `17`; the original usage remains under provider metadata. Cache-write is absent because the
OpenAI-compatible usage contract has no cache-write field. No DeepSeek-specific monitoring branch is justified.

## Evidence table

| Concern | Verified evidence | D68 implication |
|---|---|---|
| Model construction | `packages/core/src/config/provider-factory.ts:20-38`; `createOpenAICompatible({ name: "taki-provider", baseURL, apiKey, includeUsage })`, then `languageModel(model)` | Keep provider-neutral adapter; `includeUsage` is the existing streaming usage opt-in. |
| Run composition | `packages/core/src/main.ts:113-122` creates DB, event repo/live bus, Run repo, observability, and effect lifecycle | No monitor authority or second runtime is needed. |
| Per-request wrapping | `packages/core/src/agents/chat-agent.ts:229-245` wraps the selected model when `runId`/`attemptId` exist and constructs `ToolLoopAgent` | Instrument this model wrapper plus agent callbacks; preserve vision path and no-context compatibility. |
| Stream consumption | `packages/core/src/agents/chat-agent.ts:261-295` iterates `result.stream`, yields only `text-delta`, clears pending text on `finish-step`, throws `error` parts, persists in `finally`, and reports detached aggregate usage | Add observers without changing text output or detached usage semantics. |
| Current loss point | `packages/core/src/agents/model-effect-middleware.ts:10,58-70` defines a narrow `ProviderStreamPart`; settlement only reads `inputTokens.total`/`outputTokens.total` and reacts to `error`/`finish` | Widen an internal normalized observer type or use v7 callbacks; do not infer missing fields. |
| Atomic effect/usage ledger | `packages/core/src/db/effect-repo.ts:123-152` settles effect and appends `effect.settled` plus optional `usage.settled` in one transaction; `packages/core/src/db/run-event-repo.ts:5-33` assigns contiguous seq | New facts must be bounded append-only events emitted at the same Core authority and remain replayable. |
| Effect service boundary | `packages/core/src/harness/effect-lifecycle-service.ts:5-20` exposes prepare/settle/wait/commit/list | Model/tool producer code can depend on this interface, not SQLite internals. |
| Governed tool boundary | `packages/core/src/governance/governed-tool.ts:102-151,154-225` handles approval/waiting, intent commit, execution, failure classification, and settlement | Add semantic tool facts around normalized execution and settled outcome; keep raw input/result out of canonical monitor payload. |
| Approval authority | `packages/core/src/approval/approval-gate.ts:36-56` returns not-applicable/approved/denied, asks only through broker, and fails closed without notify | Governance events may report asked/decided/denied class, never authorization material. |
| Run/recovery transitions | `packages/core/src/db/run-repo.ts:266-319` atomically settles attempts/runs/receipts and appends lifecycle events; `packages/core/src/db/run-recovery-repo.ts:26-44` appends `recovery.classified`; `packages/core/src/harness/recovery-coordinator.ts:28-135` scans and reconciles | Retry/recovery events belong at these transition commits; do not derive them from logs or UI. |
| Context snapshot | `packages/core/src/harness/run-snapshot-capture.ts:40-77` captures bounded host/extension/governance/memory/provider/model/context decision references; `packages/shared/src/harness-schema.ts:126-150` validates `RunSnapshot` | Emit bounded context/accounting facts from the existing immutable snapshot; never persist assembled prompts/tools. |
| Existing projection | `packages/core/src/observability/observability-query-service.ts:109-145` sums `usage.settled`, derives only Run duration, and projects effect/usage/recovery rows | Extend projection from durable new events; preserve current/shadowed/log-only semantics and authorization. |
| Current wire limits | `packages/shared/src/run-event-schema.ts:9-35` has closed lifecycle/effect/usage kinds; `packages/shared/src/observability-schema.ts:19-36` has semantic rows but only coarse counts and technical-first inspector | Shared additions must be additive, strict, bounded, and reflected in all switches/fixtures. |

## Installed AI SDK v7 shapes

Declarations were read from `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts`.

### Usage and finish

`LanguageModelUsage` contains `inputTokens`, `inputTokenDetails.noCacheTokens`, `inputTokenDetails.cacheReadTokens`,
`inputTokenDetails.cacheWriteTokens`, `outputTokens`, `outputTokenDetails.textTokens`,
`outputTokenDetails.reasoningTokens`, `totalTokens`, and optional provider `raw`. Finish reasons are normalized to
`stop | length | content-filter | tool-calls | error | other`.

`finish-step` stream parts carry per-step response metadata, usage, performance, normalized finish reason/raw finish
reason, and provider metadata. The terminal `finish` part carries normalized finish reason, raw finish reason, and
`totalUsage`. The aggregate `result.usage`/`result.totalUsage` sums every model step; it is not a final-step-only value.

### Callback order and fields

The synthetic two-step probe used a scripted tool call followed by text and printed only event names, keys, types,
counts, finish reasons, and timing keys. Observed order:

```text
onStart
  onStepStart
    onLanguageModelCallStart
    onLanguageModelCallEnd
    onToolExecutionStart
    onToolExecutionEnd
  onStepEnd
  onStepStart
    onLanguageModelCallStart
    onLanguageModelCallEnd
  onStepEnd
onEnd
```

Observed shapes (content, prompts, tool payloads, and raw data were not printed):

- `onLanguageModelCallStart`: `callId`, provider/model, standardized messages/instructions, prepared `tools`, and
  language-model call options.
- `onLanguageModelCallEnd`: `callId`, provider/model, normalized `finishReason`, `responseId`, `usage` with all detail
  buckets, and `performance` keys `responseTimeMs`, `timeToFirstOutputMs`, output/input/effective throughput, and
  optional chunk-gap statistics. It runs after response normalization and before client-side tool execution.
- `onToolExecutionStart`: `callId`, normalized `toolCall` (`toolCallId`, `toolName`, typed object input and metadata),
  `toolContext`, and initiating messages.
- `onToolExecutionEnd`: the same call/tool context, `toolExecutionMs`, and discriminated `toolOutput` whose type is
  `tool-result` or `tool-error`.
- `onStepEnd`: per-step content, usage, provider metadata, request/response, finish reason, and step timing including
  tool execution time.
- `onEnd`: complete multi-step text/tool/result collections plus aggregate usage; aggregate detail buckets are summed.

The stream itself exposes `start-step`, `finish-step`, `tool-call`, `tool-result`, `tool-error`, approval parts,
`model-call-start`, `model-call-end`, response metadata, `text-delta`, `reasoning-delta`, `error`, `abort`, and terminal
`finish`. The `model-call-*` parts are available through the lower-level `streamLanguageModelCall` path; the
`ToolLoopAgent` constructor callbacks are the safer production seam because they avoid leaking provider content into
the Core ledger.

## OpenAI-compatible usage/cache mapping

Declarations and a no-network synthetic `generateText` probe were run against `@ai-sdk/openai-compatible@3.0.5`.
Accepted usage keys are `prompt_tokens`, `completion_tokens`, `total_tokens`,
`prompt_tokens_details.cached_tokens`, and `completion_tokens_details.reasoning_tokens` plus accepted/rejected
prediction token metadata. Chat conversion is:

```text
inputTokens.total      = prompt_tokens
inputDetails.noCache   = prompt_tokens - cached_tokens
inputDetails.cacheRead = cached_tokens
inputDetails.cacheWrite= undefined
outputTokens.total     = completion_tokens
outputDetails.reasoning= reasoning_tokens
outputDetails.text     = completion_tokens - reasoning_tokens
totalTokens            = total_tokens
raw                    = original usage object
```

Absent usage produces undefined normalized buckets. Streaming requests include
`stream_options: { include_usage: true }` only when `includeUsage` is configured. The adapter tracks the latest usage
chunk and emits normalized finish/response-metadata parts. It also maps `reasoning_content`/`reasoning`, parses
OpenAI-compatible tool-call deltas, and retains accepted/rejected prediction counts only in provider metadata.

The adapter exposes a provider-neutral `convertUsage` override. If another upstream provider has different semantics,
use that seam rather than adding a DeepSeek-specific branch. Completion conversion differs from chat: prompt tokens are
treated as uncached input and cached/reasoning details are not mapped. This is relevant only if a completion model is
introduced; the current Core path constructs chat models.

## Exact production seams and ordering constraints

1. Model request intent is committed before provider dispatch through `createModelEffectMiddleware.wrapGenerate`/
   `wrapStream` (`model-effect-middleware.ts:12-54`). D68 model-start evidence should be correlated to this effect and
   emitted after the durable intent transaction, without blocking the agent.
2. First-stream evidence should be emitted once on the first meaningful output/part observed by the wrapped stream or
   callback path. It must not classify a mere `stream-start` as first token unless the contract explicitly names that
   marker; use an explicit first-stream marker with unknown timing when no meaningful output arrives.
3. Model settlement must preserve the existing exactly-once effect settlement and usage row (`effect-repo.ts:123-152`).
   Usage is authoritative at settlement; detached `chat-agent.ts:294-295` calibration reports must not be counted a
   second time.
4. Tool call/result facts should use normalized SDK call IDs and tool names from `onToolExecutionStart/End` where
   available, then correlate to the governed effect ID. The governed wrapper remains the authority for approval,
   stale-generation, failure classification, and effect settlement.
5. Event append and live publication follow the existing transaction-then-publish pattern. Observer/serialization/live
   bus failures are contained (`effect-repo.ts:68,120,151`; `run-repo.ts` transition publishers) so monitor work cannot
   alter Run correctness or add model calls/tokens/steps.
6. Snapshot/context facts must reference the already captured `RunSnapshot`; no monitor-owned snapshot or prompt store may
   be introduced. Retry/recovery facts must be appended at `RunRepo`/recovery transition commits, not inferred from
   attempt counts.

## D68-A / D68-B ownership proposal

### D68-A: Shared + Core producers/projection data

Own the additive event union and bounded payload schemas in `packages/shared/src/run-event-schema.ts` (and any related
shared observability/effect usage schemas), Core model observer/middleware and agent callback wiring, governed-tool
semantic call/result producer, snapshot/context producer, RunRepo recovery/governance event producers, and
`packages/core/src/observability/observability-query-service.ts` plus focused tests. The slice must also update strict
fixtures, projection filters, semantic Inspector data, and `packages/shared/src/index.md` when source files change.

Suggested event families (names remain subject to Shared review):

- `model.request.started`, `model.stream.first`, `model.response.settled`;
- `tool.call.started`, `tool.result.settled`;
- `context.snapshot`;
- additive governance and retry/recovery facts only at existing authority transitions.

Every payload must be bounded and redaction-safe. Cache read/write fields are optional and emitted only when the adapter
provides disjoint authoritative buckets; cache hit/miss is not inferred. Delivery facts remain out of scope until a
delivery authority exists.

### D68-B: Desktop Monitor presentation

Own the Monitor page/view/controller and tests under `apps/desktop/src/windows/home/pages/monitor/`, consuming only the
D68-A projection/method contracts. Implement the DSH-shaped left Run browser, central grouped ledger/Overview, and
dismissible right Inspector; Chinese labels/accessibility; truthful two-way disclosures; responsive drawer; bounded
older-history/tail-follow/reconnect behavior. Do not add a page-local refresh authority or raw event JSON fallback.

## Existing tests and probe evidence

Focused regression command (run from T4 worktree) passed:

```text
pnpm --filter @taki/core exec vitest run src/agents/chat-agent-usage.test.ts src/agents/chat-agent-approval.test.ts src/agents/parallel-tool-effect.test.ts src/db/effect-repo.test.ts src/observability/observability-query-service.test.ts
```

Result: 5 files, 31 tests passed. These tests prove, among other things, all-step usage sums, unknown usage
settlement, one effect per internal provider request, approval fail-closed behavior, parallel tool effect identity and
ordering, durable effect/usage persistence, and projection behavior.

Additional no-network probes:

```text
pnpm --filter @taki/core exec node --input-type=module -e "...ToolLoopAgent + MockLanguageModelV4..."
pnpm --filter @taki/core exec node --input-type=module -e "...createOpenAICompatible + synthetic generateText response..."
```

The first probe observed the callback order and field-key sets above and aggregate usage `input=6, output=10,
total=16` for two scripted steps. The second observed normalized chat usage `input=10 (no-cache=6, cache-read=4),
output=7 (text=5, reasoning=2), total=17` and provider metadata key `probe`.

## Unresolved items (genuine)

- The exact additive D68 event kind names and Shared payload schemas are not current protocol values; they require the
  D68 design/implementation decision and strict fixtures.
- The existing `run_usage`/`UsageRecord` schemas persist only aggregate input/output/total and quality. Cache/read/write
  and reasoning persistence requires an intentional Shared + SQLite JSON/event compatibility change; this research does
  not implement it.
- `onLanguageModelCallEnd.content`, tool inputs/results, messages, and provider `raw` are available to callbacks but are
  protected content. A producer must define redacted bounded summaries before exposing any part to the ledger/UI.
- A first-stream marker needs a product definition (first meaningful text/reasoning/tool part versus transport
  `stream-start`). The SDK supplies timing (`timeToFirstOutputMs`) only on model-call end; it does not define TakiAgent's
  semantic first-stream event.
- AI SDK `ToolLoopAgent` emits approval request/response stream parts and tool approval callbacks, but TakiAgent's
  canonical approval authority remains `ApprovalGate`/`ApprovalBroker`; exact cross-correlation fields need a producer
  contract.
- Delivery success/failure still has no authority in the current Core path; do not add delivery events based on
  `chat.complete`.
- No live external provider or Desktop monitor was launched; probes were local synthetic tests and focused Core tests.

## Dispatch readiness

D68-A can be dispatched without guessing about the installed AI SDK v7 runtime seams. The implementation prompt should
still require the child to re-read D68 PRD/design/implement plus this artifact, verify the active task pointer, and make
the Shared event/Privacy decisions explicit before editing. No production code was modified by this preflight.
