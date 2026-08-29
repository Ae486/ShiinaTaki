# Research: DSH Compaction and Context-Management Design

- Query: Research the DeepSeek Harness (DSH) compaction and context-management design, including trigger thresholds, token metering, tool-result pruning/folding, summarization request construction, event/log/replay semantics, overflow recovery, extension points, and the parts TakiAgent should or should not copy.
- Scope: internal (checked-in DSH reference source, current TakiAgent source, named prior research, and locally installed AI SDK v7 documentation)
- Date: 2026-08-29

## Findings

### Evidence status and reference versions

This report uses the following labels:

- **Verified** means the behavior is present in checked-in source, generated reference documentation, tests, or locally installed package declarations.
- **Gap** means the checked material does not establish the behavior, or the behavior cannot transfer safely across the DSH and TakiAgent runtime models.
- **Recommendation** is an architectural conclusion for TakiAgent, not a claim about current production behavior.

The checked DSH root, compaction-basic package, and token-meter package identify themselves as `0.1.1-rc.2` (`references/deepseek-harness-master/package.json:2-3`, `references/deepseek-harness-master/packages/compaction/compaction-basic/package.json:2-4`, `references/deepseek-harness-master/packages/llm/token-meter/package.json:2-4`). TakiAgent's installed AI SDK is `ai@7.0.17`; the prior runtime-seam probe and local declarations agree on that exact version (`.trellis/tasks/08-28-dsh-observability-expansion/research/d68-runtime-seams-ai-sdk-v7-2026-08-28.md:8-22,48-61`; `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts:3503,3584`).

### Executive conclusion

**Verified:** DSH's strongest design is not its summary prompt or its numeric defaults. It is the combination of:

1. an append-only durable event log;
2. a separate replaceable model-visible surface derived from that log;
3. one replay-aware token meter shared by pressure policy and projections;
4. prune-first, remeasure, then summarize;
5. explicit compaction lifecycle records and a durable operation identity;
6. retry authorization only after a durable surface replacement proves progress.

The compaction capability is deliberately outside the agent-loop spine. DSH defines an abstract `CompactionEngine`, a basic provider, an optional tool-result pruner, and a human command consumer (`references/deepseek-harness-master/packages/compaction/README.md:5-16`; `references/deepseek-harness-master/packages/compaction/compaction/README.md:5-25`). DSH's general architecture likewise says plugins attach at services and typed events rather than patching a privileged loop (`references/deepseek-harness-master/docs/architecture.md:9-13,53-61,106-129`).

**Recommendation:** TakiAgent should copy the operation contracts and correctness invariants, but not the Cordis plugin system, the DSH session-surface storage model, the char/4 estimator, the coding-assistant summary template, or the persistence of complete raw summarizer output. TakiAgent already has a stronger CJK/image-aware estimator, a user-invisible rolling `SummaryRepo`, projection-only replay folds, a Character turn queue, and a Core-owned Run/Event authority (`packages/core/src/memory/token-estimator.ts:10-17,35-66`; `packages/core/src/agents/conversation-store.ts:135-170`; `packages/core/src/db/summary-repo.ts:10-29`; `.trellis/spec/backend/observability-projection.md:5-8,51-64`).

### 1. Capability boundaries and extension points

**Verified:** DSH separates four roles:

| Role | DSH implementation | Contract |
| --- | --- | --- |
| Service definition | `@deepseek-ai/dsh-compaction` | `compactIfNeeded`, `compactNow`, and `compactRegion`; implementation owns trigger, retention, summarization, and event sequencing (`references/deepseek-harness-master/packages/compaction/compaction/src/index.ts:87-117,119-169`). |
| Default provider | `@deepseek-ai/dsh-compaction-basic` | Uses `ctx.tokenMeter`, token-budget retention, direct `ctx.llm.stream()` summarization, and automatic listeners (`references/deepseek-harness-master/packages/compaction/compaction-basic/README.md:5-24`). |
| Optional model-free companion | `@deepseek-ai/dsh-compaction-tool-result-pruner` | Deterministically replaces oversized current tool results before summary selection (`references/deepseek-harness-master/packages/compaction/compaction-tool-result-pruner/README.md:5-17`). |
| Human consumer | `@deepseek-ai/dsh-command-compact` | Calls `compactNow()` without a model turn and reports stable typed failures (`references/deepseek-harness-master/packages/compaction/command-compact/src/index.ts:57-77,80-105`). |

**Verified:** The basic provider has one intended subclass hook, protected `summarize()`. A template or remote summarizer may replace that call while the transaction, retention, source citations, shrink validation, and token accounting remain fixed (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:95-103,226-246,422-427`; `references/deepseek-harness-master/packages/compaction/compaction-basic/README.md:24`). Automatic behavior attaches to two live events: serial `agent/pre-step` for pressure and waterfall `agent/request-error` for canonical overflow recovery (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:132-165,179-223`). The one-shot summary call is separately interceptable at `llm/stream`, not at the loop-only `agent/request` event (`references/deepseek-harness-master/packages/compaction/compaction/README.md:21-25`).

