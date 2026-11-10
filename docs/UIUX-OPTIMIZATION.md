# UI/UX Optimization Task List (Desktop Operator Surfaces)

The owner-revised 2026-11-09 [planning PRD](../.trellis/tasks/11-09-installation-user-experience/prd.md)
prioritizes simpler local flows, empty/incomplete configuration startup, and live
configuration with application-saved values before environment fallback. Its
[design](../.trellis/tasks/11-09-installation-user-experience/design.md) and
[execution plan](../.trellis/tasks/11-09-installation-user-experience/implement.md)
do not require integrated installation. The [earlier whole-product assessment](../.trellis/tasks/11-09-installation-user-experience/research/installation-user-experience-assessment.md)
retains later distribution and broader UX needs alongside the historical audit below.

> Created 2026-08-30 from a code-level audit of `apps/desktop/src` plus owner direction.
> Sources: three code audits (accessibility, visual consistency, performance), DSH trajectory UI study
> (`H:/TakiAgent/references/deepseek-harness-master/packages/client/ui-trajectory`), BANDORI-PET-REV
> costume/display study, and owner directives on naming truthfulness, card UX, and collapse affordances.
> This is the original audit and candidate work map, not a current list of unfinished defects. Several
> frontend batches have since shipped; see [the implementation report](UIUX-FRONTEND-REPORT.md).
> It complements `docs/deferred-decisions.md`; §9 maps audit items to their actual ownership rather
> than reserving new Dxx numbers.
> Verify every file:line against the live tree before implementing.

**Scope refresh, 2026-09-05:** the owner accepts the existing non-Monitor visual direction and defers
its small visual details. Monitor is explicitly excluded under G5 and requires a DSH-led rebuild.
The next stage covers Monitor, Chat/Pet live tool feedback, and readable tool/capability/
approval information. Follow the [G1 decision record](../.trellis/tasks/08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md)
for current evidence and boundaries. The owner has approved the six-batch sequence: G4 frontend
cleanup has passed automated review, and the naming/approval child has entered A1. Unresolved D64
disclosure policy and later source-backed slices retain their explicit gates; the original candidate
designs below are not automatically approved. The existing frontend task
retains its pure-frontend scope. Live2D configuration and theme/font settings entries remain later work.

**Shared interaction requirement, 2026-09-05:** preserve layout stability and motion continuity during
insert/remove, disclosure, live update, and loading-state changes. Existing reading targets, scroll
anchors, and controls must not jump when adjacent content changes. The owner delegated detailed
motion design; see [the coordinated transition design](../.trellis/tasks/08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md)
for Pet bubble handoff and the corresponding Monitor/card/dialog/feedback rules. This is a requirement
for relevant work, not a claim that current surfaces already satisfy it. The Monitor rebuild is
separately required by G5; other pages retain their accepted visual direction.

**Error follow-up, 2026-09-05:** G3c uses a single Pet error bubble containing the error message.
Broader cause/code preservation and readable error copy are owner-deferred as D77; see
[the error-contract follow-up](../.trellis/tasks/08-22-t4-agent-architecture-observability/research/error-code-message-followup-2026-09-05.md).
Do not silently add this cross-layer cleanup to the existing pure-frontend task.

