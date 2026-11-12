# Context attribution and token efficiency

Status: owner approved the attribution/Monitor implementation on 2026-11-02 after reviewing source classification, mergeable display groups and the estimator. Implement the observation slice below. The native-image child is verified; reduction pilots remain evidence-gated.

## Approved execution details

- Preserve nine stable raw categories; merge only in a small display mapping, adding counts before calculating ratios. No configurable classification engine.
- Reuse the current heuristic estimator and final prepared schemas; use upstream usage for actual input. Mark multimodal/unknown coverage explicitly and keep source descriptors out of prompts.
- Ownership: runtime/source construction is one slice, Shared/persistence/push is another, Desktop display/controller is another; root owns main composition and integrated verification.
- Capture each actual native post-filter dispatch against its already committed model Effect. Failed/missing measurement must not fail valid model work or expose an older request as current.

## Content categories and origin

Use one exclusive content category per measured segment, with origin as a separate dimension. Do not add MCP, Skills and tools as overlapping slices of one chart.

| Category | Content | Construction authority |
| --- | --- | --- |
| `instructions` | System rules, companion/initiative guidance, discovery and loader guidance | Inputs to existing instruction joins |
| `persona` | Global assistant layer and Character persona | Canonical and fallback Memory assembly section values before concatenation |
| `injected_memory` | Rendered Memory Blocks, pinned rows, disclosed intentions and automatic recall | The effective Memory renderer and actual disclosure decision |
| `runtime_context` | Time, mood, environment, Host, perception and accepted proactive context | The individual runtime tail/prepared-input values before joining them to user content |
| `summary` | The summary actually selected, including its wrapper | ConversationStore summary projection |
| `conversation` | Current/retained user and assistant content and user images | Selected row/part identity, excluding injected spans and assistant tool calls |
| `tool_definitions` | Only active descriptions, schemas and dynamic enums actually dispatched | Final SDK prepared definitions after prepareStep/disclosure |
| `tool_interactions` | Arguments, results, errors, loaded Skill text and associated images | Exact completed tool pair and captured operational origin |
| `other` | Content/framing without a proved category | Explicit estimator/source coverage gap |

Examples: an MCP schema is a tool definition with MCP origin; its response is a tool result with MCP origin. A Skill catalog entry is classified where it is actually serialized; a `load_skill` return is a tool result with Skill origin. Do not infer origin solely from tool-name prefixes or retrospectively parse a concatenated prompt.