**Verified:** The shipped base and standard/code presets compose token-meter, compaction-basic, manual command, and the tool-result pruner. The pruner is therefore not merely an unused library (`references/deepseek-harness-master/packages/bundle/base/cordis.patch.yml:280-290,356-365`; `references/deepseek-harness-master/apps/cli/config/agent-presets/standard/agent.cordis.yml:140-155`; `references/deepseek-harness-master/apps/cli/config/agent-presets/code/agent.cordis.yml:147-162`).

**Verified, AI SDK:** AI SDK v7 provides a narrower runtime seam rather than a complete compactor. `prepareStep` may replace the messages for the current step, and that replacement becomes the base for later steps (`node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/docs/03-agents/04-loop-control.mdx:183-189`; `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts:1621-1628,1701-1722`). `pruneMessages` removes reasoning and selected tool-call/result/approval content, but it does not summarize, persist a checkpoint, meter tokens, or implement recovery (`node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts:6921-6937`; `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/docs/07-reference/02-ai-sdk-ui/32-prune-messages.mdx:102-115`). The installed docs explicitly say the application chooses when compaction happens (`loop-control.mdx:183-215`).

**Recommendation:** Add a narrow Core-owned compaction/context coordinator behind existing dependency injection. Do not import DSH's "everything is a plugin" composition model. AI SDK `prepareStep` is suitable for applying a precomputed deterministic request projection between tool-loop steps, but it is not a durability or recovery authority by itself.

### 2. Trigger thresholds and retention policy

#### Ordinary pressure

**Verified:** Automatic pressure compaction runs before request derivation at `agent/pre-step` (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:147-165`). It resolves the latest durable provider/model route from the session request header, then asks that adapter for its context capacity (`index.ts:51-70,263-304`). Model discovery/listing is not the authority (`references/deepseek-harness-master/packages/compaction/compaction-basic/README.md:11-15`).

The default policy is:

| Setting | Default | Effective behavior |
| --- | ---: | --- |
| `thresholdRatio` | `0.8` | `thresholdTokens = floor(contextWindow * thresholdRatio)` (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/config.ts:19-23,133-166`). |
| `retainRatio` | `0.16` | `retainTokens = floor(contextWindow * retainRatio)` unless an absolute `retainTokens` is configured (`config.ts:74-96,144-166`). |
| `maxTokens` | `8192` | Provider generation cap for the auxiliary summary call (`config.ts:86-96`; `references/deepseek-harness-master/packages/compaction/compaction-basic/src/summarizer.ts:153-163`). |
| `compactionRetries` | `1` | One extra compaction after the first, so at most two summary attempts in one pressure check (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:314-331`). |
| `maxOverflowRetries` | `1` | At most one retry of a canonical overflowed provider request (`index.ts:187-223`). |
| `auto` | `true` | Registers pressure and overflow listeners (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/config.ts:91-96`; `index.ts:126-130`). |

Exact provider/model entries may override the policy, including retention and retry caps (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/config.ts:99-125`; `references/deepseek-harness-master/packages/compaction/compaction-basic/src/types.ts:29-42`). Missing model capacity fails a direct pressure check and is warned once per target by the automatic listener, which then continues the turn with full history (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:155-164,293-303`; `references/deepseek-harness-master/packages/compaction/compaction-basic/README.md:43-45`).

#### Confirmed overflow

**Verified:** A canonical `CONTEXT_WINDOW_EXCEEDED` bypasses capacity lookup, ordinary threshold, and normal retained-tail policy (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:248-290`). The engine first runs the optional pruner, remeasures, then selects a range with `retainTokens = 0` (`index.ts:278-290`). Because range selection always consumes at least the newest surface node before stopping, forced overflow compaction keeps the newest indivisible unit and compacts the largest balanced head available (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts:98-133`).

The tests verify that overflow compacts below the ordinary threshold, can retry after pruning alone, can summarize the pruned surface, and preserves the newest complete tool call/result pair (`references/deepseek-harness-master/packages/compaction/compaction-basic/tests/compaction-basic.spec.ts:1554-1571,1573-1608,1655-1674`).

#### Manual compaction

**Verified:** `compactNow()` runs only while the agent is idle, selects one useful range even below pressure, emits no compaction events on a no-op, and flushes the closed attempt before queued prompts may run (`references/deepseek-harness-master/packages/compaction/compaction/src/index.ts:119-143`; `references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:360-419`). The command itself never enters model history (`references/deepseek-harness-master/packages/compaction/command-compact/README.md:46-60`).

