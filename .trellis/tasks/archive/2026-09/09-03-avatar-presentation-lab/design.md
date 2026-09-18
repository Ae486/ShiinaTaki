# Design — Avatar presentation lab

Read `prd.md` first: the isolation ruling there is binding. Everything below is under `apps/desktop/`.

Owner clarification (2026-09-08): this is a localization/feasibility lab for AgentAtelierR's presentation ideas,
not a new engine. The comparison baseline is Taki's unchanged production command path plus installed engine
behavior. Native expression/motion composition is already functional in the verified cases; face filtering is an
optional diagnostic, not a prerequisite for presentation. Additional controllers below are scoped experiment
fixtures or adaptations with explicit justification, never a blanket adoption plan. Before each later phase,
compare the reference's desired visible effect with the native baseline and implement only the missing behavior.

Current phase decision (2026-09-08): Phase 3 overlays are skipped; relax belongs to future mood-preset restoration.
Phase 4 now provides native speech playback and observations, provider adapters and a local clip input. The old
overlay/envelope topology below is retained as possible experiment context only. Native results, parameter tuning
and acceptance limits are recorded in `research/phase4-native-speech-findings-2026-09-08.md`; Phase 5 is not an
active implementation order.

Production command ordering and native-priority evidence is recorded in
`research/production-command-findings-2026-09-08.md`; it is separate from the direct-engine Phase 2 probes.

## 1. Directory layout — one tree, one delete

### Authorized panel integration (2026-09-11)

- Place Speech immediately after Model. Provide native/envelope mode selection, an automatically resolved
  character-and-costume profile, preparation status/timing, and independent Closed/A/E/I/O/U pose preview controls.
  Raw Parameter hold remains an optional advanced diagnostic, not a speech prerequisite.
- Decode retained audio and prepare the existing envelope/track on synthesis or file completion. Keep native
  playback available when analysis or profile support is unavailable; report the fallback explicitly.
- Reuse native audio output. Sample its actual source position (including AudioContext suspension) for custom
  writes. Do not copy the older automation harness's performance.now-based clock into the panel.
- A custom run owns exactly one writer and temporarily disables native lip-sync. Stop, end, source/mode change,
  costume replacement and disposal detach the writer and restore prior native state before the model is destroyed.
  Guard all asynchronous decode/load completion with a generation token. Natural silence produces zero opening.
- Bind profiles by both character and costume, require known declared IDs, and fill unused pose coordinates from
  the rest pose so rounded/width values cannot leak into subsequent poses. Preview all authored candidates without
  requiring manual parameter names; preview must end on speech start or source/model changes.
- Automated browser acceptance must use the normal visible panel controls. Verify profile matching, native/custom
  exclusivity, clock freeze/resume, end/Stop/replay/switch cleanup, failures, preview geometry and responsive layout.
  Preserve the earlier harness results as historical smoke observations, not audio-clock or phoneme certification.

