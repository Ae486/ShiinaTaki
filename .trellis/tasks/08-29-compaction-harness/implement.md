# Compaction Harness implementation plan

## Execution boundary

This plan follows the reviewed design in `design.md`. Slices 1-3 are complete; Slice 4 remains. Later slices
may update this file when source evidence, provider behavior, or test results justify a better design. A plan update must
preserve the task's global invariants and be recorded before dispatching the next slice.

The task is a Core harness change. D68-B Monitor UI remains blocked until the compaction acceptance gate passes; the UI
must consume the resulting semantic context facts rather than invent a page-local workaround.

## Execution status

| Slice | Status | Evidence |
| --- | --- | --- |
| Slice 1 | Implemented and formally checked on 2026-08-29 | Core full suite: 284 files, 1789 passed, 1 skipped; workspace typecheck and root lint passed; isolated Core boot smoke passed; task validation and `git diff --check` passed apart from the pre-existing parent-task CRLF warning; deterministic 10,000-row source probes stayed below 100 ms and surfaced the explicit backstop. |
| Slice 2 | Implemented and formally checked on 2026-08-29 | Provider-independent Core composition now constructs one Utility Slot and one detached per-Character maintenance chain for Legacy and canonical Local; all Legacy episodic/flush/tidy/compaction calls share the Utility Slot queue; typed `MemoryFlushPort` outcomes and activation retirement are covered. Focused tests: 70 passed. Core full suite: 286 files, 1804 passed, 1 skipped. Workspace typecheck, root lint, isolated Core boot, task validation, and `git diff --check` passed. |
| Slice 3 | Implemented and formally checked on 2026-08-30 | Migration 032 adds revisioned summary checkpoints, one fenced per-Character operation cursor, and immutable lifecycle evidence. Summary replacement, operation commit, and terminal evidence are atomic. Focused check: 99 passed; Core full suite: 288 files, 1825 passed, 1 skipped; Core typecheck, root lint, task validation, `git diff --check`, and isolated Core boot through migrations 1-32 passed. |
| Slice 4 | Pending | Complete request pressure, general Context Reduction, summary quality, and recovery hardening. |

## Dispatch protocol

Before each implementation or check dispatch, the main session must:

1. Verify `cwd`, branch, worktree list, `HEAD`, dirty paths, and
   `python ./.trellis/scripts/task.py current --source`.
2. Set the session task pointer to this exact task before dispatch. Every child prompt starts with:
   `Active task: .trellis/tasks/08-29-compaction-harness`.
3. Use English prompts, explicitly state that YCE is disabled and must not be used, require `jbcontext` for semantic
   search, and forbid secondary agent dispatch, commit, push, reset, rebase, or archive.
4. Dispatch at most one `trellis-implement` and one `trellis-check` for each slice. All remaining implementation and
   check agents use `xhigh` effort. A healthy child is not interrupted; wait in the established ten-minute cadence.
5. Keep ownership at slice boundaries. Do not split a slice into repetitive prompts unless measured scope exceeds the
   two-to-three-context-window target and the plan is updated first.

The two completed research reports are the approved explore output. A new explore is optional only if an implementation
slice discovers an unresolved installed-API or storage fact; it must write a focused artifact under `research/` before
implementation continues.

## Slice 1 — Token-first Replay View and source loading

**Target size:** 2–3 context windows.  
**Primary ownership:** `conversation-store` / `context-window` / token measurement seam and their tests.  
**Dependency:** none; this is the foundation for every later slice.

### Scope

- Replace the pre-selection `latestAscending(characterId, REPLAY_WINDOW)` source cliff with a context candidate loader that
  can inspect rows older than 200. Keep one `selectView` closure for `history`, `windowStart`, and `estimatedTokens`.
- Make token pressure the ordinary boundary. Retain a bounded row guard only as an explicit estimator/database safety
  backstop; a hit must be observable and must not look like normal token exhaustion.
- Preserve the summary-head projection, pressure fold order, leading-tool validity, Character isolation, image privacy,
  and append-only Timeline behavior.
- Extend the measurement contract to distinguish history/summary/fold savings from stable instruction/tool-schema and
  response-reserve costs. Reuse provider usage/calibrator facts when available; fall back to the existing
  CJK/image/tool-aware estimator without inventing usage or cache values.
- Make the retirement candidate/range calculation token-aware and tool-pair-aware at the pure layer, while keeping the
  current summary writer unchanged until Slice 2/3.

### Required tests

- More than 200 unretired rows: summary remains visible and token selection reaches older rows.
- Mixed CJK, multimodal references, tool calls/results, oversized tool result, and one oversized newest message.
- Exact replay/windowStart/estimate equality from one projection call; repeated renders are byte-identical and do not
  mutate Timeline rows.
