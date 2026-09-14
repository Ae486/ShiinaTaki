# PRD — Avatar presentation lab (dev-only experiment page)

## Status: EXPERIMENT, NOT A PRODUCT FEATURE

**Owner ruling (2026-09-03): this task ships an isolated test surface only.** None of its code enters the product
path. Whether any technique it validates gets adopted is a separate decision, taken after the lab has been used.

**Owner clarification (2026-09-08): adapt AgentAtelierR / Ryza's presentation strengths to Taki's existing engine,
assets, and production code. This task validates which techniques transfer; it does not build a new animation
engine or replace existing capabilities.** Start from the real production entry points and engine defaults, reuse
working behavior, then isolate only an observed gap. Filtering, extra channels, custom overlays, replay helpers,
and custom lip-sync remain experiments until a measured need justifies them. Do not make an experimental helper a
production requirement merely because it exists. Keep direct-engine findings distinct from production scheduling,
interaction, tool validation, and command-delivery behavior. Automate functional checks and screenshots first;
request human testing only for an observation that the available automation cannot establish.

**Owner stage decision (2026-09-08): skip additional blink/sway implementation; existing engine capability is
accepted for this lab's next step. Expression relax is a future mood-system feature, not an engine experiment:
after a transient expression ends, return to the mood preset's presentation configuration. No fixed 4.6-second
neutral-reset policy is introduced here. Proceed to Phase 4, real speech and native engine lip-sync.** The choice
between tagged model output and avatar tools, including application acknowledgements and paired command timing,
remains deferred until the invocation contract is chosen. Custom lip-sync remains a later measured comparison.

**Owner feedback and follow-up (2026-09-08):** the owner reports that the Fish test produces audible speech and a
moving mouth, but the result looks like simple opening. This confirms the owner's basic playback observation,
not perceptual lip-sync or phoneme-shape acceptance. Investigate how far the actual mouth parameters can be
controlled and whether representative speech mouth poses can be displayed. Compare the reference techniques
against real rendered parameter combinations, with special attention to costume-specific parameter names,
ranges and visible deformation. Keep this investigation in this existing Lab task and retain the evidence.
This follow-up does not authorize a production driver, an audio phoneme recognizer or an automatic custom-mouth path.

**Multilingual design clarification (2026-09-09):** the renderer boundary must use a small universal viseme class
set, while cue production and timing remain locale/model-aware. Shared articulatory families make broad classes
portable, but phoneme inventories, allophony, prosody, G2P and acoustic classifier accuracy differ by language.
Code-switched segments must carry locale/model context; unknown or low-confidence cues degrade to conservative
envelope-driven opening. This is a design requirement for the next Lab comparison, not authorization to install a
language model or implement production mouth automation now.

**Selection clarification (2026-09-09):** no existing project is accepted as a final drop-in. Use a Taki-owned thin
cue/clock/profile/writer adapter, benchmark `wawa-lipsync` first, and initially combine Fish PCM envelope with
locale-specific Mandarin/Japanese G2P. Evaluate MFA only as an optional buffered alignment service; consider Azure
timed visemes only with a provider change. HeadAudio, wLipSync and MotionSync remain secondary compatibility studies.

Consequences, binding on implementation:

**Owner authorization (2026-09-11): connect the existing custom mouth experiment to the ordinary Lab panel so its
effects can be observed without automation or raw parameter IDs.** Provide native/envelope playback comparison on
the same retained clip and direct multi-parameter pose previews on the measured costumes. Synthesis/file loading
prepares the envelope; playback follows the real audio position. Envelope processing supplies opening/closure,
not phoneme recognition. Pose previews are explicitly authored candidates, separate from audio-derived visemes.
The scope remains inside the Lab; no provider change, new dependency or production adoption is authorized here.

- **All lab code lives in one directory: `apps/desktop/lab/`.** Nothing is added under `apps/desktop/src/windows/`
  or `apps/desktop/src/renderer/`, and the production directory indexes (`src/windows/index.md`,
  `src/renderer/index.md`) are NOT touched. A reader scanning `src/` must not encounter lab files at all.
- **Deleting the experiment = deleting `apps/desktop/lab/` plus reverting a handful of lines in
  `apps/desktop/vite.config.ts` and one entry in `apps/desktop/tsconfig.json`.** No other file may need editing.
- **Existing code is imported, never modified.** The lab reuses `src/renderer/spike/create-stage.ts`,
  `src/renderer/live2d/load-character-model.ts` and `src/renderer/live2d/settings-prune.ts` as-is. If something
  there needs changing to be reusable, copy it into `lab/` instead — do not refactor production code for the lab.
- Every lab source file's header `POS:` line must say **"experimental / lab — not in production path"** (the
  convention `src/windows/spike/main.ts` already uses).
- Dev-only at the build level: the page, its dev middleware and its proxy are registered only under
  `command === "serve"`, so `vite build` never emits them (mirrors the spike ruling D18-A).

## Why

`docs/AVATAR-PRESENTATION.md` §5–§6 records presentation techniques studied from the AgentAtelierR reference and a
feasibility analysis against our engine (`untitled-pixi-live2d-engine` 1.3.1) and our 147 imported costumes.
**Every conclusion in §6 is derived from typings and dist source only — nothing has been observed running.** §6.6
names a gating experiment that has never been run: a body motion must be able to relinquish the face parameters
(`ignoreParamIds`) so an expression survives it. Our Cubism 2 motions write all 64 parameters and Cubism 3 motions
carry ~105 curves, so without that mechanism every layered-presentation idea in §5 collapses.

