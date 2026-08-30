# Compaction Harness Technical Design

## 0. Status and decision boundary

This document is the active design contract for `08-29-compaction-harness`. It is based on the live TakiAgent source,
ratified T5 decisions, ADR 0005/0008/0009, and the checked-in DeepSeek Harness (DSH) `0.1.1-rc.2` reference. Slices 1-3
are implemented and checked; this revision records the pressure/reduction contract that governs pending Slice 4.

The design is intentionally evolutionary. The first implementation slice establishes stable seams and evidence; it is
not a claim that the first release is the final context architecture. Later slices may revise contracts when tests or
provider observations reveal a better implementation, but such changes must be recorded in the task artifacts before
the next slice.

## 1. Current TakiAgent design (verified)

### 1.1 Data flow

The current path is one append-only, Character-scoped relationship timeline and one recomputed model projection:

```text
TimelineRepo rows (all durable user/assistant/tool rows)
  -> latestAscending(characterId, 200)
  -> remove rows covered by conversation_summary.through_seq
  -> prepend projection-only <conversation-summary> head when coverage is visible
  -> pressure-only semantic tool folds
  -> token selection and leading-orphan-tool repair
  -> ModelMessage history for the current model request
```

The same `selectView` closure supplies `history()`, `windowStart()`, and `estimatedTokens()`
(`packages/core/src/agents/conversation-store.ts:98-124`). This is a strong single-boundary invariant: the replay view
and the pre-compaction flush agree about which rows have left the model window.

After a committed primary turn, `chat-agent.ts` schedules detached maintenance. `createAutoMemory` serializes work per
Character and runs `episodic -> flush -> tidy -> compact` (`packages/core/src/memory/auto-memory.ts:73-121`). The current
compactor flushes the retiring range, invokes one Utility Slot `generateText` call with the previous summary plus a
rendered transcript, and advances the summary watermark only after non-empty output
(`packages/core/src/agents/compaction-pass.ts:125-208`). The user turn never waits for this pass.

### 1.2 Current contracts that are worth preserving

| Contract | Evidence | Decision |
| --- | --- | --- |
| Relationship timeline is append-only and context loss is projection-only | `docs/adr/0005-continuous-timeline-no-sessions.md`; `docs/adr/0008-replay-view-context-seam.md` | Preserve exactly. Never write a machine summary as a user-visible timeline row. |
| Character is the relationship and memory isolation boundary | `conversation-store.ts`, ADR 0009 | Preserve. No user-facing session list is introduced by compaction. |
| One deterministic replay boundary feeds history, flush, and token estimate | `conversation-store.ts:98-124`; Batch 6 design | Preserve and extend, rather than creating separate selectors. |
| Token-aware selection with a message-count emergency guard | `context-window.ts`; T5 R1 | Preserve token-first intent, change where the guard is applied. |
| Memory flush precedes retirement and the watermark advances only on success | `compaction-pass.ts:161-204`; T5 R5/Batch 7 | Preserve. Make the memory side effect an injected narrow port. |
| Detached background compaction protects chat latency | `auto-memory.ts`; T5 R5 | Preserve as a TakiAgent product policy, while marking it as a local adaptation rather than a DSH default. |
| Provider-neutral estimator and post-hoc usage calibration | `memory/token-estimator.ts`, `window-calibrator.ts` | Preserve the CJK/image/tool-aware estimator; add request-envelope accounting. |
| Tool calls/results are persisted with replay-safe names-only call data | `turn-mapping.ts`, backend agent-runtime spec | Preserve privacy and anti-hallucination constraints. |

### 1.3 Current defects and weak choices

1. **The 200-row fetch is a real source boundary, not merely a backstop.** `conversation-store.ts:137` asks SQLite for
   only the newest `REPLAY_WINDOW` rows before summary substitution. A summary whose coverage is more than 200 rows old
   therefore disappears even when the token budget has room. The same cap is applied again by `selectWindow`, so the
   token design cannot reach older rows (`context-window.ts:28-30`).
2. **Retention is row-count based.** `compaction-pass.ts:152-158` keeps the newest `keepMessages` rows (default 40),
   even though pressure and replay are measured in estimator units. Tool calls and results each consume rows, and a raw
   cut can split a tool pair.
