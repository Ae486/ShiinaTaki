# Batch 2 Design — Unified Primitive Layer + Token Adoption (08-30-frontend-uiux-optimization)

> Grounded in the 2026-08-30 primitive inventory (every claim below has file:line evidence in the
> implement.jsonl-referenced survey; re-verify at implementation time). Scope: `apps/desktop` only.
> Batch-4 page redesigns (MCP/Skills cards, master-detail, settings regroup) and batch-5 monitor
> three-zone layout are OUT — batch 2 delivers the primitives + tokens + adoption + a11y closures.

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
  Do NOT run workspace `pnpm typecheck`/`pnpm lint` as gates — packages/core is currently red from the
  PARALLEL compaction session's uncommitted files; do not touch or fix those, report their presence.
- `git diff --check`; `pnpm --filter @taki/desktop exec vite build` to confirm token emission.
- Each primitive: at least one behavior test (selected state attr, escape policy, copy feedback,
  toast cap/pause). Spec §home-window "Streaming timeline" and markdown XSS tests must stay green.
- Do not commit; leave the tree for Leader review + formal check.
