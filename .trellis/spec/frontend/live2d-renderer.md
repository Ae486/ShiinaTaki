# Live2D Renderer Contract (locked by spike #13, 2026-07-13)

> **Reference-first rule (user-directed 2026-07-14): for ANY Live2D work — model/manifest parsing, `.zst` import, hit areas, param-driven behavior, lip-sync, idle/click behaviors — FIRST study how BANDORI-PET-REV did it (`references/BANDORI-PET-REV-main/`), then adapt to OUR stack + needs.** Good ideas and structures can be taken directly; the constraint is only clean-room (GPLv3 — patterns/algorithms/data-formats yes, no verbatim code copy) and the stack difference (we are PixiJS 8 + untitled-pixi-live2d-engine, NOT its PySide6/QOpenGLWidget + LuaJIT core — so its render-core hacks are irrelevant, but its presentation logic, format handling, and behavior tables are gold). Reference-file map (all GPLv3, study-only): `zst_model_archive.py` + `TOOL-convert_models_to_zst.py` + `OUTFIT.md` (the `.zst` collection format we must read in #18), `custom_model_import.py` + `model_manager.py` (generic Cubism import + character/costume layout), `live2d_widget.py` (tracking/hit-test/lip-sync/quality), `live2d_click_actions.py` + `click_motion_presets.py` (7-region + fuzzy resolver), `emotion_behavior.py` (emotion→behavior tables), `tts_manager.py` (lip-sync pipeline, for #31). Deeper prose analysis: `.trellis/tasks/archive/2026-07/07-07-reference-research/research/live2d-presentation-analysis.md`.

**Locked stack**: `untitled-pixi-live2d-engine@1.3.1` + `pixi.js@8.19.0`, Cubism Core 5.1.0. Evidence: `.trellis/tasks/07-13-live2d-renderer-spike/research/` (do not re-litigate the choice; a change requires a superseding spike + TECH-STACK edit).

## Load order & init (verified against installed types — keep verifying on version bumps)

1. Runtime globals load as plain `<script>` tags BEFORE the module entry: `live2dcubismcore.min.js` (sets `window.Live2DCubismCore`, Cubism 3-5) and `live2d.min.js` (Cubism 2.1 legacy). Missing legacy runtime fails with "Could not find Cubism 2 runtime".
2. `extensions.add(Live2DPlugin)` before `new Application()`; PixiJS 8 `await app.init(...)` is async.
3. `Live2DModel.from(source)` → `Promise<Live2DModel>`; `model.motion(group, index?)` / `model.expression(id?)` → `Promise<boolean>`; `model.hitTest(x, y)` → `string[]`; `model.speak(url, opts?)` (lip-sync wheel, activation deferred to #31).

## Generation split — raw parameter access (the gotcha)

The API differs by model generation; any param-driven feature (head tracking, lip-sync, click feedback) MUST branch:

```ts
// Legacy (Cubism 2, .model.json/.moc): string-keyed
const legacy = model.internalModel.coreModel; // Live2DModelWebGL
legacy.setParamFloat("PARAM_ANGLE_X", v); legacy.getParamFloat("PARAM_ANGLE_X");

// Modern (Cubism 3-5, .model3.json/.moc3): handle-keyed
const modern = model.internalModel;           // CubismInternalModel
modern.coreModel.setParameterValueById(modern.idParamAngleX, v);
```

Reference implementation: `apps/desktop/src/renderer/spike/param-probe.ts`.

## BanG Dream model facts (verified on taki assets)

- Manifests define NO standard SDK hit areas (`hitTest` returns `[]`); Cubism 2 files carry a BandoriPet-custom `hit_areas_custom` field instead → click reactions need the custom hit-area increment (#16).
- moc3 assets are large (4.5 MB moc3, 1.75 MB per texture) — use the engine's `textureOptions.lod` hedge; watch memory on always-on overlay and future mobile.
- Layout scale measured 1.0 on both generations — no BANDORI-style 1.35x framing compensation unless #14 observes otherwise.
- Auto-behaviors are NOT free: a loaded model shows only built-in idle param drift (a slight breath sway). Eye-blink does NOT run automatically — it needs the EyeBlink motion group driven explicitly or an idle loop (that is #14's state machine, not the renderer default). `autoInteract` defaults are off in our harness.
- Idle cost is high WITHOUT a frame governor: PixiJS defaults to full-rate redraw, so two idle models pegged ~1 CPU core in the spike. The frame governor (full-rate while animating, throttle when idle, pause off-screen/asleep) is a #14 acceptance criterion, not an optimization — treat any always-on render loop without it as a defect.
- Cubism 2 costumes may reference an external `../_mtn_emp/` shared motion pool absent from the `.zst` (e.g. taki `casual/`); prefer self-contained costumes (e.g. `arbeit/`) or handle missing motion refs gracefully at import (#18).

## Render governor (established #14) — mandatory for any always-on canvas

- The governor OWNS the ticker: create the PixiJS app with `autoStart:false` and let the governor call `ticker.start()/stop()` + set `maxFPS`. Never let a Live2D model update on an unstarted `Ticker.shared` while the app runs a different ticker — that was the spike's "blink doesn't run" bug. Bind the model explicitly to the governed ticker.
- Tiers: full fps while active/interacting; throttle on window blur (`getCurrentWindow().onFocusChanged`); STOP on `visibilitychange` hidden (minimize) — provable via a frame-count assertion (0 frames while hidden, resumes on unhide). "Paused when covered by another window" is NOT achievable (no verified Tauri/DOM occlusion API) — scope it out, don't fake it.
- Gate the whole thing on a `renderThrottling` flag (default true); off ⇒ always full-rate, never paused. The flag's real config wiring is deferred (D19 → M5 #24); #14-era code reads a local default.

## Window geometry persistence (decided #14)

Pet window position is LOCAL window-manager state, NOT agent-domain state of record — it is per-machine, meaningless to the OS-neutral Core (invariant 8), and must NOT cross the WS protocol. Use `tauri-plugin-window-state` (Rust-side, POSITION-only, pet-scoped via `with_denylist(["main"])`); geometry never touches `packages/core`/`packages/shared`. This is the ruling on "durable state belongs to Agent Core": that rule covers agent-domain durable state (sessions/memory/config), not display-manager chrome.

## Per-pixel click-through (established #15)

- The transparent-window paradox is REAL (Tauri #2090/#6164): `setIgnoreCursorEvents(true)` kills ALL pointer events with no forward option, so a webview-`pointermove`-driven toggle can never flip back. Drive the toggle from the GLOBAL cursor (`cursorPosition()`, a top-level `@tauri-apps/api/window` export wrapping `GetCursorPos`) — readable regardless of ignore state. No `windows` crate: Tauri's `setIgnoreCursorEvents` already sets `WS_EX_TRANSPARENT｜WS_EX_LAYERED`.
- Alpha authority = a per-frame cached CPU mask: render `app.stage` (identity transform = screen space, gives 1:1 window-local→mask mapping) into a persistent low-res (~¼) RenderTexture once per painted frame via `renderer.extract.pixels(renderTexture)` (passing a RenderTexture skips generateTexture + does not destroy — one readback/frame), refresh hooked into the GOVERNED ticker (rides the frame governor, static-but-correct when paused). The cursor poll reads one mask cell O(1) — NEVER `extract.pixels` per poll (that path renders + syncs gl.readPixels = GPU stall). The mask subsumes any bbox pre-gate (empty pixels read alpha 0); do NOT also gate on `model.containsPoint` (it tests model-local bounds — feeding screen coords risks false-reject drop-through).
- Coordinate transform (the highest-risk line): `(cursorPosition − innerPosition) / scaleFactor → canvas-local logical px`. Use `innerPosition` (client area), NOT `outerPosition`. Toggle formula `ignore = !dragging && !buttonDown && !opaque`, fired only on change (busy-guard against overlapping IPC). Lift the `dragging` flag to a shared store so the toggle suspends during drag (no mid-drag drop-through); recover OS-swallowed releases (`buttons===0` pointermove / blur / pointercancel). Restore `setIgnoreCursorEvents(false)` on teardown so a disposed overlay never leaves the window stuck click-through.
