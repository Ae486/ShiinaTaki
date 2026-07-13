# PRD — Per-pixel click-through (GitHub issue #15)

The pet overlay's highest-risk module: clicks on taki's opaque pixels interact; clicks on transparent regions pass through to the window beneath. Blocked-by #14 (done). Research verified all APIs (`research/00`–`05`).

## Leader decisions (self-ruled 2026-07-14 — technical decision tree, no product/spec tension; recorded for transparency)

1. **Alpha test = web-side cached alpha mask (research option a).** Refresh a CPU-side alpha mask ONCE per painted frame via a persistent low-res RenderTexture (~¼ scale) + `getPixels`; the cursor poll reads a single mask cell (≈ free). NEVER call `renderer.extract.pixels` per poll — verified in the installed dist it renders a new RenderTexture + sync `gl.readPixels` (GPU stall) + destroys, every call. `model.containsPoint(point)` (bbox) is the cheap coarse gate before consulting the mask. (`model.hitTest`=`[]` for taki → useless for per-pixel; DOM `elementFromPoint` can't see canvas alpha; Rust capture is heavier/mis-seamed.)
2. **Event flow = global-cursor-driven toggle, start with approach B.** The paradox is real (Tauri #2090/#6164): `setIgnoreCursorEvents(true)` kills ALL pointer events with no forward option, so a webview-`pointermove`-driven toggle can never flip back. Drive the toggle from the GLOBAL cursor. **Approach B (start here):** the pet webview polls Tauri's built-in `cursorPosition()` (desktop-global, wraps `GetCursorPos`, already shipped) on an interval, tests the mask, calls `setIgnoreCursorEvents`. Zero new Rust — honours invariant 1 (Core/native surface minimal). Fall back to **A** (Rust `GetCursorPos` poll thread pushing cursor via event, lower latency) ONLY if B's IPC-poll latency is visibly laggy — document the observation if you switch.
3. **`windows` crate NOT added.** Verified: `tao` `set_ignore_cursor_events(true)` already sets `WS_EX_TRANSPARENT｜WS_EX_LAYERED` (the cross-process pass-through mechanism); `cursorPosition()` already wraps `GetCursorPos`. Amend the overstated `docs/TECH-STACK.md:43` click-through line via update-spec.

## Mechanism (the working loop)

Per cursor poll (via `cursorPosition()`), compute `opaqueUnderCursor`:
- Convert global cursor → pet-window-local coords (window position/size + DPR).
- If outside `model.containsPoint` bbox → not opaque (fast reject).
- Else index the cached alpha mask at the scaled point; alpha > threshold (BANDORI used 8/255) → opaque.
Then toggle: `ignore = !dragging && !leftButtonDown && !opaqueUnderCursor`. Call `setIgnoreCursorEvents(ignore)` only on CHANGE (avoid redundant IPC).

The alpha mask refresh lives in the render loop (governor-gated): it rides the frame rate, so it throttles when idle and is static-but-correct when the governor pauses (the model isn't moving, so the mask is still valid). The cursor poll is a constant cheap `cursorPosition()` + array index — it does NOT fight the idle-CPU governor.

## Architecture / placement (frontend spec — enforce)

- Mask generation is renderer-side (framework-free): a new `renderer/alpha-mask.ts` (persistent low-res RenderTexture + per-frame `getPixels` + a `sampleAlpha(x,y)` reader). NO React imports.
- The click-through controller (cursor poll + coordinate transform + toggle) is a pet-window hook `windows/pet/use-click-through.ts` — it may touch Tauri (`cursorPosition`, `getCurrentWindow().setIgnoreCursorEvents`) because hooks are the only place components reach Tauri. Renderer stays framework/Tauri-free; the hook consumes the renderer's `sampleAlpha` + `containsPoint` through the pet-scene controller.
- **Drag suspend**: lift the `dragging` flag from `use-pet-drag.ts` into the shared `stores/avatar-store.ts` (or a small `interaction` store) so the click-through hook reads it. Toggle formula gates on it — no drop-through mid-drag (AC).
- Capability: add to `capabilities/pet.json` — `core:window:allow-set-ignore-cursor-events` AND `core:window:allow-cursor-position` (both currently absent; forgetting compiles fine, fails at runtime). Verify exact ids against regenerated schema.

## Acceptance criteria (issue #15)

- [ ] Clicking taki's visible body interacts; clicking empty/transparent area passes through to the app beneath
- [ ] Cursor hit-testing tracks the model as it animates and moves (per-frame live-pixel mask)
- [ ] Click-through suspended during drag (no drop-through mid-drag) — shared drag flag gates the toggle
- [ ] No opaque root background defeats transparency (pet root stays transparent — already true from #14; re-verify)
- [ ] Behavior verified on WebView2 via the manual smoke checklist (transparency + through-click) — QUEUE to manual-checks
- [ ] Tests: the alpha-mask sampler (pure, given a known bitmap → correct opaque/transparent verdicts at coordinates); the toggle formula (`ignore = !dragging && !buttonDown && !opaque`) as a pure function

## Constraints

- Never code APIs from memory — research files carry verified signatures (`cursorPosition` is a top-level `@tauri-apps/api/window` export; `setIgnoreCursorEvents` is on the window instance; PixiJS 8 `extract.getPixels`/RenderTexture shapes verified in dist). Re-confirm when wiring.
- Toggle only on change; poll interval reasonable (~16–33ms) — measure, don't peg a core.
- Anti-sprawl: TS <=300/fn<=50/<=3 params; INPUT/OUTPUT/POS headers; update touched dirs' index.md.
- Do NOT modify `packages/core`/`packages/shared` (no protocol change — click-through is pure client + window). Rust change limited to `capabilities/pet.json` (approach B needs no Rust code). If you must fall back to approach A, that adds a Rust cursor-poll module in `apps/desktop/src-tauri` — flag it, don't do it unless B is proven laggy.
- The core click-through correctness (opaque-interactive / transparent-through) is a MANUAL WebView2 check — headless can't verify OS-level pass-through. Automate what's pure (mask sampler, toggle formula); queue the rest.

## Research inputs (verified, read first)
- `research/00-summary-and-recommendation.md` — decisions + headline answers
- `research/01-tauri-set-ignore-cursor-events.md` — API + permission + paradox proof
- `research/02-alpha-hit-test-options.md` — the 4 options + verified cost
- `research/03-event-flow-architecture.md` — the working loop, B vs A
- `research/04-drag-suspend-and-animation-tracking.md` — drag gate + governor budget
- `research/05-windows-crate-necessity.md` — why the crate isn't needed
- `.trellis/spec/frontend/live2d-renderer.md` — governor + renderer conventions from #14
