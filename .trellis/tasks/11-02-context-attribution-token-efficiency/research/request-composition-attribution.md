# Research: Request composition and construction provenance

- Query: Establish exclusive request content groups, trustworthy source attribution, per-dispatch correlation, effective-window authority, and evidence-backed token priorities before attribution implementation follows the native-image handoff.
- Scope: internal; current T4 source and the existing sanitized November 1 report. No production/spec edit, live SQLite access, paid call, service start, or runtime-mutating test.
- Date: 2026-11-02
- Task ownership: explicitly assigned parent task `11-02-context-attribution-token-efficiency`; only this report and `research/attribution/` are owned. The global `.trellis/.current-task` still pointed to `09-03-avatar-presentation-lab` when read; that mismatch was reported to the coordinator, without a lifecycle/pointer change.

## Findings

### Decision needed for the next implementation

Adopt **construction-time source descriptors plus a bounded per-model-Effect measurement**, using the existing model observer, Run Event ledger, usage settlement, cache subscription and Monitor controller. Retain the original request and execution semantics. Capture the effective real-token window separately from the estimator budget. Persist no second transcript or billing ledger.

The current producers already provide the necessary execution identity and actual prepared tool definitions. Their gap is source segmentation and durable per-request composition: the initial/post-turn measurement is not every dispatched request; the latest completed-request capture is used for calibration but not durable composition; admission manifests deliberately report unknown accounting.

The image owner was notified before this report: retain source Timeline entry/part or originating toolCallId/captured binding when constructing/hydrating native parts, and retain selected-evidence linkage for proactive media. A screenshot serialized as a user FilePart is still tool evidence. Images remain in their owning category and ordinary provider input usage. No image counter, percentage, category or independent accounting producer is proposed.

### 1. Actual content taxonomy and source coverage

Use these nine exclusive categories. Persona is separated because its actual source is identifiable before the Memory assembler joins it to other instructions. This refines the draft grouping without treating SDK roles as provenance.

| Category | Actual content and construction seam | Existing coverage / smallest addition |
| --- | --- | --- |
| `instructions` | Captured Memory/base system prompt; truthfulness/companion/initiative guidance; loader/discovery guidance and catalog descriptions where serialized as instruction text. `agents/agent-attempt.ts:292`, `:89`, `:108`; `agents/initiative-context.ts:33`; `extensions/extension-run-context.ts:61`. | Immediate inputs are known but several strings are already flattened. Retain fragment category/origin at the existing joins; do not parse prompt headings afterward. |
| `persona` | Global assistant layer and Character persona. `memory/canonical-memory-assembly.ts:31`, `memory/assembler.ts:71`, `memory/initiative-memory-assembly.ts:19`. | Separate the two existing section values before concatenation. Primary `assembleMemory` currently returns one string, so historical persona shares cannot be recovered from its reference/hash. |
| `injected_memory` | Actually rendered Blocks, budgeted pinned rows, selected quiet intention, automatic recall suffix and selected initiative Memory. `canonical-memory-assembly.ts:31`, `:35`; `agent-attempt.ts:184`, `:268`; `initiative-memory-assembly.ts:24`. | Retain category at these renderers. An intention is classified only if the existing disclosure gate includes it. Explicit `recall` tool returns instead belong to tool interactions. |
| `runtime_context` | Day/time/timezone, mood capsule, avatar/environment/Host state, perception, accepted initiative purposes/presence/observations and current inbox/control state. `agent-attempt.ts:266`, `:299`; `main.ts:561`, `:569`; `initiative-context-builder.ts:104`, `:138`. | Inputs are program supplied, often transported inside a user-role message. Split the real injection values from user text before the join; native ambient evidence follows this category unless it is an associated tool result. |
| `summary` | The summary head actually selected into this request, including its wrapper. `agents/conversation-store.ts:206`, `:255`. | `summaryTokens` and selection already exist. The summary is a user-role ModelMessage, demonstrating why role-only classification is wrong. Carry its projection identity; no new summary authority. |
| `conversation` | Current and retained user/assistant text and user attachments, excluding injected tails, summaries and assistant tool-call parts. `agent-attempt.ts:244`; `turn-mapping.ts:98`. | Retain current/retained source row and part association through projection. Generated/proactive speech uses the ordinary assistant row once delivered. Image estimates stay inside this category. |
| `tool_definitions` | Only the prepared definitions actually sent for this provider call, including descriptions, dynamic enums and schemas. `turn-usage-report.ts:54`; installed SDK `stream-text.ts:2463`, `:2480`, `stream-language-model-call.ts:317`. | Already available as `event.tools`; do not count the full registered ToolSet or manually re-evaluate a dynamic description with undefined context. A Skill/MCP catalog in instructions is not an additional active schema. |
| `tool_interactions` | Assistant tool-call arguments, tool results/errors/denials, loaded Skill/resource bodies, and associated screenshots even when SDK serialization gives their file a user role. `turn-mapping.ts:49`, `:61`, `:113`; `source-context.ts:17`; `agent-attempt.ts:141`. | Within the live loop the actual pair and immutable binding are known. Durable call arguments are deliberately not stored; replay supplies `{}`. Preserve captured operational origin separately for new retained parts, with legacy absence unknown. |
| `other` | Unclassified content, SDK-injected content without a proved source, and estimated framing/separators that are not assigned to another segment. | Explicit incomplete coverage. This is an estimator component, never provider input minus an unrelated estimate. |