- Emergency row guard emits an explicit fact and does not silently become the ordinary boundary.
- Balanced tool-call/result cuts and no leading orphan tool result.
- Legacy no-budget behavior remains intentionally compatible where the fallback is still supported.

### Exit gate

Core focused tests, typecheck, lint, and a long-history deterministic harness pass. No summary or Memory Provider wiring is
changed in this slice unless required to keep the single projection boundary coherent.

### Rollback point

The source loader and pure selector can be reverted independently while retaining the old summary schema and Timeline.
Do not revert the append-only or Character-isolation contracts.

## Slice 2 — Provider-independent Compaction composition

**Target size:** 2–3 context windows.  
**Primary ownership:** Compaction coordinator construction, maintenance composition, and Memory flush adapter.  
**Dependency:** Slice 1's projection/measurement contract.

### Scope

- Move Compaction construction out of the Legacy-only `MemorySubsystem` ownership boundary. Core composition must create
  one coordinator for Legacy Markdown, canonical Local, and future Hindsight selections.
- Introduce a narrow `MemoryFlushPort`/adapter. The Legacy adapter wraps the existing watermark-guarded `FlushWriter`;
  canonical/future providers return an explicit `not_required`, `retryable_failure`, or `permanent_unavailable` result
  according to their verified contract.
- Keep one Utility Slot and one per-Character maintenance serialization path. Do not create a second Agent loop, Session,
  Timeline, or provider-specific compactor.
- Preserve detached post-turn behavior and make an unavailable Memory flush explicit and retryable/deferred rather than
  silently removing Compaction from the selected runtime.
- Keep pressure trigger and current T5 R2 clean-attempt overflow behavior; do not enable DSH-style mid-turn summary
  recovery in this slice.

### Required tests

- Legacy startup constructs and runs Compaction.
- Canonical Local startup still exposes a Compaction trigger and does not silently return `undefined`.
- Provider switch/activation does not leave a stale Legacy writer reachable.
- Flush occurs before retirement, is idempotent by operation/range, and an unavailable adapter leaves the old summary
  authoritative with a bounded diagnostic.
- Duplicate triggers serialize per Character and never invoke two summary calls concurrently.
- Normal chat, tool execution, Character isolation, and detached latency behavior remain green.

### Exit gate

All three startup paths have explicit behavior; canonical mode no longer loses the compactor by construction. The single
Utility Slot and maintenance chain are proven by tests and a boot smoke.

### Rollback point

Composition changes can fall back to the old Legacy wiring behind an explicit compatibility adapter, but a provider mode
must never silently claim Compaction support when its flush contract is unavailable.

### Execution notes — 2026-08-29

- Core composition owns Compaction and the only production `AutoMemory` serialization chain. Legacy provider work is a
  maintenance pass inside that chain, and every Legacy model call enters the one process-wide Utility Slot queue;
  canonical Local skips provider maintenance but still runs the same Compaction pass.
- `MemoryFlushPort` returns `success`, `not_required`, `retryable_failure`, or `permanent_unavailable`. Legacy reuses the
  existing `memory_auto.last_flush_seq` plus `FlushWriter`; canonical Local returns the verified no-flush-required result;
  the unavailable Hindsight runtime returns a bounded permanent-unavailable result and startup remains fail-closed.
- In-process canonical activation drains Legacy flush work through the existing authority fence, clears the selected
  Legacy subsystem reference, removes Legacy maintenance from the chain, and switches the flush binding before later
  compaction attempts. Failed or unavailable flush outcomes leave the prior summary authoritative.
- Verification completed: 70 focused tests; Core full suite 286 files / 1804 passed / 1 skipped; `pnpm -r typecheck`;
  root `pnpm lint`; task context validation; `git diff --check`; and a real isolated Core boot through `ws server
  listening` followed by clean SIGINT shutdown. The first boot probe intentionally had no provider configuration and
  failed at the existing fail-fast config boundary; the isolated placeholder-provider rerun passed without external calls.

## Slice 3 — Durable summary transaction and recovery evidence

**Target size:** 2–3 context windows.  
**Primary ownership:** summary revision/CAS, durable operation lifecycle, lock and restart recovery.  
**Dependency:** Slice 2's coordinator and flush port.

### Scope

- Extend the summary checkpoint with a monotonic revision and operation/source boundary metadata without changing its
  projection-only meaning or exposing text to the user scroll-back.
- Add one Core-owned compaction repository over a mutable operation/lease cursor and append-only immutable lifecycle
  events, with operation id, Character scope, optional Run/Attempt correlation, reason, selected range, measurements,
  provider/model route, terminal state, and bounded failure class.
- Add a durable per-Character lock/lease and idempotency rule. The operation record is evidence/coordination only; it is
  not a second Run or conversation authority.