**Recommendation:** Preserve two automatic triggers in TakiAgent: proactive pressure and reactive canonical overflow. Keep manual `/compact` out of the initial redesign unless there is a product requirement; it adds admission, cancellation, persistence, and UI-result obligations without helping automatic correctness.

### 3. Replay-aware token metering

**Verified:** DSH token metering is a separate singleton service and not part of `CompactionEngine` (`references/deepseek-harness-master/packages/llm/token-meter/README.md:5-20`; `references/deepseek-harness-master/packages/compaction/compaction/README.md:17-25`). It maintains one incremental fold per session over the durable log, while every `measure()` returns a detached, deeply immutable snapshot (`references/deepseek-harness-master/packages/llm/token-meter/src/index.ts:73-98,100-147`).

The estimate is fixed and has no configuration:

- text and reasoning use `ceil(length / 4)` plus block overhead;
- tool calls price name plus serialized arguments;
- tool results recurse into their content;
- messages add role overhead;
- system prompt and tool schemas are priced separately (`references/deepseek-harness-master/packages/llm/token-meter/src/estimate.ts:12-19,21-57,60-87`).

**Verified:** The preferred anchor is provider usage from the latest successful call, but only when the canonical request header is unchanged and the provider total is no lower than the complete heuristic anchor. Otherwise DSH falls back to full heuristic pricing (`references/deepseek-harness-master/packages/llm/token-meter/src/index.ts:100-147,221-260`). Provider totals add input, cache-read, cache-write, and output buckets; reasoning is not added again (`index.ts:43-49`). Later surface appends or replacements apply a signed heuristic delta to that anchor (`index.ts:123-146,263-269`; `references/deepseek-harness-master/packages/llm/token-meter/src/surface-fold.ts:42-64`).

`totalTokens` is explicitly request-and-response pressure, not a provider-exact next-prompt count (`references/deepseek-harness-master/packages/llm/token-meter/src/types.ts:20-33`; `references/deepseek-harness-master/packages/llm/token-meter/README.md:18-22`). This is reasonable because the previous assistant output joins the next request surface, but it remains an approximation.

**Verified:** UI projections are deliberately separate from gating. `contextPressure` exposes the last provider prompt sample and a projected next-request value adjusted by surface deltas, while the README states that occupancy is not a decision input and compaction calls `measure()` directly (`references/deepseek-harness-master/packages/llm/token-meter/src/usage-projection.ts:153-218`; `references/deepseek-harness-master/packages/llm/token-meter/README.md:30-44`).

**Gap:** DSH's fixed char/4 estimator explicitly underprices some content, especially CJK and JSON-heavy schemas (`references/deepseek-harness-master/packages/llm/token-meter/README.md:63-68`). It also has no provider tokenizer or count-tokens call.

**Recommendation:** Copy the provider-anchor plus signed-delta model, immutable measurement snapshot, and separation between gating and display. Do not copy char/4. TakiAgent's current estimator already treats CJK near one token per character, adds per-message overhead, assigns a flat image cost, and prices tool JSON (`packages/core/src/memory/token-estimator.ts:10-17,35-66`). Extend that estimator to include the actual stable instructions and tool schemas used by a request, then calibrate with the authoritative AI SDK usage already observed at Core's model seam (`.trellis/tasks/08-28-dsh-observability-expansion/research/d68-runtime-seams-ai-sdk-v7-2026-08-28.md:48-61,104-131`).

### 4. Tool-result pruning and folding