3. **Compaction construction is owned by the Legacy Memory subsystem.** `runtime-selector.ts:17-25` does not construct
   that subsystem in canonical Local mode; `runtime-composition.ts:31-48` consequently returns no `autoMemory` and no
   compactor. The summary reader remains live, so canonical mode can replay an old summary but cannot advance it.
4. **There is no durable compaction operation record.** The summary table stores only `(character_id, through_seq,
   text, updated_at)` (`summary-repo.ts`, migration 012). Counts-only logs cannot reconstruct an interrupted attempt,
   selected range, failure stage, or whether a retry made progress.
5. **There is no compare-and-swap/revision check.** A detached summary may be generated while rows are appended or a
   summary changes. The current watermark discipline avoids half-written state, but it cannot distinguish a valid append
   after the selected range from a stale result after a relevant deletion or competing operation.
6. **Pressure is history-only.** `estimatedTokens()` prices the projected history and summary, while stable
   instructions, tool schemas, and response reserve are represented only indirectly by `historyRatio`. A full request
   pressure contract is absent.
7. **Summary validation is too weak.** Only empty text is rejected. There is no provider truncation check, strict-shrink
   check, protected-content check, or quality feedback/retry (`compaction-pass.ts:188-204`). The summary is intentionally
   not hard-truncated, which remains the correct quality policy; the missing guard is validation, not a new output cap.
8. **Compaction input loses structured tool-result content.** `renderTranscript()` uses `entry.content` only, while
   payloads live in `parts` (`render-transcript.ts:8-10`, `turn-mapping.ts:58-81`). This is privacy-safe but can lose a
   fact that was never restated in assistant prose.
9. **The stored-argument fold is effectively inert for new rows.** Persistence removes raw arguments and replay emits
   `{}` (`turn-mapping.ts:43-48,94-105`), so the fold does not materially reduce the request estimate. Its current test
   checks the copy, not a lower replay cost.
10. **Failure retry has no cooldown or durable attempt budget.** A still-overfull view can invoke a failed utility model
    after every completed turn (`auto-memory.ts:113-121`), creating repeated cost and noisy diagnostics.

These are implementation targets, not reasons to discard the existing Replay View or Character timeline model.

## 2. DSH reference and transfer decision

The checked reference is DSH `0.1.1-rc.2` (`references/deepseek-harness-master/package.json:2-3`). The useful part is its
boundary design, not its package names or defaults.

| DSH mechanism (verified source) | What it solves | TakiAgent decision |
| --- | --- | --- |
| Separate `CompactionEngine` with `compactIfNeeded`, `compactNow`, `compactRegion` (`packages/compaction/compaction/src/index.ts:87-169`) | Keeps compaction out of the privileged agent loop and gives all triggers one operation path | **Adopt the boundary.** Implement a Core-owned coordinator; reserve manual operation for a later slice. |
| Separate Token Meter service (`packages/llm/token-meter/README.md:5-20`) | One immutable measurement is reused by pressure, range selection, and projections | **Adopt and adapt.** Use TakiAgent's estimator and provider usage anchors, not DSH char/4. |
| Pressure listener plus canonical overflow listener (`compaction-basic/src/index.ts:132-223`) | Proactive maintenance and reactive recovery | **Adopt pressure. Preserve T5 R2 overflow behavior initially.** Request-local overflow recovery may be enabled only after SDK evidence proves tool effects are not replayed. |
| Model-free tool-result pruner, then remeasure (`compaction-basic/src/index.ts:278-325`; pruner package) | Avoids an auxiliary model call when deterministic reduction is sufficient | **Adopt and generalize the order.** Tool-result pruning is one `ContextReducer`; TakiAgent applies the same deterministic-reduce/remeasure contract to other safely reducible request components. |
| Token-priced head range with tool-pair balance (`compaction-basic/src/region.ts:90-133,314-335`) | Prevents orphan calls/results at replacement boundaries | **Adopt.** Make pair balance a shared predicate for replay, retirement, and recovery. |
| Prefix replay + final compaction instruction (`compaction-basic/src/region.ts:488-513`; `summarizer.ts:72-164`) | Preserves provider cacheable prefix for the auxiliary call | **Optional optimization.** Use only for same-route calls after privacy and real-provider measurements; correctness must not depend on it. |
| Empty/aborted/truncated/non-shrinking summary rejection (`summarizer.ts:164-224`) | Prevents silent corruption and compaction loops | **Adopt.** Keep no hard summary cap, but reject invalid or non-shrinking output and retain the previous checkpoint. |
| `compaction/start -> summary -> replacement -> end`, durable lock and generation (`compaction/README.md:39-53`; `region.ts:183-253,426-478`) | Makes async work crash-detectable and retries require durable progress | **Adapt.** Store bounded lifecycle evidence and a durable per-Character lock, while keeping `SummaryRepo`/Replay View as the model projection rather than creating DSH surface rows. |
| Provider usage anchor plus signed replay deltas (`token-meter/src/index.ts:100-147,221-269`) | Corrects a heuristic without requiring provider tokenizers | **Adopt and adapt.** Include instructions/tools and retain TakiAgent's CJK/image-aware estimator. |
| Manual `compactNow()` while idle (`compaction/compaction/src/index.ts:119-143`) | Explicit operator maintenance | **Defer.** Reserve the coordinator method, but do not add a user command or UI obligation to this task's first implementation. |