`memory/runtime-composition.ts:70` chooses the effective provider capture. Canonical Local uses `canonical-local-runtime.ts:57`, and Hindsight uses `hindsight/hindsight-memory-runtime.ts:54`; both pass the captured canonical assembly and prompt. The Legacy fallback is `runtime-composition.ts:160`, with the same persona/Blocks/pinned/intention section shape in `assembler.ts:71`. A legacy assembler is not the authority for current canonical requests.

Keep separators, fences and source headers with their owning content or explicitly with `other`. Split mixed assistant/user messages by constructed parts or text spans. Do not count a mixed message wholly as conversation and then count its tool/injected parts again.

### 2. MCP and Skill origin is a second dimension

Use a closed origin dimension `builtin | mcp | skill | unknown`, optionally accompanied internally by the captured source reference/revision. It overlaps content categories and is never another slice added to the main composition total.

| Case | Category | Origin authority |
| --- | --- | --- |
| Direct MCP schema and its actual result | Definitions / interactions respectively | Captured MCP candidate and direct binding, `extensions/extension-sources.ts:75`, `:140`. |
| Generic `extension_call` schema | Definitions | Built-in bridge; its payload/result origin is independently the captured selected extension. |
| `extension_call` result targeting MCP/Skill | Interactions | Selected captured extension identity/kind, not the generic tool name or model-authored output labels. |
| `load_skill` / `read_skill_resource` schema | Definitions | Built-in loader; its returned captured Skill/resource body has Skill origin. `extension-sources.ts:31`. |
| Skill-enabled Core product bundle schema | Definitions | The Core schema remains built-in content; successful captured load/bundle membership explains activation, not Skill execution ownership. `agent-tool-assembly.ts:16`, `tool-disclosure.ts:34`, `:62`. |
| Skill catalog entry in instruction text | Instructions | Skill catalog producer. Keep general loader guidance separately as built-in instructions. |
| Uncaptured historical same-name tool | Known category, unknown origin | Today's registry is not proof of yesterday's binding. |

Disclosure is already implemented: `tool-disclosure.ts:42` begins with deferred tools absent, and `:46` derives activation from completed steps. `agent-attempt.ts:105` selects the next active subset and may update companion guidance at `:108`. Do not reinstate all tools to make attribution easier, or use historical Skill loads as activation evidence.