- Re-read source and summary revisions before commit. Allow appends strictly after the captured retiring range; reject
  stale ranges or competing summaries. Commit summary replacement and terminal success evidence in one short SQLite
  transaction.
- Define restart classification (`abandoned`/retryable after lease expiry), cancellation, duplicate trigger, and no-double-
  advancement behavior.
- Keep Slice 3 independent of the pending pressure/reducer policy: it may persist bounded before/after measurements, but
  it must not implement the `0.8` trigger, reducer ordering, summary-quality policy, or same-ToolLoop projection changes.

### Required tests

- Concurrent append during summary generation: valid later append survives; stale covered-range change cannot overwrite.
- Competing/duplicate operation and CAS conflict: exactly one summary advancement.
- Restart with open, committed, failed, cancelled, and expired operations; recovery is deterministic and idempotent.
- Cancellation never advances `throughSeq`; already committed flush remains safe.
- Schema reopen/migration tests, strict bounds, Character isolation, and no raw prompt/secret/tool payload in evidence.
- Replay equality after summary replacement and unchanged Timeline scroll-back.

### Exit gate

Every asynchronous compaction attempt is crash-detectable, retryable according to durable evidence, and cannot overwrite
a newer source/checkpoint. The monitor can later project bounded semantic facts without reading Pino text.

### Rollback point

The evidence table and revision columns are additive. If the new coordinator cannot commit atomically, leave the old
summary authoritative and mark the operation deferred; never perform a best-effort partial watermark update.

### Execution notes — 2026-08-30

- `conversation_summary` now carries a monotonic revision plus operation/source metadata. The Timeline remains append-only
  and the summary remains a model-only projection checkpoint.
- `conversation_compaction_operations` is the mutable recovery cursor and enforces one open lease per Character;
  `conversation_compaction_events` is append-only bounded evidence. Stable operation identity plus an increasing fence
  makes duplicate/restarted attempts idempotent without adding a Run or Session authority.
- The selected range is contiguous with existing summary coverage. Its digest is rechecked after generation, so later
  tail appends survive while edits/deletes inside the retiring range fail as `SOURCE_STALE`. Summary revision/coverage
  conflicts fail as `SUMMARY_CONFLICT`.
- Summary replacement, operation terminalization, and the committed event share one synchronous SQLite transaction.
  Cancellation never advances coverage; expired open work becomes `abandoned/LEASE_EXPIRED` through bounded idempotent
  reconciliation.
- Formal check fixed stale-attempt controller ownership by binding controllers to the lease fence, strengthened range and
  operation-ID source constraints, made `summary_generated` lease-check/event append atomic, and removed raw provider
  exception text from Utility Slot logs.
- Verification: 99 focused check tests; Core full suite 288 files / 1825 passed / 1 skipped; Core typecheck; root lint;
  task validation; `git diff --check`; and isolated Core boot applying migrations 1-32 through `ws server listening`.
  Workspace typecheck was concurrently blocked only by an unrelated Desktop/UIUX missing `icon-button.tsx`; Core,
  Shared, CLI, and E2E typechecks passed.

## Slice 4 — Complete request pressure, Context Reduction, and quality hardening

**Target size:** 2–3 context windows.  
**Primary ownership:** complete projected-input pressure, deterministic Context Reduction, remeasurement, summary
validation, retry/cooldown, and the end-to-end regression harness.
**Dependency:** Slices 1–3.

### Scope

- Measure the complete projected next-request input, including system/governance instructions, Character prompt, Memory,
  tool/MCP schemas, summary, history, current message, and request-local dynamic context. Use authoritative upstream
  `inputTokens` to calibrate the envelope when available; cache-read tokens remain part of pressure.
- Trigger normal proactive handling at `projectedInputTokens >= effectiveContextWindowTokens * 0.8`. Record `0.8` as
  configurable TakiAgent policy. Do not multiply it by `historyRatio`/`triggerRatio`; do not confuse the post-overflow
  90% effective-window shrink with the proactive trigger.
- Migrate configuration deliberately: preserve `TAKI_COMPACT_TRIGGER_RATIO` as a compatibility input if practical while
  changing its denominator to the effective window; remove `TAKI_CONTEXT_HISTORY_RATIO` from normal trigger authority.
  Any remaining legacy/unmeasured admission use must be named, tested, and documented rather than silently retained.
- Apply a stable deterministic Context Reduction pipeline before an auxiliary summary call, then remeasure the complete
  request. Reducers cover both tool and non-tool candidates: old dialogue/summary material, Tool/MCP/search/file results,
  repeated or stale snapshots, reasoning, bounded media descriptions, and duplicate observations.