Origins form a separate closed dimension: `builtin | mcp | skill | unknown`, describing the supplier of the measured content. The generic `extension_call` schema is built-in, while its result uses the actually selected extension's captured origin. A Skill's text is Skill-origin; a Core-owned schema/result does not become Skill-origin merely because loading a Skill enabled the tool. Activation provenance is not execution ownership. Missing historical bindings remain unknown. Existing `SourceContext` describes supplied material; it must not be overloaded with operational origin or model-facing metric identifiers. Detailed source coverage and code anchors are in [request-composition-attribution.md](research/request-composition-attribution.md#1-actual-content-taxonomy-and-source-coverage).

The owner explicitly requests no separate image token category or meter. An image belongs to its enclosing user message or tool result and contributes to the ordinary provider input total. Reuse the main multimodal request path; do not add a vision-accounting subsystem. Unknown component cost must not become zero or an apparently complete text-only percentage.

The current request estimator measures broad message/instruction/schema totals, not full per-source attribution. Preserve construction provenance through the minimum necessary measurement path. Existing historical records may only support partial attribution; show that limitation rather than backfilling guesses.

## Metric scopes and arithmetic

The owner requested the combined display; the following pairing is the proposed interpretation for review:

| Metric | Scope | Update point |
| --- | --- | --- |
| Cache hit rate | Existing primary-summary window, all eligible Core foreground/background observations | Usage settled and aggregate recomputed; successful primary summary resets the window |
| Input context / effective window | One identified latest primary request and its actual model/configuration | That request's final usage becomes available |
| Composition | The same identified primary request | Component measurement correlated with that request |

Background completion can update cache rate without changing the latest-primary context display. Include request/model/time identity so these different scopes are understandable. Do not sum background inputs into the main model's occupancy. A later selected-request detail view is not a prerequisite for the initial display.

The occupancy label should describe input at dispatch. Response reserve is capacity planning, not already-used input; final output and a projected next request are different quantities. Resolve the actual configured/calibrated effective window, not a history allocation or unverified marketing limit.

The verified `WindowCalibrator.effectiveWindow()` returns **estimator units**, not real tokens. Add a read-only snapshot to that existing owner containing declared/effective real tokens, estimator window and factor; capture it before dispatch. Divide reported input by the captured effective real-token window. When only an estimate exists, label it and use the estimator window. A slot-keyed calibration is not proof of the custom endpoint's actual hard limit or model-specific calibration. Catalog metadata does not override this runtime configuration.

Provider total input is authoritative where present. Component percentages use a common estimator and an explicitly stated coverage denominator. Never subtract estimator units from provider tokens to invent a real residual or silently scale estimates into exact attribution. Unknown provider usage or multimodal cost remains unknown/partial.

Preserve the established cache formula: sum(cache-read input) / sum(input) over the identical eligible reported pairs, with coverage shown. Successful checkpoint commit is the reset authority. Summary-call usage settles in the prior window; other crossing calls follow existing settlement/transaction membership. Reuse that contract rather than replacing it.

## Producer and data-flow direction

Reuse request preparation/measurement, model-observability correlation, durable usage and the existing Core-to-Monitor projection/push mechanisms. Measure actual outgoing messages, instructions and active schemas at each dispatch, including continuation steps; an initial or projected request alone is insufficient.

Keep the change proportional: persist only necessary counts, attribution metadata and request/model identity, not another complete transcript or billing ledger. The exact storage/Shared/UI contracts require inspection before selection. Optional telemetry must not block valid conversation, summary publication or memory work. The UI should render Core facts, not independently reconstruct totals.

Do not implement a generic provenance framework just to draw a chart. Begin with boundaries the runtime already owns and expose remaining gaps honestly.

## Concrete implementation boundary

1. Retain small category/origin descriptors at the existing Memory, instruction, tail and replay joins. Keep them outside model content; preserve wrappers/joiners in one category and use one estimator denominator. Preserve native tool-image source even when transport uses a user role.
2. Measure final dispatched instructions/messages and prepared tools for **each physical model Effect**, including continuation steps and retries. The native child's dispatch middleware now supplies the actual image-bearing envelope; the old admission/next-request pressure map is not this producer. The observability model wraps `native.model(...)`, so the outer Effect middleware prepares/binds the intent before the native middleware filters expired/retired images. Bind that already committed Effect to the native `onDispatch` final envelope; sampling only outer middleware params or call-start would be incorrect. A missing or mismatched sample remains partial/unknown and must never be attached to a different request.
3. Append a closed, versioned `context.request.measured` variant to the existing Run Event schema. Store only model/Effect identity, request population/order, bounded category/origin counts, coverage and the dispatch-time window snapshot. Keep old strict event meanings unchanged. Add no table, raw transcript, image bytes or second usage record. New retained tool parts may carry an optional machine-only origin reference; old rows are not rewritten.
4. Join canonical `run_usage` exactly once by model Effect. Instrumentation failure cannot retry or fail an otherwise valid provider operation. Unknown/malformed/missing usage remains distinct from reported zero. A failed/cancelled request with reported usage remains visible as such.
5. Extend the existing cache subscription response/push with an independent optional latest-primary projection, including the explicit payload construction in `CacheUsageService.flush`. Rebuild it from durable events/usage after restart. Select by actual primary source/dispatch order, not completion callback order. Background/proactive completions update cache only; a summary reset leaves the last actual primary request visible until another completes. Model termination without usage must also trigger a refresh, rather than leaving an older successful sample looking current.
6. Render the existing cache fact, latest input/effective-window fact, and estimated composition together in Monitor. Show model, completion time, coverage and useful loop position; keep internal IDs out of ordinary UI. Reuse the current visibility/revision/client-generation/reconnect controller, without polling.

The compact persisted matrix has nine categories and four origins, with bounded numeric fields. Exact event version, optional origin shape and query implementation are implementation-level choices to validate against the current strict schemas; the requirement is a single existing authority, not a new universal provenance abstraction. Use typed explicit unavailable results for exhausted bounded scans rather than claiming no data.

An independent planning challenge after the native implementation found no new architecture blocker. Incorporated prerequisites: post-filter dispatch binding, content-origin versus Skill activation, origin metadata through Shared/Timeline sanitization/private replay, correct window units, explicit subscription payload projection and terminal missing-usage invalidation. This is planning review, not acceptance of unimplemented code.

### Shared-file handoff from the native child

- `native-image-attempt.ts` owns final currentness/expiry filtering and captures the actual provider envelope. Preserve this dispatch point rather than observing only pre-filter preparation.
- `native-image-projection.ts` preserves context/tool origin independent of SDK role. Tool origin may include originating model Effect and step; public metrics do not expose image IDs or create an image category.
- `native-image-replay.ts` and private replay hydrate and price retained images before selection. Legacy explicit SDK media is normalized on read. Attribution must consume this selected native projection rather than independently rebuilding text-only history.
- `turn-usage-report.ts` keeps the latest completed sample for calibration; it is not a durable all-request collector. Keep its purpose and add per-Effect attribution through the existing observability owner.

### Failure and acceptance cases

- Exclusive categories sum to their common estimate; origin totals reconcile within each category. Preserve fragment-rounding consistency without scaling provider totals into fabricated component tokens.
- Current user text, injected runtime text, summary and a native tool image retain distinct sources even when all use a user message role.
- Changed active tools, repeated provider call IDs, physical retries, same-loop continuations and late auxiliary completion do not cross-associate samples or double-count usage.
- Success, failed/cancelled usage, missing usage, reported zero, old rows, unknown origins, expired images and instrumentation/storage faults remain distinguishable.
- Cache reset, reconnect/re-entry, out-of-order completion and Core restart reproduce the correct independent metric scopes.
- Actual rendered Monitor loading/ready/partial/unavailable states and a real isolated WS request verify the full producer-to-UI path. Existing paid samples need not be repeated merely to populate counters.

## Investigation outcome and next reduction choices

The sanitized November 1 cohort has 39 foreground requests and 2,120,339 input tokens; component shares are not reconstructable. Continuations account for 49.64% of foreground input but only an estimated 33.76% of conditional cost under that report's dated tariff. Necessary inspection/verification must not be labeled waste. Background reasoning also matters despite a small input share.

Proceed with measurement before trimming. Defer same-loop rewriting, global thinking changes and broad history-policy changes. Revalidate the observed Windows command/argument mistakes at their tool owner, then choose at most one recoverable result-reduction pilot after source attribution exists. Measure the whole affected request/summary/recovery cycle; the image migration removes translator calls but repeated native images can still consume input. No savings percentage is claimed from mixed historical and synthetic cohorts.

## Completed image dependency and initiative scope

Trace heartbeat/proactive requests independently before deciding whether their context can be treated as ordinary conversation composition. Shared Run/agent machinery does not itself imply shared history selection or message persistence.

The verified native-image child now sends user input, agent screenshots, MCP images and selected perception/proactive/co-watching evidence to the primary model. Separate vision-slot and translation producers are removed. Its source/retention/dispatch contracts are implementation dependencies to preserve, not pending migration work.

Prefer existing SDK/provider/catalog support for model capabilities. Tools, native provider web search and application search tools are different capabilities; model-list metadata may be incomplete for custom endpoints. The result of research should be a small integration or a clearly bounded follow-up task, not a new capability-probing framework.

Detailed flow and original complexity findings are recorded in this task's research directory. The [verified image/capability child](../11-02-native-multimodal-model-capabilities/prd.md) records automated acceptance and its remaining manual/runtime limitations. This parent owns attribution/cost integration against that native request surface.

## Reduction candidates and tradeoffs

1. **Evidence-based tool improvements.** Address observed argument/environment/quoting mistakes at their owner. Compare concise existing guidance, schema/result improvements and local deterministic handling where semantics allow it. Avoid broad retry machinery and preserve inspect/change/verify work.
2. **Operation-specific result projection.** Prefer an existing tool family's compact, evidence-preserving model view. Preserve original bodies and provide a verified reference/retrieval path. Metadata and status cannot be replaced by a misleading success summary.
3. **Deterministic folding/truncation.** Evaluate one large retained result family. Compare unchanged replay, a semantic family projection, and bounded head/tail output with a recovery reference. Head/tail is simple but can lose important middle text; all approaches must account for extra retrieval and changed-prefix cache cost.
4. **Same-loop reduction.** D70 remains deferred. Verify call/result pairing and exactly-once effects before rewriting loop messages. Reading an original is not permission to rerun the original operation. Preserve recent useful feedback; do not copy a whole-log rewrite blindly.
5. **Prompt/memory cleanup.** Remove demonstrated duplication without hiding capabilities, freshness or required facts. Preserve stable-early/volatile-late behavior where semantics permit it; cached instructions are still submitted and occupy input context.
6. **Summary/background work.** Compare useful source coverage, no-work calls, summary growth and trigger frequency. References offer both standalone summaries and conversation-prefix reuse; neither is universally cheaper or better. Try model-free reduction before another summary where valid. Do not repeat the failed global thinking-disablement approach.

Measure the whole affected horizon: initial cache disruption + later inputs + output/reasoning + summary calls + retrieval/recovery + retries. A reduction is not adopted because its local output is shorter or its cache percentage is higher.

## Compatibility, review and unresolved contracts

- Existing completed ingestion/recovery/tidy and cache-window behavior form the baseline, not an invitation to redesign them.
- Preserve original history, tool outcome semantics, source identity and retrieval failure distinctions. Prefer disposable request projections over destructive data changes.
- Before an architectural or persistence change, use an independent advisor on the original requirements and constraints; apply the owner-approved model families. Evaluate findings against actual code, not reviewer confidence.
- A reduction pilot needs a bounded rollout and a way to restore the prior projection without losing data; exact control belongs in the reviewed implementation plan.
- This implementation must verify the settled post-filter dispatch hook, source sidecars through projection, bounded event persistence and latest-request reconnect behavior. Original-result recovery and candidate-specific reduction budgets belong to the later evidence-selected pilot.

See [planning evidence](research/planning-baseline.md) for code and reference locations. No numeric reduction target, token threshold, schema migration, new dependency or model setting is selected by this draft.

## November 4 bounded tool/replay follow-up

The owner approved the scoped work in `research/pilot-plan-20261104.md`. Exec changes only its invocation guidance,
with examples verified against the current Host. There is no new execution or permission contract.

Avatar begins as an experiment outside production replay. Following the independent challenge in
`research/replay-pilot-advisor-20261104.md`, transform only complete historical pure-Avatar groups into one explicitly
labeled Core historical-observation message after the atomic group. Preserve speech, exact tagged outcomes, identity,
source/origin and unknown arguments; keep mixed/unsupported groups unchanged and report their coverage. Use existing
untrusted fences and classify the observation as tool interactions. Production durable storage, live SDK steps and
replay defaults remain the baseline until evidence supports adoption.

Start with eight paired early/late reconstructed-context trials (two boundaries, two representations, two repeats),
up to three model steps each to allow the existing one correction and a final reply, within 24 physical requests.
Reconstructed current instructions and Avatar-only tool competition are explicitly different from the uncaptured
full historical request. Use actual original user inputs by default; named synthetic controls cannot stand in for the
natural task. Record no-call, other-tool, truncation/limit and missing usage separately from valid-name success.