Existing `SourceContext` and `ToolSourceMaterial` describe supplied material and generation, not MCP/Skill operational origin (`shared/context-source-schema.ts:9`, `:18`, `:33`). Reuse the sidecar/capture pattern in `tool-source-materials.ts:9` and `source-context.ts:17`; do not overload material `label`/`reference` or render fresh metric correlation IDs into the prompt.

For complete **future retained-result** origin, add a small optional machine-only origin reference to the existing tool-call/result Timeline parts at actual capture, and preserve it through `turn-mapping`. Otherwise even newly measured results become origin-unknown on later Runs. This adds metadata to existing `parts` JSON, not another result store and not raw inputs. Old parts stay readable with origin absent. The child's concurrent `imageRefs` field on tool-result parts is the right associated-image ownership pattern; its final implementation is the child's verification responsibility, not acceptance evidence from this report.

### 3. First request, continuation and selected Heartbeat contexts

| Surface | Primary first request | Same-loop continuation | Selected Heartbeat judgment |
| --- | --- | --- | --- |
| History/summary | Actual `store.project(characterId)` selection (`agent-attempt.ts:59`). | Prior prepared request plus SDK response/tool feedback; material rendering may supply the selected projection (`:114`). | `initiativeReplay()` is empty, including summary and history (`initiative-context.ts:27`). |
| Persona/Memory | Captured assembler plus optional automatic recall suffix (`agent-attempt.ts:63`, `:184`). | Captured baseline remains; new tool/resource results and permitted instruction updates can add content. | Selected Persona and only offered Global/Character projections (`initiative-context-builder.ts:93`); ordinary assembler and automatic recall are skipped (`agent-attempt.ts:63`, `:272`). |
| Current input | Real user text, native attachments and ephemeral runtime tail. | Tool calls/results are actual loop feedback; not another real user turn. | Fenced accepted purposes, user time and permitted observations as ephemeral control input (`initiative-context-builder.ts:104`). Governed preparation evidence is appended (`agent-attempt.ts:57`). |
| Tools | Initial disclosed subset. | The actual subset may grow after a successful captured loader/describe; measure each call. | Explicit selected read registry plus `heartbeat_respond`, intersected with actual admitted tools (`initiative-context.ts:12`). |
| Retention | Primary batch owns ordinary Timeline commit. | Completed tools survive a later request failure through step recording (`agent-attempt.ts:141`). | Judgment and tool transcript are not ordinary relationship replay. Only accepted `speak` publication becomes a normal assistant row; silent/express have none. |
| Pressure/UI scope | Primary admission/compaction pressure. | Per-call completed usage and final native request shape. | Same Effect/usage ledger, separate composition population; does not overwrite the primary pressure snapshot (`agent-attempt.ts:192`). |

The installed SDK first resolves `prepareStep`, active tools and step messages/instructions (`node_modules/ai/src/generate-text/stream-text.ts:2438`, `:2463`, `:2499`, `:2504`). It then emits call-start with standardized instructions/messages and prepared tools (`stream-language-model-call.ts:333`), while `params.prompt` at the wrapped provider boundary contains the converted prompt (`:360`). An image-bearing tool output may acquire a native user carrier during conversion. Preserve its construction source through that conversion rather than reclassifying by the resulting role.

Reuse [heartbeat-message-flow.md](heartbeat-message-flow.md) for admission/delivery/maintenance details. A deterministic tick is not a request; a selected judgment can invoke several model requests; a pre-judgment evidence call is independently metered. The older translator flow in that report is the image child's removal target, not the post-migration attribution contract.

### 4. Minimal per-dispatch instrumentation

