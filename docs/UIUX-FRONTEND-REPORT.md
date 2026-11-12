# Frontend UI/UX Program — Delivery and Follow-up Report

> Task `.trellis/tasks/08-30-frontend-uiux-optimization` (child of 08-22). Scope executed by the T4
> Leader session 2026-08-30/31 under the owner mandate "implement the pure-frontend batches in order,
> one commit each, then summarize". Cross-batch total: **136 files, +4,621/−853 lines, 7 commits,
> desktop tests 419 → 548, all formal checks PASS / PASS-WITH-FIXES (all findings repaired)**.
> Requirements source: `docs/UIUX-OPTIMIZATION.md`; design: the task's `design.md`; every batch passed
> the gates (desktop typecheck, full desktop test suite, scoped ESLint, `git diff --check`, vite build).
> Nothing outside `apps/desktop/**` (+ two spec files + task docs) was touched; the parallel compaction
> session's tree content was never modified.

## Owner feedback and scope refresh — 2026-09-05

The owner reports that the non-Monitor visual baseline is broadly satisfactory, with its small UI/UX
details deferred to a focused later pass. G5 explicitly excludes Monitor: its current page only proves
traceability, and its information organization, Chinese coverage, interaction and visual quality are
not accepted. D68-B must port/rebuild primarily from DSH Trajectory. The original batch evidence below
is historical; the new G4 implementation has its own evidence and does not certify Monitor acceptance.

The [G1 grill record](../.trellis/tasks/08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md)
tracks the next stage: Monitor, Chat/Pet live tool feedback, and readable tool/capability/approval
information. The existing task remains pure frontend. Cross-layer batches require their own reviewed
artifacts; Live2D configuration and theme/font settings entries remain later work.

Owner G4 clarification: hashes, internal revisions/generations and opaque identifiers must be removed
from user-facing details as well as card faces. Batch 4's historical move into technical disclosures
does not satisfy this requirement. The [current removal inventory](../.trellis/tasks/08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md)
covers MCP/Skills, shared extension status, Settings, Monitor and import feedback. Its first pure-frontend
slice is now implemented; cross-layer labels and Monitor remain under their respective children.

## G4 follow-up — useful-information cleanup (2026-09-05)

Removed MCP/Skills internal bookkeeping and metadata dumps, shared Host identity copies, permission
revision counters and raw import identity. Useful tools, package declarations/files, outcomes, counts,
timing and actions remain. MCP service wording now follows actual connected state, and extension
status explicitly distinguishes old snapshots from current availability.

Independent review passed without fixes: workspace typecheck, root lint (one preexisting Core warning),
Desktop 108 files / 594 tests, scoped ESLint and Vite build. No commit was made. Actual WebView2 and
owner visual acceptance remain pending. Full scope and protection evidence:
[G4 implementation evidence](../.trellis/tasks/08-30-frontend-uiux-optimization/implementation-evidence-g4-2026-09-05.md).

## Batch 1 — token foundation + four defect fixes (`266cad8`, 26 files)

**Implemented**: semantic token layer in `src/styles.css` `@theme` (accent/danger/ok/warn/link); rose
stays brand accent, danger moves to red (role separation); approval dialog semantics fixed (allow =
primary, deny = danger-soft — was inverted); IME-safe Enter in composer and pet bubble; `lang="zh-CN"`
+ pinned font stack + global button `cursor: pointer`; tool-card emoji → self-drawn `ToolIcon`.

**Files**: `styles.css`, `approval-dialog.tsx`, `composer.tsx` (+test), `chat-bubble.tsx` (+test),
`app.tsx`, `pet-stage.tsx`, `markdown-view.tsx`, `tool-card.tsx`, `action-button.tsx`, `badge.tsx`,
`page-chrome.tsx`, three entry HTMLs, `lib/icons/tool-icon.tsx` (new) + icon tests/index.

**Expected changes**: pinyin candidate confirmation no longer sends half-typed messages; every button
shows a hand cursor; approval colors match learned danger semantics; errors read red, selection stays
rose; emoji rendering hazards gone.

