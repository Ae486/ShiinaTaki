# D68 implementation plan

## Execution boundary

This plan is intentionally staged. The task is not considered complete when a first UI mock or a partial event payload
exists. Each stage must preserve the single Run/Event authority and update this plan if implementation evidence changes
the design. The first implementation dispatch should own one coherent vertical slice of approximately two to three
context windows; later stages may become child tasks if the measured scope exceeds that budget.

G5 owner clarification (2026-09-05): D68-B is a direct DSH Trajectory presentation port/rebuild. The
current Monitor proves traceability but is not an accepted visual or interaction baseline. The UI stage
must cover DSH composition, visual treatment, Chinese labels and interaction, not just scaffold repair.

Existing D68-A producer/projection work has its own accepted evidence. Stages 1–4 retain the original
data plan; do not repeat them wholesale to start G5. The UI preflight maps actual available facts to
the port and identifies only concrete missing-data work. Cache and Compaction gates below are complete.

The [2026-09-06 source/adapter preflight](research/d68-b-ui-port-adapter-map-2026-09-06.md) is complete.
It identifies request-correlation and backward-history projection work, current selection/live-summary
defects, and the DSH virtualizer dependency. Main adopted version 3.14.9 under the owner's 2026-09-06
execution delegation. The final additive wire contract remains a prerequisite to D68-B dispatch;
A1/A2 checking is complete in the separate readable-operations task. No new D68-B production
implementation is claimed here.

## Dispatch and task-pointer protocol

Before any execution-stage delegated explore, implementation, or check:

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

Planning-only reference reads do not activate a task merely to inspect source; they report the actual
session pointer and remain within the owner's planning authorization.

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
5. Provide useful semantic Inspector sections. G4 excludes user-facing internal metadata rows and `技术关联` dumps;
   retain required identities in wire/query/replay contracts without automatically rendering them.
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

## Stage 5 — DSH Trajectory UI port, Chinese localization and interaction

1. Freeze the source-component/style map from design section 2, representative reference states and required
   TakiAgent adapters. Reuse the existing source findings; investigate only an unresolved seam. Inventory library
   compatibility and attribution before implementation; do not replace direct porting with another generic mock.
2. Port the full-height Toolbar/Overview/ledger/conditional-Inspector composition, row density, spacing, typography,
   selection/error treatment and grouped-content hierarchy. Integrate Run selection and remove the inherited
   page-width constraint that prevents the right pane from appearing.
3. Adapt source view models to existing canonical Run/Event projections. List any missing facts explicitly rather
   than fabricating values. Preserve G4's removal of internal metadata in every primary/expanded/local view.
4. Port the corresponding record/range selection, search, grouping, close/resize and useful input/output/detail
   interactions. Adapt narrow layouts while retaining the reference information hierarchy.
5. Port bounded row mounting, initial tail placement, older-page loading and scroll-anchor preservation. Correct
   selected-row request races, close behavior, live Run summaries and reconnect/older-Run selection recovery.
6. Translate all system-owned visible and accessible copy: toolbar/Overview, tabs, labels, states, tooltips and
   empty/loading/error fallbacks. Keep protocol values internal and actual names/paths/output unchanged.
7. Apply the shared continuity/reduced-motion requirements. New rows, pane changes and disclosures must preserve
   reading/control positions; manual resize responds directly to the pointer.
8. Compare the resulting default, selected, expanded, live, historical and narrow states against DSH, recording each
   deliberate domain/privacy/G4 difference. Exercise the real enabled Monitor in WebView2, including a successful
   and failed tool/model path. Revise old scaffold tests that would preserve the rejected presentation.

Exit gate: automated behavior checks plus reference comparison and owner visual/interaction acceptance confirm
the DSH-led product UI, complete Chinese system labels, meaningful data and working live/history interactions.
Traceability, a nominal three-region component, or a static screenshot alone cannot pass this gate.

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
| D68-B | Direct DSH Trajectory presentation port/rebuild, full Chinese UI, real-data adapters, history/live interactions and reference-based visual acceptance | Slice after the source/adapter map; the existing mock is not a completion shortcut |
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
| Privacy and irrelevant-field exposure | forbidden-content checks for protected payloads plus G4 absence checks for internal metadata in primary and expanded user-facing UI |
| UI disclosure regression | component tests assert every expandable region closes and Inspector close clears selection |
| DSH presentation drift / untranslated UI | compare representative states with the DSH source/reference, audit all UI-owned copy, and run actual WebView2 interaction; traceability alone is insufficient |
| Live UX regression | controller tests for update, tail suspension, backfill, overflow and generation replacement |
| Performance | bounded payloads, pagination, visible-window rendering and no page-local polling loops |

## Rollback points

- Shared contract changes can be reverted before producers are enabled; preserve parsers for already committed additive
  events.
- Producer wiring can be feature-gated by Monitor mode without changing Run correctness.
- UI can fall back to the existing semantic projection if a new optional detail is unavailable; it must never fall back to
  raw technical fields.
