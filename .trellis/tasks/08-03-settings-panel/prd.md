# PRD — Settings panel: home window + operation wheel + config store

Owner-grilled 2026-08-02/03 (conversation rulings, all BINDING). Runs BEFORE T4 (owner-ruled).
Supersedes the #22→#26 T6 sequencing for the surfaces named here; whatever this task does not
consume stays in T6. HANDOFF §4.3 records the plan-B context.

## Product shape (owner's design, verbatim intent)

1. **One home window** (single instance): left side = menu switching pages, right side = the page
   content. The CHAT PAGE is one of the pages — the existing standalone chat window (M4 #17)
   RETIRES and its components migrate into the home chat page (streaming timeline, attachments,
   cancel-retract etc. must not regress). Home is a separate Tauri window from the pet overlay,
   with its own capability file (architecture rule).
2. **Operation wheel**: right-click in the pet window summons a wheel of icons at the mouse
   position — chat / settings / costume / home / (extensible). Every icon is a SHORTCUT: it opens
   the home window navigated to the target page (home icon = home's default nav view). Costume
   switching MIGRATES from the current raw right-click into the wheel. Wheel + pages are
   REGISTRY-DRIVEN (add an item/page = one registry entry) — owner's maintainability constraint:
   later page reorganization must not require rework.
3. **Wheel interaction semantics** (owner: "直觉上的操作"):
   - Appears at the right-click position; flips/clamps near screen edges.
   - Clicking anywhere NOT on the wheel dismisses it; BEST EFFORT the original click still does
     what it would have done (model touch, click-through); if infeasible, dismiss-only is the
     accepted degrade. Window blur (clicking another app) also dismisses.
   - Trigger region: the whole pet-window rect IF the click-through mechanism allows receiving
     right-clicks over transparent regions; otherwise DEGRADE to "right-click on the Live2D model
     area" (owner pre-approved this degrade; scoping verdict decides — see research/).
   - **Click-animation fix (owner-reported defect)**: today BOTH mouse buttons trigger the touch/
     click animation; only LEFT click may trigger it. Right-click = wheel only.
4. **Chat entry**: left-click behavior essentially unchanged (touch animation + bubble bar); the
   bubble bar's enter-chat button AND the wheel's chat icon both navigate to the home chat page.
5. **V1 pages — ALL IN** (owner: "统统装进来", organize/prune later per real usage — links to D54
   owner-called convergence): chat / knob settings (R13 numbers) / operations (manual tidy,
   compaction + calibration status) / perception privacy (pause, retention, skip-list — manual
   check 79) / costume (migrated) / D38 idle-pool editor / D46 screenshot usage+cleanup entry.
   Elastic: if D38/D46 threaten the schedule, they defer LAST with a recorded trigger.

## Config store (owner approved the professional shape over panel-writes-.env)

- Core owns a DB config table (single writer = core, invariant 2); first boot seeds from env/
  built-in defaults; panel writes via WS methods → core zod-validates (R13 fail-closed discipline)
  → persists → live-applies where the knob supports it, else flags "restart to apply".
- Per-knob annotation REQUIRED: live-apply vs restart; the panel displays it truthfully.
- Env vars become dev-time overrides: an explicitly-set env var wins and the panel shows the knob
  as env-locked.
- Secrets stay in Windows Credential Manager paths — never in the config table or files.

## Style reference (license boundary, non-negotiable)

BANDORI (`references/BANDORI-PET-REV`, GPLv3) is the visual/layout reference for ALL overlapping
surfaces (chat page included): replicate design/layout/organization freely ("权衡着抄" = follow
the look), design in-style where no overlap exists — but ZERO code lines and ZERO asset files may
be taken into this repo (GPL contamination). Icons: clean-licensed open-source placeholders chosen
by the leader; owner will hand-draw replacements later.

## Non-goals / constraints

- Pet overlay hosts ONLY the wheel; all pages live in the home window.
- Protocol types once in `@taki/shared` (zod) + Rust serde mirror where the Shell is involved.
- Pet UI stays a disposable client (invariant 4); home window likewise holds no state of record.
- Anti-sprawl caps, INPUT/OUTPUT/POS headers, per-dir index.md, kebab-case, why-only comments.

## Open items for scoping (research/ answers these before batching)

RESOLVED 2026-08-03 — full facts in `research/rs-panel-scoping.md`; verdicts:

- **Wheel trigger = model-area right-click (degrade ACTIVE, owner pre-approved).** Click-through is
  window-level `setIgnoreCursorEvents` on a 24ms alpha-sampling poll — over transparent pixels the
  webview receives NO events, so whole-rect summon is impossible. Open wheel stays clickable via the
  existing `data-keep-interactive` element test.
- **Left-button-only fix site**: `windows/pet/use-pet-drag.ts` `onPointerDown`/`onPointerUp` never
  read `event.button` (the outlier — `use-click-through.ts:93` already filters button 0). One filter
  fixes both the reaction AND the bubble opening on right-click.
- **Right-click unplug** = `pet-stage.tsx:46-49` onContextMenu + `<CharacterPanel>` render + the
  `panelOpen` flag; the costume hooks underneath are reusable.
- **Costume page cross-window seam (leader call)**: the page lives in home but `switchCostume` needs
  the live PetScene (pet window only). Mechanism decided at batch design against the existing
  channels: prefer core-mediated (home → WS → core → existing avatar/costume push → pet executes;
  matches "core coordinates, windows are disposable clients") else a namespaced Tauri window event.
- **Home window needs**: `home.html` + Vite input + `windows/home/main.tsx` + `capabilities/home.json`
  (chat.json is the template) + opener; pet capability already permits opening; CSP already covers WS.
  Chat migration is small: `windows/chat/` couples out only via active-character, a type import, and
  ToastHost; keep `chat-window.tsx` body, lift chrome into the home shell, retire `open-chat-window.ts`
  (single call site `chat-bubble.tsx:44`).
- **No router exists**; zustand one-store-per-domain is the pattern → home current-page = small
  zustand store with a discriminated union; page registry is new code following that style.
- **Every window owns its WS socket** (shared localStorage identity → home auto-authenticates).
  `lib/ws-client.ts` is 258/300 — adding config methods FORCES a split (batch it deliberately).
  D29 (mid-turn disconnect never settles, ws-client.ts:239-250) comes due on first touch: fix it in
  the ws-client batch.
- **30 real knobs** (table in research file). CAVEAT: nothing in core re-reads config after boot —
  every loader runs once at module scope. v1 stance: all knobs honestly badged "restart to apply";
  upgrade individual knobs to live-apply only where the getter conversion is trivial, during the
  config batch. Secrets (3 `*_API_KEY`) render as set/not-set only.
- **config.* methods**: copy `memory-tidy.ts` (33-line factory), names+schemas in `@taki/shared`,
  one register line; subscription copies `avatar-subscribe.ts`. No Rust mirror (operator↔core only).
- **Legacy `main` window** (pairing panel, broadest capability file) sits confusingly beside home —
  NOT touched this task; consolidation registered as a deferred decision at close.

## Batch plan (proposed 2026-08-03, owner ratification pending)

1. **Config store (core-only, headless-testable)**: migration (config table) + config-repo + knob
   metadata registry (30 knobs: name/zod/default/restart-vs-live/secret) + env-seed & env-locked
   precedence + `@taki/shared` schemas + server methods config.list/get/set + config.changed push.
   Verification bonus: the new CLI `--call config.list` exercises it end to end.
2. **Home window + chat migration (frontend)**: home entry + capability + shell (left menu registry,
   page host, current-page store) + chat page migration + bubble button retarget + ws-client split
   (+ config methods, D29 fix).
3. **Wheel + pet interactions (frontend)**: registry-driven wheel (model-area right-click, mouse-pos
   spawn, edge clamp, dismiss-on-outside/blur, keep-interactive), costume-panel unplug, left-only
   click fix, shortcuts → home@page.
4. **Pages (frontend + small core status additions where needed)**: knobs page (from config.list
   metadata, restart/env-locked badges) / operations page (tidy trigger, compaction+calibration
   status) / perception page / costume page (cross-window seam) / D38 idle-pool + D46 screenshot
   entry (elastic — defer LAST with trigger if schedule demands).
5. **Visual pass + close**: BANDORI-referenced layout/style polish (clean-room), placeholder icons
   (clean-licensed), manual checks, docs, deferred registrations.
