# Live2D Renderer Contract (locked by spike #13, 2026-07-13)

> **Reference-first rule (user-directed 2026-07-14): for ANY Live2D work — model/manifest parsing, `.zst` import, hit areas, param-driven behavior, lip-sync, idle/click behaviors — FIRST study how BANDORI-PET-REV did it (`references/BANDORI-PET-REV-main/`), then adapt to OUR stack + needs.** Good ideas and structures can be taken directly; the constraint is only clean-room (GPLv3 — patterns/algorithms/data-formats yes, no verbatim code copy) and the stack difference (we are PixiJS 8 + untitled-pixi-live2d-engine, NOT its PySide6/QOpenGLWidget + LuaJIT core — so its render-core hacks are irrelevant, but its presentation logic, format handling, and behavior tables are gold). Reference-file map (all GPLv3, study-only): `zst_model_archive.py` + `TOOL-convert_models_to_zst.py` + `OUTFIT.md` (the `.zst` collection format we must read in #18), `custom_model_import.py` + `model_manager.py` (generic Cubism import + character/costume layout), `live2d_widget.py` (tracking/hit-test/lip-sync/quality), `live2d_click_actions.py` + `click_motion_presets.py` (7-region + fuzzy resolver), `emotion_behavior.py` (emotion→behavior tables), `tts_manager.py` (lip-sync pipeline, for #31). Deeper prose analysis: `.trellis/tasks/archive/2026-07/07-07-reference-research/research/live2d-presentation-analysis.md`.

**Locked stack**: `untitled-pixi-live2d-engine@1.3.1` + `pixi.js@8.19.0`, Cubism Core 5.1.0. Evidence: `.trellis/tasks/07-13-live2d-renderer-spike/research/` (do not re-litigate the choice; a change requires a superseding spike + TECH-STACK edit).

## Load order & init (verified against installed types — keep verifying on version bumps)

1. Runtime globals load as plain `<script>` tags BEFORE the module entry: `live2dcubismcore.min.js` (sets `window.Live2DCubismCore`, Cubism 3-5) and `live2d.min.js` (Cubism 2.1 legacy). Missing legacy runtime fails with "Could not find Cubism 2 runtime".
2. `extensions.add(Live2DPlugin)` before `new Application()`; PixiJS 8 `await app.init(...)` is async.
3. `Live2DModel.from(source)` → `Promise<Live2DModel>`; `model.motion(group, index?)` / `model.expression(id?)` → `Promise<boolean>`; `model.hitTest(x, y)` → `string[]`; `model.speak(url, opts?)` (lip-sync wheel, activation deferred to #31).

## Teardown order (established by real WebView2 StrictMode repro, 2026-08-19)

The Pet scene owns the Live2D model and its Pixi `Application`, so it also owns their teardown order. Destroy the
attached `Live2DModel` while `app.ticker` is still alive, remove it from the stage, and only then call `app.destroy()`.
The disposer must be idempotent.

Pixi destroys Application plugins (including its ticker) before stage children. If a Live2D model remains attached,
its `Automator.destroy()` later calls `ticker.remove()` against the destroyed ticker and throws
`Cannot read properties of null (reading 'next')`. Under React StrictMode that leaves the probe canvas in the DOM above
the second live canvas, making successfully loaded model assets appear blank.

```typescript
// Wrong: ticker plugin dies before the Live2D child unregisters its Automator.
app.destroy(true, { children: true });

// Correct: model teardown runs while the governed ticker is valid; the empty app can then remove its canvas.
app.stage.removeChild(model);
model.destroy({ children: true });
app.destroy(true);
```

Required regression points: two `dispose()` calls do not throw; model removal/destruction occur exactly once before
application destruction; a real Tauri development reload has exactly one canvas and no teardown exception.

## Cubism 2 mask context ownership (verified 2026-10-16)

Engine 1.3.1's `Live2DModel.generateUID()` counts per model, starting at 1, while the vendored Cubism 2 SDK stores
`frameBuffers[glno]` and `fTexture[glno]` in realm-global arrays. Two asynchronous StrictMode scenes therefore overwrite
the same slot. After the late probe is disposed, the live context rejects the foreign framebuffer and keeps its
previous target (often the main canvas) bound. Colored mask-channel shapes and failed pupil clipping are the visible
symptoms; one remaining canvas does not prove mask ownership is correct.

`renderer/live2d/legacy-mask-context.ts` wraps the legacy internal model's `updateWebGLContext` before the loader adds
the model to the stage. This must precede even the first forced click-through RenderTexture capture. Each initialization
gets a unique realm slot; `Symbol.for` keeps allocation and duplicate-install guards stable across Vite HMR. Cubism 3+
continues through its own engine path. Keep the locked engine/runtime and model assets unchanged for this workaround.

On context reinitialization or internal-model destruction, release only the captured framebuffer, renderbuffer and
textures. Remove cache references only when identities still match; validate handles against their owning GL context
and delete a shared texture once. Never call the SDK's realm-wide cache disposal for one scene or costume. This adapter
owns mask allocations only, not all SDK GPU resources or the renderer's context-restoration policy.

Regression coverage: `legacy-mask-context.test.ts` reproduces the original rejected-binding leak, then covers multiple
contexts, shared-context costumes, late StrictMode teardown, reinitialization, lost contexts, foreign replacements,
failed initialization, duplicate installation and HMR. `load-character-model.test.ts` covers attachment ordering, a late
async model and the Cubism 3+ branch. Live evidence must check `gl.isFramebuffer` / `gl.isTexture` from the visible
canvas's context as well as a screenshot; screenshots alone cannot establish that mask draws target the right buffer.

## Avatar Command outcome classification (established D80, 2026-09-19)

`renderer/live2d/avatar-commands.ts` resolves every Avatar Command to a Presentation Outcome report and never throws.
The engine promise decides `applied`; a `false` is classified best-effort from state read BEFORE the call, mirroring
the engine 1.3.1 rules verified in `dist/index.js`:

- **Motion** (`MotionManager.startMotion`): `state.reserve(group, index, priority)` refuses a non-FORCE priority that is
  `<= state.currentPriority` or `<= state.reservePriority` (and an already playing/reserved same motion); after a
  successful reserve, `currentAudio.isPlaying && priority != FORCE` refuses too. Classification order: `speaking`
  (audio playing, non-FORCE) → `motion_busy` (priority at/below current or reserved) → `superseded` (a newer motion
  command for this model started before this one resolved) → `unavailable`.
- **Expression** (`ExpressionManager.setExpression`): an index equal to the current expression returns `false` before
  the reserve slot is touched; a pending load whose `reserveExpressionIndex` moved on returns `false`. Classification:
  `already_active` (target index === pre-call current index) → `superseded` (newer expression command started) →
  `unavailable`. `already_active` is checked first because it is deterministic; a back-to-back pair would otherwise
  mislabel it.
- Unknown name → `rejected/unknown_name` plus the vocabulary drift re-report (1b). A throw → `rejected/unavailable`.
- Agent motions keep NORMAL by default: never escalate to FORCE or queue to turn a rejection into an apply — the
  rejection is the truthful outcome and the tool description tells the model not to retry.
- The report leaves the window only while the connection generation is current (`restore-pet-connection.ts`); a
  retired generation reports nothing and Core resolves `unknown` at its deadline.

Regression fixtures: `avatar-commands.test.ts` reproduces the Lab table (same expression twice, NORMAL over NORMAL,
two un-awaited expressions, speaking, unknown name, throw) with a fake model.

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

Per-frame order (engine 1.3.1, lab-verified 2026-09-18): `internalModel.update()` emits `beforeMotionUpdate` →
motion/expression update → `afterMotionUpdate` → `beforeModelUpdate` → `coreModel.update()` → `loadParam()`
(restores the saved snapshot). Any parameter written or read for a frame must happen synchronously inside one of
those events; a deferred read (microtask/timeout) after `beforeModelUpdate` sees the restored values, not the frame's.

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
- Alpha authority = a cadence-gated cached CPU mask: render `app.stage` (identity transform = screen space, gives 1:1 window-local→mask mapping) into a persistent low-res (~¼) RenderTexture via `renderer.extract.pixels(renderTexture)` (passing a RenderTexture skips generateTexture + does not destroy — one readback, no stall), refreshed through the GOVERNED ticker at a gated cadence (`renderer/frame-gated-refresher.ts`, every 4th governed frame — readback no longer per-frame) and FORCED at silhouette jumps (scene build, model attach/costume switch, canvas resize); sampling never touches the GPU. Static-but-correct when the governor pauses (no separate timer — when the ticker stops, zero refreshes). The cursor poll reads one mask cell O(1) — NEVER `extract.pixels` per poll (that path renders + syncs gl.readPixels = GPU stall). The mask subsumes any bbox pre-gate (empty pixels read alpha 0); do NOT also gate on `model.containsPoint` (it tests model-local bounds — feeding screen coords risks false-reject drop-through). Accepted tradeoff: the cached silhouette may trail up to the gate interval during fast motions (manual-verify click-through there).
- Coordinate transform (the highest-risk line): `(cursorPosition − innerPosition) / scaleFactor → canvas-local logical px`. Use `innerPosition` (client area), NOT `outerPosition`. Toggle formula `ignore = !dragging && !buttonDown && !opaque`, fired only on change (busy-guard against overlapping IPC). Lift the `dragging` flag to a shared store so the toggle suspends during drag (no mid-drag drop-through); recover OS-swallowed releases (`buttons===0` pointermove / blur / pointercancel). Restore `setIgnoreCursorEvents(false)` on teardown so a disposed overlay never leaves the window stuck click-through.

## Costume switch, staleness, and attachment truth (established #18, hardened T1 1f + D61)

A switch loads the new model FIRST, then tears down the previous (`reloadModel`, costume-switch.ts) — a failed load leaves the current model rendering. A monotonic switch ticket `ctx.seq` guards races: `isStale = () => ctx.seq.current !== ticket`, checked AFTER the load resolves; a newer switch that bumped `seq` makes the late arrival self-discard (removeChild + destroy + throw), never attaching.

- **`withTimeout` does NOT cancel the source** (promise-timeout.ts just stops awaiting). A slow-but-eventually-finishing load whose `isStale` is still false will attach LATE — silently swapping the on-screen costume while the identity stores stay pre-switch. D61's `AttemptGate` therefore calls `PetScene.abortSwitch()` on Cancel/deadline/failure while renderer work is live. The ticket bump makes a late `reloadModel` see `isStale → true` and self-discard. The call is exact-once per live renderer stage, idempotent, and model-less safe.
- **Attachment is the worn-costume commit boundary**: `switchCostume()` resolves only after `attachModel`. Its caller commits window-local selection and best-effort `last-costume` synchronously from that resolution. `avatar.report` is downstream synchronization; a failed or outcome-unknown report cannot relabel the visible attachment as failed. The next authenticated generation re-reports `reportSnapshot()`.
- **Pre-attachment timeout/cancel never advances identity**: a stopped resolution/path/renderer stage cannot update scene, current selection, `last-costume`, or Core vocabulary. Do not move report/persistence into an earlier intent stage.
- **`reportSnapshot()` is live-scene authority**: the optional costume ID comes from the source that actually attached in the current `SceneModel`, never from `localStorage` or the requested costume.
- **`ctx.seq` is shared with idle-motion staleness (D39)**: `abortSwitch` bumping it also disposes the retained model's idle scheduler → it loses random Idle Motion until the next switch (engine breath/blink stay; correctness untouched — a spurious bump can never mis-attach a model or mis-report vocab, those gate on success downstream). Accepted; decouple via a separate idle ticket only when it bites.

The full cross-window total-budget, Home-result, report-recovery, and initial-promotion contract is
[`costume-operation-lifecycle.md`](./costume-operation-lifecycle.md).
