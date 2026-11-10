# Backlog budget advisor

Date: 2026-11-06. Read-only review of the current implementation and the owner's follow-up authorization.
No source changes, model calls or live database writes were performed.

## Conclusion

The proposed direction is appropriate: useful larger batches, independent per-batch budgets, and continuation inside
the existing durable tidy operation. Re-enqueueing each batch on the existing Utility Slot is enough for FIFO fairness;
an external scheduler, new durable queue or parallel mutation engine is unnecessary.

100 short memories, a 24,000-token initial-input target, 48 steps and 600 seconds per batch are reasonable candidate
defaults for this observed backlog. They are tunable product choices, not proof that every batch finishes. Validate
the same stored backlog with measured provider calls and semantic spot checks; do not infer quality from throughput.

## Required implementation details

1. **Snapshot admission at actual queue dispatch and use stable identities.**
   `tidy-coverage.ts:23-26` identifies eligibility by exact revision, while `canonical-memory-view.ts` embeds revision
   in each `cm:` reference. Freeze the initial Bank/memory identity set at the first actual Utility dispatch, not at
   submission. Recapture current revisions inside each later dispatch. Remove accepted visible identities from that
   finite set; do not repeatedly chase a memory which changes after its accepted checkpoint. Newly written memories
   and later external revisions remain eligible for a later operation. If admitted items became invalid or hidden,
   remove them from the finite work set without inventing a reviewed checkpoint.

2. **Keep completion and remaining work truthful.**
   The current successful path unconditionally calls `succeeded()` (`tidy-pass.ts:177`), which clears `pending`
   (`memory-tidy-review-repo.ts:52-53`). After a finite admitted backlog completes, query current remaining work.
   If later changes remain, preserve `pending` through `continued()` and return `ran`, the actual remaining count,
   and `nextAction: continue`. Existing Shared schema and Home rendering already support this shape
   (`memory-tidy-state.ts:50-53,79`). Do not label this expected new work as a provider failure or mark it clean.

3. **Account each Utility task once.**
   The current single `slot.run` returns accumulated `state.usage` (`tidy-pass.ts:90-98`). With one slot call per batch,
   return that batch's usage only. Returning the operation accumulator on every dispatch double-counts earlier batches.
   Aggregate the operation progress separately. Unknown cancelled-call usage must remain unknown.

4. **Handle stop/refused dispatch explicitly.**
   `UtilitySlot.run` returns `undefined` after stop (`utility-slot.ts:53-55`). Break the continuation loop on this
   outcome; retain accepted progress and unresolved pending work. The current `stop()` only closes admission and
   awaits the active task (`utility-slot.ts:78`), so a 600-second batch can extend orderly Core shutdown to ten minutes.
   Add a narrow tidy-owned shutdown abort, compose it with the existing batch timeout, and wire it through the Local
   subsystem stop. Do not cancel unrelated Utility tasks. `main.ts:778` already waits for memory runtime stop before
   operation-owner settlement and database close; preserve that ordering.

5. **Price complete initial input and keep evidence intact.**
   Reuse `estimateToolSchemaTokens` (`agents/request-measurement.ts:81`) plus the shared token estimator. Include
   system instructions, input framing, full Blocks, record metadata/fences and whole duplicate groups. Select with
   short handles rather than pricing long internal canonical references. Initial input is not the whole future
   multi-step transcript: reserve room for output and tool history, and respect the selected Utility/main model's
   configured context window. A first atomic record/group or the fixed Blocks can exceed the target; do not loop on
   an empty selection, silently truncate it, or acknowledge unseen rows. Either use a documented singleton exception
   below a separate safe model ceiling, or return a specific actionable capacity failure with pending work preserved.

6. **Global Blocks still need complete preservation.**
   Larger batches reduce repeated index/model rewrite opportunities. Preserve existing full block content and permit
   at most the supported informed updates; do not create a final global rewrite based solely on the last batch's
   evidence. This optimization does not justify dropping earlier memory-index topics or unsupported user-model claims.

7. **Keep compatibility changes deliberate.**
   Legacy lacks exact checkpoints and stops after its bounded report. Apply continuous finite-backlog processing only
   when the canonical checkpoint/capture path exists. Changes to shared default knob values may still change Legacy
   call budgets; document that explicitly or supply the old defaults for its existing path. Hindsight is independently
   curated and should remain untouched.

## Minimal acceptance scenarios

- A synthetic 627-record backlog completes inside one durable operation over multiple batches, including more than
  twelve total model steps; the per-batch step cap still stops a genuinely unfinished batch.
- Two batches individually fit their deadlines while their combined duration exceeds one batch's deadline.
- A competing Utility task queued during batch one runs before batch two; batch two sees its fresh relevant writes.
- A record is externally modified both before its batch and after its accepted review. The latest visible revision
  is reviewed once for the admitted identity; a later unseen revision stays pending without an endless operation.
- A new memory arrives during the operation: it does not extend the finite admitted backlog, and the successful
  result preserves the actual remaining count plus automatic pending eligibility below the ordinary threshold.
- Mixed short/long rows, a duplicate group crossing the row cap, fixed-block overhead, and an oversized first group
  never lead to an empty-success report, lost evidence or silently skipped checkpoint.
- Stop after an accepted batch and during model generation: no new batch starts, pending work and committed edits
  survive, the operation owner settles before SQLite closes, and unrelated queued work is not replayed.
- Two known-usage batches produce Utility totals equal to the sum once; a cancelled batch keeps unknown usage honest.
- Existing correction, same-step unknown-write fence, authority switch, restart/no-replay and Legacy tests remain green.

## Remaining limits

This advisor reviewed wiring and contracts, not an implemented patch or model-output quality. No release/owner
acceptance is implied. A cooperative abort still cannot forcibly terminate an arbitrary non-cooperative provider.