```
apps/desktop/
├─ lab/                              ← THE experiment. Delete this dir to remove the lab.
│  ├─ lab.html                       served at /lab/lab.html in dev; never built
│  ├─ index.md
│  ├─ vite/                          node-side dev plugin (imported by vite.config.ts only)
│  │  ├─ lab-characters.ts           devLabCharacters(): middleware `/lab-characters/*` + JSON listing at the bare prefix
│  │  └─ lab-characters.test.ts
│  ├─ page/                          browser: DOM shell + panels (plain DOM, no React/Tailwind)
│  │  ├─ main.ts                     layout, createStage, createLabScene, mount panels, HMR/unload dispose
│  │  ├─ controls.ts                 DOM builders: section, row, button, select, slider, checkbox, textInput
│  │  ├─ panel-model.ts              character/costume picker + badges + load + facts summary
│  │  ├─ panel-motion.ts             group/index/priority/loop; channel; ignore-face (+eye-open) toggles; stop; invalidate cache
│  │  ├─ panel-expression.ts         expression list, set/reset; relax timer; "survives motion?" sample
│  │  ├─ panel-params.ts             param picker + hold-slider with hook position + write mode
│  │  ├─ panel-overlays.ts           blink / sway toggles + options; hook position; write mode; breathDepth isolate
│  │  ├─ panel-speech.ts             provider, base URL/key/voice/model/speed, key-persist checkbox, text, path selector, composite, stop
│  │  └─ panel-readout.ts            <pre> at 10 Hz: engine state, lipSyncIds, sampled params, envelope stats, findings log
│  ├─ scene/                         browser: engine-facing glue + pure behaviours
│  │  ├─ lab-scene.ts                owns app + ModelContext; load(entry); onModel / onBeforeDispose; stale-load guard
│  │  ├─ character-catalog.ts        listing JSON → CatalogEntry[]; toCostumeSource(entry, origin)            (+test)
│  │  ├─ costume-inspector.ts        post-load facts: generation, groups, expressions, lipSyncIds, param ids, face set
│  │  ├─ face-params.ts              pure: parse .exp.json / .exp3.json → {id, calc}; deriveFaceSet              (+test)
│  │  ├─ param-access.ts             duck-typed C2/C3 adapter: has/get/set/add/mult/listIds                    (+test)
│  │  ├─ frame-hooks.ts              registry over internal.on/off for the three events; dt clock             (+test)
│  │  ├─ layered-motion.ts           ensureChannels, playLayered, invalidateMotion                            (+test)
│  │  ├─ param-sampler.ts            samples ids at all three hooks; base-value drift detector                (+test)
│  │  ├─ blink-overlay.ts            pure scheduler (injected RNG) + overlay factory                          (+test)
│  │  ├─ sway-overlay.ts             nod/sway/phrase formulas; gain map; injected energy source               (+test)
│  │  ├─ expression-relax.ts         pure timer: arm / suppress / cancel / tick                               (+test)
│  │  ├─ lipsync-driver.ts           mouthFromEnergy, fakeMouthAt, fakeDurationMs, createLipsyncOverlay       (+test)
│  │  └─ speaking-state.ts           shared {speaking, energy, elapsedMs}; start/stop                         (+test)
│  └─ speech/                        browser: network + audio decoding (provider-agnostic)
│     ├─ speech-provider.ts          SpeechRequest / SpeechClip / SpeechProvider / Transport / ProviderConfig types
│     ├─ fish-audio-provider.ts      buildFishRequest (pure) + createFishAudioProvider                        (+test)
│     ├─ openai-compatible-provider.ts buildOpenAiSpeechRequest (pure, = docs/TTS-INTERFACE.md) + factory     (+test)
│     ├─ transport.ts                createTransport("direct" | "proxy"); proxy maps base → /lab-tts/fish | /lab-tts/local (+test)
│     ├─ clip-player.ts              lazy AudioContext (gesture), decode, play with elapsedMs(), stop/dispose
│     └─ audio-envelope.ts           pure DSP: PCM → Envelope; envelopeValueAt                                (+test)
├─ vite.config.ts                    EDIT (the only production file touched, ~12 lines, all inside `serve` guards)
└─ tsconfig.json                     EDIT: "include" += "lab"
```

Reused from `src/` **unmodified**, via the `@/` alias: `@/renderer/spike/create-stage.ts` (`createStage`),
`@/renderer/live2d/load-character-model.ts` (`loadCharacterModel`, `placeCentered`, `CostumeSource`),
`@/renderer/live2d/settings-prune.ts` (`pruneSettings`). If any of them proves unsuitable, **copy into `lab/`**;
never edit them for the lab.

`vite.config.ts` changes, each inside the existing `command === "serve"` / `apply: "serve"` discipline:
1. `input.lab = fileURLToPath(new URL("./lab/lab.html", import.meta.url))` next to `input.spike`.
2. `devLabCharacters()` added to `plugins` (imported from `./lab/vite/lab-characters.ts`; it self-declares `apply: "serve"`).
3. `server.proxy`: `"/lab-tts/fish": { target: "https://api.fish.audio", changeOrigin: true, rewrite: strip prefix }`
   and `"/lab-tts/local": { target: process.env.TAKI_LAB_TTS_LOCAL_TARGET ?? "http://127.0.0.1:9880", changeOrigin: true, rewrite: strip prefix }`.
   `server.proxy` is dev-only by construction. Fixed targets are the allowlist — no open forwarder.

The existing `spikeAssets()` plugin is **left exactly as is** — the lab plugin duplicates ~20 lines of middleware
rather than refactoring production config (isolation beats DRY here; the duplicate leaves with the lab).

## 2. Model source

`devLabCharacters()` serves `TAKI_LAB_CHARACTERS_ROOT ?? join(homedir(), ".takiagent", "workspace", "characters")`:
- `GET /lab-characters/` (bare prefix) → `{ root, characters: [{ id, character: <character.json> }] }` for every
  subdirectory containing `character.json`.
- `GET /lab-characters/<rel>` → the file, guarded by `normalize(join(root, rel)).startsWith(root)`; MIME by extension
  (`.json`, `.png`, `.wav`, `.mp3`; default `application/octet-stream` — `.moc/.moc3/.mtn` fetch fine as octet-stream).

`character.json` shape (verified): `{ characterId, costumes: string[], defaultCostume, settingsFilesByCostume:
Record<costume, "model.json" | "<name>.model3.json"> }` → settings URL `/lab-characters/<id>/<costume>/<file>`.

System B costumes reference `../_mtn_emp/…`, absent from the workspace. `toCostumeSource(entry, origin)` builds a
`CostumeSource` whose `resolve(ref)` returns `null` for any ref containing `..` (so `loadCharacterModel` →
`pruneSettings` strips it, same path as production #18) and the absolute URL otherwise; the count of pruned refs
becomes the badge.

## 3. Engine facts the code depends on (untitled-pixi-live2d-engine 1.3.1, dist source)

Per-frame `InternalModel.update()` — same shape in both generations:

```
beforeMotionUpdate → primary motion → parallel motions → afterMotionUpdate
→ saveParameters()                                     (snapshot of motion output)
→ expression (C2: set; C3: effective Add / Multiply / Overwrite)
→ built-in eyeBlink ONLY if no motion updated this frame
→ focus → breath
→ engine lipsync (only while motionManager.currentAudio): v = mouthSync()*lipSyncGain(1.5); v^1.15; clamp [0.1,1] if v>0; add with lipSyncWeight(0.4)
→ physics → pose
→ beforeModelUpdate → render → loadParameters()        (restore snapshot; writes after step 2 are discarded)
```

- **Hook semantics** — *confirmed in the browser, Phase 1 (2026-09-06)*. `afterMotionUpdate` writes go into the
  persistent base (physics sees them; hair follows a head sway) but expression/focus may overwrite them and `add`
  writes **accumulate** on params the motion does not write. `beforeModelUpdate` writes are the final word before
  render and never accumulate, but physics does not see them. **Accumulation saturates at the parameter's declared
  range**: both cores clamp on write (C2 inner `setParamFloat` clamps to min/max; `addToParamFloat` is
  `setParamFloat(get + v·w)`; C3 `setParameterValueByIndex` likewise), so `PARAM_ANGLE_X` pins at ±30 within a frame —
  a runaway overlay cannot blow a parameter up, but a 20-per-frame `add` looks like a one-frame jump. For a visible
  ramp use a small step (5).
- **`ignoreParamIds`** (`_startMotion`) filters the motion's curve list before queueing — and **mutates the cached
  motion object** in `motionManager.motionGroups[group][index]`; the parallel manager loads through
  `this.manager.loadMotion()` so it shares that cache. A motion once played filtered stays filtered for later
  unfiltered plays until the slot is reset to `undefined` (`null` means "load failed" — never use it).
- **Idle auto-start — does NOT fire on BanG Dream assets.** `MotionManager.update()` starts a random motion from the
  group literally named `idle` (C2) / `Idle` (C3) whenever the queue is finished. Our costumes have no such group
  (`idle01`, `mtn_idle01_C` do not match), so after "Stop all" the queue stays finished, `isFinished()` is true, and
  the engine's built-in blink **does** run between motions. Production `idle-motion.ts` is what keeps a motion going.
- **Cubism 3 manifests carry `FileReferences.Pose = null`** (all 39 imported costumes). The engine's `replaceFiles`
  forwards that `null` to the resolver verbatim; every resolver must reject non-string refs (production
  `resolveResourcePath` does; the lab's `toCostumeSource` learned it the hard way in Phase 1).
- **`speak()`** loads `@pixi/sound` (real dependency, present); audible playback and the analyser are fed by separate
  sources (possible A/V offset — measure it). `SoundManager.analyze()` is dB-normalised (−90..−10 dB, smoothing 0.85).
  `speak()` returns `false` while audio is already playing. `config.sound` defaults `true`;
  `config.preserveExpressionOnMotion` defaults `true`.
- **`lipSyncIds`** is never empty: C2 hard-codes `["PARAM_MOUTH_OPEN_Y"]`; C3 defaults `["ParamMouthOpenY"]` unless the
  settings declare a LipSync group. Report it; use it as the custom path's default target.
- `internalModel.options.{lipSyncGain, lipSyncWeight, breathDepth}` are read every frame → mutable live.
- `parallelMotionManager` is empty until `internal.extendParallelMotionManager(n)`. `model.motion()` has no
  `ignoreParamIds`; `motionManager.startMotion(group, index, priority, { ignoreParamIds, loop })` and
  `parallelMotionManager[n].startMotion(group, index, priority, { ignoreParamIds, loop })` do.
- Core APIs: C2 `coreModel.setParamFloat(id, v)` / `addToParamFloat(id, v, w)` / `multParamFloat(id, v, w)` /
  `getParamFloat(id)` / `getParamIndex(id)`; C3 `internal.idManager.getId(str)` → handle,
  `coreModel.setParameterValueById(h, v, w)` / `addParameterValueById` / `multiplyParameterValueById` /
  `getParameterValueById`; param enumeration `coreModel.getParameterCount()` + `getParameterId(i)` (C3 only).
- Asset facts: every C2 motion writes all 64 params incl. the face; C3 motions ~105 curves incl. the face. C2
  expressions declare 22 params with `calc: "add" | "mult"` (default add; `mult` on `PARAM_EYE_L/R_OPEN`), but the
  installed 1.3.1 `Live2DExpression.updateParamExe` always calls `setParamFloat(id, val * weight)` for BOTH declared
  modes. Its constructor first subtracts `def || 0` for declared add or divides by `def || 1` for declared mult.
  **Effective C2 calc is set**, not add/mult. Browser reproduction on 2026-09-07 confirmed `smile01` holds eye-form at
  1 and brow-form at 0.5 while the unfiltered `angry02` motion writes -1 beneath it. The eye-open exclusion option
  refers to DECLARED mult parameters; an active C2 expression can still overwrite motion blinking. C3 `.exp3.json`
  `Parameters[].{Id, Value, Blend}` where **`Blend` is numeric (1 / 2) in all imported costumes** — the engine's parser
  (`CubismExpressionMotion.parse`, dist ~8116) only recognises the strings `"Add" | "Multiply" | "Overwrite"` and falls
  back to Additive for anything else, so **every C3 expression parameter is applied as `add` at runtime** regardless of
  its declared `Blend` (`ParamEyeLOpen Value 1.1 Blend 2` is added, not overwritten). `face-params` must report the raw
  `Blend` but the "also ignore eye-open" toggle is C2-only in effect; record this against `AVATAR-PRESENTATION.md` §6.5.
  The face set to relinquish = the ids declared by the costume's expression files.
- **Expression Reset is temporary at the engine layer.** `resetExpression()` queues the default expression but
  retains `currentExpression`; a subsequent `setExpression()` for the same name returns false, even though it is no
  longer being applied. The lab must explicitly restore a repeated expression and cancel outstanding expression
  reservations on reset/supersession/disposal. A failed or pending Set is not a survival experiment.
- **C2 native loop is ignored.** Both legacy primary and parallel `_startMotion` implementations name the argument
  `_loop` and play once. The lab's loop checkbox requires owned replay scheduling with Stop all / disposal
  cancellation; C3 uses the native loop flag. A log of `loop=true` alone is not evidence of looping.
- **Cache mutation confirmed in dist for both generations**: C2 `_startMotion` (dist ~3759/~3931) reassigns
  `motion.motions = motion.motions.filter(...)`; C3 (dist ~9781/~9926) reassigns `motion._motionData.curves` and
  `curveCount`. `loadMotion` (dist ~1172) returns the cached object when truthy and treats `null` as "failed" — hence
  `invalidateMotion` sets the slot to `undefined`.
- Expression file URLs: the production loader applies `settings.replaceFiles(resolve)` after pruning, so
  `expressionManager.definitions[i].file | File` is **already absolute** on a loaded model — fetch it as-is.
- Teardown order (spec `live2d-renderer.md`): `stage.removeChild(model)` → `model.destroy({ children: true })` →
  only then `app.destroy(true)`; disposer idempotent.

## 4. Key interfaces

```ts
// scene/param-access.ts — detection: typeof coreModel.setParamFloat === "function" → "cubism2", else "cubism3"
export type Generation = "cubism2" | "cubism3";  export type WriteMode = "set" | "add" | "mult";
export interface ParamAccess { readonly generation: Generation; has(id: string): boolean; get(id: string): number;
  set(id: string, v: number, weight?: number): void; add(id: string, v: number, weight?: number): void;
  mult(id: string, v: number, weight?: number): void; listIds(): string[] | null /* C2: null */ }
