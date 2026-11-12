# DSH observability expansion and Monitor UX

## Goal

Rebuild TakiAgent's Monitor presentation primarily from the checked-in DSH Trajectory implementation,
using the existing Core Run/Event authority. The current page is a functional trace-validation prototype,
not an accepted product UI or a layout/visual constraint. The delivered Monitor must make model requests,
tools, usage, timing, governance, retry/recovery and context understandable through DSH's information
organization, interaction and visual design, with complete Chinese system labels and G4 field selection.

## Planning refresh — 2026-09-05

The [G1 UI/UX grill](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md)
coordinates the next stage and records current source findings. Monitor-specific layout, information
hierarchy, selection/live/history correctness, and producer-backed metrics remain D68 work. Chat/Pet
tool feedback and non-Monitor naming/approval work remain separate workstreams. G5 explicitly excludes
Monitor from the accepted non-Monitor visual baseline. D68-B is a DSH-led UI port/rebuild, not a polish
pass on the current scaffold. This planning clarification does not activate implementation.

## Requirements

### 1. Canonical facts and producer coverage

- Keep one Core-owned Run state and one append-only Run Event ledger. Monitor remains a read-only projection.
- Add fixed, versioned, bounded, replayable producers for the facts that the monitor presents:
  - model request start, first stream marker, finish/error, provider/model, and measured timing;
  - tool call/result, normalized tool name, stable call reference when available, outcome, error classification, and duration;
  - usage quality and input/output/total token counts;
  - bounded context/accounting summary;
  - approval/governance, retry, recovery, and interruption facts where the existing Core boundary knows them;
  - delivery facts only when a delivery authority exists;
  - cache read/write facts only when the provider/runtime supplies an authoritative provider-neutral signal.
- Every displayed field must be reconstructable from durable Run Events after restart. Missing facts remain absent or
  explicitly `unknown`; the UI must never infer them from Pino text, hashes, wall-clock guesses, or zero defaults.
- Producers must be non-blocking with respect to the Agent loop and must not add a model request, tool, prompt text, or
  extra runtime.

### 2. DSH-shaped Monitor layout and interaction

- Port DSH's presentation composition and interaction patterns as the default approach. Match its hierarchy,
  density, spacing, grouped rows, control placement and selected/detail states; the existing Monitor components
  are reusable only where they support that target. Replace the test scaffold with a full-height workspace:
  - a compact Run browser on the left;
  - a central execution ledger with a fixed Overview/timing strip;
  - a selection-based Inspector on the right.
- Keep the Inspector temporary and dismissible with a visible close control. Selecting another record replaces its
  contents; closing it returns the full-width ledger.
- Use DSH-style Turn/Step grouping adapted to `Run -> Attempt -> Model Request/Tool` semantics. Do not equate Attempt
  with a model Step when the facts do not have that meaning.
- Every expandable group or detail section must provide a visible expand/collapse control with truthful `aria-expanded`.
  Expanded content must always be closable without navigating away or reopening the page.
- Preserve DSH interaction behavior: bounded older-history loading, tail following for live runs, suspension of tail
  following while the user inspects older rows, generation-safe reconnect/backfill, and visible loading/empty/error/stale
  states.
- Use a responsive narrow-screen fallback (stacked ledger plus a closable bottom/detail drawer) without changing the
  information hierarchy.
- Include the DSH timing Overview, loaded-history controls, request totals, search and grouping interactions
  where their real TakiAgent facts exist. A generic table/card arrangement is not sufficient DSH parity.
- Preserve layout stability across Inspector/disclosure open-close, live row updates, and loading-state changes.
  Existing selected content and reading anchors must not jump; explicit pane dragging follows the pointer directly.
  Apply the [shared motion design](../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md)
  with reduced-motion and interrupted-transition behavior included in the batch design.

### 3. Chinese user-facing labels and semantic information hierarchy

- All visible Monitor labels, filter options, status values, section names, buttons, empty/error states, and accessibility
  labels must be Simplified Chinese.
