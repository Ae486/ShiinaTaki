# Research: Reference mouth control and parameter mapping

- Query: How far can mouth parameters pose speech shapes, and does BANDORI's viseme implementation prove that the current costumes support those shapes?
- Scope: mixed; local reference source is authoritative for the inspected application layer. A brief public-upstream check is not evidence of the missing local renderer version.
- Date: 2026-09-08
- Task: `.trellis/tasks/09-03-avatar-presentation-lab`, verified from `.trellis/.current-task`.
- Boundary: research only. No reference application, production renderer, speech provider, or model asset was modified or executed by this research subtask.

## Findings

### Conclusion and evidence levels

Mouth opening and mouth shape are independent controls when a costume's rig exposes both. BANDORI has a real application path that generates and forwards two values, opening and form. It does not prove that every addressed parameter exists in every costume or that its named presets render distinguishable phoneme shapes.

Three different claims must remain separate:

1. **Generated control values:** BANDORI defines seven opening/form pairs and chooses among them using text heuristics.
2. **Parameter application:** Python forwards the requested IDs into the renderer; the local Lua renderer dependency is missing, so this checkout cannot establish its final alias resolution or unknown-ID behavior.
3. **Actual model deformation:** use the Lab's declared-parameter enumeration and image comparison. A successful setter/getter round trip is insufficient because an unknown parameter may exist only as an auxiliary value.

The companion experiment is [mouth-pose-capability-2026-09-08.md](mouth-pose-capability-2026-09-08.md), with the reproducible probe in [mouth-pose-probe.mjs](mouth-pose-probe.mjs). During the same session, the parent probe reported:

- C2 `taki/arbeit` declares `PARAM_MOUTH_FORM_01`, `PARAM_MOUTH_OPEN_Y`, `PARAM_MOUTH_FORM_Y`, and `PARAM_MOUTH_SCALE`; it does not declare `PARAM_MOUTH_FORM`. Writing the latter did not change the mouth compared with the opening-only image.
- C3 `taki/live_01` declares `ParamMouthForm` and additional mouth controls. A form/opening sweep produced both a small round opening and a wide smile/teeth appearance.
- These are observations of the tested Taki costumes in the installed engine. They do not certify the missing BANDORI Lua runtime or complete phoneme coverage. The companion report owns exact values, screenshots, pixel evidence, and subsequent calibration.

### BANDORI: preset values are a heuristic pose vocabulary

`references/BANDORI-PET-REV-main/tts_manager.py:212` defines the following pairs. The labels are the reference's labels, not visually certified outputs on our rigs.

| Label | Base opening | Base form | Intended approximation in the reference |
| --- | ---: | ---: | --- |
| `aa` | 0.55 | 0.00 | Open vowel |
| `ow` | 0.34 | -0.72 | Rounded vowel |
| `iy` | 0.28 | 0.82 | Spread vowel |
| `uw` | 0.22 | -1.00 | Small rounded vowel |
| `mbp` | 0.00 | 0.00 | Closed lips |
| `fv` | 0.18 | 0.32 | Small opening with positive form |
| `neutral` | 0.24 | 0.00 | Generic fallback |

This is a two-dimensional parameter space, not seven independent rigged mouth meshes. The preset called `fv` does not itself establish a lip/teeth-contact control; `ow` and `uw` depend on what negative form actually deforms on the chosen costume. C2 `PARAM_MOUTH_FORM_01` also has a different measured range from these generic form targets, so copying the numbers would require calibration and clamping.

Text selection is deterministic and approximate:

- Latin words use character and substring rules, such as `m/b/p`, `f/v`, `oo/uu/ew`, and `ow/oh/oa/ou/aw/au` (`tts_manager.py:246`). There is no pronunciation dictionary or acoustic phoneme recognizer in this path.
- Kana are assigned using fixed character groups (`tts_manager.py:285`). This is a character heuristic, not a phoneme aligner.
- For Han characters, `language` equal to `chinese`, `zh`, or the literal Chinese-language label selects **`aa` for every character**. With other language labels, the same characters select `neutral` (`tts_manager.py:223`, especially lines 236-238). There is no pinyin conversion in this branch.
- Punctuation becomes `mbp`; other unmatched characters use `neutral` (`tts_manager.py:239`). A closure generated this way is not evidence of a spoken bilabial consonant.

### BANDORI: estimated timing and amplitude interaction

The source prepares a pending sequence from text (`tts_manager.py:623`), decodes each audio chunk (`tts_manager.py:628`), and assigns some pending units to that chunk (`tts_manager.py:653`):

- Unit rate is 10/s for English, 8/s for Japanese, and 7/s otherwise (`tts_manager.py:305`).
- Requested unit count is `max(1, round(chunk_duration * unit_rate))`.
- It consumes at most that many pending units; when none remain, it uses one `neutral` unit.
- Allocated units receive approximately equal spans of sample frames. The final unit absorbs the remainder.
- The callback chooses a pose using the midpoint of the currently consumed sample range (`tts_manager.py:734`).

This tracks audio consumption, but the boundaries are estimated from chunk duration and a fixed rate. They are not timestamps from Fish, forced alignment, or phoneme recognition. Changing audio chunk boundaries or speaking rate can change the heuristic assignment. A single long chunk can also consume fewer text units than the real utterance contains.

The audio callback uses the consumed PCM segment to compute RMS and peak. Its activity accumulator is:

`level = max(previous_level, min(max(4 * RMS, 0.35 * peak), 0.55))`

See `tts_manager.py:701`, particularly lines 718-724. A 33 ms timer (`tts_manager.py:595`) emits a pose and decays the stored level by 0.55 (`tts_manager.py:746`). For the current emission:

- When the base opening is below 0.05, opening is at most `min(0.2 * level, 0.04)` and form is zero. Even `mbp` can therefore carry a small nonzero opening.
- Otherwise, activity is `min(1, level / 0.18)` above a 0.01 level threshold, and zero below it.
- Opening is `min(0.55, max(0.9 * level, base_opening * activity))`.
- Form follows `base_form * max(0.25, activity)` when activity is positive, otherwise zero.
- Completion emits `(0, 0)` once audio is exhausted and the decaying level falls below 0.01.

These formulas can reduce separation among nominal opening presets under loud audio because the `0.9 * level` term is shared. They also explain why named visemes must be inspected after the full pipeline, not only in the preset table.

### BANDORI: the application path really forwards both values

The two-value producer is connected to a visible application path:

| Local source | Role |
| --- | --- |
| `tts_manager.py:772` | Emits opening and clamped form through `mouth_pose_changed` |
| `tts_common.py:40` | Publishes both values for the speaking character |
| `action_bus.py:39` | Serializes the `LIP` message, including optional form |
| `pet_window.py:3181` | Parses opening/form and calls the Live2D widget |
| `live2d_widget.py:313` | Clamps opening to the configured maximum and form to `[-1, 1]` |
| `live2d_widget.py:879` | Smooths the target and requests model parameter writes |
| `live2d_widget.py:835` | Calls the lip-sync step immediately before model `Draw()` |

All paths in the table are under `references/BANDORI-PET-REV-main/`.

The widget treats targets as stale after 180 ms. Its per-render smoothing factors are 0.55 for opening and 0.45 for form, with values smaller than 0.01 snapped to zero. It then writes the literal IDs `PARAM_MOUTH_OPEN_Y` and **`PARAM_MOUTH_FORM`**, both with weight 1 (`live2d_widget.py:889`). The configured opening maximum itself can be set from 0 to 1 (`live2d_widget.py:324`), independently of the producer's 0.55 cap.

### BANDORI: where the local alias trace stops