export function createParamAccess(internal: { coreModel: unknown; idManager?: { getId(s: string): unknown } }): ParamAccess;

// scene/frame-hooks.ts
export type HookPosition = "beforeMotionUpdate" | "afterMotionUpdate" | "beforeModelUpdate";
export interface FrameContext { nowMs: number; dtMs: number; params: ParamAccess }
export type Overlay = (ctx: FrameContext) => void;
export interface FrameHooks { add(pos: HookPosition, fn: Overlay): () => void; clear(): void; dispose(): void }
type Emitter = { on(e: string, fn: () => void): unknown; off(e: string, fn: () => void): unknown };
export function createFrameHooks(emitter: Emitter, params: ParamAccess, now?: () => number): FrameHooks;

// scene/layered-motion.ts
export interface LayeredMotionRequest { group: string; index: number; priority: 0 | 1 | 2 | 3; loop?: boolean;
  channel: "primary" | number; ignoreParamIds: string[] }
export function ensureChannels(internal: { parallelMotionManager: unknown[]; extendParallelMotionManager(n: number): void }, n: number): void;
export function playLayered(internal: LayeredInternal, req: LayeredMotionRequest): Promise<boolean>;
export function invalidateMotion(manager: { motionGroups: Record<string, unknown[]> }, group: string, index: number): void; // slot = undefined