### 2.1 DSH mechanisms explicitly rejected

- Cordis's plugin tree and DSH's session/surface storage model: TakiAgent already has Core DI, a Character timeline,
  `SummaryRepo`, Run/Event authority, and memory-provider selection. A second substrate would create competing history
  authorities.
- DSH's fixed char/4 estimator: it underprices CJK and JSON-heavy content; TakiAgent's existing estimator is more
  appropriate (`packages/core/src/memory/token-estimator.ts:10-66`).
- DSH's coding-assistant section template: TakiAgent needs companion continuity, commitments, open threads, emotional
  context, and absolute dates, as recorded in Batch 7 and `research/re-compaction-prompts.md`.
- Persisting complete `rawOutput`, reasoning, or tool blocks: this conflicts with the bounded privacy/observability
  contracts in `.trellis/spec/backend/observability-projection.md` and logging guidelines.
- DSH's broad overflow retry on the current outer attempt: TakiAgent's `chat-agent.ts` deliberately retries only a
  clean, side-effect-free attempt (`chat-agent.ts:178-208`). Replaying a completed tool step is unsafe.
- A hard `maxTokens` summary cap: DSH treats a length finish as failure, and prior TakiAgent research records that a
  silent cap poisons rolling summaries. Quality validation and a retry policy are safer than clipping.

## 3. Decision classification

### 3.1 TakiAgent-specific requirements to retain

- `characterId` is the durable scope for relationship continuity, persona, and Character memory. It is not replaced by a
  compaction/session identifier.
- One continuous user-facing relationship timeline remains the source of scroll-back. Compaction is invisible there.
- A summary is a projection-only head for the model, never a synthetic user message in the Timeline.
- Companion summaries prioritize promises, open threads, the user's situation, shared decisions, emotional beats, and
  exact words when they matter; permanent identity facts remain governed by Memory.
- Pre-retirement Memory flush protects long-term continuity. The flush is a side effect supplied by the active memory
  provider, not the owner of compaction state.
- Detached post-turn work does not block chat. A concurrent turn reads the last committed summary; a later turn sees the
  replacement.
- Existing privacy, governance, Host, Tool, Character-isolation, and Run/Event rules remain authoritative.

### 3.2 General mechanisms to adopt or adapt

- Token-first context budgeting; provider usage is a calibration anchor, with a deterministic estimator fallback.
- One immutable request/context measurement shared by trigger, replay projection, compaction selection, and observability.
- Deterministic Context Reduction before an auxiliary summary call, followed by immediate remeasurement. DSH's
  tool-result pruner is the proven first reducer; TakiAgent's pipeline also admits bounded non-tool reducers.
- Balanced tool-call/result boundaries, including a single oversized unit rule that is explicit and observable.
- Append-only evidence plus a recomputed, replaceable Replay View.
- A separate Utility Slot summarizer, with same-route cache-shaped input as an optimization only.
- Durable operation identity, per-Character lock, snapshot/revision checks, idempotency, cancellation, restart recovery,
  and a terminal failure reason.
- Empty, provider-truncated, protected-content, and non-shrinking summary guards. Failed attempts leave the old summary
  authoritative.
