# Compaction Harness design brief

This is the compact execution context injected into implementation and check agents. The two full research reports remain
the source of baseline detail; this brief also records the checked Slice 1/2 state and the approved Slice 3/4 target so a
later agent does not act on superseded planning.

## Current TakiAgent facts

- `conversation-store.ts` computes one Replay View projection for `history`, `windowStart`, and `estimatedTokens`. In
  measured production mode, Slice 1 now pages through `replay-source-loader.ts` until the token candidate is complete,
  a summary bridge is reached, history ends, or the explicit 10,000-row emergency backstop is hit. The old 200-row path
  remains legacy no-budget compatibility only (`conversation-store.ts:15-16,132-157,173-223`;
  `replay-source-loader.ts:11-21,44-95`).
- The current Slice 2 compactor still triggers from replay-history pressure strictly above
  `historyBudget * triggerRatio` and therefore does not yet implement the approved complete-input pressure contract
  (`compaction-pass.ts:100-106,143-155`). It retains a DSH-grounded `0.16` token-priced tail plus the explicit
  `keepMessages` minimum-tail guard, flushes first, generates one Utility Slot summary, and advances `throughSeq` only
  after non-empty output (`compaction-pass.ts:146-235`; `retirement-selector.ts:11-29`). This trigger is a remaining
  Slice 4 defect, not the target meaning of `0.8`.
- The user turn is never blocked: `createAutoMemory` runs detached and serializes maintenance per Character
  (`memory/auto-memory.ts:73-121`).
- Migration 012 stores one overwritable summary row per Character: `through_seq`, text, timestamp; it is not a Timeline
  row (`db/migrations/012-conversation-summary.ts`, `db/summary-repo.ts`).
- Slice 2 constructs the Utility Slot and detached Compaction maintenance from Core runtime composition for both Legacy
  and canonical Local. Canonical activation retires Legacy maintenance and rebinds flush to explicit `not_required`;
  Hindsight selection still fails explicitly because that authority runtime is not installed
  (`memory/runtime-composition.ts:31-60,71-99`; `memory/memory-flush-port.ts:18-22,44-50`).
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
2. No durable compaction lifecycle/lock/restart evidence or source revision CAS (Slice 3).
3. History-budget pressure is still used as the trigger instead of complete projected input (Slice 4).
4. Deterministic reduction is still tool/history-specific rather than one general measured Context Reduction pipeline
   with tool and non-tool reducers (Slice 4).
5. Empty-only summary validation; no strict shrink, truncation, protected-content, or quality guard (Slice 4).
6. Structured tool-result payloads are absent from `renderTranscript`; argument folding is inert for names-only rows.
7. Failed utility calls can be retried on every trigger without a durable cooldown/budget.

## DSH mechanisms verified and transfer decisions

DSH `0.1.1-rc.2` separates a `CompactionEngine`, Token Meter, optional model-free tool-result pruner, and manual command
(`references/deepseek-harness-master/packages/compaction/README.md:5-25`). The basic provider uses pressure and canonical
overflow listeners, token-priced retention, balanced tool-pair ranges, direct auxiliary summarization, and explicit
lifecycle records (`compaction-basic/src/index.ts:132-223`; `compaction-basic/src/region.ts:90-133,183-253,314-383`).
Its Token Meter prefers a provider-usage anchor and applies immutable replay deltas (`packages/llm/token-meter/src/index.ts:100-147,221-269`).

Adopt/adapt:

- independent compaction coordinator and Token Meter;
- deterministic Context Reduction -> remeasure -> summarize, generalizing DSH's tool-result pruner into one reducer;
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
- Define normal proactive pressure as
  `projectedInputTokens >= effectiveContextWindowTokens * 0.8`. `projectedInputTokens` covers the complete input envelope:
  system/governance instructions, Character persona/soul prompt, Memory, tool/MCP schemas, summary, replay history, the
  current message, and request-local dynamic context. Cache-read tokens still occupy context capacity. The overflow
  recovery 90% shrink remains calibration, not the trigger.
- `TAKI_COMPACT_TRIGGER_RATIO` may remain the compatibility input for the new ratio, but its denominator changes to the
  effective window. `TAKI_CONTEXT_HISTORY_RATIO` is not a normal trigger authority after Slice 4; any temporary
  legacy/unmeasured admission role must be explicit and tested.
- Treat Context Reduction as a general projection stage. Tool/MCP/search/file results, old dialogue/summary material,
  repeated snapshots/observations, reasoning, and bounded media descriptions may be reduced by typed policies; core
  governance, Character identity, authoritative Memory, the current message, and recent continuity are protected.

## Target contract

```text
Complete input envelope + TimelineRepo + SummaryRepo
             -> pure ContextProjector + ContextReductionPipeline
             -> ModelMessage Replay View + complete projected-input measurement
CompactionCoordinator -> MemoryFlushPort + Utility Slot + SummaryRepo CAS
                      -> durable lifecycle evidence and restart-safe terminal state
```

Ordinary selection is token-first. A row cap is only an explicit emergency estimator/database guard and emits a
`backstop_hit` fact. The target order is complete-input measurement -> deterministic reduction -> remeasurement -> skip
the Utility Slot call when below `0.8`, otherwise detached rolling compaction -> durable commit -> later-request summary
visibility. Summary replacement remains projection-only; the Timeline is never rewritten. The coordinator is constructed
independently of Legacy/canonical/future Hindsight Memory selection. D68-B Monitor UI waits for this contract.

## Planned slices

1. **Complete:** token-first Replay View/source loading with balanced units and the explicit 10,000-row backstop.
2. **Complete:** provider-independent coordinator composition, one Utility Slot, and MemoryFlushPort.
3. **Complete:** durable summary revision/CAS, per-Character fenced lease, append-only lifecycle evidence,
   cancellation/idempotency, atomic commit, and restart recovery. Slice 3 did not add reducers or change the trigger.
4. **Pending:** complete projected-input pressure, general Context Reduction and remeasurement, summary
   quality/retry/cooldown, same-ToolLoop safety decision, and end-to-end hardening.

Each slice has one implementation agent and one check agent, targets 2-3 context windows, and may update later slices
only after recording evidence in task artifacts.