## Batch 2 — unified primitive layer + adoption (`c0f45b8`, 82 files)

**Implemented**: 8 primitives in `components/ui/` — **SelectionTile** (one selection recipe, ring
emphasis, aria-pressed/aria-current), **Dialog** (focus trap, initial focus, restore, escape policy;
approval migrates fail-closed with no close affordance), **Field** (label association + shared control
class), **FeedbackLine** (danger→alert roles, retry action slot), **EmptyState**, **Skeleton**,
**CopyableRow** (min-w-0, truncate, copy feedback), **IconButton** (labelled, 28/32px); ActionButton
gains `ghost/link/accent` tones, `pill` shape, `busy` (aria-busy). Full adoption: composer's private
button deleted, 17 hand-rolled buttons and 3 hand-rolled cards migrated, 5 selection recipes unified.
A11y closures: **A4** toast (aria-live, close button, 4-cap, click-pause — D34 deviation closed),
**A5** one global `:focus-visible` accent outline, **A6** pending states (MCP save, knob commit,
tidy/purge), **A7** ≥32px hit targets, **A8** live regions + keyboard-scrollable PageBody/timeline.
8 new glyphs (x/copy/check/alert-triangle/chevron-down/external-link/image-off/image-plus); inline
SVGs promoted. 4 implementer deviations ruled sound by formal check; 4 minors repaired (Dialog focus
containment for out-of-card focus, connection-status rose→danger, CopyableRow catch + contract
wording, `bg-surface`).

**Files**: all of `components/ui/**` (8 primitives + tests + index.md), most pages/components/features
(82 files total), 8 new `lib/icons/*-icon.tsx`.

**Expected changes**: every list has designed loading/empty/error-with-retry; toasts dismissible by
keyboard, capped, click-pausable; approval dialog is keyboard-operable (Tab stays inside, focus
restored); selection looks the same on every page; MCP save shows 保存中; theme change = one file.

## Batch 2.5 — theme/font-size entry-readiness (`5eed5fd`, 28 files)

**Implemented** (owner ruling: no settings entry yet, layer must accept one): every `--text-*` rides
`calc(<rem> * var(--text-scale, 1))` (scale var verified in emitted CSS); theme seam documented
(`[data-theme]` redefinition pattern) and ENFORCED — all remaining raw hue/slate literals swept
(`app.tsx` legacy window, pet-stage, operation-wheel, markdown PROSE, tool-card, timeline-message;
only sanctioned alpha-black/white remain); new tokens `accent-muted`, `warn-deep`,
`shadow-card/overlay/modal` (all shadow literals swapped); `prefers-reduced-motion` base rule;
contrast pass (15 meaningful `text-faint` sites → `text-secondary`).

**Expected changes**: a future theme switch or font-size setting is ONE variable override + one
config key — zero page edits; small text readable; OS reduce-motion respected (typing dots, shimmer,
wheel appear collapse).

## Batch 4 — extension cards, master-detail, settings groups, labels, banner (`358ca1f`, 30 files)

**Implemented**: **U2/U3** MCP/Skills cards rebuilt on DSH human-facing projections — display-name
titles, status badges, truthful dismissible diagnostics (re-show on NEW outcome, last-good preserved),
technical fields (修订/代次/Owner/哈希/Catalog generation) only inside collapsed disclosures with
CopyableRow; **L2** master-detail two-pane via container queries (`@xl`=576px container; two panes at
the default 900px window, vertical stack below); **U7** settings regrouped into 5 Chinese sections
(权限与审批/模型与上下文/感知与隐私/存储与缓存/高级) via a client-side key→group map (exact + prefix +
safe fallback, nothing hidden), search over key/label/description, knob rows Chinese-label-primary
with key as secondary code; **N4** monitor UI vocabulary Chinese via a labels seam delegating wire
vocabulary to the shared presentation map (read-only) with supplement + raw fallback, filters derived
from the zod enums (adds the missing 请求取消); **U6** connection banner = `--z-notice` overlay strip
— no layout shift on reconnect. Formal check: 1 minor repaired (`row.surface` Chinese label); 4
deviations ruled sound (shared `observabilityLabel` reuse, container-query threshold, schema-derived
filters, no premature primitive).