**Verified:** DSH prunes only after ordinary pressure or confirmed overflow qualifies. A below-threshold pressure check does not opportunistically rewrite results (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:278-312`; test `references/deepseek-harness-master/packages/compaction/compaction-basic/tests/compaction-basic.spec.ts:769-804`). After pruning, compaction-basic remeasures and skips the summary call if pressure is now safe; otherwise the summarizer receives the already-pruned surface (`index.ts:306-325`; test `compaction-basic.spec.ts:789-819`).

The default pruner uses Unicode code-point budgets:

| Setting | Default |
| --- | ---: |
| prune above | `8192` text code points |
| retain head | `4096` code points |
| retain tail | `1024` code points |
| marker | `\n\n[... tool result middle pruned ...]\n\n` |

Sources: `references/deepseek-harness-master/packages/compaction/compaction-tool-result-pruner/src/config.ts:6-14,31-64` and `references/deepseek-harness-master/packages/compaction/compaction-tool-result-pruner/README.md:19-29`.

**Verified:** `pruneSession()` snapshots the current surface, scans every current `tool/result`, preserves all event data except nested content, and appends a new replacement result. The full original event remains in the append-only log (`references/deepseek-harness-master/packages/compaction/compaction-tool-result-pruner/src/index.ts:124-183`; `README.md:9-17`). Rich blocks retain relative order; only text contributes to the character budget (`src/index.ts:63-121`). The operation is idempotent because the emitted result is within threshold and strictly smaller (`README.md:15-17`).

Every prune appends a log-only `compaction/prune` shadow-price event immediately before the replacement. That lets bounded O(1) projections subtract the replaced range without storing every per-node token price (`references/deepseek-harness-master/packages/compaction/compaction/src/types.ts:72-88`; `references/deepseek-harness-master/packages/llm/token-meter/src/surface-projection.ts:1-15,48-93`).

**Gap:** This is syntactic head/middle/tail pruning. It does not preserve semantically important middle lines, deduplicate repeated results, mark stale observations, or distinguish snapshots from fact-class results. It may split grapheme clusters even though it preserves UTF-16 surrogate pairs (`references/deepseek-harness-master/packages/compaction/compaction-tool-result-pruner/README.md:58-62`).

**Recommendation:** Retain TakiAgent's richer projection-only fold ordering: older snapshot-class results, fact-class results, then oversized tool-call arguments, with recent per-tool results protected (`packages/core/src/agents/replay-folds.ts:15-23,36-70,73-107`). Add DSH's two strongest rules: run deterministic pruning before any summary call and remeasure immediately; enforce balanced tool-call/result cut boundaries. Do not append synthetic replacement rows to TakiAgent's user-visible Timeline. Current TakiAgent folds copies in the Replay View and leaves stored Timeline rows unchanged (`replay-folds.ts:1-6,41-60,110-139`), which better preserves its UI and privacy contracts.

### 5. Range selection and tool-pair integrity

**Verified:** DSH always compacts a head-anchored range and retains a recent token-priced tail. It walks backward until the retained budget is reached, then moves the cut backward until no unanswered tool call crosses it (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts:90-133`). Compaction range edges are surface positions, not numeric sequence intervals, because a later replacement gets a fresh high sequence number at an older position (`references/deepseek-harness-master/packages/compaction/compaction/src/types.ts:104-118`; `references/deepseek-harness-master/packages/compaction/compaction/src/index.ts:145-169`).

The pairing helpers count assistant tool calls and tool results in current surface order and cache balance by `replaceGeneration`. Missing surface events and orphan results fail loudly as corruption (`references/deepseek-harness-master/packages/compaction/compaction/src/tool-pairing.ts:10-26,28-73,76-106,109-131`). Region validation requires both the cut before `start` and the cut after `end` to be balanced (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts:314-335`).

**Slice 1 status:** the former TakiAgent gap is now addressed in the worktree. `selectWindow()` and the background compactor share `replayUnits()`, while `retirement-selector.ts` accumulates a DSH-grounded `0.16` token-priced tail and cuts only between contiguous call/result spans (`packages/core/src/agents/context-window.ts:52-78`; `packages/core/src/agents/retirement-selector.ts:23-64`; `packages/core/src/agents/compaction-pass.ts:148-178`). The remaining DSH mismatches are durable lifecycle/CAS, summary quality, and provider-independent composition work reserved for later slices.

**Recommendation:** Make tool-pair integrity a first-class boundary predicate shared by hard window selection, rolling-summary retirement, overflow reduction, and any AI SDK `prepareStep` projection. Do not rely on post-cut orphan cleanup as the only safety rule.

### 6. Summarization request shape and output validation

**Verified:** DSH does not send a detached plain transcript prompt. It reconstructs the latest routed request's cacheable prefix for the selected region:

- the conversation's own system prompt;
- its tool schemas;
- the selected model-visible messages in surface order;
- one final user message containing the compaction instruction (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts:488-513`; `references/deepseek-harness-master/packages/compaction/compaction-basic/src/summarizer.ts:72-85,121-164`).

The default target is a configured summary provider/model pair, else the latest routed request target, else the agent target (`summarizer.ts:128-143`). The call carries `sessionId`, `purpose: 'compaction'`, the configured `maxTokens`, and the caller's abort signal (`summarizer.ts:145-164`). It is a direct `ctx.llm.stream()` call, not another agent-loop step (`references/deepseek-harness-master/packages/compaction/compaction-basic/README.md:18-20`).