- Explicit pressure and overflow operation reasons, while preserving the existing T5 R2 overflow contract until a
  request-local safe retry seam is proven.

### 3.3 Current defects to remove

- Applying a fixed row cap before token selection or summary substitution.
- Treating `keepMessages` as the normal retention capacity instead of a possible minimum-tail safety floor.
- Constructing the compactor only inside Legacy Memory.
- Relying on process-local logs and in-memory serialization as the only lifecycle/recovery evidence.
- Advancing a summary without a source/revision compare-and-swap.
- Measuring only history while calling the result a complete request pressure value.
- Accepting an empty/non-shrinking/truncated summary as a successful operation.

## 4. Target architecture

```text
Core composition root
  ├─ TimelineRepo (append-only Character relationship source)
  ├─ ContextProjector
  │    ├─ full candidate loader (paged; bounded emergency row guard)
  │    ├─ token meter / provider usage anchor
  │    ├─ summary substitution
  │    ├─ ContextReductionPipeline (tool and non-tool reducers)
  │    ├─ balanced tool-pair selection
  │    └─ ModelMessage request projection
  ├─ CompactionCoordinator (independent of Memory Provider)
  │    ├─ pressure trigger
  │    ├─ detached post-turn operation
  │    ├─ optional future overflow/manual entry points
  │    ├─ snapshot + revision/CAS
  │    ├─ summary quality validation
  │    └─ durable lifecycle/lock evidence
  ├─ SummaryRepo (current projection checkpoint only)
  ├─ MemoryFlushPort (optional provider adapter)
  │    ├─ Legacy Markdown adapter
  │    ├─ Canonical Local adapter
  │    └─ future Hindsight adapter
  └─ Utility Slot (one shared background model route)
```

There is still one Run/Turn/ToolLoop data flow. Compaction is a context-management operation invoked by that runtime,
not a second Agent loop, session authority, or Timeline writer.

### 4.1 Identity and ownership

Only these identities are needed for the compaction contract:

| Field | Meaning | Is it an authority? |
| --- | --- | --- |
| `characterId` | Relationship and memory scope | Yes, existing TakiAgent scope |
| `operationId` | One compaction attempt across retries/restarts | Only for operation idempotency/evidence |
| optional `runId` / `attemptId` | Correlation to the triggering Run when one exists | No; Run remains the execution authority |
| `revision` / `throughSeq` | Monotonic source/checkpoint versions | No; versions, not new identities |

No SDK-facing `sessionId`, `taskId`, or second timeline is introduced for compaction. If a provider requires a session
field, the adapter maps it to the existing Run or Character scope.

### 4.2 Context and token contract

`ContextProjector` remains pure with respect to durable state. Its input is Timeline + SummaryRepo + the complete
captured request envelope; its output contains the ModelMessage projection and a bounded measurement:

```text
historyTokens
summaryTokens
instructionTokens
characterPromptTokens
memoryTokens
toolSchemaTokens
currentTurnTokens
dynamicContextTokens
reductionTokensSaved
projectedInputTokens
accountingQuality (provider | calibrated | estimated | unknown)
sourceRevision / summaryRevision
```

The token budget is the primary boundary. Candidate loading must be able to inspect rows older than 200 until the token
selection is complete. A row count may remain only as an explicit, bounded emergency guard for a broken estimator or a
pathological database result; hitting it emits a durable/diagnostic `backstop_hit` fact and never masquerades as normal
token exhaustion. The exact emergency default is a local policy to be selected from benchmark evidence in Slice 1,
not a new silent constant.

`projectedInputTokens` means the complete projected input sent on the next model request: system/governance
instructions, Character persona/soul prompt, Memory injection, tool/MCP schemas, rolling summary, replay history, the
current user message, and request-local dynamic context. Provider-reported `inputTokens`, when authoritative, calibrates
this whole envelope after a successful call. Cache-read tokens still occupy context capacity and are never subtracted
from pressure. Missing upstream usage remains `estimated`/`unknown`; no synthetic cache or usage values are created.

Normal proactive pressure is one ratio:

```text
projectedInputTokens >= effectiveContextWindowTokens * 0.8
```