// scene/expression-relax.ts (pure)
export interface RelaxTimer { arm(nowMs: number): void; suppress(on: boolean): void; cancel(): void; tick(nowMs: number): boolean /* true once */ }
export function createRelaxTimer(delayMs?: number): RelaxTimer;   // default 4600

// scene/blink-overlay.ts (pure scheduler + factory)   interval 1700–3500 ms, closed 95–140 ms, RNG injected
// scene/sway-overlay.ts (pure)  phrase = |sin(t·π·0.24)|^1.8; nod = sin(t·π·0.82+0.25)·(1.15+e·2.35)·(0.38+phrase·0.62);
//   sway = sin(t·π·0.29+0.8)·(3.15+e·1.25) + sin(t·π·0.11+1.9)·0.84;  gains head 1.0 → AngleX/Y/Z, body 0.12 → BodyAngleX
// scene/lipsync-driver.ts
export interface EnergySource { energyAt(tMs: number): number; durationMs: number }
export function mouthFromEnergy(e: number, o?: { deadZone: number; gamma: number; max: number }): number;  // 0.08 / 0.78 / 0.48
export function fakeMouthAt(tMs: number): number; export function fakeDurationMs(visibleChars: number): number; // 5.2 Hz, 28 % closed; 55 ms/char clamped 900–4200
export function createLipsyncOverlay(src: EnergySource, clock: () => number, target: { ids: string[]; mode: "set" | "add" }): Overlay;

