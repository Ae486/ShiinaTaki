# Implementation phases — Avatar presentation lab

Each phase leaves a runnable page. Dispatch one `trellis-implement` per phase, then `trellis-check`.
Every phase: `pnpm --filter @taki/desktop typecheck && pnpm --filter @taki/desktop test && pnpm lint` green, and
`pnpm --filter @taki/desktop build && ls apps/desktop/dist` shows no `lab*` output.

## Phase 1 — runnable page

Files: `lab/lab.html`, `vite.config.ts` (input + plugin only; proxy comes in Phase 4), `tsconfig.json`,
`lab/index.md`, `lab/vite/lab-characters.ts` (+test), `lab/page/{main, controls, panel-model, panel-motion
(play/stop only), panel-expression (set/reset only), panel-params, panel-readout}.ts`, `lab/scene/{lab-scene,
character-catalog (+test), costume-inspector (no face set yet), param-access (+test), frame-hooks (+test),
param-sampler (+test)}.ts`.

Browser checks: picker lists 147 costumes across 8 characters; `taki/arbeit` (C2) and `taki/live_01` (C3) both load
and render; a system-B costume (`taki/casual`) loads with a "N refs pruned" badge; motions play by group/index/
priority/loop; expressions set/reset; hold `PARAM_ANGLE_X = 20` (C2) at `beforeModelUpdate` → final sample 20 while
the base sample follows the motion; `curl -i localhost:1420/lab-characters/..%2F..%2Fx` → 404.

Tests: `lab-characters` (env override; listing from a temp dir; traversal → 404; missing → 404),
`character-catalog` (listing → entries; settings URL; `toCostumeSource` resolves siblings, nulls `..`),
`param-access` (fake C2 core with `setParamFloat`; fake C3 core with `setParameterValueById` + `idManager`),
`frame-hooks` (fake emitter: add/dispose/clear, dt, dispose then add throws), `param-sampler` (three positions;
drift flag).

## Phase 2 — layering: the gating experiment

Files: `lab/scene/{face-params (+test), layered-motion (+test)}.ts`; extend `costume-inspector` (face set from
`expressionManager.definitions[i].file | File`, fetched as absolute URLs, parsed by `face-params`), `panel-motion`
(channel select primary / 1–3; ignore-face toggle; "also ignore eye-open" sub-toggle; invalidate-cache button),
`panel-expression` (sample one face param → "expression survives: yes / no").

Browser checks: run `lab/automation/browser-check.mjs` against both `taki/arbeit` and `taki/live_01`. Compare motion
alone, expression alone, both command orders without filtering, and filtered motion plus expression. Preserve raw
frame values and screenshots; do not require an unfiltered no followed by a filtered yes. The 2026-09-07 runtime
reproduction disproved that premise: legacy expressions effectively set values, so the C2 smile already wins over
the unfiltered angry motion. Cover filtered primary + parallel channels, shared cache leakage and invalidation,
declared-mult eye-open exclusion with/without an expression, actual looping beyond the motion duration, Stop all,
Reset/Set, repeated Set, selection-only changes, failed/pending requests, and costume replacement.

**A negative result stops here** and is recorded against `docs/AVATAR-PRESENTATION.md` §6.6.

Tests: `face-params` (both JSON shapes; `mult` flagged; `excludeMult` option; dedupe), `layered-motion`
(`invalidateMotion` sets the slot to `undefined`, never `null`; request → primary vs channel n routing via fakes;
`ensureChannels` idempotent).

## Phase 3 — overlays + relax

**Superseded by owner decision on 2026-09-08.** Do not implement this block now. Native blink/sway capability is
accepted as sufficient for proceeding; relax belongs to the later mood system and returns to mood presets.
The original experiment description below is retained as historical context, not an active implementation order.

Files: `lab/scene/{blink-overlay (+test), sway-overlay (+test), expression-relax (+test)}.ts`,
`lab/page/panel-overlays.ts`; extend `panel-expression` (relax delay / arm / suppress).

Browser checks: blink visible under a running motion, `set` vs `mult`, at each hook; sway `add` at
`afterMotionUpdate` (hair physics follows) vs `beforeModelUpdate` (no physics); sampler flags accumulation for `add`
at `afterMotionUpdate` on a param the motion does not write; relax fires 4.6 s after arm and is held while
suppressed; `breathDepth = 0` isolates custom sway from the engine's built-in drift.

Tests: `blink-overlay` (seeded RNG: intervals in 1.7–3.5 s, closures 95–140 ms; overlay writes 0 while closed),
`sway-overlay` (spot values at t=0 and energy 0/1; gain map ids), `expression-relax` (fires once; suppress holds;
cancel; re-arm resets).

## Phase 4 — speech + proxy + engine lip-sync

**Active next phase (owner authorized 2026-09-08).** Use existing `model.speak()`/`stopSpeaking()` without changing
the engine or writing mouth parameters. Provide Fish Audio and reserved OpenAI-compatible request adapters, a
fixed-target dev proxy, and a local audio-file/replay input to decouple provider access from native playback.
Keep API keys in the page's memory only. Stop, failed loads, cancellation, costume replacement and page disposal
must terminate owned audio and release object URLs; delayed completion must not play on a retired model.
Readouts distinguish computed engine contribution, actual final mouth values, and unavailable observations.
Before custom-envelope work, record the native path's real measured behavior. Automated local speech playback
does not count as successful Fish synthesis; provider live acceptance requires a configured service/credential.

