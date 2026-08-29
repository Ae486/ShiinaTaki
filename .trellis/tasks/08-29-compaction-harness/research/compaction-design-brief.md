# Compaction Harness design brief

This is a compact execution-context summary of the two full research reports in this directory. The full reports remain
the source of detail; every item below points to a live source or an archived decision.

## Current TakiAgent facts

- `conversation-store.ts` computes one Replay View closure for `history`, `windowStart`, and `estimatedTokens`
  (`packages/core/src/agents/conversation-store.ts:98-124`). The order is timeline load -> summary substitution ->
  pressure folds -> token cut -> ModelMessage projection.
- The first load is `latestAscending(characterId, REPLAY_WINDOW)` with `REPLAY_WINDOW = 200`
  (`conversation-store.ts:19-21,137-150`). This happens before token selection, so a summary older than 200 loaded rows
  disappears even when the token budget has room. `selectWindow` applies the cap again (`context-window.ts:28-30`).
- The current compactor triggers when projected history estimate is strictly above `budget * triggerRatio` (default
  `0.8`), retains a DSH-grounded `0.16` token-priced tail plus the explicit `keepMessages` minimum-tail guard (default
  `40`), flushes first, generates one Utility Slot summary, and advances `throughSeq` only after non-empty output
  (`compaction-pass.ts:125-224`, `retirement-selector.ts:23-64`, `context-config.ts:49-73`).
- The user turn is never blocked: `createAutoMemory` runs detached and serializes maintenance per Character
  (`memory/auto-memory.ts:73-121`).
- Migration 012 stores one overwritable summary row per Character: `through_seq`, text, timestamp; it is not a Timeline
  row (`db/migrations/012-conversation-summary.ts`, `db/summary-repo.ts`).
- Canonical Local boot does not construct Legacy Memory (`memory/runtime-selector.ts:17-25`), and
  `runtime-composition.ts` exposes `autoMemory` only from the Legacy object (`memory/runtime-composition.ts:31-48`).
  Therefore the summary reader remains available but the compaction writer disappears in canonical mode.
- TakiAgent's estimator is CJK/image/tool-aware (`memory/token-estimator.ts:10-66`). Provider usage calibrates it, but
  the current replay estimate does not fully price instructions, tool schemas, and response reserve.
- Current overflow behavior is ratified T5 R2: recalibrate the effective window and retry once only for a clean,
  side-effect-free outer attempt (`agents/chat-agent.ts:178-208`); overflow does not silently become model-backed
  compaction.

## Current strengths

1. Append-only Character relationship history and projection-only context loss (ADR 0005/0008).
2. One shared boundary prevents replay/flush drift.
3. Flush-before-retire and success-only watermark advancement prevent silent memory loss.
4. Detached maintenance protects chat latency.
5. Summary and tool folds are idempotent, copy-on-write, and privacy-aware.

## Current defects to address

1. The pre-token 200-row source cliff.
2. Row-count retention and possible tool-pair splits (resolved by Slice 1; remaining lifecycle/quality work is open).
3. Legacy-only compactor construction.
4. No durable compaction lifecycle/lock/restart evidence or source revision CAS.
5. History-only pressure accounting.
6. Empty-only summary validation; no strict shrink, truncation, protected-content, or quality guard.
7. Structured tool-result payloads are absent from `renderTranscript`; argument folding is inert for names-only rows.
8. Failed utility calls can be retried on every trigger without a durable cooldown/budget.

## DSH mechanisms verified and transfer decisions

DSH `0.1.1-rc.2` separates a `CompactionEngine`, Token Meter, optional model-free tool-result pruner, and manual command
(`references/deepseek-harness-master/packages/compaction/README.md:5-25`). The basic provider uses pressure and canonical
overflow listeners, token-priced retention, balanced tool-pair ranges, direct auxiliary summarization, and explicit
lifecycle records (`compaction-basic/src/index.ts:132-223`; `compaction-basic/src/region.ts:90-133,183-253,314-383`).
Its Token Meter prefers a provider-usage anchor and applies immutable replay deltas (`packages/llm/token-meter/src/index.ts:100-147,221-269`).

Adopt/adapt:

- independent compaction coordinator and Token Meter;
- prune -> remeasure -> summarize;
- token-priced balanced ranges;
- durable operation identity, lock, lifecycle, revision/progress proof and restart classification;
- empty/truncated/non-shrinking summary rejection;
- optional same-route cache-shaped summarizer request;
- pressure plus a future request-local overflow path.

Reject/defer:

- Cordis/plugin/session-surface substrate (would add a second authority);
- fixed char/4 estimator;
- coding-agent summary headings;
- raw summarizer output/reasoning/tool payload persistence;
- broad outer-loop overflow retry, until the SDK proves request-local side-effect safety;
- hard summary output caps.

## TakiAgent-specific decisions

- Keep `characterId` as the relationship/memory scope. A compaction `operationId` is only an operation idempotency key;
  optional `runId`/`attemptId` are correlation fields, not new authorities. Revisions are versions, not IDs.
- Keep one Run/Turn/ToolLoop and one Timeline. Compaction is a context operation, not a second session or loop.
- Keep companion-focused, first-person, absolute-date summary semantics from Batch 7 and `re-compaction-prompts.md`.
- Keep detached post-turn operation and pre-retirement memory flush. Make flush a narrow provider adapter; canonical or
  future Hindsight absence must be explicit (`not_required`, retryable, or unavailable), never silent disappearance.
- Keep T5 R2 overflow semantics until a separately tested request-local recovery seam is proven.

## Target contract

```text
TimelineRepo -> pure ContextProjector (paged candidates, token meter, folds, balanced cuts)
             -> ModelMessage Replay View + bounded ContextMeasurement
CompactionCoordinator -> MemoryFlushPort + Utility Slot + SummaryRepo CAS
                      -> durable lifecycle evidence and restart-safe terminal state
```

Ordinary selection is token-first. A row cap is only an explicit emergency estimator/database guard and emits a
`backstop_hit` fact. Summary replacement remains projection-only; the Timeline is never rewritten. The coordinator is
constructed for Legacy, canonical Local, and future Hindsight modes. D68-B Monitor UI waits for this contract.

## Planned slices

1. Token-first Replay View/source loading and full request measurement.
2. Provider-independent coordinator composition and MemoryFlushPort.
3. Durable summary revision/CAS, lock, lifecycle log, and restart recovery.
4. DSH-informed pruning, summary quality/retry/cooldown, and end-to-end hardening.

Each slice has one implementation agent and one check agent, targets 2-3 context windows, and may update later slices
only after recording evidence in task artifacts.