**Files**: `pages/mcp/{mcp-labels,mcp-server-list}.ts` (new), `mcp-server-card/page/state` reworked;
`pages/skills/{skill-labels,skills-list,skill-card}.ts(x)` (new/reworked); `pages/settings/
{config-groups.ts (new), knob-field, settings-page}`; `pages/monitor/{monitor-labels.ts (new),
monitor-page/-view}`; `components/connection-status/*`; `home-shell.tsx`; tests updated faithfully.

**Historical result and current limitation**: internal fields were moved off card faces into technical
disclosures. G4 now requires removing those fields from details too. MCP/Skills browse as list + detail
pane; Settings are grouped/searchable; Monitor labels were localized; the connection banner reserves
its presentation space. The new metadata-removal requirement remains to implement.

## Batch 5 — streaming, memory, visibility, DSH monitor scaffold, bundle (`865b896`, 29 files)

**Implemented**: **P1a** chat deltas coalesced through a 40ms trailing-edge flusher (`chat-delta-
coalescer.ts`; first delta immediate; rAF rejected — hidden windows pause it; no polling loop);
atomic persisted-swap / clearInflight / scroll-follow contracts preserved and test-pinned. **P1b**
timeline mount cap 300 with exact `nextBefore` re-point (trimmed rows refetchable, no holes) +
加载更早消息 jump restore + image data-URL LRU (40, failure eviction). **P1e** `page-visibility-store`
(single writer: home-shell); hidden monitor tears down live subscription and suppresses publishing
with visibility surviving dispose (reconnect-while-hidden stays gated — check-found major, repaired);
perception reads skip while hidden; chat deliberately stays live (backlog-on-return). **L1** monitor
DSH three-zone scaffold: Run browser / ledger / closable resizable inspector (320–440px drag +
keyboard steps, stacks inline when narrow); `MasterDetail` shell extracted (third consumer) and
adopted byte-equivalently by mcp/skills. **P1f** react-markdown lazy chunk + `target: "esnext"` —
home entry **265.7 kB → 115.1 kB** (gzip 80.4 → 35.7 kB). **P1g** spike removed from production
build (dev-only input; dist verified clean). Formal check: 1 major + 3 minors repaired.

**Expected changes and limits**: coalescing reduces state updates and Markdown parse frequency, but
the accumulated text is still reparsed on each flush; incremental parsing and stutter-free long replies
are not proven. Mounted timeline rows and the image cache are bounded while older rows remain
accessible; hidden Monitor rendering/subscriptions are gated. The three-zone component is implemented,
but the 2026-09-05 source audit found its right pane unreachable inside the current PageBody width
(about 45rem available versus the 48rem container breakpoint). Actual wide-window layout and resizing
remain D68 work. Under G5, the whole Monitor presentation must follow the DSH source baseline; fixing
the breakpoint alone is insufficient. The recorded build loaded ~57% less home-entry JS and excluded spike scaffolding.

## Batch 6-FE — pet overlay hot-path economy (`15c4111`, 11 files)

**Implemented**: **P1c** alpha-mask readback gated to every 4th governed frame
(`frame-gated-refresher.ts`, framework-free, no timers) with forced refresh at silhouette jumps
(scene build, model attach/costume switch, canvas resize); ≤4-frame silhouette staleness accepted
and documented; sampling untouched; zero refreshes while the governor pauses. **P1d** cursor poll
24→32ms with `innerPosition` cached (lazy first fetch, poll-observed drag end, `onMoved`/`onResized`
dirty flags, 2s TTL backstop) and the interval fully stopped while `document.hidden`; coordinate
math extracted (`cursor-poll.ts`) and unit-pinned. Idle IPC 83/s → ~31/s, 0 while hidden; idle
readbacks 60/s → 15/s. Stale spec line in `live2d-renderer.md` updated. Formal check PASS.

