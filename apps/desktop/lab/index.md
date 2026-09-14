# lab/ — Avatar presentation lab (experimental, NOT in production path)

Dev-only control bench at `http://localhost:1420/lab/lab.html` (`pnpm --filter @taki/desktop dev`; plain browser, no
Tauri, no Agent Core). Registered in `vite.config.ts` only under `command === "serve"`, so `vite build` never emits it.
Delete this directory plus those config lines to remove the experiment (task `09-03-avatar-presentation-lab`).

- lab.html — page shell: Cubism runtime `<script>` tags, two-column layout (canvas left, controls right), module entry

## vite/ (node-side, imported only by vite.config.ts)
- lab-characters.ts — `devLabCharacters()` serve-only plugin: `/lab-characters/` JSON listing + traversal-guarded costume files from `~/.takiagent/workspace/characters` (or `TAKI_LAB_CHARACTERS_ROOT`)
- lab-tts-proxy.ts - serve-only fixed Fish/local endpoint proxies and public `/lab-tts/config`; `TAKI_LAB_TTS_LOCAL_TARGET` changes the local target, never stores a key

## page/ (browser: plain-DOM shell + panels)
- main.ts — boot: spike `createStage` -> `createLabScene` -> mount panels; HMR / unload dispose
- controls.ts — DOM builders (section/row/button/select/slider/checkbox/textInput/badge) + the `PanelDeps` contract
- panel-model.ts — character/costume picker with generation badge, Load, "N refs pruned" badge, facts summary
- panel-motion.ts — group/index/priority/loop, channel (primary | parallel 0-2), ignore-face-set (+ eye-open mult, C2-effective) toggles, Play / Stop all / Invalidate buttons, face-set note
- motion-actions.ts — motion panel behaviour: derive the ignore set, delegate lifecycle/looping to motion-playback, log cache mutation, stop all channels, invalidate selected motion
- panel-expression.ts — expression select, Set/Reset/Sample controls delegated to expression-actions; a single-parameter probe, not whole-face certification
- expression-actions.ts — bind applied-expression state to the scene, sampler and settle timer; cancel on reset/disposal and report idle references separately
- panel-params.ts — param id (+datalist), value slider, hook position, write mode, Hold overlay; feeds the sampler
- panel-readout.ts — 10 Hz `<pre>` (costume, motion + parallel channel state, lipSyncIds, face-set size, sampled before/after/final + drift), explicit n/a values, and findings log ring
- panel-speech.ts - local audio and provider synthesis controls, native Play/Stop/Resume, snapshot and disposer
- speech-actions.ts - scene-bound source cancellation, retained clip replay, native target attachment and monitor lifecycle
- speech-fields.ts - runtime provider/transport/request inputs; API key stays in the page's memory only
- speech-readout.ts - playback and computed/observed mouth values with explicit unavailable states and control guards

## scene/ (browser: engine-facing glue + pure behaviours)
- lab-scene.ts — owns app + current `ModelContext`; `load(entry)` with teardown order + stale-load ticket (also covers the expression-file fetch); `onModel` / `onBeforeDispose`; `dispose`
- character-catalog.ts — listing JSON -> `CatalogEntry[]`; `toCostumeSource` (nulls `..`/absolute refs); `countPrunedRefs`
- costume-inspector.ts — post-load facts: generation, motion groups, expressions, lipSyncIds, param ids, face params per expression + deduped face set (`fetchFaceParams` async companion)
- face-params.ts — pure: parse `.exp.json` / `.exp3.json` with effective C2 set/def normalization and C3 blend fallback; retain declared calc for eye-open exclusion
- expression-control.ts — serialized expression application/restoration, pending reservation cancellation, and successfully applied state independent of dropdown selection
- expression-probe.ts — select a usable face parameter and distinguish active-motion evidence, idle reference, settling, unapplied, and unavailable readings
- motion-playback.ts — per-channel lab-owned C2 replay loops, native C3 looping, replacement/Stop all/disposal cancellation
- layered-motion.ts — `ensureChannels` / `playLayered` (primary vs parallel[n] `startMotion` with `ignoreParamIds`) / `invalidateMotion` (slot -> undefined, never null)
- param-access.ts — duck-typed Cubism 2 / Cubism 3 parameter adapter: has/get/set/add/mult/listIds
- frame-hooks.ts — overlay registry over `beforeMotionUpdate` / `afterMotionUpdate` / `beforeModelUpdate`; dt clock
- param-sampler.ts — samples tracked ids at the three hooks; base-value drift latch (accumulating `add` detector)
- mouth-track.ts — validated clip-relative universal viseme cues and deterministic sampling
- mouth-language.ts — locale-aware Mandarin Pinyin / Japanese mora adapters with unknown-cue diagnostics
- mouth-envelope.ts — buffered PCM envelope, pause closure and attack/release shaping
- mouth-profile.ts — measured C2/C3 costume mappings and declared-range clamping
- mouth-writer.ts — opt-in `beforeModelUpdate` set-only writer; skips undeclared IDs and exposes fallback state
- native-speech-monitor.ts - read-only native analyser/final mouth observations, computed contribution and browser observation timing

## speech/ (browser: whole-utterance input and native engine playback)
- speech-provider.ts - request, clip, provider and injectable transport contracts
- provider-request.ts - validated endpoints and buffered audio responses with sanitized structured errors
- fish-audio-provider.ts - Fish `/v1/tts`, model header, reference voice and prosody speed
- openai-compatible-provider.ts - reserved `/v1/audio/speech` request adapter; does not run a synthesis model
- transport.ts - direct fetch or exact configured proxy mapping with AbortSignal propagation
- native-clip-source.ts - in-memory retained bytes, file input, synthesis cancellation and stale-response rejection
- native-speech-playback.ts - native speak/stop/resume, per-play object URLs and retired uncancellable-load cleanup
- native-lipsync.ts - pure calculation of the installed engine's gain, power, positive floor, cap and weight

## automation/ (local browser acceptance, never imported by the lab page)
- browser-check.mjs — isolated real-browser scenario runner with frame, cache, application-state and pixel assertions; incremental JSON results
- browser-driver.mjs — visible UI actions, test-response-only scene observation, frame samples and screenshots
- browser-scenarios.mjs — composition, shared cache, three parallel channels, looping, eye-open, Reset/Set, cancellation and unavailable-parameter cases
- browser-images.mjs — real PNG foreground/movement checks and screenshot comparison assembly
- production-command-check.mjs — unchanged Core tool and production renderer entry diagnostics; record actual engine results, native policy and interaction differences
- create-speech-fixture.ps1 - creates a real local Windows system-voice WAV with pauses under ignored output
- speech-check.mjs - native audio, replay, resume, switching and failed/cancelled input browser scenarios
- speech-observations.mjs - per-frame audio/final mouth samples and screenshot/layout evidence; never writes parameters
- fish-mouth-check.mjs - real Fish request plus native/custom C2/C3 mouth evidence; reads credentials only from process environment

See `automation/README.md` for the installed Playwright prerequisite and command. Evidence stays under the ignored
`.trellis/.runtime/` tree; model images are never committed or included in a production build.