1. **Construction descriptors.** Retain category/origin around the existing instruction and tail joins and memory section arrays. Retain summary selection, source row/part and exact tool-result association in replay/native material preparation. A bounded transient sidecar is sufficient; no source registry, model-facing marker or generic provenance runtime is needed.
2. **Final model input.** Extend the existing model observer's call-start sample to measure each actual standardized message/instruction and prepared schema set. Reuse `estimatePreparedToolSchemaTokens` and the existing ordinary message estimator. The sibling calibration producer at `turn-usage-report.ts:50` proves these inputs already exist, but deliberately keeps only the latest completed request and is not the requested all-dispatch producer.
3. **Bind once to actual dispatch.** The final native migration wraps `native.model(...)` with the observability model: the outer `model-effect-middleware.ts` commits/binds the Effect before `native-image-attempt.ts` filters retired/expired images. Therefore bind that committed Effect to the **native `onDispatch` final envelope**, with actual provider/model and captured window, rather than treating outer middleware params or call-start as final input. `model-observability.ts` already establishes exact Effect identity. No valid matching sample or unsupported projection means explicit unknown/partial; never reuse the newest unrelated sample. This handoff correction was independently reviewed after the native path stabilized; media bytes remain native parts rather than JSON prose.
4. **Settle through existing authority.** Join the sample to `run_usage` by model Effect ID after `lifecycle.settle` (`model-observability.ts:113`). Retain failed/cancelled usage when reported; no missing value becomes zero. Generation `callId` can span several requests/retries and is not the request key. SDK step number is descriptive population context; a retried physical dispatch gets its own model Effect and must not be misreported as useful loop continuation.
5. **Release request material.** Retain only bounded counts/coverage/source references after measurement; do not keep callback message/tool/media payloads for Monitor. Optional measurement failures stay isolated, following `model-observability.ts:204`. Authoritative Effect/usage settlement still uses `assertHealthy()` and cannot be silently swallowed.

A segment-based estimator must keep an exclusive partition and common denominator. For existing flattened text, retain source spans at construction; assign joiners/framing deliberately. Reconcile fragment-rounding with the existing whole-text estimate (for example, prefix-estimate differences across adjacent known spans), rather than silently changing the total or comparing incompatible sums. Unknown source spans go to `other`/unknown origin. Exact provider totals are never proportionally redistributed into apparently exact component counts.

The current ordinary estimator already uses a heuristic for native file/image parts (`memory/token-estimator.ts:42`, `:63`). Reuse the image owner's final estimator/admission projection and label its multimodal coverage honestly. A file inside content is not a separately reported provider component; it must not be serialized as base64 text for counting, omitted as zero, or assigned a new image meter. Provider-specific serialization and true token sizing remain distinct from local estimates.

### 5. Effective-window authority: distinguish real tokens from estimator units

`windowCalibrator.effectiveWindow()` is explicitly **estimator units**: `floor(effectiveRealTokens / factor)` (`agents/window-calibrator.ts:22`, `:51`). `main.ts:224` creates it for the primary slot, `:230` allocates the history ratio, and `:573` calibrates from matching observed/estimated input. `db/window-state-repo.ts:12` stores the effective **real-token** cap and factor.

Add a read-only snapshot to the existing calibrator, captured at dispatch:

```ts
{ declaredRealTokens, effectiveRealTokens, estimatorWindowUnits, factor }
```

The real cap is the existing `min(persisted effective cap, declared config)` with the current overflow adjustment (`window-calibrator.ts:44`, `:60`); a missing persisted row uses declared config and factor 1. Identify the actual provider/model/slot with this snapshot. It is an effective **runtime-configured/overflow-adjusted** limit, not universal proof of the custom endpoint's advertised hard limit. Existing state is slot keyed, so a source/model change must not be presented as proven model-specific calibration.

- Reported occupancy: `sameRequestReportedInput / capturedEffectiveRealTokens`.
- Estimated fallback: a clearly labeled estimator occupancy against the captured estimator window, or equivalent factor-adjusted estimate against the real cap. Preserve uncertainty, especially for multimodal input.
- Composition: category local estimates divided by their common local-estimate total, with source/estimation coverage shown. No subtraction of estimate units from provider tokens, and no claim of exact component tokens.
- Response reserve, `projectedRequestTokens`, final output/reasoning and detached next-request projections are **not used input at dispatch** (`request-measurement.ts:45`; `request-preparation.ts:85`). Cache reads remain used input.