**G4 clarification, 2026-09-05:** remove meaningless hashes, internal revisions/generations and opaque
identifiers from user-facing MCP/Skills, Settings, Monitor and related pages, including expanded
details. A second disclosure/copy control is not the default destination for such fields. Follow the
[reference study and concrete removal inventory](../.trellis/tasks/08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
Preserve useful operation inputs/results/configuration and the internal fields required by actions.

**G5 Monitor baseline, 2026-09-05:** the current Monitor is a functional trace-validation prototype.
Its appearance, information organization, localization and interaction are not accepted. Port/rebuild
the surface primarily from DSH Trajectory components, styles and behavior; follow
[D68's source mapping](../.trellis/tasks/08-28-dsh-observability-expansion/design.md). Traceability alone
does not pass UI/UX acceptance. Chinese system labels and G4 field selection apply throughout the port.

Priorities: **P1** = correctness/safety/trust or user-visible defect; **P2** = clear UX/consistency debt;
**P3** = polish. Batches are the suggested execution order (§10).

---

## 1. Naming and labeling truthfulness ("show the real name, not a generic id")

The owner directive: everywhere the operator sees an approval, a governed capability, or a tool, show the
concrete entry name (server/tool/command), never an undifferentiated technical id. Verified instances:

- **N1 (P1) Durable approvals list shows `mcp.tool.call` / `mcp-tool-call` for every MCP tool.**
  Evidence: `packages/core/src/server/methods/approval-methods.ts:39` →
  `approval-interaction-service.ts:195` calls `authority.list()` **without** the optional labels map;
  `packages/core/src/approval/approval-decision-service.ts:40,80-88` supports
  `ApprovalSafeLabels` but nothing populates it; the UI falls back to raw ids —
  `apps/desktop/src/windows/home/pages/settings/approval-decisions-section.tsx:45-46`
  (`decision.labels?.capability ?? binding.identity.capabilityId`).
  Fix: populate `ApprovalSafeLabels` (capability + subject) at decision time from the canonical binding
  (`binding.identity.subject` already carries serverName/toolName for MCP; tool key for Core tools; target
  class for exec), join in `list()`, and render the readable operation/target labels. Internal binding ids
  remain in logic rather than becoming secondary/Inspector text. UI labels stay Chinese.
  Shared schema: `packages/shared/src/approval-decision-schema.ts:91`.

- **N2 (P1) Permission advanced cells render raw capability ids as card titles.**
  Evidence: `permission-cells-card.tsx:27` `<PageCard title={capabilityId}>` — operators see
  `mcp.tool.call`, `workspace.file.read`, `core.avatar.motion` with no Chinese label.
  Fix: one shared capabilityId → Chinese label map (single source, e.g. beside the governance registry in
  `@taki/shared` so Core and UI agree); remove redundant raw capability-id display.

- **N3 (P1, D64) exec approval card does not show the actual command.**
  Registered as D64; the approval dialog renders only redacted classification sections
  (`approval-dialog.tsx:74-87` renders `presentation.sections` verbatim). Fix belongs to the Approval UI
  batch: bind a safely-redacted but command-specific field into the challenge presentation so the operator
  can verify what they are approving (see D64 acceptance criteria — digest-bound, secret-scrubbed).

- **N4 (P2) Monitor page mixes English state/initiator labels and raw ids into otherwise Chinese UI.**
  Evidence: `monitor-page.tsx:15-23` (`Primary`, `Scheduled Task`, `Queued`, `Deadline exceeded`...),
  `:20` English state labels, `:77` raw `run.characterId`, `:20` `Attempt N` group labels in
  `monitor-view.tsx:20`. D68 already requires unified Chinese labels.
  Fix: Chinese label maps for initiator/state/phase/outcome; character display name when available.

- **N5 (P2) Chat tool card uses an emoji as its icon and shows the raw tool key.**
  Evidence: `tool-card.tsx:28` `🔧` (violates the no-emoji-icon rule; the repo itself documents WebView2
  emoji rendering hazards in `composer.tsx:46`), `:29` raw `name` in mono font. For MCP tools the model-facing
  key comes from the MCP client listing — verify what it renders as (prefixed? namespaced?) and display a
  readable `server · tool` pair using the same identity data N1 introduces.
  Fix: replace emoji with a `lib/icons` glyph and show a readable server/tool name; do not add a
  duplicate routing-key line merely because the key exists.

- **N6 (P2, D65/G4) MCP/Skills still expose meaningless internal fields.**
  Evidence: `mcp-server-card.tsx:51-52` 修订/代次 badges, `:58` `Owner … Runtime generation …` line in
  11px slate-400; `skills-page.tsx` 哈希/Owner/Metadata rows (D65). The delivered frontend phase moved
  these into disclosures; G4 requires their removal from expanded details as well.
  Fix: keep name, status, actionable connection/configuration, selected tools and meaningful outcomes.
  Remove internal revision/generation/hash/opaque-owner fields and empty technical sections; curate
  useful package metadata instead of dumping every key. The shared status strip and Settings/Monitor
  have matching removal targets in the linked inventory. Ordinary DSH/Pi tool views inform useful
  input/output content; their dedicated debug views are not a generic user-page template.

- **N7 (P3) Governance presentation copy is English in an all-Chinese UI.**
  Evidence: `core-tool-governance-adapter.ts:90-97` ("Allow Core tool"), `mcp-turn-tools.ts:120-131`
  ("Allow MCP tool", "Target"). These reach the approval dialog. Fix with the shared label map from N2;
  keep digest/schema fields unchanged.

## 2. Unified component layer + design tokens (theme-switching foundation)

Owner directive: one component set so pages stop drifting and the whole theme can change in one place.
Current state: 5 shared primitives (`action-button.tsx`, `page-card.tsx`, `badge.tsx`, `page-chrome.tsx`,
plus `lib/icons`) exist and are mostly adopted, but color/size literals are hardcoded in ~every file, so a
theme change today means touching dozens of files.

- **C1 (P1) Semantic token layer in `styles.css` `@theme`.**
  Define: accent (rose today), danger (separated from accent), ok/warn, surface/border/text steps, font-size
  scale (collapse 10/11/12/13/15 → 4 steps), radius/spacing steps. Pages stop writing `rose-500`-style
  literals (review rule); dark mode becomes possible later without re-touching pages.
- **C2 (P1) Fix the rose double-meaning while tokenizing.**
  Evidence: ~17 accent vs ~16 danger usages of rose; monitor error banner and selected run card share
  `bg-rose-50` on one screen (`page-chrome.tsx:34` vs `monitor-page.tsx:75`); palette drift: `red/green` in
  `app.tsx:48,66`, `pet-stage.tsx:65`, `approval-dialog.tsx:53`, `sky` links in `markdown-view.tsx:19`.
- **C3 (P1) Approval dialog semantic inversion.**
  Evidence: `approval-dialog.tsx:62-64` — all three *allow* choices are solid rose; deny is slate; everywhere
  else rose = danger/irreversible (`action-button.tsx` header comment). Fix: allow = primary (accent),
  deny = danger-soft; "always" additionally gated by the disclosure checkbox (already implemented).
- **C4 (P2) Missing primitives cause per-page re-invention.** Add to `components/ui/` (each with an
  `index.md` contract): SelectionTile/GhostButton (root cause of 17 hand-rolled buttons and 5 selection
  recipes — `composer.tsx:78` even defines a private second `ActionButton`), Dialog (focus trap + Escape +
  focus restore; migrate approval dialog), Skeleton/EmptyState/ErrorState (with retry), CopyableRow,
  Field (label association). Migrate drifted call sites in the same batch.
- **C5 (P3) Typography baseline.** Pin a font stack (`system-ui` + Microsoft YaHei fallback order), switch
  `<html lang>` to `zh-CN` in `home.html/pet.html/index.html`, drop 11px Chinese body text to 12px minimum.

## 3. Accessibility (verified gaps; see audit for full line-level list)

- **A1 (P1) Approval dialog focus management** — `role="dialog" aria-modal` declared (`approval-dialog.tsx:46`)
  but no initial focus, no Tab trap, no Escape semantics. Escape must NOT auto-deny (fail-closed: no choice =
  no response); it only closes the dismissible-error state.
- **A2 (P1) IME Enter-to-send** — `composer.tsx:130-135` sends on Enter without `event.nativeEvent.isComposing`
  check; pinyin candidate confirmation sends the raw composition. Same check needed in the pet bubble input.
- **A3 (P1) Global `cursor-pointer`** — Tailwind v4 preflight removed the button hand cursor; 1 usage in the
  whole app (`permission-cells-card.tsx:20`). One base-layer CSS rule fixes all windows.
- **A4 (P2) Toast reachability** — no `role/aria-live`, no close button, keyboard cannot dismiss
  (`toast-host.tsx:39-76`); no stacking cap (`toast-store.ts:29`); **D34's "click pauses the timer" is not
  implemented (only mouseenter pauses, `toast-host.tsx:41-42`) — registry deviation to repair.**
- **A5 (P2) focus-visible coverage** — only 3 sites; `mcp-server-editor.tsx:11` replaces the outline with a
  near-invisible 1px ring. Standardize a visible focus token on all primitives.
- **A6 (P2) Mutations without visible pending state** — MCP editor save button enabled during mutation
  (`mcp-page.tsx:88-99`); knob commit-on-blur has no lock (`knob-field.tsx:40-44`). Re-entry is silently
  swallowed by controllers. Show pending on the control, disable while in flight.
- **A7 (P2) Hit targets** — attachment remove 20px (`composer.tsx:66`), bubble buttons ~16-20px, ActionButton
  ~28px tall. Raise to ≥32px on operator surfaces (pet overlay exempt where constrained).
- **A8 (P3) Live regions** — PageAlert, MCP feedback banner, knob notices are plain `<p>`; announce via
  `role="status"/"alert"`. Scroll containers keyboard-scrollable (`tabIndex={0}` on PageBody/chat timeline);
  "上滑查看更早" hint is mouse-phrased.

## 4. Card/page UX and streaming fidelity (owner directives: card UX, collapse, true streaming)

- **U1 (P1) Collapse affordance missing on expandable content (D68).**
  Monitor inspector opens on row click and can never be closed (`monitor-page.tsx:85,92` — no close control,
  no selected-row toggle-off); DSH closes on × and on clicking ledger whitespace, and its disclosures are
  two-way. Fix: inspector gets 关闭 button + click-again-to-deselect; any `details`/disclosure added under
  D67/D68 must collapse both ways (registry rule already says "审计所有可展开内容均可再次收起").
- **U2 (P2) MCP server card redesign.** Evidence: `mcp-server-card.tsx:46-63` — title is the raw serverId,
  4 badges crammed in the header (status + 修订 + 代次 + 工具数), an 11px low-contrast owner line, 6 equal-tone
  action buttons in one wrap row. Fix: readable server name as title, user-edited namespace where needed
  for configuration without a redundant identifier row, status badge + tool count
  only, transport line, primary action (测试), overflow menu or grouped row for 重连/停用/编辑/移除, diagnostics
  as a dismissible banner, technical fields per N6.
- **U3 (P2) Skills card redesign** — name/status/trust/actions primary; remove internal hash/owner/revision
  fields from details under D65/G4. Inspection shows useful description, compatibility/license, declared
  tools and bounded relative files as applicable, not an arbitrary metadata map.
- **U4 (P2) Shared value rows need copy/expand.** `LabeledRows` truncates values with no tooltip or copy
  (`page-card.tsx:34`) and skills/monitor pass hashes and unbounded strings into it; the monitor detail `dl`
  lacks `min-w-0` so a long unbreakable value can overflow the card (`monitor-view.tsx:33-34`).
  Fix: CopyableRow for meaningful values and `min-w-0` on the grid; remove meaningless internal rows
  under G4 instead of making them easier to copy.
- **U5 (P2) Loading/empty/error unification.** Every page hand-rolls a bare `text-slate-400` line
  (`mcp-page.tsx:86`, `skills-page.tsx:26`, `settings-page.tsx:23`, `monitor-page.tsx:80,89`); no skeletons,
  no designed empty states, retries only on some pages (`approval-decisions-section.tsx:40` has one,
  most don't). Fix: Skeleton/EmptyState/ErrorState primitives (C4) adopted by all 8 pages; every failed
  read gets a retry.
- **U6 (P3) Connection banner steals layout height** (`connection-status.tsx:23` in normal flow; chat and
  home both push content on reconnect then shift back on connected). Overlay it or reserve space.
- **U7 (P3) Settings page regrouping (owner directive: messy, insufficient Chinese hints).**
  Evidence: `settings-page.tsx:18-36` — permission section + durable approvals + a flat server-ordered knob
  list; each knob's primary label is the English dotted key (`knob-field.tsx:49`), description 11px.
  Fix (coordinate with **D54** convergence so we don't restyle knobs that will be demoted to config-file-only):
  grouped sections (权限与审批 / 模型与上下文 / 感知与隐私 / 存储与缓存 / 高级), Chinese primary label + key as
  secondary `code`, search box, C5 sizing.

### Streaming fidelity: tool activity is invisible until the turn ends (owner-reported "真流式")

Phenomenon: a turn may make several tool calls, but every tool card appears only when the whole stream
finishes. Root cause chain (verified):

1. **Core forwards only text.** `chat-agent.ts:271-282` — the `result.stream` loop yields `text-delta`
   only; `tool-call`/`tool-result`/`finish-step` parts "flow by" (the loop's own comment) and everything is
   persisted from `responseMessages` in one `persistTurn` (`:283`) after the loop ends. `observeStreamPart`
   already sees every part in real time — the data exists at the exact seam, it is just not forwarded.
2. **The WS chat surface has no tool event.** Only `chat.delta` (plain text) + `chat.complete/error` exist
   (`ws-client-routes.ts`; shared `CHAT_METHODS`).
3. **The client in-flight row is text-only.** Tool cards come exclusively from `timeline.appended` after
   turn-end persistence; the in-flight row (`chat-timeline-store`) cannot hold them.

- **U8 (P1) Live tool-call/result events + in-flight tool parts.**
  Fix shape (additive, no second runtime — matches D67's "真实到达顺序" and the one-Run/Turn-runtime rule):
  - Core: forward `tool-call`/`tool-result` parts from the existing stream loop as a new zod-validated
    notification (e.g. `chat.tool`: `messageId`, `toolCallId`, `toolName`, `state`, readable labels from the
    N1 identity/labels work). Persisted timeline stays turn-granular (the D1 contract is untouched) — the
    live channel is presentation-only, exactly like `timeline.appended` vs the store.
  - Client: the in-flight row gains an ordered, `toolCallId`-keyed tool-part list rendered with the existing
    `ToolCard`; `timeline.appended` at turn end still replaces it in ONE atomic `set()` — extend the
    streaming-timeline spec so the swap dedupes by `toolCallId` (no double flash).
  - Redaction: name + status only; args/results stay out of the live payload (same disclosure floor as
    approval presentations) until an inspector exists.
- **U9 (P1, same root) "Executing" gap.** Between a tool call and its result (and during approval waits) no
  delta fires, so the UI shows frozen partial text with no indicator. U8's `state: "calling"` card is the
  fix; the typing-dots-only-before-first-delta behavior should key on "turn active, no text yet" instead.
- **U10 (P2, same event) Pet bubble shows no tool activity at all** — `features/chat-bubble` renders plain
  text deltas only; once U8's event exists the bubble should show at least a compact "使用工具中…" line
  (presentation-gated like the deltas).
- **Same-class sweep (adjacent, do not silently expand scope):** D14 (timeline drops reasoning/file parts —
  a live event would make reasoning cards possible later), D16 (error path loses completed steps' tool
  records), D66/D67 (the Run live bus and the UI read-model contract — U8 must reuse the existing notify
  pattern, not create a second event authority), and the spec's "Streaming timeline" section needs the
  tool-part extension when U8 lands.

## 5. Page layout redesigns (owner directive: multi-column where it pays)

DSH reference shape: toolbar + (optional timeline strip) + ledger with an **on-demand, closable, resizable
right inspector** (`clamp(320px, 38%, 440px)`); T4's own D68 notes prescribe left Run browser + central
ledger + dismissible right inspector. Home window is 900×800 (`open-home-window.ts:36-37`); inspector math
must degrade gracefully (drawer on narrow width).

- **L1 (D68/G5) Monitor → direct DSH Trajectory presentation port/rebuild**: left Run browser, central grouped ledger (turn/step
  grouping, semantic rows per DSH: kind tag + readable text + metrics lane), right closable inspector (N6/U1).
  Use the existing proven Core projections and explicitly identify missing facts. The current scaffold
  is test evidence only; it is not the accepted visual/product baseline for the DSH port.
  **Owner ruling 2026-08-30: porting DSH trajectory UI components and page layout is authorized.** License
  verified: `references/deepseek-harness-master/LICENSE` is MIT (Copyright (c) 2026 DeepSeek) — copying and
  modification are permitted; substantially ported files carry an attribution header
  (`Adapted from DeepSeek Harness (MIT), <path>`). This overrides the earlier "adapt, don't transcribe"
  caution for DSH specifically (BANDORI remains GPLv3 layout-reference-only).
- **L2 (P2) MCP/Skills → master-detail**: list pane + detail/editor pane instead of full-width stacked cards;
  editors stop stretching the page; details contain useful server/package information under G4.
- **L3 (P2) Costume page → 3 columns** (owner directive, BANDORI-informed): left = existing home nav
  (unchanged); middle = character header + costume rows (keep the existing per-row click-to-wear +
  result-deadline contract — do NOT adopt BANDORI's select-then-Apply two-step); right = Live2D config card
  (see F5/L4). BANDORI borrowables: 40px rows with inline preview/favorite, staggered fade-in, static
  portrait thumbnails, quality/GPU/fps/scale/opacity sliders.
  **Preview tradeoff**: BANDORI renders real Live2D in a preview bubble; pulling pixi+live2d into the home
  window would add the ~410K chunk and a second renderer. Ship static thumbnails first; live preview is a
  later option.
- **L4 (P2) Live2D config card (right column)** — currently none of these knobs exist as config:
  fps (replaces focus tiers, see F5), model scale (drives pet window size), opacity, render throttling
  (supersedes the D19 boolean), idle-motion pool editor (this is **D38's landing spot**), idle/blur behavior.
  Prerequisite: a Core config batch (single-writer keys + `config.changed` push; `timing-policy-sync.ts` is
  the in-repo pattern) and pet-side application incl. window resize permission in `pet.json`.
- **L5 (P3) Chat/Perception/Operations stay single-column** — already the right shape; chat keeps its own
  scroll + composer (DSH uses the same ledger + floating composer pattern).

## 6. Performance (verified; fix risks assessed)

- **P1a (P1) Streaming markdown O(n²)** — every `chat.delta` re-parses the whole accumulated text
  (`markdown-view.tsx`, store `set` per delta via `use-chat-timeline.ts:32`; no rAF/coalescing anywhere).
  Fix: coalesce `growInflight` to a 30-60ms flush; move the scroll-follow effect (`use-timeline-scroll.ts:45-56`)
  onto the coalesced update. Risk: low; tail-follow must key on the flush, not the raw delta.
  Status clarification (2026-09-05): the delivered 40ms coalescer reduces update/parse frequency;
  accumulated Markdown is still reparsed per flush. It does not establish incremental parsing or
  prove the absence of long-reply stutter without profiling.
- **P1b (P2) Timeline memory growth** — unbounded `loadOlder` mounting full markdown trees
  (`timeline-view.tsx:59-66`, 50-row pages) + module-level data-URL image cache with no eviction
  (`use-attachment-image.ts:14`). Fix: cap mounted rows (evict above N with a "加载更早" jump point) and add an
  LRU to the image cache. Full virtualization deferred until symptoms (variable heights + tail-follow
  complexity not justified yet).
- **P1c (P1) Pet per-frame alpha-mask readback** — `pet-scene.ts:109` calls `mask.refresh` every ticker tick;
  refresh = RenderTexture render + synchronous `extract.pixels()` GPU→CPU readback at 0.25 res
  (`alpha-mask-source.ts:33-38`), roughly doubling pet GPU work at the active tier. Fix: refresh the mask at a
  lower cadence (every Nth frame or only while a motion is playing); sampling already reads a cached bitmap so
  hit-testing stays cheap. Risk: silhouette edges lag a few frames during fast motion — imperceptible at 0.25
  res; verify click-through + gaze + proximity in manual checks after the change.
- **P1d (P2) Cursor poll cost** — `use-click-through.ts:19,43` polls every 24ms with two Tauri IPC calls
  (`cursorPosition` + `innerPosition`), forever, even hidden. Fix: cache `innerPosition` (refresh on drag end),
  pause when `document.hidden`, widen to 32ms. Risk: +8ms gaze latency (none felt); "toggle feels instant"
  comment must be re-verified by hand.
- **P1e (P2) Hidden keep-alive pages keep working** — visited pages stay mounted with `hidden`
  (`home-shell.tsx:104-117`) but nothing tells them; a hidden monitor keeps receiving live events and
  re-rendering (`monitor-controller.ts` bind/dispose is client-scoped only). Fix: visibility gate
  (dispose/bind or a `pageHidden` signal) as part of the D67 refresh contract.
- **P1f (P3) Bundle** — home is one 248K chunk with zero code-splitting (`pages.ts` static imports;
  react-markdown needed only by chat): lazy-load the chat page's markdown deps at minimum. `target: "esnext"`
  in `vite.config.ts`.
- **P1g (P2) Release hygiene** — `devtools` cargo feature ships in release (`src-tauri/Cargo.toml:34`);
  spike entry in production rollup inputs (`vite.config.ts:44-49`) — the latter is **D18(A)**, close it here.
- **P1h (P2) Focus tiers → user fps (owner directive #6).** `render-governor.ts:25` tiers 60/30/15 by
  focus/activity; owner decision: remove focus-based throttling, use one user-configured fps. Keep the
  hidden/asleep full pause (that is not focus throttling; issue #14's provable-pause AC depends on it). Also
  fix the existing footgun: `renderThrottling=false` bypasses the hidden check entirely (`render-governor.ts:68`).
  New shape: `maxFPS = user config`; pause when hidden/asleep; supersede the D19 boolean (config via Agent Core
  path closes D19). Coordinate mask cadence (P1c) so higher fps doesn't multiply readbacks.

## 7. Cross-cutting i18n/labels

- **I1 (P2)** Chinese label maps for governance capabilities (N2/N7), monitor states/initiators (N4),
  MCP failure reasons (exists in `mcp-server-card.tsx:21-27` — reuse pattern), approval choices.
  Single source in `@taki/shared` so Core presentations and UI agree. No i18n framework — the repo
  convention is hardcoded Chinese; just centralize the maps.

## 8. Explicit non-goals for this effort

- No third-party component library (shadcn/Radix): one real modal, self-drawn icons, hardcoded Chinese —
  token + primitive layer is the cheaper, convention-consistent route.
- No dark mode implementation in these batches; C1 only makes it possible later.
- No rewrite of the pet overlay interaction model (drag/click-through/proximity stay).
- No Taki-only skill format / permission semantics changes (frozen decisions).

## 9. Deferred-decision crosswalk (corrected 2026-09-05)

The original provisional D70–D76 numbers were never safe to treat as registrations. The actual registry
assigns D70 to `prepareStep` safety, D71–D74 to OpenBiliClaw, D75 to compaction token/benefit measurement,
and D76 to compaction prompt/version/quality evaluation. Keep these UI audit IDs instead:

| Audit items | Ownership and current disposition |
|---|---|
| N1/N2/N7/I1 | Readable approval/capability names; cross-layer G1 batch still to be designed |
| N5 | Glyph replacement delivered; readable tool names remain G1 work |
| N6/U2/U3 and related-page fields | D65/G4; remove meaningless internal fields from primary and expanded views; earlier disclosure-only cleanup is insufficient |
| A4 | D34 deviation addressed by the frontend Toast batch; not a new deferred registration |
| U1/L1/N4 | D68 for Monitor; D67 for other disclosures. Close controls exist; Monitor layout and asynchronous state residuals remain |
| P1h | Live2D configuration/hidden-pause follow-up, outside G1 |
| P1e | D67; hidden-page gating delivered, subject to targeted behavior verification |
| U8/U9/U10 | D67 live tool feedback across Chat/Pet; additive presentation over the existing turn/Run authority |

## 10. Suggested execution batches

Historical sequencing from the initial audit. Delivered frontend batches are recorded in the report;
the G1 grill will define the next executable batches. In particular, the old Batch 6 grouping does not
add Live2D configuration to the newly confirmed Chat/Pet scope.

| Batch | Contents | Notes |
|---|---|---|
| 1 | C1/C2 tokens, C3 approval tones, A2 IME, A3 cursor, C5 lang/font, N5 emoji | small, unblocks everything |
| 2 | C4 primitives + U5 state primitives + A5/A6/A7 adoption; U1 collapse; U4 copy rows | foundation for 3-5 |
| 3 | N1/N2/N6/N7 naming + I1 maps + D64 (N3) approval command disclosure | Core + Shared + UI |
| 4 | U2/U3 MCP/Skills card redesign + L2 master-detail + settings regroup (U7, with D54) | |
| 5 | L1 monitor 3-zone (with D68), P1a/P1b chat perf, P1e/D67 hidden-page gate | |
| 6 | U8/U9/U10 live tool events (Core notify + client in-flight parts + spec extension), L3/L4 costume + Live2D config page + P1h fps config + P1c/P1d pet perf + D19/D38 closure | U8 needs the N1 labels from batch 3 |

Each batch: one Trellis child, one final formal check proportional to complexity (per Leader operating rules);
owner manual acceptance required for anything packaged-WebView-visible.