**Verified:** The final instruction requires exact Markdown sections for primary request, technical concepts, files/code, errors/fixes, pending jobs, current work, next step, and critical context. It tells the model to consolidate a previous `<compacted-summary>`, retain still-true facts, and drop stale facts (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/summarizer.ts:31-66`). The landed checkpoint is a user-role message framed by a preamble and `<compacted-summary>` tags (`summarizer.ts:68-70,184-195`).

The output path fails closed:

- only text blocks become the checkpoint;
- image output throws `UNSUPPORTED_CONTENT`;
- empty/whitespace-only text is rejected;
- provider error, abort, or `max-tokens` finish is rejected;
- the fully framed summary must estimate strictly smaller than the shadowed source (`summarizer.ts:164-181,197-224`; `references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts:359-383`).

**Verified:** DSH logs the safe summary, optional complete raw provider output, provider/model, generation cap, and optional usage on `compaction/summary` (`references/deepseek-harness-master/packages/compaction/compaction/src/types.ts:23-66`). The stated purpose of replaying the original prefix is provider KV-cache reuse (`references/deepseek-harness-master/packages/compaction/compaction-basic/README.md:105-156`).

**Gap:** Replaying system prompt and tool schemas is costly if the summary model differs, and exposing tools to the summary model creates output that must be discarded safely. The checked design does not redact secrets from the summary or raw output before persistence. `rawOutput` may include reasoning or tool-call blocks even though only text reaches the checkpoint.

**Recommendation:** Do not copy the DSH coding-agent template. TakiAgent's accepted compaction prompt is companion-specific, first-person, date-anchored, rolling, and explicitly separates long-term permanent facts from episodic continuity (`packages/core/src/agents/compaction-pass.ts:20-96`; prior prompt research `.trellis/tasks/archive/2026-08/07-28-memory-context/research/re-compaction-prompts.md:122-138,204-218`). Preserve that domain fit.

Also do not copy `maxTokens: 8192` as a correctness mechanism. TakiAgent deliberately removed a hard output cap because a truncated rolling summary poisons future merges (`packages/core/src/agents/compaction-pass.ts:20-30,188-204`; `re-compaction-prompts.md:122-138,204-206`). Copy DSH's empty-output and strict-shrink guards instead: reject a non-shrinking summary without advancing `throughSeq`, and leave the old summary authoritative.

Prefix-cache replay may be an optional optimization only when the same provider/model is used and privacy review permits the system/tools replay. It should not be required for compaction correctness, and complete raw summarizer output should not enter TakiAgent's Run ledger or operator surfaces (`.trellis/spec/backend/observability-projection.md:51-64`).

### 7. Event, log, projection, and replay semantics

**Verified:** DSH's session is an append-only event log and the model history is derived from it. Raw chunks remain for replay/UI fidelity, while the current model-visible surface is a projection (`references/deepseek-harness-master/docs/architecture.md:92-96`; `references/deepseek-harness-master/docs/subsystems/session.md:5-11`). Only `user/message`, `assistant/message`, and `tool/result` may join the surface. Compaction lifecycle events are log-only (`references/deepseek-harness-master/packages/compaction/compaction/README.md:39-53`).

A successful summary compaction appends this sequence:

1. `compaction/start` acquires the log-recorded lock;
2. the summary model runs;
3. `compaction/summary` records summary content, selected range, shadowed seqs/tokens, and model-call facts;
4. one replacement `user/message` carries the framed checkpoint and `surfaceOp: replace`;
5. `compaction/end` releases the lock (`references/deepseek-harness-master/packages/compaction/compaction/README.md:41-49`; implementation `references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts:183-253,426-478`).

The replacement cites `[startEvent.seq, summaryEvent.seq, ...shadowedSeqs]`, and its source carries the same `compactionId` plus optional manual `sourceCommandId` (`region.ts:447-477`; `references/deepseek-harness-master/packages/compaction/compaction/src/checkpoint.ts:19-50`). `deriveMessages()` rebuilds when `replaceGeneration` changes and omits shadowed nodes, while raw events remain available (`references/deepseek-harness-master/packages/core/session/src/index.ts:701-739`; `references/deepseek-harness-master/packages/core/session/src/surface.ts:360-378,431-440`).

**Verified:** The opening marker is the durable lock. A failed later stage makes one close attempt with `error`; if closing itself fails, the unmatched start intentionally remains blocking evidence (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts:200-253`). An unmatched start older than a newer `session/end-seed` is treated as stale evidence from a previous process lifecycle, while a newer unmatched start reports busy (`region.ts:279-312,516-549`). The invariant companion verifies ownership, identity correlation, one summary per bracket, range metadata, and successful end-after-summary (`references/deepseek-harness-master/packages/compaction/compaction/src/invariant.ts:123-217,245-297`).

Manual compaction allows unrelated injected context between start and end, so UI grouping uses `compactionId` rather than adjacency (`references/deepseek-harness-master/packages/compaction/compaction/README.md:49-53`; `references/deepseek-harness-master/packages/client/ui-conversation/src/client/conversation-nodes/compaction.ts:30-56`). Adjacency is required only for the `compaction/summary` or `compaction/prune` shadow-price event and its immediately following replacement (`references/deepseek-harness-master/packages/compaction/compaction/src/types.ts:25-31,72-88`).

**Gap in current TakiAgent:** the rolling summary is one overwritable Character row and successful compaction emits counts-only Pino logs. The reviewed Run Event union has no compaction lifecycle kind (`packages/core/src/db/summary-repo.ts:10-29,38-79`; `packages/core/src/agents/compaction-pass.ts:188-208`; `packages/shared/src/run-event-schema.ts:37-45,180-194`). Therefore a restart can reconstruct the current summary but cannot reconstruct each compaction attempt, its selected input boundary, failure stage, or shrink result from durable Run events.

