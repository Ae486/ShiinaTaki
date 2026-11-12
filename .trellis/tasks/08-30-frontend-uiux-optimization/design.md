# Batch 2 Design — Unified Primitive Layer + Token Adoption (08-30-frontend-uiux-optimization)

> Grounded in the 2026-08-30 primitive inventory (every claim below has file:line evidence in the
> implement.jsonl-referenced survey; re-verify at implementation time). Scope: `apps/desktop` only.
> Batch-4 page redesigns (MCP/Skills cards, master-detail, settings regroup) and batch-5 monitor
> three-zone layout are OUT — batch 2 delivers the primitives + tokens + adoption + a11y closures.

**Document status, 2026-09-05:** this is the Batch 2 design with Batch 2.5 and Batch 7 appendices,
not a complete design for the next UI/UX stage. Follow the
[G1 grill record](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md)
for confirmed scope and current evidence. Later cross-layer work requires its own complete planning
artifacts; this task remains pure frontend.

G4 supersedes this historical design's suggestions to move hash/Owner/revision/generation fields into
technical disclosures. Remove meaningless fields from user-facing details entirely. Keep CopyableRow
and other primitives for useful values; follow the [current field inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md)
and the updated frontend field-selection contract for further implementation.

## 1. Token additions (`src/styles.css` `@theme`)

- Neutral steps: `surface`(white) / `surface-muted`(slate-50) / `surface-sunken`(slate-100) /
  `surface-strong`(slate-800) / `surface-deep`(slate-900) / `backdrop`(slate-950/35);
  `border`(slate-200) / `border-subtle`(slate-100) / `border-strong`(slate-300);
  `text-strong`(slate-800/900) / `text-body`(slate-600/700) / `text-secondary`(slate-500) /
  `text-faint`(slate-400).
- Accent extras: `accent-text`(rose-700), `accent-border`(rose-200), `accent-border-strong`(rose-300),
  `accent-deep`(rose-900/950 for dark toast/notice surfaces). Send pills normalize from `rose-400`
  to `accent` (rose-500) — a visible one-step darkening, listed for owner acceptance.
- Font-size collapse (8→4): `--text-xs`=12px absorbs 10/11px, `--text-sm`=13, `--text-md`=15,
  base stays 16. Keep markdown `0.85em` relative.
- Radius: sm(md) / md(lg) / lg(xl) / xl(2xl) / full — eliminate bare `rounded` drift.
- Z scale: `--z-notice:10`, `--z-wheel:20`, `--z-dialog:50`, `--z-toast:50`; give ChatBubble an
  explicit tier. Duration: `--duration-fast:120ms`, `--duration-base:150ms` (explicit, was implicit).
- Normalize card-content padding drift to card rhythm: knob rows `px-5 py-3.5` → card row step,
  permission rows `px-4 py-3` + `-mx-4 -my-3` bleed → one shared row padding.

## 2. Primitives (`components/ui/`, each with an `index.md` contract + tests)

1. **SelectionTile** — `selected, onSelect, disabled, layout: "block" | "row",
   stateAttr: "aria-pressed" | "aria-current", emphasis: "ring" | "border"`. Unifies the 3 selection
   recipes onto ONE accent recipe: selected = `bg-accent-soft text-accent-text ring-1 ring-accent-border`
   (ring variant, majority today), idle = `text-body hover:bg-surface-muted`. Adopters: home-shell nav
   (6th site, as row+aria-current), monitor run tile + trajectory row, permission-level-card,
   costume-row, mcp KindPicker (gains the aria state it lacks).
2. **Dialog** — `open, onClose, escapePolicy: "close" | "none" (approval = "none", fail-closed),
   labelledBy/aria-label, size: "md" (max-w-lg) | "lg", status/alert slots, built-in close button,
   focus trap + initial focus + restore on close, backdrop z-dialog`. Only consumer this batch:
   approval-dialog (A1 closes here). Do not build portal/side-drawer machinery yet.