Runtime correction (2026-09-07): the paragraph above records the original motivating hypothesis. Automated Phase 2
browser reproduction found that C2 expressions effectively set their values after motion update, and that the
selected C3 expression adds onto zero-valued motion curves. Both can already survive unfiltered playback. The
experiment must measure actual relinquishment and composition; an unfiltered no is not an acceptance prerequisite.
See `research/phase2-browser-findings-2026-09-07.md` for the observations and corrected gate interpretation.

Reading source can establish what an API *claims*. It cannot answer how the character *looks*, whether the engine's
own lip-sync is good enough, or how a hook position interacts with physics. Those need hands on controls.

## Goal

A page at `http://localhost:1420/lab/lab.html` (via `pnpm --filter @taki/desktop dev`, plain browser, no Tauri, no
Agent Core, no WS) that loads any imported costume and exposes manual controls to answer
`docs/AVATAR-PRESENTATION.md` §7 items 7–11 by direct observation.

## Scope

In:

1. **Model surface** — pick any of the 147 costumes from `~/.takiagent/workspace/characters/` (both Cubism
   generations); badge generation and pruned external refs; live parameter readout.
2. **Gating experiment (§6.6)** — play motions on the primary channel or a parallel channel, with/without the
   costume's face parameter set passed as `ignoreParamIds`, and observe whether a set expression survives.
3. **Per-frame overlays** — blink, head/body sway, generic parameter hold; each selectable across the three hook
   positions (`beforeMotionUpdate` / `afterMotionUpdate` / `beforeModelUpdate`) and write modes (set/add/mult).
4. **Expression relax timer** — the §5.2 behaviour Taki lacks entirely today.
5. **Speech, for real** — Fish Audio TTS with a runtime key input, behind a provider seam that also implements the
   reserved OpenAI-compatible local-TTS contract (`docs/TTS-INTERFACE.md`) for later self-hosting.
6. **Two lip-sync paths, comparable A/B** — the engine's native `speak()`/`mouthSync()`, and a custom amplitude
   envelope with forced closures (§5.5), plus the no-audio fake mouth.
7. **Composite speaking state** — blink + sway + lip-sync + relax running together (§5.4).

Out:

- Vocabulary root grouping / semantic mapping (`docs/AVATAR-PRESENTATION.md` §4) — owner deferred it pending the
  quality of the rest.
- Any change to product avatar behaviour, tools, prompts, or the Core protocol.
- Packaging, Tauri integration, CI wiring.

## Acceptance criteria

1. `pnpm --filter @taki/desktop dev` → the page lists all 147 costumes and loads both a Cubism 2 (`taki/arbeit`) and
   a Cubism 3 (`taki/live_01`) costume; system-B costumes load with a "N refs pruned" badge.
2. The §6.6 gating experiment produces a definitive yes/no, visible on screen and recorded in the findings log:
   with the face set ignored, does a set expression survive a body motion?
3. Blink and sway are visibly driven by our own code while a motion is playing, at a selectable hook position, and
   the readout shows whether an `add` write accumulates across frames.
4. A Fish Audio clip plays with the character's mouth moving; the readout shows raw `mouthSync()`, the engine's
   post-clamp value and the final mouth parameter side by side (the documented `[0.1, 1] × 0.4` floor).
5. The same clip can be replayed through the custom envelope path, and the difference in mouth closures is
   observable.
6. `pnpm --filter @taki/desktop build` then `ls apps/desktop/dist` shows no `lab*` output.
7. `pnpm --filter @taki/desktop test`, `typecheck`, and `pnpm lint` are green; the pure logic modules
   (envelope, blink scheduler, sway math, relax timer, face-param derivation, param adapter, catalog, providers) have
   colocated unit tests that run in the default node environment with no engine value imports.
8. Deleting `apps/desktop/lab/` plus reverting the `vite.config.ts` / `tsconfig.json` lines leaves the tree
   exactly as before, with `pnpm lint`, `typecheck` and `test` still green.

## Non-goals / risks

- **A negative gating result is a valid outcome**, not a failure of this task. It would invalidate the §5.11 cost
  estimates and force the mutually exclusive expression-and-motion fallback named in §6.6 — recording that is worth
  as much as a positive result.
- Fish Audio browser CORS is unverified; the plan routes through a Vite dev proxy with fixed targets. If Fish
  changes shape, only `lab/speech/fish-audio-provider.ts` is affected.
- The shared motion library `_mtn_emp` referenced by 16 costumes is absent from the workspace; those costumes' motions
  cannot be exercised here. Documented, not worked around.

## References

- `docs/AVATAR-PRESENTATION.md` — §1 measured vocabulary reality, §5 presentation lessons, §6 engine/asset
  feasibility (the hypotheses this lab tests), §7 open questions 7–11 (what it must answer).
- `.trellis/spec/frontend/live2d-renderer.md` — locked renderer stack, load order, **teardown order**, the
  generation-split parameter API, BanG Dream model facts.
- `apps/desktop/src/windows/spike/` + `src/renderer/spike/` — the dev-only standalone-page precedent to copy.
- `docs/TTS-INTERFACE.md` — the reserved local-TTS wire contract the second provider implements.