The archived latest calibration has real cap **131,000**, factor **1.063771519480805**, estimator window **123,146**, and history budget **86,202**. These are four different values/units. This latest snapshot is not a captured per-request historical denominator; historical precise occupancy remains unknown.

### 6. Minimal durable storage and Monitor projection

Prefer one new closed **request-measurement Run Event variant** in the existing versioned union. Keep old admission `context.snapshot` and old strict v1 payload meanings unchanged: they lack model Effect correlation (`shared/run-event-schema.ts:161`) and must not be retrospectively relabeled as dispatched requests. The repository already stores versioned bounded JSON and immutable per-Run sequences (`db/run-event-repo.ts:64`, `db/migrations/025-run-events.ts:4`); this proposal requires no new request table.

Suggested bounded payload:

```ts
type RequestAttributionPayload = {
  kind: "context.request.measured",
  modelEffectId: string, provider: string, modelId: string,
  primaryInputSeq?: number, stepNumber?: number, // internal source/order, not UI bookkeeping
  estimatedInputTokens: number,
  components: Record<Category, number>,
  originComponents: Record<Category, Record<Origin, number>>,
  sourceCoverage: "complete" | "partial" | "unknown",
  estimateCoverage: "text-estimate" | "heuristic-multimodal" | "partial" | "unknown",
  window: { declaredRealTokens: number, effectiveRealTokens: number, estimatorWindowUnits: number, factor: number }
};
```

Bound the closed matrices (9 categories x 4 origins), count ranges and source-reference fields. Provider input/cache/output remain solely in `run_usage`; projections join them once by Effect and never add `usage.settled` again. Keep optional operational-origin metadata for new retained tool parts as described above. Neither new event fields nor source references become prompt content or raw Inspector panels.

For the aggregate strip, add a sibling optional `latestPrimaryRequest` to the existing initial/pushed cache update, upgrading Shared/Core/client together. Leave the cache `snapshot` formula/window/coverage untouched and independently available. The latest-primary projection is rebuilt from these events and canonical usage after restart; the in-memory `latestRequestMeasurements` Map is not its source because it contains admission/reduction/next-request pressure estimates (`main.ts:232`, `:575`; `request-preparation.ts:46`, `:85`).

Use the same coalesced after-commit notification path: `main.ts:208` already reacts to usage settlement, `:191` to auxiliary settlement, `:264` to summary commit; `cache-usage-service.ts:40` coalesces and reads only for subscribers. Add a terminal-model hint if a failed/missing-usage outcome would otherwise never refresh request availability. Do not start polling or initialize statistics with a model call.

Select the newest terminal/accounted **primary request by its source/dispatch order**, not whichever unrelated callback finishes last. Primary `attempt.userEntry.seq` is a canonical monotonic source sequence; record it internally, then use the request's per-Run event sequence for later steps/retries. A model Effect identifies the exact joined usage. Missing ordering/lineage means unavailable or a selected-request detail, not UUID-based guessed chronology. Bounded existing Run/Event queries must distinguish scan-budget exhaustion from no records. Background/Heartbeat settlement updates cache but never overwrites primary context/composition. Summary reset changes cache only; the latest primary input remains the last actual request until another completes.

Reuse `server/methods/cache-usage-methods.ts:12`, `shared/cache-usage-schema.ts:63`, and the existing controller's revision/client-generation/visibility/close guards (`apps/desktop/src/windows/home/pages/monitor/cache-usage-controller.ts:35`, `:101`, `:123`). `monitor-page.tsx:20` already places the independent aggregate strip above the Run workspace.