// speech/speech-provider.ts
export interface SpeechRequest { text: string; voice: string; model: string; speed: number; format: "wav" | "mp3" }
export interface SpeechClip { bytes: ArrayBuffer; mimeType: string; providerId: string; elapsedMs: number }
export interface UpstreamRequest { url: string; headers: Record<string, string>; body: string }
export type Transport = (req: UpstreamRequest, signal?: AbortSignal) => Promise<Response>;
export interface ProviderConfig { baseUrl: string; apiKey: string }
export interface SpeechProvider { readonly id: "fish-audio" | "openai-compatible"; synthesize(req: SpeechRequest, signal?: AbortSignal): Promise<SpeechClip> }
// fish (verified OpenAPI):  POST {base}/v1/tts; headers Authorization: Bearer, Content-Type: application/json, model: <s2.1-pro-free|s2.1-pro|s2-pro|s1>;
//   body { text, reference_id: voice, format, prosody: { speed }, latency: "normal" }; errors 401/402/503 JSON {status,message,reason} → thrown message
// openai-compatible (docs/TTS-INTERFACE.md): POST {base}/v1/audio/speech; body { model, input: text, voice, response_format: format, speed }
// transport "proxy": exact Fish /v1/tts and the configured local /v1/audio/speech target only; mismatches rejected
// transport "direct": fetches the validated HTTP(S) upstream URL, subject to that service's browser CORS policy

// speech/audio-envelope.ts (pure)
export interface Envelope { frameMs: number; values: Float32Array; durationMs: number; closuresInserted: number; peak: number; floor: number }
export interface EnvelopeOptions { frameMs: number; peakPercentile: number; floorPercentile: number; gamma: number; rise: number; fall: number;
  closure: { minHoldMs: number; maxHoldMs: number; zeroMs: number; minLocalPeak: number; openThreshold: number } }