3. **Field** — `label, htmlFor/id auto-pair, hint?, invalid?, children` wrapping a control; control
   class tokenized: `rounded-md border px-2.5 py-1.5 text-xs focus:ring-2 ring-accent/…` (fixes the
   near-invisible mcp ring and the no-focus monitor filters). Adopters: knob-input (all variants),
   mcp-server-editor (incl. the unassociated env/header name+value pair), monitor filters. Checkbox
   keeps `accent-*` (no Toggle primitive — 0 sites justify it).
4. **FeedbackLine** — `tone: "danger" | "warn" | "ok" | "info", role auto (danger→alert, else status),
   action?: { label, onClick }` (the retry affordance). Absorbs: PageAlert internals (page-chrome
   delegates), the 6 bare colored `<p>`s (knob notices, storage, permission-section), mcp 3-tone
   FeedbackBanner, mcp editor error box. ErrorState-with-retry = FeedbackLine danger + action; the 9
   retry-less failed reads gain retry via this.
5. **EmptyState** — `icon?, title, hint?, action?`; adopts the 12 bare empty `<p>`s; mcp-page's
   designed EmptyState PageCard becomes a consumer, not a one-off.
6. **Skeleton** — `lines?: number | block`; thin wrapper over `animate-pulse` (no shimmer system);
   replaces the 11 bare "载入中…" lines where a layout stub helps, else EmptyState/loading copy via
   FeedbackLine info. Image-attachment shimmer block becomes a Skeleton block consumer.
7. **CopyableRow** — `label, value, mono?, onCopy feedback ("已复制" transient)`; fixes `min-w-0` +
   truncate. Adopters this batch: monitor-view inspector technical fields (replaces its hand-rolled
   copy button) + inspector detail dl `min-w-0`, skills-page 哈希/Owner/修订 rows, extension-convergence
   shortId. MCP card lines wait for batch-4 card redesign.
8. **IconButton** — `label (required, aria), children: glyph, size, tone`; adopters: composer attach +
   thumbnail remove (grows to ≥32px hit target, A7), chat-bubble open/close (same).
9. **ActionButton extension** — new tones `ghost` (slate text, hover surface-sunken: monitor 复制,
   bubble close) and `link` (accent text: perception 前往设置), plus `shape: "pill"` for the 3 send
   pills (composer private component deleted, chat-bubble send, approval re-implementation migrated).

## 3. A11y closures riding the adoption (PRD items 8-13)

- **A4 toast**: `role="status"`/`aria-live="polite"` on the stack, per-toast close IconButton, stacking
  cap (e.g. max 4, oldest dropped), click-on-card pauses its timer (closes the D34 deviation),
  keyboard dismissal (Escape clears the stack), tones move to `bg-danger-deep` / `surface-strong`.
- **A5**: every primitive carries the shared focus-visible ring token; the mcp editor ring fix is the
  Field adoption.
- **A6**: pending state on MCP editor save button (disabled + `保存中…`) and knob commit (transient
  `保存中…` via FeedbackLine); buttons get `aria-busy`.
- **A7**: hit targets ≥32px for IconButton/ghost in operator surfaces (pet bubble exempt where the
  overlay constrains, but bubble open/close go to 28px minimum).
- **A8**: FeedbackLine roles cover status/alert; PageBody + chat timeline get `tabIndex={0}` +
  keyboard scrolling; "上滑查看更早" → "滚动查看更早消息".
- **U1**: monitor inspector PageCard gains a 关闭 ActionButton (tone ghost) and clicking the selected
  row again deselects (controller state, generation-guarded as today).
- **U4**: CopyableRow + LabeledRows detail dl `min-w-0`.

## 4. Glyphs (`lib/icons`, one file each + icons.test.tsx rows)