**Recommendation:** Copy the lifecycle identity and durable facts, not DSH's message-surface mutation. A TakiAgent compaction transaction should record at minimum: operation id, Character id, triggering Run/Attempt when present, reason (`pressure`, `overflow`, or future manual), source `throughSeq`, proposed new `throughSeq`, measured before/after, deterministic replay-view revision/fingerprint, summary model route, terminal state, and bounded error class. Commit the successful `SummaryRepo.upsert` and its terminal evidence atomically if the database layer permits. The summary remains projection-only and never becomes a fake Timeline user row.

### 8. Overflow recovery semantics

**Verified:** DSH adapters normalize provider-specific context failures to one canonical code before the compactor sees them (`references/deepseek-harness-master/packages/llm/llm-deepseek/src/adapter.ts:332-344`; `references/deepseek-harness-master/packages/llm/llm-pi-ai/src/stream.ts:72-88`). The `agent/request-error` listener handles only that code and delegates all other failures (`references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts:179-189`).

Recovery flow:

1. require a durable routed target;
2. enforce the exact target's `maxOverflowRetries`;
3. capture `surface.replaceGeneration`;
4. prune and/or force one balanced head compaction;
5. retry only if the generation advanced;
6. if pruning advanced the generation but later summary work threw, still retry from the durable pruned surface;
7. let cancellation win;
8. otherwise preserve the original provider error (`index.ts:183-223`).

The retry counter resets when the agent becomes idle or after a successful assistant message, so a later successful provider call begins a new recovery sequence (`index.ts:167-177`). Tests cover canonical-only handling, target-specific caps, cancellation, durable prune progress, and preserving the original error when no replacement lands (`references/deepseek-harness-master/packages/compaction/compaction-basic/tests/compaction-basic.spec.ts:1611-1653,1779-1835`).

**Verified limitation:** surface compaction cannot repair a single oversized retained unit, an oversized system/tool/request envelope, or an indivisible non-tool node (`references/deepseek-harness-master/packages/compaction/compaction/src/index.ts:101-106`; `references/deepseek-harness-master/packages/compaction/compaction-basic/README.md:158-164`).

**Critical TakiAgent mismatch:** current TakiAgent retries by rerunning the whole `ToolLoopAgent` attempt. It therefore permits the one retry only when no text was yielded and no step completed, specifically to avoid replaying tool side effects (`packages/core/src/agents/chat-agent.ts:178-208`). DSH retries an individual failed provider request inside its own loop, after prior completed tool steps remain durable and are not rerun (`references/deepseek-harness-master/packages/core/agent-loop/src/agent.ts:372-390`).

**Recommendation:** Do not copy DSH's broader retry eligibility onto TakiAgent's outer-attempt retry. Keep the existing side-effect-free guard until TakiAgent has a verified request-level recovery seam that can retry only the failed model request. `prepareStep` can reduce later-step context, but the installed AI SDK docs do not provide a DSH-equivalent `agent/request-error` waterfall that proves request-local replay. If no request-local seam is added, a mid-turn overflow after completed tools must remain terminal rather than rerun the attempt.

Retry should additionally require measurable progress: a changed replay-view generation/fingerprint and a strictly smaller reconstructed request, not merely a lowered configured window. Preserve the original provider error when no reduced request can be produced.

### 9. What TakiAgent should copy, adapt, or reject