// defaults 20 / 0.95 / 0.12 / 0.72 / 0.68 / 0.30 / { 120, 240, 60, 0.12, 0.10 }
export function computeEnvelope(pcm: { channels: Float32Array[]; sampleRate: number }, opts?: Partial<EnvelopeOptions>): Envelope;
export function envelopeValueAt(env: Envelope, tMs: number): number;   // linear interpolation, 0 outside

// scene/lab-scene.ts — panel ↔ scene wiring
export interface ModelContext { entry: CatalogEntry; model: Live2DModel; internal: InternalModel; params: ParamAccess; hooks: FrameHooks; facts: CostumeFacts }
export interface LabScene { readonly current: ModelContext | null; load(entry: CatalogEntry): Promise<ModelContext>;
  onModel(fn: (ctx: ModelContext) => void): () => void; onBeforeDispose(fn: (ctx: ModelContext) => void): () => void; dispose(): void }
```

Wiring rule: **panels never store a `Live2DModel`.** They hold desired state ("blink on, mult, afterMotionUpdate")
and re-attach onto `ctx.hooks` inside `onModel`. `load()` order: `onBeforeDispose` (panels stop audio, cancel
timers) → `hooks.dispose()` → `stage.removeChild(model)` → `model.destroy({ children: true })` →
`loadCharacterModel(app, toCostumeSource(entry, location.origin))` → `inspectCostume` → new `FrameHooks` →
`onModel`. A `loadSeq` counter discards stale loads (same idea as `costume-switch.ts`'s `isStale`).

## 5. Gotchas to handle explicitly

1. AudioContext needs a user gesture — native playback resumes inside click handlers; after `speak()` check
   `motionManager.currentContext?.state` and `resume()` if suspended; show the state in the readout.
2. `speak()` refuses while playing — poll `motionManager.currentAudio?.isPlaying` for button state; never queue.
3. Cache mutation — every filtered play logs "motion (g,i) now filtered — cache mutated"; `invalidateMotion` button +
   "reload costume"; affects parallel channels too.
4. Costume switch — `onBeforeDispose` cancels synthesis and stops native playback before `hooks.dispose()`; panels
   re-attach in `onModel`. Uncancellable native audio loading retains its old-manager cleanup and blocks replay
   until it settles. Do not call methods on the destroyed model. Teardown order per §3.
5. HMR/unload — `import.meta.hot?.dispose(...)` and `beforeunload` → `scene.dispose()` → `app.destroy(true)`;
   `create-stage` already guards Pixi plugin double-registration.
6. `afterMotionUpdate` accumulation — default blink/mouth to `set`; the sampler's base-value drift detector makes
   `add` accumulation visible.
7. "Stop all" leaves the queue finished on our assets (no `idle`/`Idle` group) — the engine's built-in blink then runs
   between motions, so a blink experiment must be judged WITH a motion playing to isolate our overlay from the engine's.
8. Timing — record request, `speak()` resolution, actual `isPlaying` with a running context, and first positive
   mouth contribution separately. These are browser observations, not physical audio-output measurements.
9. System B — `toCostumeSource` returns `null` for `..` refs → pruned; badge counts; those motions cannot be tested.
10. Proxy mode targets fixed hosts only; "direct" mode lets a CORS-enabled local server be typed in.
11. Key handling — memory only; no browser storage, logs, repository configuration or screenshots of credentials.

## 6. Testing posture

Pure modules are node-tested with fakes and **no engine value imports** (type-only imports are fine; if a value is
unavoidable, `vi.mock("untitled-pixi-live2d-engine", () => ({ MotionPriority: { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 } }))`
as the existing renderer tests do). Engine-facing glue (`lab-scene`, `costume-inspector`, `clip-player`, panels)
is exercised in the browser only — the spike precedent. Vitest's default include picks up `lab/**/*.test.ts`.

Phase 2 browser checks are automated by `lab/automation/browser-check.mjs`, using the locally installed Playwright
module and isolated contexts. Test-only response injection exposes the existing scene for observation; the regular
lab page exports no debug global. Evidence includes UI actions, frame-level before/after/final values, actual cache
curve counts, successful/failed Set outcomes, active-channel states, screenshots, and nonblank/moving pixel checks.
The single-parameter panel probe is explicitly narrower than whole-expression verification. Idle readings are
references, and failed/unapplied/settling/unavailable readings have no yes/no survival verdict. A positive gate does
not require a negative unfiltered baseline: C2 set writes and C3 additive expressions over zero-valued motion
curves can already survive. See `research/phase2-browser-findings-2026-09-07.md` for measured outcomes.