**Expected changes**: the always-on overlay costs roughly a third of its former IPC and half its
per-frame GPU readback work; nothing user-visible changes except (theoretically) mask edges trailing
up to 4 frames during fast motions — owner manual checks listed in the commit message.

## Batch 7 — reactive read-model contract, D67 frontend side (`97c7c46`, 12 files)

**Implemented**: new spec `.trellis/spec/frontend/reactive-read-models.md` codifying the rules the
app now follows (push handlers generation-guarded; per-generation refetch without write replay; no
polling; hidden-gating matrix; per-page restore-seam table; scroll discipline; stale/busy from real
signals only), linked from `home-window.md` + spec index. Settings family: `config.changed` deltas
apply-skip while hidden (`config-gate.ts`, 7 tests) with a single deduped refetch on reactivation
(closes the batch-5 flagged gap); permissions listeners stay live. Monitor ledger tail-follow:
bottom-pinning keyed on row count, pause-on-scroll-up with a truthful 已暂停跟随·回到底部
affordance, keyboard scroll retained, selection remount resets the pin. Skills inspect section now
closes both ways (U1 audit follow-up). Full expandable audit: all disclosures two-way. Formal check
PASS (2 advisories — both addressed/accepted).

**Expected changes**: settings seen after a background config change are never stale; the monitor
ledger behaves like the chat timeline at the bottom (follows when pinned, stops stealing position
when scrolled up, offers an honest way back); every disclosure in the app collapses; the D67
contract is now written law for future pages.

## Remaining work and ownership — 2026-09-05

| Item | Ownership / dependency | Frontend consumer |
|---|---|---|
| Monitor DSH Trajectory UI port/rebuild | D68/G5; reference components/styles/interaction over proven Core facts, with missing producers identified separately | DSH-led layout and visual hierarchy, complete Chinese UI copy, correct selection/live/history behavior, useful metrics and G4 metadata removal |
| G4/D65 information cleanup | Desktop presentation, with separate safe-label projection work where needed | Remove internal bookkeeping from MCP/Skills, Settings, shared status, Monitor and import feedback, including expanded details |
| U8/U9/U10 live tool feedback | D67; Core/Shared/Desktop contracts (`chat.tool` is only a proposed event name) | In-flight tool entries, truthful activity feedback, separate Pet text segments and temporary tool bubbles |
| Live/persisted tool outcome reconciliation | D67 tool-feedback batch; canonical call/result identity and outcome semantics | Completed calls stop looking active; structured failures do not look successful |
| N1/N2/N5/N7/I1 readable names | Core approval labels + shared presentation contract | Tool names, permission titles, durable approval list and dialog copy |
| N3/D64 exec command disclosure | Rust challenge presentation; existing safe-disclosure contract | Approval dialog command-specific context |
| L4/P1h/D19/D38 config batch | Later work, outside G1; Core config keys + Pet application | Costume 3-column page (L3), unified fps, idle-pool editor, render-throttle key |
| Settings entry for theme/font-scale | Later work, outside G1; Core config keys | Existing seams (`--text-scale`, `[data-theme]`) |

Owner visual feedback is recorded above. Keep specific unverified acceptance items open, including
Pet overlay behavior, real Monitor pane sizing/resizing, asynchronous selection/reconnect behavior,
and long-stream profiling. Broad visual approval does not automatically check every PRD criterion.

## Metrics

- Desktop test suite: **419 → 548 tests** (103 files), all green; ESLint clean; typecheck clean.
- Home entry chunk: **265.7 kB → 115.1 kB** (gzip 80.4 → 35.7 kB); markdown stack on demand (154.9 kB async).
- Pet overlay: idle IPC **~83/s → ~31/s** (0 hidden); mask readbacks **60/s → 15/s**.
- Raw hue/slate literals in tsx: **~55+ slate + 55 rose/amber/emerald/sky → 0** (sanctioned alpha-black/white only).
- Distinct font sizes: **8 → 4**; selection recipes **5 → 1**; hand-rolled buttons **17 → 0** (home surfaces).