| DSH idea | TakiAgent decision | Reason |
| --- | --- | --- |
| Compaction outside the low-level model loop behind a narrow service | **Adopt** | Matches the existing Core-owned harness direction and avoids a second runtime authority. |
| Shared meter used by pressure, range selection, and observability | **Adopt** | Prevents trigger/view drift. Use TakiAgent's estimator and AI SDK usage, not DSH's estimator. |
| Proactive pressure plus canonical overflow triggers | **Adopt** | Current detached post-turn compaction does not cover every runaway multi-step turn; overflow alone is reactive. |
| Prune, remeasure, summarize only if still necessary | **Adopt** | Deletes auxiliary model calls when deterministic reduction is enough. |
| Balanced tool-call/result range edges | **Adopt** | Stronger than current leading-orphan cleanup and protects summaries from split tool units. |
| Durable operation id, lifecycle facts, failure stage, and progress proof | **Adopt** | Enables restart/replay equality and prevents retry without a committed reduction. |
| Reject empty, truncated, or non-shrinking summaries | **Adopt** | Prevents compaction loops and silent loss without imposing silent clipping. |
| Provider usage anchor plus deterministic surface delta | **Adapt** | Keep authoritative usage and signed deltas, but use CJK/image/tool-schema-aware estimation. |
| Surface replacement events | **Adapt** | Map to `SummaryRepo.throughSeq` plus a pure Replay View and durable compaction evidence; do not create synthetic Timeline rows. |
| `prepareStep` message replacement | **Adapt** | Use for deterministic between-step projection, not as persistence, lock, or retry authority. |
| Same-prefix summarization for KV-cache reuse | **Optional adaptation** | Only when same-route reuse is measured and privacy/cost are acceptable. It must not determine correctness. |
| Exact-target policy overrides | **Optional adaptation** | Useful if TakiAgent supports materially different context windows/models; avoid a large config surface before evidence requires it. |
| Manual `/compact` | **Defer** | Automatic correctness has higher value; manual operation adds queue and UI contracts. |
| Cordis plugin tree and session-surface storage model | **Reject** | TakiAgent already has DI, Timeline, SummaryRepo, Run/Event ledger, and Character admission. A parallel substrate would create competing authorities. |
| Fixed char/4 estimator | **Reject** | Known bad fit for TakiAgent's CJK-heavy and image-bearing context. |
| DSH coding-assistant summary headings | **Reject** | Wrong product domain; current companion-specific prompt has reviewed continuity and voice requirements. |
| Hard `maxTokens` as summary-size enforcement | **Reject** | A token-cap finish is treated as failure in DSH itself; TakiAgent's rolling merge is damaged by truncation. Use strict shrink validation and retry/audit policy instead. |
| Persist complete `rawOutput` and reasoning/tool-call blocks | **Reject** | Conflicts with TakiAgent's bounded redaction and protected-content rules. |
| Broader overflow retry on the current outer-attempt loop | **Reject until request-local recovery exists** | It can duplicate already completed tool effects. |
| Syntactic head/tail pruning as the complete folding policy | **Reject** | Keep TakiAgent's semantic class ordering and recent-window protection; head/tail is only an emergency bound for a single oversized result. |

### 10. Proposed TakiAgent design constraints derived from the evidence

These are recommendations for planning, not current contracts:

1. **One context manifest per provider request.** It should identify the stable instructions/tools generation, replay-view revision, summary `throughSeq`, folded entries, retained tail, estimated composition, and authoritative usage anchor without storing raw prompt/tool payloads in the Run ledger.
2. **One pure request projector.** Summary substitution, semantic folds, emergency single-result head/tail pruning, tool-pair boundary repair, and final hard cut should be deterministic from durable Timeline + SummaryRepo + captured configuration.
3. **One compaction transaction coordinator.** It owns pressure/overflow/manual reasons, operation identity, selected retirement span, pre-retire memory flush, summary call, shrink validation, compare-and-swap stability check, SummaryRepo commit, and durable terminal evidence.
4. **Two execution modes.** Post-turn rolling summary may remain detached. A request that must proceed immediately may use deterministic projection synchronously; model-backed mid-turn summarization should block only behind an explicit policy and must not masquerade as a detached background pass.
5. **Retry requires request-local safety and progress.** Current whole-attempt overflow retry remains clean-attempt-only. A future request-local retry may allow prior tool steps only after it proves the SDK/provider call can be retried without replaying tool execution.
6. **Summary quality is validated.** Minimum guards are non-empty, no provider truncation, strict estimated shrink, preserved latest unresolved request/commitments, and no secret/raw protected payload leakage. A failure leaves the previous summary and `throughSeq` unchanged.
7. **Observability is bounded and replayable.** Emit semantic compaction facts through the existing Run/Event authority when tied to a Run; keep Character-global summary content in SummaryRepo, not in the monitor ledger. Projection must show unknown values as unknown, following the existing observability spec (`.trellis/spec/backend/observability-projection.md:51-64,69-84`).

### Files found

