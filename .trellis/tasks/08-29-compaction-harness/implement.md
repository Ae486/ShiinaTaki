# Compaction Harness implementation plan

## Execution boundary

This plan follows the reviewed design in `design.md`. It is an implementation roadmap, not a claim that any slice is
already complete. The first slice establishes the shared context boundary; later slices may update this file when source
evidence, provider behavior, or test results justify a better design. A plan update must preserve the task's global
invariants and be recorded before dispatching the next slice.

The task is a Core harness change. D68-B Monitor UI remains blocked until the compaction acceptance gate passes; the UI
must consume the resulting semantic context facts rather than invent a page-local workaround.

## Execution status

| Slice | Status | Evidence |
| --- | --- | --- |
| Slice 1 | Implemented and formally checked on 2026-08-29 | Core full suite: 284 files, 1789 passed, 1 skipped; workspace typecheck and root lint passed; isolated Core boot smoke passed; task validation and `git diff --check` passed apart from the pre-existing parent-task CRLF warning; deterministic 10,000-row source probes stayed below 100 ms and surfaced the explicit backstop. |
| Slice 2 | Implemented and formally checked on 2026-08-29 | Provider-independent Core composition now constructs one Utility Slot and one detached per-Character maintenance chain for Legacy and canonical Local; all Legacy episodic/flush/tidy/compaction calls share the Utility Slot queue; typed `MemoryFlushPort` outcomes and activation retirement are covered. Focused tests: 70 passed. Core full suite: 286 files, 1804 passed, 1 skipped. Workspace typecheck, root lint, isolated Core boot, task validation, and `git diff --check` passed. |
| Slice 3 | Pending | Durable summary transaction and recovery evidence. |
| Slice 4 | Pending | DSH-informed pruning, summary quality, and recovery hardening. |

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
- Add one Core-owned append-only compaction evidence repository (provisional table name
  `conversation_compaction_log`) with operation id, Character scope, optional Run/Attempt correlation, reason, selected
  range, measurements, provider/model route, terminal state, and bounded failure class.
- Add a durable per-Character lock/lease and idempotency rule. The operation record is evidence/coordination only; it is
  not a second Run or conversation authority.
- Re-read source and summary revisions before commit. Allow appends strictly after the captured retiring range; reject
  stale ranges or competing summaries. Commit summary replacement and terminal success evidence in one short SQLite
  transaction.
- Define restart classification (`abandoned`/retryable after lease expiry), cancellation, duplicate trigger, and no-double-
  advancement behavior.

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

## Slice 4 — DSH-informed pruning, summary quality, and recovery hardening

**Target size:** 2–3 context windows.  
**Primary ownership:** deterministic pruning order, summary validation, retry/cooldown, and end-to-end regression harness.  
**Dependency:** Slices 1–3.

### Scope

- Run deterministic tool-result reduction before an auxiliary summary call and remeasure immediately. Keep TakiAgent's
  semantic snapshot/fact ordering and recent-per-tool protection; add only bounded head/tail reduction where a single
  result requires it.
- Render structured tool facts into compaction input through a dedicated bounded/privacy-safe projection. Never pass raw
  secrets, credentials, prompt bodies, authorization material, sensor/media bytes, or unbounded payloads.
- Add deterministic summary guards: non-empty text, no provider length/truncation finish, strict estimated shrink against
  the selected source, no forbidden content, and preserved current continuity fields. Failed validation leaves the previous
  summary authoritative; optional audit-and-retry is enabled only when a focused quality probe justifies its cost.
- Add durable retry budget/cooldown and bounded failure reasons. Do not retry a broken utility model on every ordinary turn.
- Keep T5 R2 overflow behavior as the default. Research/implement a request-local DSH-style overflow path only if the
  installed AI SDK/provider proves that a failed model request can retry without replaying completed tool effects; otherwise
  preserve the original error after the clean-attempt retry boundary.
- Add deterministic end-to-end coverage for `chat commit -> detached trigger -> summary -> next replay`, long histories,
  canonical Local, restart, concurrent append, failure/empty summary, provider overflow, and cache-prefix stability.

### Required tests

- Prune-first can avoid a model call when pressure becomes safe; summary sees the reduced projection when it remains needed.
- Empty, whitespace, truncated, non-shrinking, and protected-content outputs do not advance the checkpoint.
- Quality retry/cooldown obeys the durable attempt budget and cancellation.
- Overflow after a completed tool step never reruns the side effect unless a proven request-local seam is enabled.
- Realistic long-history deterministic integration and one key-gated real-provider probe when the user authorizes it.
- Existing Core/Shared tests plus cache-prefix, Monitor projection, Character isolation, and normal chat/tool paths.

### Exit gate

The coordinator has a measurable progress proof, safe failure behavior, and a repeatable end-to-end harness. Only then may
D68-B begin its Monitor UI implementation.

### Rollback point

Pruning/quality policy can be feature-gated independently. A failed quality pass leaves the prior summary and can be
disabled without restoring the 200-row source cliff.

## Cross-slice validation matrix

| Area | Evidence required before task completion |
| --- | --- |
| Token boundary | Core unit/integration tests for long rows, CJK, images, tools, oversized single entries, and backstop reporting |
| Provider composition | Legacy, canonical Local, and future-provider explicit startup behavior; no silent compactor disappearance |
| Durability | Migration/reopen, lock, CAS, idempotency, cancellation, concurrent append, and restart recovery tests |
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