Add: `x` (close), `copy`, `check`, `alert-triangle`, `chevron-down` (two-way disclosures), `external-link`,
`image-off` (expired attachment placeholder), `image-plus` (attach). Promote the two inline SVGs
(composer attach `composer.tsx:47`, bubble expand `chat-bubble.tsx:57`) to glyph files. Spinner stays CSS.

## 5. Explicitly NOT built (YAGNI, per inventory §12)

No Row/ListItem (marginal, 3 sites — revisit at batch-4 drawers); no Toggle/Switch (0 sites); no
portal/drawer machinery in Dialog; no shimmer system; wheel geometry, pet keep-interactive plumbing,
markdown PROSE string, two-step confirm state machines, approval choice gating, ExtensionConvergenceStrip,
TypingDots, DateDivider, Brand all stay bespoke.

## 6. Visual changes to flag for owner acceptance

1. Send pills darken one step (rose-400 → accent rose-500).
2. Selection recipes unify on the ring recipe — monitor/permission tiles change border→ring emphasis.
3. Badge/10-11px text moves up to 12px (xs) — slightly larger small text everywhere.
4. Monitor filters/trajectory rows lose bare `rounded` for `rounded-md`.
5. Approval dialog gains a visible close affordance? NO — approval keeps no-dismiss policy; Dialog's
   close button renders only when `escapePolicy="close"` (used by batch-4 drawers).

## 7. Verification

- `pnpm --filter @taki/desktop typecheck` and `test` green; `pnpm exec eslint apps/desktop/src` clean.
  Historical Batch 2 scope: workspace gates were excluded because the parallel compaction session
  then had uncommitted Core failures. This is not a current failure claim or a standing waiver for
  future batches; use current task/spec gates and preserve other contributors' changes.
- `git diff --check`; `pnpm --filter @taki/desktop exec vite build` to confirm token emission.
- Each primitive: at least one behavior test (selected state attr, escape policy, copy feedback,
  toast cap/pause). Spec §home-window "Streaming timeline" and markdown XSS tests must stay green.
- Do not commit; leave the tree for Leader review + formal check.

## 8. Batch 2.5 — entry-readiness sweep (2026-08-30, committed separately)

Owner ruling: no settings entry yet, but the layer must accept one at any time. Delivered:

- **Font-scale seam**: every `--text-*` is `calc(<rem> * var(--text-scale, 1))` — a future
  `html { --text-scale: … }` scales all four steps; `--text-scale` verified present in emitted CSS.
- **Theme seam documented + enforced**: styles.css header documents the `[data-theme]` override
  pattern and the sweep rule (raw hue/slate literal in tsx = review finding; alpha-black/white over
  token surfaces are the only sanctioned literals). ALL remaining literals swept: app.tsx, pet-stage,
  operation-wheel (incl. `z-(--z-wheel)`, text-xs), markdown PROSE, tool-card, timeline-message
  (user bubble → `accent-muted`).
- **New tokens**: `accent-muted`(rose-100), `warn-deep`(amber-900), `shadow-card/overlay/modal`
  (all shadow-sm/lg/2xl sites swapped; zero bare `shadow` left).
- **prefers-reduced-motion** base rule (wheel appear, typing dots, shimmer collapse to end state).
- **Contrast pass**: 15 meaningful `text-faint` sites → `text-secondary` (page hints, empty texts,
  refresh/loading states, owner lines, monitor connection line, subject lines, badge muted tone,
  scroll hint, 切换中 pending); decorative icons and disabled states keep faint.
- Gate evidence: desktop typecheck/test(487)/eslint clean, vite build with token emission verified.

## 9. Batch 7 — D67 reactive read-model consolidation (final frontend batch)

Owner framing: after batches 1-6-FE most of D67's acceptance already exists piecemeal. This batch
consolidates it into ONE contract and closes the remaining cheap gaps; it explicitly does NOT wait
for U8/U9/U10 live tool events (D67 follow-up; tool-arrival order stays out of scope here).