`references/BANDORI-PET-REV-main/live2d_lua_adapter.py` does not normalize these mouth IDs in the inspected Python path:

- `LuaLAppModel.SetParameterValue` stores the exact string ID and numeric value/weight in `_pending_parameters` (line 753).
- `Draw()` copies the same ID into each Lua `opts.parameters` entry and invokes the renderer (line 727, especially 734-743).
- Renderer choice is generation-dependent: the C2 embed versus the moc3 embed (line 616).
- The runtime loads `live2d_embed` and `live2d_moc3_pet_embed` from `third_party/Live2D-v2-Lua` (lines 17 and 519-520). That directory is absent from the local reference checkout, including hidden/ignored-file inspection.
- The local README explicitly asks the operator to clone that dependency separately (`README.md:108`). It does not pin the clone to a revision in that instruction.

Therefore:

- No local Python alias from `PARAM_MOUTH_FORM` to `PARAM_MOUTH_FORM_01` was found.
- Whether the omitted C2/C3 Lua implementations add aliases, reject unknown IDs, or retain auxiliary values cannot be established from this checkout.
- In the tested **Taki C2** rig, blindly applying BANDORI's literal `PARAM_MOUTH_FORM` is already shown to be ineffective. The supported C2 form ID is `PARAM_MOUTH_FORM_01`; its meaning and range must be calibrated on that rig.
- In the tested **Taki C3** rig, the supported ID is `ParamMouthForm`. A string written successfully somewhere in the reference bridge is not proof that this exact model parameter was addressed.

The earlier conversational statement that BANDORI's final parameter writes demonstrated rendered mouth-form support was too broad. They demonstrate application-layer intent and delivery into a renderer API. Actual support requires the complete runtime and a model observation.

### Ryza: energy-driven animation scrubbing, without phoneme classification

`references/AgentAtelierR-main/lib/src/audio_envelope.dart` extracts a WAV amplitude envelope:

- Default frame duration is 20 ms (line 26); each frame is RMS over samples and channels (line 97).
- The 95th percentile supplies a peak reference; the 12th percentile supplies a noise reference. Energy is clamped to `[0, 1]` after subtracting noise and dividing by `max(peak - noise, 0.000001)`, then raised to power 0.72 (lines 102-110).
- Smoothing uses factor 0.68 on increasing energy and 0.30 on decreasing energy (line 118).
- A post-pass searches for a low-energy point roughly 120-240 ms after the prior closure and writes about 60 ms of zeros (lines 130-169). This imposes a speaking rhythm; it does not identify `m/b/p` in the audio.
- `valueAt()` linearly interpolates the envelope at an audio playback position (line 13).

`references/AgentAtelierR-main/lib/src/chat_screen.dart:483` converts energy to a normalized animation position:

- Below energy 0.08, the mouth position is zero.
- Otherwise it is `clamp(((energy - 0.08) / 0.92)^0.78 * 0.48, 0, 0.48)`.
- Track time becomes animation duration multiplied by that value.

Speaking selects the current expression's lip-sync animation on facial track 13, with animation time scale zero so that the playback-position callback scrubs it directly (`chat_screen.dart:337`). Outside speaking, the same track uses the expression's static mouth animation (`chat_screen.dart:351`). Without a usable envelope, it uses a periodic fallback with explicit closure intervals (`chat_screen.dart:438`).

`references/AgentAtelierR-main/lib/src/character_expression.dart:306` supplies different seated expression resources, including `facial_mouth_002_scrub_01`, `facial_mouth_013_scrub_01`, and `facial_mouth_017_scrub_01`. Standing presets mostly share `facial_mouth_002_scrub_02` (line 367). These are emotion/appearance resource choices, not audio-derived vowel selection.

Ryza therefore provides a useful example of authored mouth animation plus improved opening rhythm. It does not establish phoneme-accurate `a/i/u`, nor does it establish what a separate Live2D costume can deform into.

## Files Found

