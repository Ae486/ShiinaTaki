# DSH observability expansion and Monitor UX

## Goal

Expand TakiAgent's existing Run/Event monitor into a useful, replayable, DSH-shaped developer observability surface. The
monitor must expose the facts needed to understand and tune an Agent run (model requests, tools, usage, timing,
governance, retry/recovery, and context) while keeping Core as the only execution authority. Its layout and information
hierarchy must follow the checked-in DSH Trajectory design rather than the current vertically stacked card layout.

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

- Replace the current vertical `filter -> Run card -> trajectory card -> inspector card` arrangement with a DSH-shaped
  full-height workspace:
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

### 3. Chinese user-facing labels and semantic information hierarchy

- All visible Monitor labels, filter options, status values, section names, buttons, empty/error states, and accessibility
  labels must be Simplified Chinese.
- Internal event kinds, schema names, and wire values remain stable English identifiers; presentation code maps them to
  Chinese labels in one closed mapper.
- The ordinary Run list and ledger show meaningful semantic facts only: Character, trigger, initiator, state/outcome,
  provider/model, duration, token totals/quality, tool counts, retry/error summaries, and delivery/recovery state when
  available.
- The default Inspector shows applicable `概览`, `用量`, `耗时`, `上下文`, `输入摘要`, `输出摘要`, `工具定义`, `重试/恢复`
  sections. It must not lead with opaque identifiers.
- `runId`, `attemptId`, `effectId`, sequence numbers, hashes/digests, generations, revisions, and correlation keys are
  never primary content. If a developer genuinely needs them, place them in an explicitly collapsed `技术关联` section
  in an authorized local mode.
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
  `08-29-compaction-harness` must now complete its design and approved implementation slices before D68-B UI work so
  long-history context loss and Memory-lifecycle coupling are not hidden behind the Monitor.
- The cross-Home reactive read-model contract, Chat in-flight tool/approval presentation, and the disclosure audit for
  every non-Monitor page (including Skills/MCP) remain D67 follow-up work. D68 must not introduce a competing page-local
  refresh protocol.

## Acceptance Criteria

- [ ] A replay/restart of the same Run reconstructs identical monitor summaries and trajectory rows from the durable
  Run Event ledger.
- [ ] A successful model request exposes provider/model, start/finish state, measured duration, first-stream/TTFT data
  when produced, and usage quality without fabricating missing values.
- [ ] A successful and a failed tool invocation each produce a readable call/result row with outcome, bounded error
  classification, and duration when known.
- [ ] Retry, recovery, approval, and context facts appear only when emitted by their fixed Core producers and can be
  filtered/inspected without exposing protected payloads.
- [ ] A provider with no cache signal displays `缓存信息未提供`; no `miss`, zero, or hit-rate is inferred.
- [ ] The Monitor uses a DSH-shaped left-browser/center-ledger/right-Inspector layout on wide screens and a usable
  responsive fallback on narrow screens.
- [ ] Every expandable Monitor section can be collapsed again, and the Inspector has a visible close control.
- [ ] Primary Monitor labels and accessibility text are Chinese; opaque IDs/hashes/generations are absent from ordinary
  rows and default details.
- [ ] Live committed events update the selected Run without leaving/re-entering the page; older-history loading and
  tail-follow behavior do not steal the user's scroll position.
- [ ] `DISABLED`, `FEEDBACK_ONLY`, and `FULL_LOCAL` preserve their privacy and availability contracts.
- [ ] Core, Shared, and Desktop tests cover schema strictness, producer absence/unknown behavior, replay equality,
  filters, disclosure state, close behavior, reconnect/backfill, and protected-content exclusion.

## Definition of Done

- Shared contracts, Core producers, projections, WS methods, and Desktop Monitor UI are updated together.
- DSH reference behavior is cited in the design and verified against the local reference source; no new observability or
  UI framework is introduced.
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

- Current TakiAgent events are limited to lifecycle/effect/usage; proposed model/tool/context/governance/recovery event
  kinds are additive recommendations and must be finalized against live AI SDK stream shapes before implementation.
- Current Monitor Inspector is technical-field-first and permanently appended to the page. D68 explicitly replaces that
  presentation with a dismissible, semantic-first Inspector.
- Existing `run_events` stores JSON payloads, so additive event kinds do not require a SQLite migration unless measured
  volume later proves an index/materialized-counter need.
