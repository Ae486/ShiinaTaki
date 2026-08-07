# Batch 3 design — operation wheel + right-click migration + left-only click fix (pet window)

Contract for implement/check. Parent: prd.md §2/§3 (wheel rulings incl. the ACTIVE degrade:
model-area right-click) + research/rs-panel-scoping.md §1/§2/§3. Scope: `apps/desktop/src` pet-side
ONLY. FROZEN: packages/*, apps/cli, e2e, `windows/home/` (except one wheel→openHome import if
needed — openHome is in `lib/`, so home stays untouched), tauri conf/capabilities (pet.json already
grants event emit).

## Product recap (owner rulings)

Right-click on the Live2D model summons the operation wheel at the mouse position. Wheel items are
SHORTCUTS. Clicking anything outside the wheel dismisses it (best-effort: the original click still
does its normal thing; degrade = dismiss-only). Esc and window blur also dismiss. Edge clamp/flip
near screen borders. Costume switching leaves the raw right-click. Click/touch animation (and the
bubble) must respond to LEFT button only — owner-reported defect.

## Components

1. **Wheel item registry** — `src/features/operation-wheel/wheel-items.ts`: ordered rows
   `{id, label, run(ctx)}` (icon slot lands with batch-5 assets; ctx carries the closers).
   V1 rows: `chat` → `openHome("chat")`; `home` → `openHome(DEFAULT_PAGE_ID)`; `costume` →
   open the EXISTING CharacterPanel overlay (bridge until batch 4 moves costume into home —
   function continuity: costume must stay reachable every commit). `settings` row lands in
   batch 4 WITH its page. Adding an item = one row (owner's maintainability constraint).
2. **Wheel component** — `src/features/operation-wheel/operation-wheel.tsx`: radial layout of the
   registry rows around the summon point; minimal neutral styling (text-label chips are fine —
   BANDORI-referenced polish + owner icons are batch 5); `data-keep-interactive` on the container
   (the existing keep-interactive element test is what keeps it clickable while click-through
   ignoring is active — reuse, verify the attribute name in `click-through-toggle.ts`).
3. **Placement** — `wheel-placement.ts` pure fn: (summonPoint, wheelSize, windowSize) → position,
   clamped/flipped so the wheel never renders off-window. Node-testable.
4. **State** — `wheelOpen` + summon point live beside `panelOpen` in the existing
   `stores/interaction-store.ts` (same domain: pet-window overlays; do NOT create a new store for
   two fields — match the store-per-domain rule).
5. **Summon wiring** — `pet-stage.tsx`: `onContextMenu` currently opens CharacterPanel
   (`:46-49`) → now `preventDefault()` + open wheel at `{clientX, clientY}`. The costume panel
   opens ONLY via the wheel's costume item from now on.
6. **Dismiss wiring** — a `use-wheel-dismiss.ts` hook: (a) any pointerdown whose target is outside
   the wheel container closes it and DOES NOT swallow the event (best-effort pass-through: let it
   propagate to the stage handlers so a model touch still reacts — pin with a test that the stage
   handler still fires); (b) `Escape` keydown closes; (c) window blur closes; (d) a second
   contextmenu re-summons at the new point (not a toggle-close). Listener lifecycle: attached only
   while open, removed on close/unmount.
7. **Left-only fix** — `use-pet-drag.ts` `onPointerDown`/`onPointerUp` gain `event.button !== 0 →
   return` (research: the outlier; `use-click-through.ts:93` is the in-file precedent). Pin with
   tests: right-button pointer sequence produces NO click reaction and NO bubble; left-button path
   byte-identical behavior.

## TDD rows

1 registry: rows unique/ordered, each `run` invokes its target (openHome spy / panel opener spy);
2 placement: center summon → centered ring, corner summon → clamped fully on-window (all four
corners); 3 summon: contextmenu on stage → wheel opens at point, default suppressed, costume panel
does NOT open; 4 dismiss: outside pointerdown closes AND the underlying stage handler still runs;
Esc closes; blur closes; re-contextmenu moves the wheel; 5 left-only: right-button down/up → no
`scene.handleClick`, no bubble-open, no drag start; left-button unchanged (existing drag/click
tests stay green unmodified); 6 keep-interactive: the wheel container carries the attribute the
click-through toggle honors (assert against the REAL constant from click-through-toggle, not a
string copy); 7 wheel-open during click-through: with the cursor-over-transparent state simulated,
the wheel remains in the keep-interactive element set (unit at the toggle-fn seam).

## Gates

pnpm -r typecheck / -w lint / -r test (desktop 159 + new; core 1160 / shared 207 / cli 32
byte-stable) + `pnpm --filter @taki/desktop build`. No tauri dev (leader/owner visual pass covers:
right-click summons, items navigate, costume via wheel, right-click no longer animates). Do NOT
commit.
