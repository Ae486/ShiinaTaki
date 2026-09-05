# Compaction Harness implementation plan

## Execution boundary

This plan follows the reviewed design in `design.md`. Slices 1-4 are complete. Later slices
may update this file when source evidence, provider behavior, or test results justify a better design. A plan update must
preserve the task's global invariants and be recorded before dispatching the next slice.

The task is a Core harness change. Its compaction acceptance gate has passed; D68-B Monitor UI remains a separate
pending stage and must consume the resulting semantic context facts rather than invent a page-local workaround.

## Execution status

| Slice | Status | Evidence |
| --- | --- | --- |
| Slice 1 | Implemented and formally checked on 2026-08-29 | Core full suite: 284 files, 1789 passed, 1 skipped; workspace typecheck and root lint passed; isolated Core boot smoke passed; task validation and `git diff --check` passed apart from the pre-existing parent-task CRLF warning; deterministic 10,000-row source probes stayed below 100 ms and surfaced the explicit backstop. |
| Slice 2 | Implemented and formally checked on 2026-08-29 | Provider-independent Core composition now constructs one Utility Slot and one detached per-Character maintenance chain for Legacy and canonical Local; all Legacy episodic/flush/tidy/compaction calls share the Utility Slot queue; typed `MemoryFlushPort` outcomes and activation retirement are covered. Focused tests: 70 passed. Core full suite: 286 files, 1804 passed, 1 skipped. Workspace typecheck, root lint, isolated Core boot, task validation, and `git diff --check` passed. |
| Slice 3 | Implemented and formally checked on 2026-08-30 | Migration 032 adds revisioned summary checkpoints, one fenced per-Character operation cursor, and immutable lifecycle evidence. Summary replacement, operation commit, and terminal evidence are atomic. Focused check: 99 passed; Core full suite: 288 files, 1825 passed, 1 skipped; Core typecheck, root lint, task validation, `git diff --check`, and isolated Core boot through migrations 1-32 passed. |
| Slice 4 | Implemented and formally checked on 2026-08-31 | Complete projected-input pressure, typed tool/non-tool reduction with post-turn remeasurement, summary quality, durable retry/cooldown, and production-order regression coverage. Focused check: 110 passed. Core full suite: 293 files / 1851 passed / 1 skipped. Workspace typecheck, root lint (0 errors; one pre-existing unused-disable warning), task validation, `git diff --check`, and isolated Core boot through migrations 1-32 passed. |

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

- Measure the complete projected next-request input from the exact assembled instructions, outgoing messages, and
  prepared/estimated tool schemas; these carry system/governance, Character/Memory, summary/history, current message,
  and request-local dynamic context exactly once. Use authoritative upstream `inputTokens` to calibrate the envelope
  when available; cache-read tokens remain part of pressure.
- Trigger normal proactive handling at `projectedInputTokens >= effectiveContextWindowTokens * 0.8`. Record `0.8` as
  configurable TakiAgent policy. Do not multiply it by `historyRatio`/`triggerRatio`; do not confuse the post-overflow
  90% effective-window shrink with the proactive trigger.
- Migrate configuration deliberately: preserve `TAKI_COMPACT_TRIGGER_RATIO` as a compatibility input if practical while
  changing its denominator to the effective window; remove `TAKI_CONTEXT_HISTORY_RATIO` from normal trigger authority.
  Any remaining legacy/unmeasured admission use must be named, tested, and documented rather than silently retained.
- Apply a stable deterministic Context Reduction pipeline at the initial admitted-request seam and during post-turn
  detached admission measurement, then remeasure the complete request. Reducers cover Tool/MCP/search/file results and
  typed rolling-summary-head candidates; generic semantic dialogue remains protected.
  Additional snapshot, reasoning, media-description, and duplicate-observation policies remain future reducer work.
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
  of completed tool calls/results. It is not proven in installed AI SDK 7.0.17, so same-ToolLoop reduction remains
  disabled; the initial request and post-turn detached admission measurement use the safe projection reducer instead.
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

### Execution notes — 2026-08-31

- Request admission measures the exact assembled instructions, outgoing messages, and tool schemas, applies typed
  tool-result / rolling-summary-head reduction to the actual provider projection, and remeasures at the configurable
  `effectiveWindow * 0.8` boundary. The post-turn path persists assistant/tool output first, projects the updated Replay,
  applies the same reducer, and publishes that next-request snapshot before detached maintenance starts.