- Translate framework-owned captions, tooltips, no-data text and fallback labels as well as primary headings.
  Preserve the identity of actual provider/model/tool names, code, paths and output content; localization must not
  rewrite those values or guess the cause of an upstream error.
- Internal event kinds, schema names, and wire values remain stable English identifiers; presentation code maps them to
  Chinese labels in one closed mapper.
- The ordinary Run list and ledger show meaningful semantic facts only: Character, trigger, initiator, state/outcome,
  provider/model, duration, token totals/quality, tool counts, retry/error summaries, and delivery/recovery state when
  available.
- The default Inspector shows applicable `概览`, `用量`, `耗时`, `上下文`, `输入摘要`, `输出摘要`, `工具定义`, `重试/恢复`
  sections. It must not lead with opaque identifiers.
- `runId`, `attemptId`, `effectId`, sequence numbers, hashes/digests, generations, revisions, and correlation keys are
  internal bookkeeping. G4 removes their user-facing display, including expanded Inspector details and `FULL_LOCAL`;
  do not create a replacement `技术关联` disclosure/copy panel. Keep identities needed for queries, bindings and replay
  in the underlying contracts. Use the [current field inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
- Raw prompts, credentials, authorization material, raw Host/MCP payloads, and sensor/media bytes remain excluded even in
  `FULL_LOCAL`. Bounded redacted detail may be shown when a producer supplies it.
- Cache display is `缓存读取/缓存写入` only when authoritative fields exist; otherwise show `缓存信息未提供`, never a
  synthetic hit/miss or zero.

### 4. Useful metrics and filtering

- Run summaries must include model request count, tool call/result counts, failure/retry counts, token totals with quality,
  and measured duration where available.
- Trajectory rows must distinguish model, tool, usage, context, governance, recovery, delivery, and lifecycle semantics.
- Filters/search must operate on real producer fields and support at least initiator, provider, model, tool, category,
  state/outcome, retry/error, time, and literal text search.
- Preserve `current`, `shadowed`, and `log-only` classification so internal evidence is retained without polluting the
  ordinary view.

### 5. Scope boundary with the deferred UI work

- Monitor-specific layout, Chinese labels, Inspector disclosure/close behavior, meaningful observability fields, and
  Monitor tail/backfill behavior belong in D68.
- The D68-A real usage evidence exposed a Harness prefix-cache defect. Archived child task
  `08-28-harness-prompt-cache-stability` closed that measured provider-cost regression. Child task
  `08-29-compaction-harness` completed and formally checked its approved implementation slices on 2026-08-31, closing
  the context-management gate before D68-B UI work. D68-B must consume the resulting semantic facts rather than hide
  long-history, pressure, reduction, or Memory-lifecycle defects behind the Monitor.
- The cross-Home reactive read-model contract, Chat in-flight tool/approval presentation, and the disclosure audit for
  every non-Monitor page (including Skills/MCP) remain D67 follow-up work. D68 must not introduce a competing page-local
  refresh protocol.

## Acceptance Criteria

- [x] A replay/restart of the same Run reconstructs identical monitor summaries and trajectory rows from the durable
  Run Event ledger.
- [x] A successful model request exposes provider/model, start/finish state, measured duration, first-stream/TTFT data
  when produced, and usage quality without fabricating missing values.
- [x] A successful and a failed tool invocation each produce a readable call/result row with outcome, bounded error
  classification, and duration when known.
- [x] Retry, recovery, approval, and context facts appear only when emitted by their fixed Core producers and can be
  filtered/inspected without exposing protected payloads.
- [x] A provider with no cache signal displays `缓存信息未提供`; no `miss`, zero, or hit-rate is inferred.
- [x] The Monitor uses a DSH-shaped left-browser/center-ledger/right-Inspector layout on wide screens and a usable
  responsive fallback on narrow screens.
- [x] Representative default, selected, expanded, live, historical and narrow-window states are compared against
  the DSH reference for composition, density, spacing, interaction and visual hierarchy. Every required adaptation
  is recorded; "trace data appears" or "three regions exist" is not sufficient UI acceptance.
- [x] Every expandable Monitor section can be collapsed again, and the Inspector has a visible close control.
- [x] Monitor labels and accessibility text are Chinese; opaque IDs/hashes/internal generations and revisions are absent
  from primary and expanded user-facing details, including `FULL_LOCAL`, while query/selection identities still work.
- [x] Live committed events update the selected Run without leaving/re-entering the page; older-history loading and
  tail-follow behavior do not steal the user's scroll position.
- [x] Inspector/disclosure transitions and live updates preserve selected-record, scroll, and focus continuity at real
  window sizes; interrupted or reduced-motion transitions leave no stale content or invisible input-blocking layer.
- [x] `DISABLED`, `FEEDBACK_ONLY`, and `FULL_LOCAL` preserve their privacy and availability contracts.
- [x] Core, Shared, and Desktop tests cover schema strictness, producer absence/unknown behavior, replay equality,
  filters, disclosure state, close behavior, reconnect/backfill, and protected-content exclusion.

Acceptance record: [2026-09-07 engineering evidence](implementation-evidence-d68-b-2026-09-07.md). These checks were performed under the owner's delegated engineering acceptance; personal owner inspection is not claimed.

## Definition of Done

- Shared contracts, Core producers, projections, WS methods, and Desktop Monitor UI are updated together.
- DSH reference components/styles/behavior are mapped in the design and reused where practical. Required
  TakiAgent adapters and dependency choices are explicit; no DSH runtime or second authority is introduced.
  Substantially copied MIT source retains the copyright/license notice and source attribution.
- Relevant specs, research, tests, and deferred-decision links are updated.
- Shared/Core/Desktop typechecks, tests, lint, Desktop build, task validation, and `git diff --check` pass.
- No production implementation starts until this PRD, `design.md`, and `implement.md` are reviewed and the task is
  explicitly activated.
- Before each executable slice, the main session verifies and sets the session-scoped Trellis task pointer. Every delegated
  prompt begins with the exact `Active task:` path and requires the child to verify/correct `task.py current --source`
  before reading context or touching files.

## Out of Scope

- A second Agent loop, Runtime, Session authority, Monitor database, or Timeline authority.
- Invented cache hit/miss, provider-specific branches solely for monitoring, or cost calculation without a pricing
  authority.
- Unbounded raw prompt/tool/Host/MCP export.
- Delivery receipt implementation before a delivery authority exists.
- The generic D67 Home refresh abstraction, Chat streaming redesign, or Skills/MCP page cleanup as a separate product
  surface.

## Research References

- [`research/d68-producer-first-scope-2026-08-28.md`](research/d68-producer-first-scope-2026-08-28.md) — verified DSH fields,
  current TakiAgent producer inventory, and bounded first-wave scope.
- [`../08-22-t4-agent-architecture-observability/research/dsh-observability.md`](../08-22-t4-agent-architecture-observability/research/dsh-observability.md)
  — DSH event, telemetry, query, privacy, and trajectory adaptation decisions.
- [`../08-22-t4-agent-architecture-observability/research/phase-d-observability-plane.md`](../08-22-t4-agent-architecture-observability/research/phase-d-observability-plane.md)
  — one ledger, multiple projections, and durable/live plane boundaries.
- `references/deepseek-harness-master/packages/client/ui-trajectory/README.md` — DSH Trajectory layout, Inspector,
  folding, lazy history, virtualization, and tail-follow behavior.

## Technical Notes

- The original producer inventory predates D68-A. Provider/model, model timing/TTFT, tool, token/reasoning/cache facts
  are already available where their producers supply them. Verify residual context/compaction, request-summary,
  governance/recovery, and delivery needs against current contracts; do not rebuild existing producers or invent gaps.
- The earlier scaffold residuals were resolved by the checked D68-B port: full-height layout, temporary semantic
  Inspector, bounded history, current summaries and retained selection. Final acceptance includes real-window
  geometry, interrupted/reduced-motion interaction, reading anchors and reconnect; component presence alone was
  not used as evidence.
- Existing `run_events` stores JSON payloads, so additive event kinds do not require a SQLite migration unless measured
  volume later proves an index/materialized-counter need.