Render three aligned, compact facts: existing cache-window rate/coverage; latest primary input over its labeled effective configured window; estimated composition with coverage and optional MCP/Skill origin detail. Show model, completion time and useful loop position, while keeping Effect/Run IDs and source digests machine-only under the existing field-selection contract. Preserve loading, reconnect/stale, no-data, unavailable and reported-zero states. Cache and primary-request facts have different scopes and must be labeled accordingly.

### 7. Reused quantitative evidence and priorities

The only new execution here was deriving aggregates from the **already sanitized JSON**, not querying SQLite. [attribution/baseline-derived.json](attribution/baseline-derived.json) records its source hash and separates reported measurements, offline replay estimates and unknowns. The underlying [November 1 report](../../archive/2026-11/11-01-cache-token-cost-diagnosis/research/new-conversation-cost-analysis.md) supplies method, dated context and quality limits.

| Population | Requests | Reported input | Output including reasoning | Cache ratio | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| Nov 1 primary first | 20 | 1,067,828 | 5,889 (3,828 reasoning) | 92.79% | 50.36% of foreground input; **estimated** 66.24% of foreground conditional cost. |
| Nov 1 same-Run continuation | 19 | 1,052,511 | 8,481 (5,377 reasoning) | 99.38% | 49.64% of foreground input; **estimated** 33.76% of conditional cost. Seven Runs contain these continuations. |
| Older Heartbeat, same stored Flash alias: first | 2 | 13,178 | 536 (460 reasoning) | 29.14% | Existing historical population only; not Nov 1 or proof of today's thin selected context. |
| Older Heartbeat, same alias: continuation | 2 | 14,710 | 1,013 (624 reasoning) | 92.24% | Ordinary continuation feedback is visible in totals; source proportions cannot be reconstructed. |

Historical normalized cache pairs remain the original report's descriptive accounting; earlier raw field presence was not fully retained. This is not today's summary-window rate, provider invoice or a causal deployment comparison. November 1 had no Heartbeat request in the normal-use cohort.

| Priority / decision | Evidence label | Useful finding and constraint |
| --- | --- | --- |
| **Adopt attribution before trimming** | Measured totals + unknown composition | 39 foreground requests consumed 2,120,339 input; mean 54,368/request. All 20 admission snapshots say unknown. Component attribution is the missing evidence; a ~54K request does not prove any particular prompt section is redundant. |
| **Preserve legitimate loops; defer D70 rewriting** | Measured + conditional price estimate | Continuations are nearly half the input but about one third of foreground cost. The 3 exec-bearing Runs have 18 requests/989,165 input and contain real inspection/change/verification. Same command digest before and after a change is not useless repetition. |
| **Investigate bounded Windows-tool correctness at its owner** | Observed failures; savings unknown | Two unavailable `wmic` calls in the same initial batch and one later PowerShell filter-quoting failure are concrete mistakes. Batch failures are not retries after receiving each other. Prefer a concise known execution pattern; no generic retry/OS framework justified. |
| **Observe avatar first-call correctness; do not duplicate guidance** | Measured ceiling + conditional estimate | Four corrected empty-argument calls add 220,157 input (10.38%) but only CNY 0.00661204 (3.64%) conditional foreground cost. This is an associated upper bound, not promised savings. All correct once; `already_active` causes no extra request. Dynamic enums/name/no-repeat guidance already exists. |
| **Evaluate summary/results only after whole-request attribution** | Offline estimate + observed character lengths | Offline replay summary is 9,493 estimator units: 42.93% of the first 22,112-unit replay, falling to 31.80% of the last 29,852-unit replay. This excludes instructions, schemas and transient tails and is not a provider-token share. Retained recall/search results are 15,470/7,402 characters; new results peak at 5,238 characters. Existing pressure folding and family-owned Memory projection already exist. Preserve originals and prove model-accessible recovery before a pilot. |
| **Defer narrow gate experiment; reject global thinking disablement** | Reported tokens + conditional estimate + prior quality evidence | Six ordinary background calls use 8,237 input/3,400 output including 3,009 reasoning: 0.387% of combined input but 9.78% of conditional combined cost. Four gates emit 2,082 output including 2,026 reasoning. Input share alone misses this spending; keep/skip/correction/privacy quality still needs a gate-only experiment. Prior summary/extraction regressions reject the global switch. |
| **Keep cold-start and cache-disruption costs in comparisons** | Measured request + conditional estimate; cause unknown | Initial low-cache request: 49,738 input, 1,024 cached; CNY 0.04938648, 27.18% of foreground conditional cost. Data does not isolate cache expiry, new code, summary or Memory change. Freezing Memory/forcing summaries would change semantics and spend more calls. |