- Positive provider input usage remains a post-hoc calibration anchor; cache reads consume pressure, while absent/zero
  usage falls back to the complete local estimate and cannot overwrite the next-Replay pressure snapshot.
- The quality check fixed two privacy/accounting defects: nested AI SDK `content/file` tool outputs now omit media bytes
  from compaction transcripts, and zero provider usage can no longer erase estimated complete-request pressure.
- Summary quality failures retain the previous checkpoint and reuse the existing bounded failure classes. Durable
  operation attempts enforce same-source budget, Character-wide cooldown across source changes, restart recovery,
  cancellation, lease expiry, source-stale, and CAS-conflict behavior.
- AI SDK 7.0.17 `prepareStep` remains disabled because installed docs/source prove message-base replacement but not
  exactly-once completed Tool Effects. T5 R2 remains clean-attempt-only and never replays a completed side effect.
- Verification: 110 focused tests; Core full suite 293 files / 1851 passed / 1 skipped; Core and workspace typechecks;
  root lint (0 errors, one pre-existing warning); task validation; `git diff --check`; and isolated Core boot through
  migrations 1-32 to `ws server listening`, followed by SIGINT shutdown without a model request.

## Real-provider acceptance probe - 2026-09-02

The implementation was exercised against a fresh isolated copy of the primary SQLite database at
`C:\Users\55473\AppData\Local\Temp\takiagent-compaction-real-20260902-2005`, using the real DeepSeek-compatible
configuration and `deepseek-v4-flash`. The Core process ran from this worktree on port `8975`; the production database
was not opened for writes. The probe used the declared main window of `65,536` tokens, so the proactive threshold was
`65,536 * 0.8 = 52,428.8` tokens. The provider returned `inputTokens = noCacheTokens + cacheReadTokens` for every observed
request. `cacheWriteTokens` was omitted by the provider in every sample and is intentionally recorded as unknown, not
as zero.

Observed lifecycle and cache results:

| Probe | Result | Representative provider usage |
| --- | --- | --- |
| Initial long history | Background compaction committed `3381..3602`, summary revision `1 -> 2`; timeline rows remained intact | `61,241` input, `0` cache read (`0%`) |
| First request after summary replacement | Chat remained correct; replacement prefix was re-warmed | `30,831` input, `10,496` cache read (`34.04%`) |
| Consecutive ordinary requests | Correct responses and stable prefix reuse | `30,987/30,720` (`99.14%`), then `31,045/30,720` (`98.95%`) |
| Core tool (`get_current_time`) | Tool call, result, and follow-up model step all completed; no duplicate effect | `31,101/30,976` (`99.60%`) and `31,244/31,104` (`99.55%`) |
| Avatar tool (`avatar_set_expression` with `smile01`) | Validated call returned `{ok:true}` and follow-up completed | `31,295/30,976` (`98.98%`) and `31,359/31,232` (`99.60%`) |
| MCP discovery and successful `qq_monitor_status` call | `extension_discover -> extension_call` completed with one approval; the MCP result was followed by a normal model step | `27,750/27,520` (`99.17%`), validation-retry step `30,513/27,776` (`91.03%`), accepted call `30,677/30,464` (`99.31%`), final step `31,570/30,848` (`97.71%`) |
| Compaction recovery under long/tool-heavy history | A transient `SUMMARY_GENERATION_FAILED` left revision `4` authoritative; a later pressure trigger merged the pending range and committed revision `5`, then another pressure trigger committed revision `6` | Successful recovery operations covered `3669..3698` and `3699..3705`; no timeline deletion or tool replay |

Across the 41 provider calls in the probe window (`12:03Z..13:00Z`), the aggregate was `1,229,692` input tokens and
`1,046,528` cache-read tokens (`85.10%` weighted). This aggregate includes the intentional first request after each
summary/prompt-shape change; the steady suffix of tool-loop and ordinary requests was generally `97%..99%`. A roughly
five-to-nine-minute gap did not by itself collapse the cache, so this probe does not support a short-TTL explanation.
It does not establish the provider's exact TTL because no cache-expiry header or provider contract was exposed.

