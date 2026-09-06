# Desktop Frontend UI/UX Optimization (Pure-Frontend Phase)

## Goal

Execute the frontend-only portion of `docs/UIUX-OPTIMIZATION.md` (created 2026-08-30 from a code-level
audit plus owner directives) so that the operator surfaces stop drifting visually, meet baseline
accessibility, and stream/scroll honestly — without touching `packages/core`, `packages/shared`, or
`src-tauri` production code. Cross-layer seams (shared label maps, Core approval labels, the `chat.tool`
live event, Live2D config keys) are consumed by later batches and are explicitly out of scope here.

## Status and follow-up boundary — 2026-09-05

G4's first pure-frontend cleanup slice is implemented and independently checked. See
[the slice evidence](implementation-evidence-g4-2026-09-05.md): 19 files, all required automated gates
passed, Desktop 108 files / 594 tests at that checkpoint. Subsequent isolated WebView2 QA passed
12/12 groups and G4 was committed with A1/A2 as `a771496`. This is engineering evidence, not personal
owner inspection; no historical task-wide acceptance or lifecycle closeout is implied.

The owner considers the non-Monitor visual baseline broadly satisfactory and defers its small UI/UX
details to a later focused pass. G5 excludes Monitor: the current page is only a functional prototype,
and D68 owns its DSH-led presentation rebuild. No broad feedback certifies all asynchronous-state or
performance criteria.

The [G1 grill record](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md)
coordinates the next Monitor, Chat/Pet tool-feedback, and readable naming/approval work. This task
keeps its pure-frontend boundary. Monitor follow-up belongs to D68; cross-layer tool/name/approval
work needs separately reviewed batches. Live2D configuration and theme/font settings remain later work.
The initial checklist below records the original requirements, not a fresh list of wholly unimplemented
features; see [the delivery report](../../../docs/UIUX-FRONTEND-REPORT.md) for shipped batches and limitations.

Owner follow-up: applicable frontend changes must preserve layout stability, reading position, and
control/focus continuity during insertion/removal, disclosure, refresh, and feedback. Use the shared
[motion continuity design](../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md)
when planning the relevant batch; it does not add cross-layer work to this task or certify old batches.