Conditional currency figures reuse the recorded November 1 Sunday tariff. They are estimates, not measured payments or November 2 prices. Count reasoning inside output once, include known failed/cancelled usage, and compare equivalent quality/verification/recovery over the entire affected horizon. No reduction or percentage-saving target is approved by this evidence.

### 8. What history can and cannot quantify

- **Already measured:** normalized per-Effect input/cache/output/reasoning, request phase populations, tool outcomes, summary revision/source coverage, retained result character lengths, and original-ledger invariants. No duplicate usage Effects or complete-detail sum mismatches were reported.
- **Offline estimated:** replay projection under the recorded latest calibration, summary/history shares in estimator units, and conditional currency. It does not recreate historical prepared instructions, active schemas, transient recalls/perception, native serialization or dispatch-time windows.
- **Not reconstructable exactly:** historical Persona/Memory/runtime shares, full schemas and their active-step changes, actual call arguments after privacy-preserving Timeline conversion, exact MCP/Skill provenance without binding capture, or private Heartbeat judgment/tool transcripts. `run-snapshot-capture.ts:95` reports unknown accounting; `:97` reports replay `not_captured`; `:100` has empty sourceRefs. Hashes/manifests identify selected sources, not their serialized token lengths.
- **New producer coverage:** future dispatch/category/window counts, observed totals, active schemas, selected-context composition, source-origin coverage and retry/continuation distinction can be captured without another model call or raw transcript. Legacy absence remains unknown; new retained source tags must survive replay to avoid losing future coverage.
- **Still requires separate verification:** the child's native provider shape/lifetime, real provider image capability/token sizing, rendered UI/reconnect behavior, naturally occurring new cohorts, equivalent-task quality, and original-result recovery. None was tested by this research.

### Files found and code patterns

Paths below are workspace-relative; explicit anchors above are the decision evidence.

| File(s) | Responsibility |
| --- | --- |
| `packages/core/src/agents/agent-attempt.ts`, `request-preparation.ts`, `request-measurement.ts` | Existing instruction/tail/replay assembly, step updates and initial/post-turn pressure measurement. |
| `packages/core/src/agents/turn-usage-report.ts`, `run-observability-telemetry.ts`, `model-observability.ts`, `model-effect-middleware.ts` | Exact prepared-envelope capture, immutable model Effect correlation, per-call usage and failure handling. |
| `packages/core/src/agents/conversation-store.ts`, `turn-mapping.ts`, `source-context.ts`, `tool-source-materials.ts` | Summary substitution, source/render projections, privacy-preserving call persistence and retained result sidecars. |
| `packages/core/src/memory/runtime-composition.ts`, `canonical-memory-run.ts`, `canonical-memory-assembly.ts`, `assembler.ts`, `initiative-memory-assembly.ts` | Effective Memory authority and construction-owned Persona/Blocks/pinned/intention/selected source sections. |
| `packages/core/src/initiative/initiative-context-builder.ts`, `agents/initiative-context.ts`, `harness/run-snapshot-capture.ts` | Thin selected context, restricted tools, source manifests and honest admission accounting gaps. |
| `packages/core/src/agents/tool-disclosure.ts`, `agent-tool-assembly.ts`, `extensions/extension-run-context.ts`, `extension-sources.ts`, `tool-disclosure-snapshot.ts` | Actual tool admission/disclosure, captured MCP/Skill origins and merged instruction sources. |
| `packages/core/src/agents/window-calibrator.ts`, `config/context-config.ts`, `db/window-state-repo.ts`, `main.ts` | Real configured/overflow cap, estimator factor, history/compaction budgets and actual composition roots. |
| `packages/core/src/db/run-event-repo.ts`, `observability/cache-usage-service.ts`, `server/methods/cache-usage-methods.ts` | Existing immutable facts, bounded queries and coalesced operator subscriptions. |
| `packages/shared/src/run-event-schema.ts`, `cache-usage-schema.ts`, `timeline-schema.ts`, `context-source-schema.ts` | Closed event/update/retained-part/source contracts; counts and machine-only identity remain separate from protected payloads. |
| `apps/desktop/src/windows/home/pages/monitor/monitor-page.tsx`, `use-cache-usage.ts`, `cache-usage-controller.ts`, `cache-usage-strip.tsx` | Existing independent aggregate strip and actual visibility/client-generation/reconnect handling. |