- `references/deepseek-harness-master/packages/compaction/compaction/src/index.ts` - abstract compaction service, trigger types, manual failures, and public operations.
- `references/deepseek-harness-master/packages/compaction/compaction/src/types.ts` - durable compaction/prune event vocabulary and result fields.
- `references/deepseek-harness-master/packages/compaction/compaction/src/tool-pairing.ts` - balanced cut calculation over current surface order.
- `references/deepseek-harness-master/packages/compaction/compaction/src/invariant.ts` - replay and live lifecycle invariant enforcement.
- `references/deepseek-harness-master/packages/compaction/compaction-basic/src/config.ts` - threshold, retention, retry, model-policy, and validation defaults.
- `references/deepseek-harness-master/packages/compaction/compaction-basic/src/index.ts` - automatic pressure and overflow listener wiring.
- `references/deepseek-harness-master/packages/compaction/compaction-basic/src/region.ts` - range selection, transaction bracket, stability checks, shrink check, and commit ordering.
- `references/deepseek-harness-master/packages/compaction/compaction-basic/src/summarizer.ts` - summary prompt, request envelope, output filtering, and checkpoint framing.
- `references/deepseek-harness-master/packages/compaction/compaction-tool-result-pruner/src/index.ts` - deterministic replay-safe tool-result replacement.
- `references/deepseek-harness-master/packages/llm/token-meter/src/index.ts` - replay-aware provider-anchor and surface-delta measurement.
- `references/deepseek-harness-master/packages/llm/token-meter/src/estimate.ts` - fixed heuristic estimator.
- `references/deepseek-harness-master/packages/llm/token-meter/src/surface-projection.ts` - bounded shadow-price projection protocol.
- `references/deepseek-harness-master/packages/core/session/src/index.ts` and `surface.ts` - append-only log, current surface, replacement generation, and derived model history.
- `references/deepseek-harness-master/packages/core/agent-loop/src/agent.ts` - request-local retry dispatch used by overflow recovery.
- `packages/core/src/agents/conversation-store.ts` - current TakiAgent summary substitution, folds, and hard replay cut.
- `packages/core/src/agents/compaction-pass.ts` - current detached rolling summary and flush-before-retire behavior.
- `packages/core/src/agents/chat-agent.ts` - current whole-attempt overflow retry safety gate.
- `packages/core/src/agents/replay-folds.ts` - current semantic, projection-only tool folding.
- `packages/core/src/memory/token-estimator.ts` - current CJK/image/message/tool-aware estimator.
- `packages/core/src/db/summary-repo.ts` - current Character-scoped rolling summary authority.
- `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/docs/03-agents/04-loop-control.mdx` - installed `prepareStep` context-management guidance.
- `node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/dist/index.d.ts` - installed `PrepareStepFunction`, usage, and `pruneMessages` declarations.

### External references and installed framework evidence

No network source was required. The only third-party framework evidence used directly is the locally installed AI SDK v7.0.17 documentation and declarations listed above. Named prior research was used to preserve already-reviewed TakiAgent decisions and avoid treating DSH as the only precedent:

- `.trellis/tasks/08-28-dsh-observability-expansion/research/d68-runtime-seams-ai-sdk-v7-2026-08-28.md` - verified AI SDK request/tool callback and usage surfaces.
- `.trellis/tasks/08-28-dsh-observability-expansion/research/d68-producer-first-scope-2026-08-28.md` - producer-first Run/Event and privacy constraints.
- `.trellis/tasks/08-22-t4-agent-architecture-observability/research/dsh-observability.md` - DSH durable/live event-plane distinction and current/shadowed/log-only projection.
- `.trellis/tasks/08-22-t4-agent-architecture-observability/research/pi-harness.md` - durable structural compaction operations and retry/effect safety comparison (`pi-harness.md:43-53,83-100`).
- `.trellis/workspace/pleia/t5-context-management-survey.md` - prior provider-agnostic token/compaction survey and AI SDK v7 limits (`t5-context-management-survey.md:461-493,520-604,645-654`).
- `.trellis/tasks/archive/2026-08/07-28-memory-context/research/re-compaction-prompts.md` - accepted TakiAgent summary-prompt rationale and hard-cap warning (`re-compaction-prompts.md:122-138,204-218`).

### Related specs

- `.trellis/spec/backend/observability-projection.md` - the existing Run/Event authority, producer-first evidence requirement, unknown-value rules, and protected-content exclusions.
- `packages/core/src/agents/index.md` - current package-level contracts for compaction pass, Replay View, overflow retry, token calibration, and observability seams (`packages/core/src/agents/index.md:4-16`).
- `references/deepseek-harness-master/docs/subsystems/compaction.md` - generated DSH compaction event/service reference (`docs/subsystems/compaction.md:9-23,60-92`).
- `references/deepseek-harness-master/docs/subsystems/session.md` - DSH append-only session, surface, and replay reference (`docs/subsystems/session.md:5-11,525-538,599-631`).

## Caveats / Not Found

- The checked DSH tree is a local `0.1.1-rc.2` reference. No upstream HEAD or tagged-release comparison was performed, and no Git operation was used.
- DSH does not provide exact tokenization in the compaction hot path. Its fixed char/4 heuristic is explicitly approximate.
- DSH does not provide semantic tool-result selection, repeated-result deduplication, observation staleness markers, or a re-read protocol. Those cannot be claimed as solved by the pruner.
- The checked source does not establish redaction of secrets from `compaction/summary.summary` or `rawOutput` before persistence.
- The checked AI SDK v7 docs provide `prepareStep` and `pruneMessages`, but no DSH-equivalent request-error recovery waterfall. A safe mid-turn provider-request retry in TakiAgent remains an implementation research item.
- Current TakiAgent source does not prove tool-pair-balanced rolling-summary retirement, durable compaction-attempt replay, atomic SummaryRepo plus Run/Event settlement, or strict post-summary shrink validation. These are gaps to address in the redesign, not existing guarantees.
- DSH's prefix-cache claim is structurally credible because it replays the same system/tools/messages before the final instruction, but no live provider measurement was run for this report. Treat cache savings as an optimization hypothesis until verified on TakiAgent's actual provider route.