G4 also requires removal of meaningless internal information from all user-facing details, not merely
moving it off card faces. Follow the [reference study and field inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
Pure Desktop removals remain within this task's boundary; missing Core label projections belong to
their separately planned workstream. Preserve canonical identities, CAS and generation guards.

## Scope boundary

- In: `apps/desktop/src/**`, `apps/desktop/vite.config.ts`, `apps/desktop/index.html` family,
  `src/styles.css`. Test files follow the code they cover.
- Out: any `packages/**` or `src-tauri/**` production change. `src-tauri/Cargo.toml` devtools feature
  (P1g) is a one-line build flag that may ride along ONLY if the batch touches release hygiene anyway;
  otherwise defer.
- Owner directives honored: unified component set (no third-party library — tokens + own primitives),
  no meaningless generic naming (UI-side parts), collapsible disclosures, multi-column where it pays,
  true streaming (blocked on Core event — not this phase).

## Requirements (checklist; IDs refer to docs/UIUX-OPTIMIZATION.md)

### Batch 1 — tokens and four one-line-class fixes

1. **C1** Semantic token layer in `src/styles.css` `@theme`: accent / danger / ok / warn, surface-border-
   text steps, font-size scale (collapse 10/11/12/13/15 → 4 steps), radius/spacing steps. Pages and
   primitives stop writing raw `rose-*`/`slate-*` literals for these roles.
2. **C2** rose double-meaning separated (accent vs danger); palette drift cleaned: `red/green` in
   `app.tsx:48,66`, `pet-stage.tsx:65`, `approval-dialog.tsx:53`; `sky` link color in `markdown-view.tsx:19`.
3. **C3** Approval dialog tones: allow = primary/accent, deny = danger-soft (`approval-dialog.tsx:62-64`).
4. **A2** IME-safe Enter: `event.nativeEvent.isComposing` guard in `composer.tsx:130-135` AND the pet
   bubble input.
5. **C5/A3** `<html lang="zh-CN">` in all three entry HTMLs; pinned font stack; one base-layer
   `cursor: pointer` rule for enabled buttons.
6. **N5a** `tool-card.tsx:28` emoji icon → `lib/icons` glyph (raw tool key display stays until the shared
   label map lands).

### Batch 2 — primitives and adoption

7. **C4** New primitives in `components/ui/` (each with an `index.md` contract): SelectionTile/GhostButton,
   Dialog (focus trap + Escape + focus restore; approval dialog migrates), Skeleton/EmptyState/ErrorState
   (with retry), CopyableRow, Field (label association). Migrate drifted call sites: composer's private
   `ActionButton` (`composer.tsx:78`), the 17 hand-rolled buttons, 5 selection recipes, 3 hand-rolled cards.
8. **A4** Toast: `role/aria-live`, close button, stacking cap, click-pauses-timer (closes the D34 deviation),
   keyboard dismissal.
9. **A5** Standardized focus-visible token on all primitives; fix the near-invisible MCP editor ring
   (`mcp-server-editor.tsx:11`).
10. **A6** Visible pending state on mutations: MCP editor save (`mcp-page.tsx:88-99`), knob commit-on-blur
    (`knob-field.tsx:40-44`).
11. **A7** Hit targets ≥32px on operator surfaces (attachment remove, bubble buttons, ActionButton height).
12. **A8** `role="status"/"alert"` on PageAlert/feedback lines; keyboard-scrollable PageBody and chat
    timeline; mouse-neutral "查看更早" wording.
13. **U1** Collapse affordances: monitor inspector close button + click-again-to-deselect
    (`monitor-page.tsx:85,92`); any disclosure added in this task collapses both ways.
14. **U4** CopyableRow adoption for useful values; `min-w-0` fix in `monitor-view.tsx:33-34`.
    G4 supersedes the historical adoption for internal hashes/ids: remove those rows and their copy controls.
15. **U5** Skeleton/EmptyState/ErrorState adopted by all 8 pages; every failed read gets a retry.
16. **C5** font-size collapse executed via the token layer.

### Batch 4 — page-level UX (frontend-only parts)

17. **U2/U3** MCP/Skills card redesign: display name primary, status + tool count only, transport line,
    primary action + grouped secondary actions, dismissible diagnostics banner. Under G4, remove internal
    修订/代次/哈希/opaque Owner from expanded details as well; retain useful selected-tool/package information.
18. **L2** MCP/Skills master-detail layout (list pane + detail/editor pane).
19. **U7** Settings regrouping via a client-side key→group map (权限与审批 / 模型与上下文 / 感知与隐私 /
    存储与缓存 / 高级), Chinese primary label with key as secondary `code`, search box. Coordinate with D54
    (do not restyle knobs likely to be demoted); no Core schema change in this task.
20. **N4** Monitor Chinese label maps for initiator/state/outcome (client-side maps; D68 will unify later).
21. **U6** Connection banner overlays or reserves space instead of shifting content.

### Batch 5 — frontend performance and layout

22. **L1** Monitor three-zone scaffold (Run browser / ledger / closable inspector) against existing
    projections. This historical delivery is traceability/test evidence; G5's product UI rebuild belongs
    to D68 and must follow DSH components/styles/interaction rather than preserve this scaffold.
23. **P1a** Coalesce `growInflight` to a 30-60ms flush; move the scroll-follow effect onto the coalesced
    update (`use-chat-timeline.ts:32`, `use-timeline-scroll.ts:45-56`).
24. **P1b** Cap mounted timeline rows with a "加载更早" jump point; LRU + failure eviction for the image
    data-URL cache (`use-attachment-image.ts:14`).
25. **P1e** Hidden-page visibility gate so keep-alive pages stop rendering while hidden
    (`home-shell.tsx:104-117`, monitor controller bind/dispose).
26. **P1f** Lazy-load chat markdown deps; `target: "esnext"` in `vite.config.ts`.
27. **P1g** Drop `spike` from production rollup inputs (D18-A).

## Non-goals

- N1/N2/N7/I1 shared label maps, N3/D64 exec command disclosure, U8/U9/U10 live tool events (D67 follow-up),
  L3/L4 costume page + Live2D config keys, P1h fps config, D19/D38 closure — all cross-layer, later.
- No dark mode implementation; no third-party component library; no pet interaction-model changes.

## Acceptance Criteria

- [ ] Per batch: workspace typecheck, root lint, `@taki/desktop` test suite green; changed-file ESLint
      clean; `git diff --check`. One final formal `trellis-check` for the whole task, sized to the diff.
- [ ] Approval dialog: keyboard-only operation possible (Tab stays inside, focus restored after close);
      allow/deny tones match the rest of the app.
- [ ] Streaming a long CJK reply shows no per-delta full markdown re-parse (profiling note in implement.md).
- [ ] Monitor inspector and every new disclosure can be closed/collapsed.
- [ ] G4 cleanup excludes internal bookkeeping from primary and expanded UI, tooltips and copy controls;
      useful names/configuration/results and correctly bound mutation/selection behavior remain intact.
- [ ] All 8 home pages render the shared Loading/Empty/ErrorState primitives (no hand-rolled placeholder
      paragraphs left).
- [ ] Owner manual acceptance for anything visual before closeout (per operating rules).

The 40ms coalescer alone does not satisfy the streaming/performance acceptance criterion: accumulated
Markdown is still reparsed on a flush. Likewise, a three-zone component alone does not prove that the
right Inspector is reachable within PageBody. Retain targeted verification rather than marking these
criteria passed from implementation presence or broad visual feedback.