- Protect core system/security/governance instructions, Character identity/persona, authoritative Memory, the current
  user message, and recent continuity-bearing dialogue. Each reducer is typed, bounded, projection-only, and reports its
  measured savings; it cannot mutate Timeline or completed effects.
- Skip the Utility Slot model call when deterministic reduction brings pressure below the threshold. When pressure remains,
  schedule detached rolling compaction; only a durable successful Slice 3 transaction affects a later request.
- Render structured tool and non-tool facts into compaction input through dedicated bounded/privacy-safe projections.
  Never pass raw secrets, credentials, prompt bodies, authorization material, sensor/media bytes, or unbounded payloads.
- Add deterministic summary guards: non-empty text, no provider length/truncation finish, strict estimated shrink against
  the selected source, no forbidden content, and preserved current continuity fields. Failed validation leaves the previous
  summary authoritative; optional audit-and-retry is enabled only when a focused quality probe justifies its cost.
- Add durable retry budget/cooldown and bounded failure reasons. Do not retry a broken utility model on every ordinary turn.
- Keep T5 R2 overflow behavior as the default. Research/implement a request-local DSH-style overflow path only if the
  installed AI SDK/provider proves that a failed model request can retry without replaying completed tool effects; otherwise
  preserve the original error after the clean-attempt retry boundary.
- Verify whether AI SDK `prepareStep` can apply deterministic reduction inside one ToolLoop without changing the meaning
  of completed tool calls/results. If not proven, keep reduction at the admitted-request/detached boundary and record the
  limitation rather than enabling an unsafe path.
- Add deterministic end-to-end coverage for `chat commit -> detached trigger -> summary -> next replay`, long histories,
  canonical Local, restart, concurrent append, failure/empty summary, provider overflow, and cache-prefix stability.

### Required tests

- Full-envelope boundary tests cover just below/at/above `0.8`, cache-read-heavy usage, absent provider usage, calibrated
  effective-window changes, and prove the 90% overflow shrink is not used as the proactive trigger.
- Configuration tests prove the old env input has explicit compatibility semantics and `historyRatio` cannot reduce the
  proactive threshold below `effectiveContextWindowTokens * compactPressureRatio`.
- Tool and non-tool reducers can independently avoid a model call when pressure becomes safe; the summary sees the reduced
  projection when it remains needed, and protected classes are unchanged.
- Empty, whitespace, truncated, non-shrinking, and protected-content outputs do not advance the checkpoint.
- Quality retry/cooldown obeys the durable attempt budget and cancellation.
- Overflow after a completed tool step never reruns the side effect unless a proven request-local seam is enabled.
- Realistic long-history deterministic integration and one key-gated real-provider probe when the user authorizes it.
- Existing Core/Shared tests plus cache-prefix, Monitor projection, Character isolation, and normal chat/tool paths.

### Exit gate

The coordinator has complete projected-input pressure accounting, deterministic measured reduction, a durable progress proof,
safe failure behavior, and a repeatable end-to-end harness. Only then may D68-B begin its Monitor UI implementation.

### Rollback point

Context Reduction and quality policy can be feature-gated independently. A failed reducer/quality pass leaves the prior
summary authoritative and can be disabled without restoring the 200-row source cliff or provider-lifecycle coupling.

## Cross-slice validation matrix

| Area | Evidence required before task completion |
| --- | --- |
| Token boundary | Complete request-envelope tests at the `0.8` threshold plus long rows, CJK, images, tools, oversized single entries, cache-read pressure, and backstop reporting |
| Provider composition | Legacy, canonical Local, and future-provider explicit startup behavior; no silent compactor disappearance |
| Durability | Migration/reopen, lock, CAS, idempotency, cancellation, concurrent append, and restart recovery tests |
| Context Reduction | Tool and non-tool reducers, protected-class invariants, measured savings, remeasurement, and model-call avoidance |
| Summary quality | Empty/truncated/non-shrinking/protected-content rejection and bounded retry/cooldown |
| Tool safety | Balanced calls/results; no side-effect replay; privacy-safe compaction transcript |
| Existing behavior | Normal chat/tool flow, Character isolation, Memory authority, prompt cache stability, and Monitor projections |
| Runtime | `pnpm -r typecheck`, root `pnpm lint`, focused/full `pnpm -r test`, Core boot smoke, and `git diff --check` |
| Task hygiene | `python ./.trellis/scripts/task.py validate .trellis/tasks/08-29-compaction-harness` |

## Explicit non-goals for this task

- No D68-B Monitor layout, Home refresh protocol, or Chat streaming UI.
- No replacement of the Memory Provider, semantic memory extraction, or Character/Memory authority rules.
- No local KV cache, provider-specific production branch, fabricated usage/cache metric, or second Agent loop/session.
- No manual `/compact` product command in the initial implementation; keep an internal coordinator entry point reserved for
  a later requirement.
