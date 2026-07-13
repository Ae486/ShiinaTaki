# Live2D renderer spike — report (issue #13)

> **RESOLVED 2026-07-13 (runtime pass captured):** The PENDING items below were subsequently
> driven to completion — see `runtime-evidence.md` for the verbatim `window.__spikeStatus`
> (all probes `ok: true` on both moc and moc3, `decision` = LOCK). `docs/TECH-STACK.md` was
> updated to the locked choice accordingly. The "PENDING-RUNTIME" framing in this section
> reflects the implement-agent's state before that browser run and is kept for the record.
> Two items remain genuinely manual (in-WebView2 GPU visual + idle CPU) — queued in
> `docs/devlog/manual-checks.md`.

**Status: PENDING-RUNTIME.** The harness is built, all gates are green, and the full asset-serving path is verified over HTTP. The in-browser probe results (motion playback, expression swap, hit-test return values, parameter round-trip, lip-sync API init) require a WebGL browser context, which the implement agent cannot drive. Those items are marked PENDING below and must be captured by the leader's browser run. Per the task contract, `docs/TECH-STACK.md` is **left untouched** until runtime evidence confirms the decision — no runtime results are fabricated here.

## Pinned versions (installed, verified)

| Package | Version | Source of truth |
| --- | --- | --- |
| `untitled-pixi-live2d-engine` | **1.3.1** | `node_modules` package.json + exported `VERSION` |
| `pixi.js` | **8.19.0** | `node_modules/pixi.js/package.json` |
| `@pixi/sound` | 6.0.1 | pulled in as the engine's peer dep (needed for `model.speak` lip-sync) |

## What was built

- `scripts/vendor-live2d-runtimes.mjs` — downloads the two proprietary Cubism runtimes into the git-ignored `apps/desktop/public/vendor/live2d/`. Ran successfully: `live2dcubismcore.min.js` (207155 B, official Live2D CDN) and `live2d.min.js` (129056 B, dylanNew mirror). `.gitignore` updated in the same change; `git check-ignore` confirms the dir is ignored.
- `apps/desktop/src/renderer/spike/` — framework-free harness (no React imports): `create-stage.ts` (PixiJS v8 async init + `extensions.add(Live2DPlugin)`), `probe-model.ts` (loads a model, exercises every capability), `param-probe.ts` (generation-aware raw param round-trip), `run-spike.ts` (orchestrator → `window.__spikeStatus`), `spike-status.ts` (types + window bridge).
- `apps/desktop/spike.html` + `apps/desktop/src/windows/spike/main.ts` — standalone Vite entry, loads the two runtime globals via `<script>` before the module, mounts a canvas + live text readout. Runs in a plain browser (no Tauri) via `pnpm --filter @taki/desktop dev`.
- `apps/desktop/vite.config.ts` — added `spike.html` as a second Rollup input, and a **dev-only** middleware serving the git-ignored `models/extracted/taki` at `/spike-assets/*` (keeps copyrighted assets out of `public/` and out of any production build).

## Test models (extracted from `models/taki.zst`, git-ignored)

- **Cubism 2 (moc)**: `arbeit/` — `model.json` + `data/model.moc` (719 KB), 2 textures, **43 local motions**, **30 local expressions**. Chosen over the prd's suggested `casual/` because `casual/`'s motions/expressions all reference an external `../_mtn_emp/` shared pool that is **not present** in `taki.zst`; `arbeit/` is fully self-contained, so the motion/expression probes are meaningful.
- **Cubism 3+ (moc3)**: `live_01/` — `.model3.json` + `.moc3` (4.5 MB), 2 textures (one is 1.75 MB), **66 local motions**, **33 local expressions**.

## API verification (read from installed `node_modules` types — not memory)

Confirmed against `untitled-pixi-live2d-engine/types/index.d.ts`:

- Init: `extensions.add(Live2DPlugin)` before `new Application()`; `await app.init(...)` is async (PixiJS 8).
- Load: `Live2DModel.from(source, options?)` → `Promise<Live2DModel>`.
- Motion / expression: `model.motion(group, index?)` → `Promise<boolean>`; `model.expression(id?)` → `Promise<boolean>`.
- Hit-test: `model.hitTest(x, y)` → `string[]` (hit-area names).
- Lip-sync: `model.speak(url, opts?)` exists (the "wheel"); we only assert the method is present, no audio played.
- Raw parameter access differs by generation (both covered by `param-probe.ts`):
  - **Legacy (Cubism 2)**: `internalModel` is `CubismLegacyInternalModel`, `coreModel` is `Live2DModelWebGL` with string-keyed `setParamFloat(id, v)` / `getParamFloat(id)` (`PARAM_ANGLE_X`).
  - **Modern (Cubism 3-5)**: `internalModel` is `CubismInternalModel` exposing `idParamAngleX` (a `CubismIdHandle`); `coreModel` is `CubismModel` with `setParameterValueById(handle, v)` / `getParameterValueById(handle)`.