1. **Contract doc** (new `.trellis/spec/frontend/reactive-read-models.md`, linked from home-window.md):
   codify the rules the app now actually follows — (a) push-driven pages update from WS events with
   generation-guarded handlers; (b) request/response pages refetch per authenticated client generation
   and never replay writes; (c) NO polling intervals in home windows (quality-guidelines); (d) hidden
   keep-alive pages gate expensive live work (monitor) while additive-delta listeners (config.changed)
   stay live; (e) reconnect recovery = per-page restore seam (chat timeline restore, monitor
   restore+refresh, perception reactivation refetch, mcp/skills generation refetch); (f) scroll
   discipline: bottom-pinning + pause-on-scroll-up + load-older hold; (g) stale/busy indications from
   real signals only (PageHeader busy; monitor stale from cursor lag) — never invented states.
2. **Settings-family hidden gating, the cheap correct shape**: `config.changed` deltas are full-value —
   while a settings page is hidden, SKIP the local apply (state can't be observed) and mark stale;
   on reactivation, refetch instead of replaying a delta queue. Applies to `use-config`; permissions
   listeners stay live (rare, small, correctness-sensitive).
3. **Monitor ledger tail-follow**: trajectory ledger gains bottom-pinning with pause-on-scroll-up and
   resume-at-bottom (the chat hook pattern, reused — extract `useTailFollow` only if ≥2 consumers
   materialize, else inline) + a live activity affordance only when Core actually streams run events
   (no fake "live" pill when nothing pushes).
4. **Expandable audit**: re-verify every disclosure/details added across batches collapses both ways
   (batch-2 U1 rule) — report as a checklist, no new UI.
5. Out of scope: any Core/shared change; tool-arrival ordering (U8/U9/U10, D67 follow-up); polling;
   invented stale states.

## 10. G4 follow-up — useful information cleanup (2026-09-05)

This is the first batch of the owner-approved next UI/UX sequence. It changes presentation only,
using the existing snapshot/controller contracts. The [execution plan](implement.md) owns dispatch,
file boundaries, gates and evidence; sections 1–9 above remain historical batch designs.

| Surface | Presentation change | Retained behavior/data |
|---|---|---|
| MCP detail | Remove config revision, runtime generation, Owner and enumeration page count. Show selected tools only when useful; no empty technical disclosure. Use service/outcome wording the operator understands. | Transport/configuration, tool count, actual duration/result, diagnostics dismissal, test/reconnect/edit/enable/remove; last-good availability only when actually supported by the snapshot |
| Skills detail/inspection | Remove the technical disclosure and catch-all custom metadata. Show declared license, compatibility and allowed tools when present, with Chinese labels; name/description already belong to the card. Retain bounded relative files. | Trust, source, validation/runtime state, inspect, replace/enable/remove, confirmation and inspection collapse |
| Extension status | Remove shortened/full Core Host identity and its copy control. Label availability, extensions and name conflicts in Chinese. | Real counts and refresh/failure state; no invented availability |
| Permission settings | Remove policy-generation badge and registry-revision suffix; explain operator-relevant safety limits in ordinary Chinese. | Actual policy snapshot, levels, cell identity, second-confirm/hard limits, generation guards and callbacks |
| Costume import feedback | Use a real supplied name if available, otherwise a generic import-success message with costume count. Never derive a display name from an opaque ID. | Import outcome, warnings, errors, list refresh and costume selection |

Known source anchors and reference rationale are in the parent
[field inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
Do not add a metadata sanitizer: select known useful fields at the render site, preserving all
canonical objects for existing actions. A tool result containing a requested checksum or version is
business content and is not removed by substring filtering.

No new state store, event, polling, animation framework or dependency is needed. Keep existing
disclosures collapsible and loading/error/confirmation behavior stable. Meaningful capability and
permission-cell labels require the separately planned shared/Core work; Monitor's G4 cleanup ships
with its DSH presentation rebuild rather than modifying the rejected scaffold in this batch.
