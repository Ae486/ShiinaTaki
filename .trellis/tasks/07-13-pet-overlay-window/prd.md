# PRD — Pet overlay window (GitHub issue #14)

The pet overlay: a transparent, borderless, always-on-top Tauri 2 window rendering the locked Live2D model at idle, with a framework-free renderer state machine (idle/thinking/working/sleeping), a render-throttling governor, and draggable position that persists across restarts. Blocked-by #13 (renderer LOCKED) + #10 (Shell) — both done.

## Leader decisions locked (2026-07-13, user-ratified)

1. **Position persistence = option (a): `tauri-plugin-window-state`** (official, v2.4.1). Window geometry is local window-manager chrome, NOT agent-domain state of record — it is per-machine, meaningless to the OS-neutral Core (invariant 8), and the plugin solves DPI/multi-monitor/off-screen clamping for free. Lives in `apps/desktop` (Windows layer). Does NOT touch the WS protocol or the Core DB. User confirmed: a fitting, extensible, purpose-built wheel → use it.
2. **Render throttling = option 2a, made configurable.** Governor: full fps while animating/interacting; throttle on window blur; **provable pause on minimize/hidden** (`visibilitychange`). The "paused when covered by another window" case is NOT detectable via any verified Tauri/DOM API — explicitly OUT of scope (documented limit, not a gap). Throttling is a **config flag `renderThrottling`, default ON, user-toggleable**; when off, always full fps. #14 makes the renderer READ the flag (local default `true`); wiring it to the real config system is deferred to M5 #24 (register **D19**).
3. **Always-on-top is a default window property** (`alwaysOnTop:true`). Hover/click/right-click interaction panels are downstream (#15 click-through, #16 bubbles) — NOT designed here. Note the seam only.
4. **Term is "render throttling"**, never "smart power saving".

## Window baseline (verified against installed CLI config schema)

New window label `pet` with its own Vite HTML entry (`pet.html`) + its own capability file (`capabilities/pet.json`, `"windows":["pet"]` — does NOT inherit `default.json`). Config fields:

```jsonc
{
  "label": "pet", "url": "pet.html",
  "width": 480, "height": 640,
  "transparent": true, "decorations": false,
  "shadow": false,          // LOAD-BEARING: shadow:true → Win11 adds 1px white border + rounded corners
  "alwaysOnTop": true, "skipTaskbar": true,
  "resizable": false, "focus": false,
  "visible": false          // show after first paint to avoid a white flash (or true if smoke shows no flash)
}
```

Web side MUST be transparent: no opaque `html`/`body`/`#root` background (defeats `transparent:true`). Pet overlay root must stay transparent (frontend spec: no opaque overlay backgrounds).

## Architecture (frontend spec — enforce)

- `apps/desktop/src/renderer/` is **framework-free TypeScript, ZERO React imports** (AC + spec). The ONLY React↔Pixi bridge is `apps/desktop/src/windows/pet/pet-stage.tsx`.
- `renderer/stage.ts` — PixiJS 8 Application lifecycle + the render-throttling governor (mandatory path for all rendering).
- `renderer/state-machine.ts` — pure, framework-free idle/thinking/working/sleeping FSM; UI-local, NO LLM/token cost; mirrored into a Zustand store for React display, driven by WS events later (in #16 the store gets real events; #14 wires the machine + local transitions + a test seam).
- `renderer/live2d/` — model load + idle (blink + breathing) using the locked engine. Blink does NOT run automatically (spike finding: needs the EyeBlink group driven or an idle loop) — #14 owns starting idle blink + breathing.
- One Zustand store `stores/avatar-store.ts` mirroring the FSM state for React; components select narrowly.
- Consume the locked renderer per `.trellis/spec/frontend/live2d-renderer.md` (load order, generation-split params, model facts). Model loads from the extracted taki asset via the same dev asset path the spike used (production asset-protocol loading is #18 — for #14 reuse the dev `/spike-assets` route or an equivalent; do NOT build the import pipeline).

## Render-throttling governor (the perf AC)

- PixiJS 8 `app.ticker.stop()/start()` + `maxFPS`/`minFPS` (verified). Full fps when active; throttle to low fps on blur (`getCurrentWindow().onFocusChanged`, fires on focus+blur); **stop() on `visibilitychange` hidden** (minimize/hide) — this is the provable-pause the AC needs.
- Governed by the `renderThrottling` flag (default true). Flag off → ticker stays full-rate.
- **AC verification**: a frame-callback assertion proves the ticker is stopped when hidden (count frames over a window of time → 0 while paused). Idle CPU with governor ON must be materially below the spike's ~1-core baseline (the #13 devlog value is the before-number).

## Dragging (verified)

- `getCurrentWindow().startDragging()` (JS, `@tauri-apps/api/window`) — NOT manual setPosition-per-move. Needs permission `core:window:allow-start-dragging`.
- Click-vs-drag **4px dead-zone** (BANDORI pattern): a press that moves <4px is a click (reaches `model.hitTest`, seam for #16), ≥4px starts the window drag. Press must land on an opaque model pixel (alpha gate is #15's job — for #14, a simple whole-window drag is acceptable; note the seam).

## Win11 DWM polish (increment, belt-and-suspenders)

Try `shadow:false` alone FIRST. Only if the smoke shows a residual Win11 rounded corner / thin border, add the DWM suppression: `windows` crate added DIRECTLY to `src-tauri/Cargo.toml` **pinned `windows = "0.61"`** (the exact line tauri 2.11.5 uses — a different major breaks HWND type-compat) with feature `Win32_Graphics_Dwm`; `WebviewWindow::hwnd()` → `HWND`; call `DwmSetWindowAttribute` with `DWMWA_WINDOW_CORNER_PREFERENCE=DWMWCP_DONOTROUND` + `DWMWA_BORDER_COLOR=DWMWA_COLOR_NONE`, Win11 22H2+ gated, graceful no-op on Win10. If `shadow:false` suffices, SKIP DWM and note that in the report (do not add an unneeded dep).

## Capabilities / permissions (verified ids)

`capabilities/pet.json` needs: `core:window:allow-start-dragging`, `core:window:allow-set-position`, `core:window:allow-outer-position`, `core:event:default`, plus the window-state plugin's permission (`window-state:default` or similar — regenerate schema after adding the plugin and use the exact generated id). Every Tauri command/plugin needs its capability entry — forgetting compiles fine, fails at runtime.

## Acceptance criteria (issue #14 + adjustments)

- [ ] Transparent borderless always-on-top window shows the Live2D model idling with **blink + breathing**
- [ ] Renderer state machine transitions idle/thinking/working/sleeping; states UI-local (no LLM/token cost)
- [ ] Render-throttling governor: full fps when active, throttled on blur, **provably paused when minimized/hidden** (frame-callback assertion) — governor respects the `renderThrottling` flag (default on). **AC ADJUSTED (user-ratified): "paused when covered by another window" is out of scope — undetectable via verified APIs; documented as a known limit.**
- [ ] Model is draggable via `startDragging`; position persists across restarts (via `tauri-plugin-window-state`, pet window scoped)
- [ ] `renderer/` contains ZERO React imports; bridge isolated to `pet-stage.tsx`
- [ ] Increment: Win11 DWM polish applied IF `shadow:false` insufficient (else documented as unneeded)
- [ ] Tests: state-machine transitions (pure unit tests, vitest); governor pause assertion

## Constraints

- Never code library APIs from memory — research files in `research/` carry verified signatures; still confirm against `node_modules` when wiring the plugin (its per-window builder method names + permission id were NOT verifiable pre-install).
- Anti-sprawl: TS file <=300 / fn <=50 / <=3 params; Rust fn <=100; INPUT/OUTPUT/POS headers on every production file; update each touched dir's `index.md`.
- Do NOT modify `packages/core` / `packages/shared` (no protocol change this issue — decision (a) keeps geometry out of the Core). Rust changes limited to `apps/desktop/src-tauri` (window config, plugin registration, optional DWM, pet capability).
- `main.rs` stays a thin shim; window/plugin wiring in `lib.rs` + modules.
- Idle CPU with governor ON is an acceptance concern — measure it and put the number in the task report against the #13 baseline.
- Manual visual checks (transparency, no Win11 border, drag feel, actual idle animation) go to `docs/devlog/manual-checks.md` — headless can't verify them.

## Research inputs (all verified, read before coding)

- `research/01-transparent-overlay-window.md` — window config fields + shadow gotcha
- `research/02-multi-window-capabilities.md` — pet label + capability file + permission ids
- `research/03-window-dragging.md` — startDragging + dead-zone
- `research/04-position-persistence.md` — decision (a) rationale + plugin wiring notes
- `research/05-win11-dwm-polish.md` — DWM belt-and-suspenders
- `research/06-framerate-governor.md` — ticker control + window/visibility events
- `.trellis/spec/frontend/live2d-renderer.md` — locked stack, load order, param API, idle-cost caveat
