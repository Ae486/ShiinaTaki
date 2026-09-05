# D68 implementation plan

## Execution boundary

This plan is intentionally staged. The task is not considered complete when a first UI mock or a partial event payload
exists. Each stage must preserve the single Run/Event authority and update this plan if implementation evidence changes
the design. The first implementation dispatch should own one coherent vertical slice of approximately two to three
context windows; later stages may become child tasks if the measured scope exceeds that budget.

## Dispatch and task-pointer protocol

Before any delegated explore, implementation, or check:

1. The main session verifies `cwd`, branch, worktree list, `HEAD`, dirty paths, and `python ./.trellis/scripts/task.py current --source`.
2. The main session activates the exact task being worked on with `python ./.trellis/scripts/task.py start <task-dir>` only
   after its planning artifacts have been reviewed. This writes the session-scoped task pointer and changes `planning` to
   `in_progress`.
3. The delegated prompt starts with `Active task: <task-dir>` and then requires the child to run
   `python ./.trellis/scripts/task.py current --source`. If the pointer is absent or names another task, the child must
   point it at the stated task before reading context or touching owned files. It must report the resulting pointer.
4. Every prompt is in English and explicitly states: `YCE is disabled and must not be used`; use `jbcontext` for semantic
   search; do not spawn or delegate to another agent; do not commit, push, reset, rebase, or archive.
5. There is at most one explore/research, one implementation agent, and one formal check agent for each executable slice.
   A healthy child is not interrupted; the main session waits in ten-minute cadence.

The explore step is a bounded preflight, not a second architecture discussion. It writes only a research artifact with
verified file/symbol/stream-shape facts. It must not alter production code or task status. Once the main session reviews
that artifact, the executable slice is frozen before dispatching `trellis-implement`.

### Upstream metric evidence gate

Usage, cache, reasoning, timing, finish, and provider metadata are implementation requirements, not optional polish.
Before omitting or approximating any such field, the implementer must verify it through all applicable evidence paths:
the checked-in DSH implementation, the installed framework/adapter source and declarations, and a focused executable
probe when the first two do not settle the runtime shape. Values supplied by an upstream result must be preserved through
the normalized Shared/Core contract with explicit `unknown`/omitted semantics when absent. Synthetic hit/miss values,
zero defaults, UI-derived timing, provider-specific monitoring branches, and claims of unsupported framework behavior
are prohibited without recorded evidence.

## Stage 1 — Targeted runtime-seam explore (preflight)

1. Verify the installed AI SDK v7 stream part types and the exact `ToolLoopAgent`/governed-tool observation seams.
2. Trace model request start/stream/finish, normalized tool call/result, approval, retry/recovery and Run Event append
   boundaries in the live TakiAgent code.
3. Confirm the smallest owned file set for D68-A and D68-B, existing tests, and any cross-layer protocol implications.
4. Persist findings under `research/` and return unresolved risks; do not edit production files.

Exit gate: the main session can name concrete producers, payload inputs, tests and file ownership without guessing.

## Stage 2 — Shared event contracts and fixtures

1. Read the backend/frontend specs and D68 research before editing.
2. Confirm installed AI SDK v7 stream part shapes and existing Run/Event append APIs from live code.
3. Extend the closed Shared event union additively for model, tool, context, governance, retry/recovery and timing facts.
4. Define bounded redacted detail and explicit unknown/omitted semantics, including cache read/write absence.
5. Add fixtures for model success/interruption, tool success/failure, usage qualities, context, approval and retry/recovery.
6. Add one centralized Chinese presentation mapper for labels/statuses/phases/surfaces.

Exit gate: Shared schemas, fixtures and mapper tests pass; no production producer is wired to an unverified payload shape.

## Stage 3 — Core producers

1. Instrument `model-effect-middleware` at request start, first meaningful stream part, finish/error and interruption.
2. Instrument the governed tool/effect boundary for normalized call start and result settlement.
3. Emit context facts from the immutable Run snapshot/admission seam.
4. Emit governance and retry/recovery facts only at existing authoritative transitions.
5. Reconcile usage from the durable settlement path; do not double-count detached callbacks.
6. Pass through cache buckets only if a provider-neutral authoritative signal is present; otherwise emit nothing.
7. Contain observer/serialization failures so the Agent loop remains unaffected.

Exit gate: producer tests prove event order, bounded payloads, non-blocking behavior, and restart/replay equality.

## Stage 4 — Projection, query and Inspector data

1. Expand `RunMonitorSummary` with request/tool/failure/retry counts, usage quality, timing and optional cache buckets.
2. Expand trajectory rows into semantic Model/Assistant/Tool/Usage/Context/Governance/Recovery/Delivery kinds.
3. Pair start/settlement facts for readable durations while retaining individual ledger events.
4. Add real-field filters for provider, model, tool, category, state/outcome, retry/error and text.
5. Replace technical-first Inspector payloads with semantic sections and a collapsed, mode-gated `技术关联` section.
6. Preserve Character authorization, redaction and `current`/`shadowed`/`log-only` classification.

Exit gate: projection tests cover sparse filters, absent fields, deterministic replay, authorization and privacy.

## Stage 4.5 — Harness prompt-prefix cache stability gate (complete)

Archived child task `08-28-harness-prompt-cache-stability` completed before any Desktop Monitor layout work. The child owned
the request-prefix audit, removal or relocation of non-semantic per-Run volatility ahead of replayed history,
authority-preserving regression tests, and a real configured DeepSeek before/after probe. Its live acceptance must show
material improvement over the reproduced approximately 10.1% cache-read ratio on comparable long-history follow-ups;
non-zero cache reads alone are insufficient.

