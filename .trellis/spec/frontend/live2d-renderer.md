# Live2D Renderer Contract (locked by spike #13, 2026-07-13)

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