- Runtime globals the bundles require: modern reads `window.Live2DCubismCore`; legacy calls the global `Live2DModelWebGL` (and errors with "Could not find Cubism 2 runtime … requires live2d.min.js" if absent). Both are provided by the vendored `<script>`s.

## Serving evidence (observed — `vite dev` on :1420, every endpoint 200)

| Endpoint | HTTP | Size | Content-Type |
| --- | --- | --- | --- |
| `/spike.html` | 200 | 974 B | text/html |
| `/vendor/live2d/live2dcubismcore.min.js` | 200 | 207155 B | text/javascript |
| `/vendor/live2d/live2d.min.js` | 200 | 129056 B | text/javascript |
| `/spike-assets/arbeit/model.json` | 200 | 7040 B | application/json |
| `/spike-assets/arbeit/data/model.moc` | 200 | 719783 B | application/octet-stream |
| `/spike-assets/arbeit/data/textures/texture_00.png` | 200 | 79223 B | image/png |
| `/spike-assets/live_01/….model3.json` | 200 | 11344 B | application/json |
| `/spike-assets/live_01/….moc3` | 200 | 4520896 B | application/octet-stream |
| `/spike-assets/live_01/textures/texture_00.png` | 200 | 1752537 B | image/png |
| `/src/windows/spike/main.ts` | 200 | 6700 B | text/javascript |

The module entry transpiling and serving 200 proves the full import graph (`renderer/spike/*` + the engine import) resolves under Vite. This is the whole path short of executing WebGL.

## Static manifest observations (determinable without a browser — feed downstream issues)

- **Hit areas (increment: feeds #16)**: NEITHER model declares standard SDK hit areas. The Cubism 2 `arbeit/model.json` has only `hit_areas_custom` (a BandoriPet-custom rect field: head/body), and the Cubism 3+ `live_01` `.model3.json` `Groups` are only `EyeBlink` + `LipSync` — **no `HitAreas`**. So `model.hitTest(center)` is expected to return `[]` for both, and the custom hit-area increment (#16) is very likely required for click reactions. (Runtime confirmation of the empty return is PENDING.)
- **Lip-sync params present**: `live_01`'s `LipSync` group targets `ParamMouthOpenY` — the mouth param the amplitude path will drive (#31).
- **Large-atlas concern**: the moc3 is 4.5 MB and its textures are 1.75 MB each (×2). This is exactly the BanG Dream large-atlas pressure the research flagged for mobile WebView memory; the engine's `textureOptions.lod: 'single-auto'` is the hedge to test under #14/mobile.

## PENDING-RUNTIME items (leader's browser run)

Run `pnpm --filter @taki/desktop dev`, open **http://localhost:1420/spike.html**, then read `window.__spikeStatus` (and the on-page readout / console). Capture per model:

- [ ] moc + moc3 both **load** (canvas dims populate)
- [ ] a **motion** starts (`model.motion(group,0)` resolves truthy)
- [ ] an **expression** applies (`model.expression(0)` resolves truthy)
- [ ] **hitTest** return values (expected `[]` given no SDK hit areas — confirm)
- [ ] **param round-trip** passes on BOTH generations (write 15 → read back ≈15)
- [ ] **lip-sync API** present (`model.speak` is a function)
- [ ] **framing/layout scale** readout per model (does moc3 need ~1.35× compensation, per BANDORI? — the readout reports layout-scale)
- [ ] idle CPU/GPU behavior once both models sit idle (breath/blink only)

`window.__spikeStatus.decision` will auto-derive the tree outcome: both generations rendering (load + motion + expression) → "LOCK untitled-pixi-live2d-engine".

## Decision

**PENDING-RUNTIME.** The decision tree has no free variables and the harness encodes it (`run-spike.ts` → `deriveDecision`), but locking the choice requires the runtime pass above. Once the leader confirms `window.__spikeStatus.decision` reports the LOCK outcome, write the pinned choice (`untitled-pixi-live2d-engine@1.3.1`, `pixi.js@8.19.0`) into `docs/TECH-STACK.md`'s renderer decision section. If the Cubism 2 path fails at runtime, follow the prd's fallback branch (determine whether the moc3 set needs Cubism 5 specifically before adopting `pixi-live2d-display-lipsyncpatch`).

## Gates

- `pnpm --filter @taki/desktop typecheck` — green
- `pnpm -r typecheck` (all 5 packages) — green
- `pnpm lint` (full repo) — green (vendored minified runtimes added to eslint ignores)