The successful MCP path also demonstrated that an invalid `extension_call` argument is represented as a validation
failure and the ToolLoop asks the model for a corrected call; the accepted retry did not repeat a completed side effect.
Several interactive CLI attempts failed only because the test stdin reached EOF/arrived after the approval deadline; an
automatic WS client immediately approving `allow_once` succeeded, so those attempts are not counted as MCP or cache
failures. The isolated Core remained healthy throughout. Several provider-backed summary attempts can still fail transiently;
the durable operation stays failed without advancing the checkpoint and later pressure retries have been observed to
recover it. Provider request duration/deadline remains a runtime limitation for future hardening because one real summary
call took several minutes while the coordinator lease remained valid.

### Follow-up cache probe rule

Future cache investigations must include at least one non-conversational path, such as a Core tool call, an MCP
discovery/call, a validation-retry loop, or a tool result with a large bounded projection. Capture usage for every model
step before, during, and after the path, and compare cache-prefix stability, total input pressure, summary replacement,
and exactly-once side effects. A tool/MCP request must not be treated as a cache failure merely because its first
post-shape-change step has a cold prefix; the steady follow-up steps and the provider's reported fields are the
authoritative evidence.

## Final closeout verification - 2026-09-05

Continuation from session `01a0437d-29a9-7fd2-b35c-7ef01f7af14e` recovered the owner's explicit commit/archive
authorization. The final full-scope Compaction review repaired three demonstrated defects before closeout:

1. A 60,000-character tool result was priced through bounded candidate text, leaving a 16,468-token provider projection
   above a 10,000-token target. Reducer progress now uses full provider-message estimates after each replacement and
   preserves the rolling summary once the tool reduction is sufficient.
2. The message target could equal the inclusive pressure trigger. It now uses
   `max(0, ceil(thresholdTokens - nonMessageTokens) - 1)`; integer and fractional boundaries are covered.
3. A non-primary ephemeral control request could overwrite a safe primary pressure snapshot while relationship
   maintenance was pending, causing an unnecessary Utility compaction. Primary-only snapshot publication fixes the
   demonstrated ChatAgent -> maintenance -> coordinator chain without changing non-primary request reduction or
   Run/Effect telemetry.

| Final check | Result |
| --- | --- |
| Focused regressions | 4 files / 21 tests passed |
| `pnpm --filter @taki/core exec vitest run --maxWorkers=4` | 293 files / 1853 passed / 1 skipped; 66.91 seconds |
| Shared, Desktop, CLI from `pnpm -r test` | 40 files / 356 passed; 105 files / 565 passed; 8 files / 47 passed |
| Core, Shared, CLI, E2E typechecks | Passed |
| Desktop source-only typecheck | Passed with an ignored temporary config including `apps/desktop/src` and Node test types |
| `pnpm exec eslint . --ignore-pattern 'apps/desktop/lab/**'` | Passed; one existing unused-disable warning in `db/run-repo.ts` |
| Task manifests / whitespace / new-file encoding | 18 implement and 19 check entries valid; diff checks passed; nine new Core files are UTF-8 without BOM |
| Isolated Core boot and same-data reopen | Fresh migrations 1-32; reopen applied none; both listened and shut down via SIGINT; Core exit code 0 verified on reopen |

The initial concurrent workspace test run timed out in one Skills ZIP test. Its 16-test file passed unchanged on a
low-load rerun, and the final full Core suite passed. No Skills code was changed.

Full-workspace green is deliberately not claimed. Excluded concurrent Avatar lab changes caused TS2877 at
`apps/desktop/lab/scene/character-catalog.ts:10-11`; a later root lint also found a 62-line function and unused
`withValue` in `apps/desktop/lab/page/panel-params.ts`. The committed Compaction scope passes its gates; lab work and
its Desktop config/document changes are separate. Rust and paid-provider checks were not repeated for these Core-only
repairs; the real-provider evidence above remains the dated acceptance record.

Boot evidence is at `G:/Temp/taki-compaction-final-20260905-e17c730a760c46199f2009f6e6316d16`. The Core ran from this
worktree with placeholder provider settings, cleared inherited credential-source settings, and no `.env.local`.
Fresh boot listened on `127.0.0.1:7026`; reopen used `:7770`. SQLite integrity was `ok`, with 32 migrations and zero
compaction operations, summaries, model Effects, or usage rows. An exit-only Node preload recorded Core exit code 0;
PowerShell's interrupted PTY wrapper returned 1 separately. Both PIDs and listeners were gone after shutdown.

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