### Related specs and external/library references

- `.trellis/workflow.md`: persistent task-local research and reviewed scope before implementation.
- `.trellis/spec/backend/agent-runtime.md:284`, `:309`: single time renderer, stable-early/volatile-late, semantic canonical prefixes, no metric-only correlation in provider input; D70 same-loop rewriting remains deferred.
- `.trellis/spec/backend/tool-disclosure.md`: captured successful activation, immutable closures, active schemas, and no history rewriting for disclosure.
- `.trellis/spec/backend/observability-projection.md`: Run/Event authority, producer-first durable facts, raw-payload exclusion, exact model Effect association, unchanged primary-summary cache window and unknown handling.
- `.trellis/spec/frontend/reactive-read-models.md`: disposable Core facts, bounded reconnect, client/visibility generations and no UI authority/polling.
- Installed `ai@7.0.148`, `@ai-sdk/openai-compatible@3.0.75` (`packages/core/package.json:15`, `:17`). Local SDK `src/generate-text/language-model-events.ts:26`, `stream-text.ts:2438`, `stream-language-model-call.ts:333` verifies prepared-call availability and conversion order. This is installed-source evidence, not a new provider experiment or assertion that every middleware/serializer preserves arbitrary metadata.
- [DeepSeek KV cache guide](https://api-docs.deepseek.com/guides/kv_cache) and pi `0.84.2` / DeepSeek Harness `0.1.1-rc.2` mechanisms are already recorded in `planning-baseline.md` and the archived reference research. They were not re-researched here and do not establish historical miss causes, recovery acceptance or current pricing.

## Caveats / Not Found

- Production image/request files were concurrently owned by the image implementer. References describe inspected construction boundaries; verify line shifts and the final native projection at handoff before implementing attribution. This report makes no native migration completion claim.
- No production/spec/task-lifecycle/Git action occurred. Only the assigned report/helper/output were written. No live/snapshot SQLite query was needed; the helper reads the archived sanitized JSON and confines output to this task's `research/attribution/`.
- Reproduction: `python .trellis/tasks/11-02-context-attribution-token-efficiency/research/attribution/derive_baseline.py`. It reproduced 39 foreground requests and 4 older same-alias Heartbeat requests, with no raw bodies/IDs emitted. Source artifact SHA-256 is retained in the derived JSON. UTF-8/no-BOM, deterministic read-back and aggregate invariants were checked; no runtime tests or manual acceptance were run.
- The new event/origin/window/UI shapes above are a concrete minimal **proposal** for the existing implementation review. This track does not authorize shared-file edits, migrations, new paid samples, reduction defaults or task closeout. The coordinator owns final scope and review after the image seam stabilizes.