`0.8` is a TakiAgent-local initial policy that leaves headroom for output, estimator error, and one continuing turn. It
is configurable and observable, but it is not multiplied by `historyRatio` or a second `triggerRatio`. Component token
counts remain diagnostics and reducer-selection inputs, not separate pressure authorities. Effective-window calibration
from provider usage remains valid. The post-overflow 90% shrink is a recovery calibration rule, not this trigger.

Configuration migration is explicit. The existing `TAKI_COMPACT_TRIGGER_RATIO` may remain as the compatibility input
for the new pressure ratio, but its denominator changes from the replay-history budget to the effective context window.
`TAKI_CONTEXT_HISTORY_RATIO` must not participate in the normal trigger once complete-input measurement is active; it may
remain temporarily only for legacy/unmeasured request admission and should be deprecated or removed through a tested
compatibility step rather than silently reinterpreted.

#### 4.2.1 Context Reduction contract

Context Reduction is a pure, deterministic projection stage and is not synonymous with tool-result pruning. Reducers
operate on typed candidates, preserve source evidence, report measured savings, and cannot mutate Timeline, SummaryRepo,
Memory, or completed tool effects.

Default reducible candidates include:

- older dialogue and replaceable rolling-summary material;
- Tool/MCP/search/file-read results, including bounded head/tail or semantic fact projections;
- stale or repeated state snapshots and duplicate observations;
- reasoning and bounded media descriptions that are no longer needed verbatim.

Default protected candidates include core system/security/governance instructions, Character identity/persona, current
authoritative Memory, the current user message, and recent dialogue with continuity value. A reducer may omit or fold a
protected class only through an explicit future policy change recorded in this task/spec, never by generic size pressure.

The order is:

```text
measure complete request
  -> apply deterministic reducers in stable priority order
  -> remeasure complete request
  -> below 0.8: skip model-backed compaction
  -> still at/above 0.8: schedule detached rolling compaction
  -> after durable commit: a later request uses the replacement summary
```

The turn that detects pressure continues against its admitted projection; it does not wait for the Utility Slot. An
in-flight compaction never changes the current request. Same-ToolLoop `prepareStep` reduction remains a Slice 4 safety
investigation because it must not replay or invalidate completed effects.

### 4.3 Summary and retirement transaction

After deterministic reduction and remeasurement still prove pressure, the coordinator captures a source snapshot before
generation:

```text
operationId
characterId
expected summary revision + throughSeq
timeline/surface revision and captured tail
balanced retiring range
measurement before
```

It then:

1. acquires the durable per-Character compaction lock;
2. calls `MemoryFlushPort` with an idempotency key and the retiring range;
3. builds a bounded, privacy-safe compaction transcript (including structured tool facts only through an approved
   projection);
4. runs the Utility Slot summarizer without a hard output-token cap;
5. rejects empty, provider-truncated, protected-content, or non-shrinking output;
6. re-reads the source revision and summary revision;
7. accepts concurrent appends strictly after the captured retiring range, but discards/retries a result if the selected
   range or prior summary changed;
8. commits `SummaryRepo` replacement and terminal success evidence in one short SQLite transaction using CAS;
9. releases the lock and exposes bounded counts/quality to logs and future Monitor projections.

The existing summary row remains the model projection checkpoint. Migration 032 implements a mutable
`conversation_compaction_operations` recovery/lease cursor plus append-only `conversation_compaction_events` lifecycle
rows (`started`, `flush_completed`, `summary_generated`, `committed`, `failed`, `cancelled`, `abandoned`). These tables
are coordination/evidence, not a second conversation or Run authority.

### 4.4 Memory Provider boundary

`MemoryFlushPort` is deliberately narrow:

```text
prepareRetirement({ characterId, fromSeq, throughSeq, operationId, signal })
  -> committed | not_required | retryable_failure | permanent_unavailable
```

Legacy Markdown wraps the current watermark-guarded `FlushWriter`. Canonical Local and future Hindsight supply their own
adapter when their memory contracts support the operation. If no adapter is available, the coordinator remains present
and reports an explicit deferred/unavailable result; it must not silently disappear with the Memory Provider. Unless a
provider explicitly returns `not_required`, retirement does not advance past an unfulfilled mandatory flush.

This preserves R0/R5's memory-first priority while making Compaction infrastructure provider-independent.