Exit gate: the child task is checked and committed, normal chat plus a tool path remain correct, and real provider usage
proves that the long reusable history prefix is being cached. If the evidence reveals another volatile prefix component,
update the child design rather than beginning D68-B with a known cost defect.

## Stage 4.75 — Compaction Harness gate

Complete child task `08-29-compaction-harness` before starting Desktop Monitor layout work. This child owns the verified
current-compaction/DSH comparison, token-first Replay, complete projected-input pressure at the configurable `0.8`
effective-window threshold, general Context Reduction, separation from Memory Provider lifecycle, and durable
summary/replay/overflow contracts. Its implementation gate must cover long histories beyond the legacy 200-row cliff,
tool-dense and non-tool reduction, canonical Local paths, concurrent appends, restart/recovery, and failed or empty
summary attempts. The child may revise the plan as implementation evidence improves it, but must not silently turn the
first slice into a final architecture.

Exit gate: all Compaction slices are checked; complete projected-input pressure, deterministic reduction/remeasurement, durable
summary lifecycle, and provider-independent composition are proven; D68-B consumes their semantic facts rather than
inventing a page-local workaround.

Gate result (2026-08-31): child `08-29-compaction-harness` completed all four slices and passed focused/full Core tests,
workspace typecheck, root lint, task validation, diff check, and isolated Core boot. D68-B may proceed as a separate
implementation stage; this gate completion does not itself start Desktop work.

## Stage 5 — DSH-shaped Desktop Monitor

1. Replace the vertical PageCard composition with a full-height three-region workspace.
2. Implement the left Run browser, central Overview/timeline ledger and conditional right Inspector.
3. Add visible close controls and two-way disclosure controls for every expandable group/section.
4. Render all visible labels and accessibility strings in Chinese; keep wire values internal.
5. Add conditional Inspector tabs: `概览`, `用量`, `耗时`, `上下文`, `输入摘要`, `输出摘要`, `工具定义`, `重试/恢复`.
6. Add responsive bottom-drawer fallback for narrow windows.
7. Preserve lazy older-page loading, tail-follow, scroll-anchor preservation and generation-safe reconnect/backfill.
8. Do not expose IDs, hashes, generations or revisions in ordinary rows or default details.

Exit gate: Desktop tests and a real enabled Monitor smoke show the DSH layout, Chinese labels, meaningful values,
close/reopen behavior, live updates and no technical-field dump.

## Stage 6 — Cross-layer quality and handoff

1. Run Shared/Core/Desktop typechecks, tests, lint, Desktop build, task validation and `git diff --check`.
2. Verify disabled/feedback/full modes and provider-without-cache behavior.
3. Run a real isolated Core/desktop monitor smoke with the configured model and inspect a model request plus a tool
   success/failure.
4. Update the observability spec and deferred decision links with any implementation learning.
5. Reassess whether D67's generic Home disclosure/read-model work remains separate; do not silently absorb it.

## Planned internal slices and effort

| Slice | Scope | Expected effort |
|---|---|---:|
| Explore | Runtime seam and exact stream/tool observation mapping; research only | 1 context window |
| D68-A | Shared event contracts, redaction/unknown rules, fixtures, Core producers, projection and semantic Inspector data | 2–3 context windows |
| Prefix-cache child (complete) | Stable Harness request prefix plus deterministic and real-provider verification | 1–2 context windows |
| Compaction Harness child | Current-design audit, DSH comparison, token-first/Memory-independent redesign, and staged implementation plan | 2–3 context windows for planning; implementation split by the approved slices |
| D68-B | DSH-shaped Monitor layout, Chinese labels, disclosures, close behavior and responsive UI | 2–3 context windows |
| D68-C (conditional) | Provider-neutral cache semantics or delivery facts after an authority exists | separate task, only if evidence supports it |

D68-A and D68-B share the same research/design context but have independent acceptance gates and ownership. The
prefix-cache child consumed D68-A's real usage evidence and is closed; the Compaction Harness child consumes the
long-history/window evidence and must close before D68-B. Do not combine these into one implementation prompt:
producer/projection correctness, request stability, and context-management correctness must be proven before the UI is
reshaped. Do not split a slice into smaller repetitive prompts unless explore evidence proves the stated budget is
exceeded.

## Tests by risk

| Risk | Required evidence |
|---|---|
| Event contract drift | strict Zod fixtures, version compatibility and all producers/projections typecheck |
| Missing/duplicate metrics | producer unit tests plus durable replay equality and usage reconciliation |
| Tool/model failure visibility | success/failure/interruption tests with bounded error classifications |
| Privacy leakage | forbidden-content tests for prompts, secrets, authorization, Host/MCP, sensor/media and technical default UI |
| UI disclosure regression | component tests assert every expandable region closes and Inspector close clears selection |
| Live UX regression | controller tests for update, tail suspension, backfill, overflow and generation replacement |
| Performance | bounded payloads, pagination, visible-window rendering and no page-local polling loops |

## Rollback points

- Shared contract changes can be reverted before producers are enabled; preserve parsers for already committed additive
  events.
- Producer wiring can be feature-gated by Monitor mode without changing Run correctness.
- UI can fall back to the existing semantic projection if a new optional detail is unavailable; it must never fall back to
  raw technical fields.