| Path | Description |
| --- | --- |
| `references/BANDORI-PET-REV-main/tts_manager.py` | Text-to-preset heuristics, estimated timing, audio activity, and pose emission |
| `references/BANDORI-PET-REV-main/tts_common.py` | TTS signal-to-IPC forwarding |
| `references/BANDORI-PET-REV-main/action_bus.py` | Lip-sync wire message |
| `references/BANDORI-PET-REV-main/pet_window.py` | Pet-side message reception |
| `references/BANDORI-PET-REV-main/live2d_widget.py` | Final target limits, smoothing, and literal parameter requests |
| `references/BANDORI-PET-REV-main/live2d_lua_adapter.py` | Raw-ID forwarding and generation-specific renderer selection |
| `references/BANDORI-PET-REV-main/README.md` | Instructions for the separately obtained Lua renderer dependency |
| `references/AgentAtelierR-main/lib/src/audio_envelope.dart` | WAV RMS envelope, normalization, smoothing, and closures |
| `references/AgentAtelierR-main/lib/src/chat_screen.dart` | Envelope-to-Spine-track playback and fallback rhythm |
| `references/AgentAtelierR-main/lib/src/character_expression.dart` | Emotion-specific mouth animation resource selection |

## External References and Versions

- Local renderer contract: `untitled-pixi-live2d-engine@1.3.1`, PixiJS 8.19.0; this is Taki's renderer, not BANDORI's Lua renderer.
- BANDORI's documented renderer dependency: <https://github.com/EasyLive2D/Live2D-v2-Lua>, as linked from the local `README.md:108`. The required directory is missing and the README clone instruction is unpinned.
- A brief read-only lookup of public upstream `main` occurred after discovering the missing dependency. GitHub's page reported head `c46c254c14cffda57bb4eefe0fdca4ae3cc73206`; the raw files were obtained through `main`, not a checkout locked to that head. These observations are deliberately excluded from local runtime conclusions. The API endpoint was rate-limited; no repository clone, dependency installation, or local runtime recovery was performed.
- No external phoneme-recognition library, speech-alignment service, or Fish API was exercised by this research.

## Related Specs and Task Evidence

- `.trellis/workflow.md`: preserve research under the current task and keep planning/implementation boundaries explicit.
- `.trellis/spec/frontend/index.md`: engineering documentation uses English.
- `.trellis/spec/frontend/live2d-renderer.md`: study the BANDORI reference first, retain the locked renderer stack, respect C2/C3 raw parameter API differences, and use clean-room adaptation for GPL reference material.
- `.trellis/tasks/09-03-avatar-presentation-lab/prd.md`: isolated Lab work; production adoption remains a separate decision; actual visual observations are required to establish a model capability.
- [phase4-native-speech-findings-2026-09-08.md](phase4-native-speech-findings-2026-09-08.md): prior native amplitude-driven playback evidence; gain tuning does not add phoneme classification.
- [mouth-pose-capability-2026-09-08.md](mouth-pose-capability-2026-09-08.md): actual costume parameter and image evidence from the companion experiment.

## Caveats / Not Found

- The local BANDORI application was not runnable as a complete renderer reference because its required Lua dependency is absent. No claim of its final C2/C3 deformation or alias behavior follows from this source review.
- Neither text heuristic labels nor parameter names certify viseme quality. The actual target costume must be inspected while controlling declared parameters and excluding later competing writes.
- The reviewed paths do not supply Chinese phoneme recognition, pinyin conversion for Han-character input, forced alignment, or measured phoneme boundaries. BANDORI's Chinese fallback remains one generic vowel shape per character.
- The companion Lab images may establish a few usable visual mouth classes. They cannot by themselves establish synchronization with Fish audio or exhaustive coverage of all major phonemes.
- No implementation or production adoption decision is made here. Findings are persisted so a later driver design can use measured costume capabilities rather than assume them from reference preset labels.