### 4.5 Lifecycle, restart, and cancellation

- A durable lock is acquired before expensive work and includes an owner/process generation and bounded lease/deadline.
- A duplicate trigger observes the active operation and returns without starting a second summary call.
- On restart, an unmatched operation is classified as `abandoned`/retryable after lease expiry. If the summary commit
  already landed, reconciliation is idempotent and does not create a second checkpoint.
- Cancellation stops the auxiliary model call and records `cancelled`; it never advances `throughSeq`. A previously
  committed Memory flush remains idempotent evidence.
- A stale CAS or changed retiring range discards the generated text and schedules a later retry; it never overwrites a
  newer summary.
- Retry budgets and cooldown are durable or deterministically derived from the terminal operation record, so a failed
  provider cannot be called on every ordinary turn without a policy decision.

### 4.6 Overflow and framework boundary

The current T5 R2 contract remains the compatibility baseline: a classified provider overflow recalibrates the effective
window and retries once only when the outer attempt is clean and side-effect-free; it does not invoke model-backed
compaction. DSH's request-local overflow compaction is a future option, not an implicit change. It may be enabled only
after an installed AI SDK/provider seam demonstrates that a failed model request can be retried without rerunning a
completed tool effect. Until then, a mid-turn overflow after a completed tool step remains terminal and preserves the
original provider error.

AI SDK v7's `prepareStep` can apply a precomputed message projection between tool-loop steps, and `pruneMessages` can
remove selected parts. Neither supplies persistence, token metering, summary generation, lifecycle locking, or recovery.
No new framework or dependency is justified; existing TypeScript, Zod, SQLite, AI SDK, and WS/Run infrastructure are
enough.

## 5. Compatibility and rollout

1. Keep old `SummaryRepo.get()` and projection semantics readable while adding revision metadata. Existing timelines and
   clients must replay without a migration-time rewrite.
2. Introduce the new projector behind the existing `history/windowStart/estimatedTokens` seam and retain a legacy mode
   only when no measured budget is injected.
3. Construct the coordinator in Core composition regardless of the selected Memory Provider. Provider-specific flush
   support is explicit; absent support produces a visible deferred operation rather than a missing capability.
4. Add lifecycle evidence and future Monitor mapping additively. Do not place summary text, prompts, credentials, raw
   tool payloads, or provider exceptions in Run Events or ordinary logs.
5. Keep D68-B Monitor UI blocked until complete projected-input pressure, Context Reduction, long-history behavior, durable
   lifecycle, and canonical-provider path pass the compaction acceptance gates. The UI must consume semantic facts from
   this coordinator, not invent page-local metrics.

## 6. Open decisions deliberately deferred

- The emergency source guard is currently an explicit 10,000-row backstop selected and benchmarked in Slice 1. Paging
  batch size and the guard may be tuned later from measured SQLite behavior, but neither may become an ordinary context
  boundary.
- Whether the compaction lifecycle is represented by one append-only table or an additive Run Event category for
  Run-linked operations. The invariant is one durable evidence source; no duplicate event authority.
- Whether a same-route cache-shaped summarizer is economically beneficial for each provider. Correctness is independent.
- Whether a semantic summary audit needs a second utility call. Start with deterministic guards; add an audit/retry pass
  only when real quality probes show omissions.
- The exact reducer priority/retention policies beyond the protected classes above. Slice 4 must derive them from current
  request shapes and DSH's prune/remeasure behavior, then record any TakiAgent-specific adaptation before implementation.
- Manual compaction and request-local overflow recovery remain reserved APIs, not first-slice product features.

## 7. Design acceptance mapping

| Requirement | Design section |
| --- | --- |
| Current data flow and hard-cap defect | 1.1, 1.3 |
| DSH evidence and transfer decisions | 2 |
| Taki-specific vs general vs defective classification | 3 |
| Token-first, complete projected-input pressure and Memory-independent target | 4.2-4.4 |
| General Context Reduction and asynchronous visibility | 4.2.1 |
| Snapshot/CAS, pairing, retry, cancellation, restart | 4.3, 4.5-4.6 |
| One common Run/Turn/ToolLoop | 4 |
| Future slices can revise the plan | 0, 6 |
| D68-B dependency | 5 |