Files: `lab/speech/{speech-provider, provider-request, fish-audio-provider, openai-compatible-provider, transport,
native-speech-playback, native-lipsync}.ts`, scene-bound speech controls/monitoring, `lab/page/panel-speech.ts`,
`lab/vite/lab-tts-proxy.ts`, and `vite.config.ts` (fixed endpoint proxies, serve-only public configuration).

Browser checks: Fish key + voice id + text → bytes → `URL.createObjectURL` → `model.speak(url, { onFinish: revoke })`
(fallback base64 data URI with the clip mime only if required); readout shows observed `mouthSync()`, computed
clamp/contribution and actual final mouth parameters separately. Disable synthesis/replay during pending input;
explicit file replacement cancels the prior input. Disable all source/play requests during native loading or active
playback. Record AudioContext state and browser-observed audio/mouth start
times; neither a `speak()` acknowledgement nor these timestamps establish physical speaker latency.

Tests: providers (URL, headers incl. `model`, body shape, error JSON → thrown message), `transport` (proxy path
mapping for fish vs other; direct passthrough).

### Mouth rig follow-up (owner requested 2026-09-08)

- [x] Restore the existing Lab session pointer and compatibility breadcrumb; record the differing readers.
- [x] Record owner-observed audible Fish playback and simple mouth opening without marking perceptual quality accepted.
- [x] Compare native, Ryza and BANDORI mouth processing, including actual parameter binding limits.
- [x] Probe declared ranges and render combined poses for C2 arbeit/C3 live_01; preserve readbacks and screenshots.
- [x] Record 59 pose cases and the C2 phantom-ID counterexample in `research/mouth-pose-capability-2026-09-08.md`.
- [x] Add the Lab-only `MouthTrack` / `MouthProfile` / `MouthWriter` contracts and node tests; keep the writer opt-in,
  `beforeModelUpdate`/`set`-only, profile-declared and native-compatible by default.
- [ ] Select an automatic mouth-driving approach after reviewing model capability and desired speech quality.

The design review is recorded in `research/realtime-mouth-design-2026-09-09.md`. The current recommendation is to
keep native amplitude as fallback/control, calibrate a costume-specific `MouthProfile`, compare a buffered Fish
envelope track first, then evaluate text/G2P and acoustic/alignment sources behind the same cue-clock-mapper-writer
contract. No provider-native cue from another audio stream may be reused for Fish.

Multilingual rule: locale-specific G2P/acoustic producers collapse into universal viseme classes before the
character/costume profile. Cues carry locale and confidence for code-switching; the renderer remains language-neutral.

Selection rule: start with a Taki-owned thin cue/clock/profile/writer adapter; benchmark `wawa-lipsync` as a Lab
source, use Fish envelope + Mandarin/Japanese G2P as the first candidate, and keep MFA/Azure/HeadAudio/wLipSync/
MotionSync as explicitly gated alternatives. Do not install or integrate a third-party dependency until the owner
approves the benchmark result and its license/model requirements.

This is a parameter/geometry investigation. A static pose result does not activate the historical Phase 5 plan.

## Phase 5 — envelope, A/B, fake mouth, composite

### 2026-09-11 panel integration (authorized subset)

- [ ] Connect Native/Envelope controls, automatic audio analysis, preparation readout and costume profile resolution.
- [ ] Add direct authored pose preview controls and expose them beside Speech without raw parameter setup.
- [ ] Use the playing audio source position; restore native lip-sync and detach custom writing on every terminal path.
- [ ] Cover cancellation, unsupported profile, preview transitions and audio suspension with focused tests.
- [ ] Verify normal panel actions on C2/C3 at desktop/mobile sizes with real retained Fish audio and screenshots.
- [ ] Record validation and limitations; keep task in progress for owner perceptual acceptance.

This subset supersedes the historical block below only for explicit panel playback and pose observation. It does
not activate fake speech, composite blink/sway/relax, recognition or production wiring.

**Not authorized by the 2026-09-08 stage decision.** This is a possible later comparison only if the native
experiment demonstrates a relevant gap. The historical implementation outline below is not a current work order.

Files: `lab/speech/audio-envelope.ts` (+test), `lab/scene/{lipsync-driver (+test), speaking-state (+test)}.ts`;
extend `panel-speech` (path selector engine / envelope / fake; composite toggle) and `panel-readout` (envelope stats).

Browser checks: same clip through engine vs envelope path — full closures visible only on the envelope path; fake
mouth on empty audio for the estimated duration; composite = sway reads energy + blink + relax suppressed, then relax
fires after `onEnded`.

Tests: `audio-envelope` (silence → zeros; constant tone → ≈1 then closures every 120–240 ms; percentile
normalisation; `envelopeValueAt` interpolation and out-of-range 0), `lipsync-driver` (dead zone, cap, fake closure
phase, duration clamp), `speaking-state` (start/stop; energy passthrough).

## Phase 6 — record findings

Update `docs/AVATAR-PRESENTATION.md` §6 with the engine corrections established during design and execution (hook
semantics; no matching automatic idle group in these costumes; lipsync floor `[0.1,1] × 0.4`; dB-normalised analyser;
cache mutation shared with parallel channels; `preserveExpressionOnMotion`; effective C2 expression set writes;
temporary engine Reset; ignored native C2 loop) and record the lab's observed answers against §7 items 7–11. This
is the only production-facing artefact of the task, and it is documentation.
