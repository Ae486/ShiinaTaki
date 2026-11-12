# Real-time mouth playback design

## Scope and conclusion

This is a design record for the existing `avatar-presentation-lab` task. It does not authorize a production
mouth driver, an engine replacement, a new dependency, a provider switch, or an automatic phoneme recognizer.

The current system has two facts that must remain separate:

1. The pinned `untitled-pixi-live2d-engine@1.3.1` has a working native lip-sync path. It reads WebAudio analyser
   energy, transforms that value and adds it to the model's lip-sync parameter(s). It does not identify phonemes
   or select `MouthForm` values.
2. The tested Taki rigs have more expressive geometry. `taki/live_01` can visibly pose closed, A/E/I/O/U-like
   candidates using `ParamMouthOpenY`, `ParamMouthForm` and related controls. `taki/arbeit` can pose closure,
   opening and spread/shape variants, but its supported C2 IDs and useful O/U range differ.

Therefore the implementable target is a **cue-driven mouth track** whose cue source can change without changing
the renderer mapping. A cue is not a raw parameter write and a raw parameter write is not proof of a visible pose.
Every mapping must be validated against the active `characterId + costumeId` rig.

## Multilingual compatibility

The design can support multiple languages, but the portable unit is a **viseme class**, not a language-independent
phoneme ID. A phoneme describes a language's contrastive sound system; a viseme groups sounds that look similar on
the lips. The mapping is many-to-one (`p`, `b`, `m` commonly share a closed-lip pose), and one phoneme can have
different visible realizations because of neighboring sounds, stress, speaking rate and speaker anatomy.

Languages share broad articulatory families, which is why a small mouth vocabulary transfers well:

- bilabial closure (`p/b/m` and analogous sounds) -> closed;
- labiodental (`f/v`) -> small opening or lip-teeth approximation;
- spread/front-vowel family (`i/e` variants) -> narrow or spread;
- open-vowel family (`a` variants) -> open/wide;
- rounded/back-vowel family (`o/u` variants) -> rounded/narrow-rounded;
- silence, pauses and closures -> rest/closed.

The inventory is not interchangeable across languages. English has interdental and rhotic realizations that Mandarin
does not use in the same way; Mandarin has tone and retroflex/palatal contrasts; French and German have additional
rounded-front vowels; Japanese has mora timing and a different consonant distribution. Tone, stress and pitch are
mostly not new mouth shapes, but they change duration, intensity and coarticulation. A single “characters per
second” schedule is consequently not a multilingual timing model.

Use this layering for locale support:

```text
locale / mixed-language segment
          |
          +--> language G2P or language/model acoustic cues
          |       (phonemes, confidence, audio-relative time)
          v
  universal viseme mapper (many phonemes -> a small visual class set)
          |
  character + costume MouthProfile (class -> actual parameter values)
          |
  one Live2D MouthWriter
```

The renderer and `MouthProfile` remain language-neutral. The cue producer is locale-aware. For a code-switched
utterance, each cue segment carries its locale or recognizer model; do not run a Mandarin character heuristic over
English text or map raw Unicode characters directly to mouth shapes. If locale/G2P confidence is low, emit
`unknown` and let the audio envelope control a conservative open/closed fallback.

For the current Fish path, the practical options are:

1. **Text/G2P route:** Fish receives the text but returns no public phoneme/viseme timeline. Use a language-specific
   G2P front-end (Mandarin Pinyin/phoneme, English phonemes, etc.), map to universal classes, and align the sequence
   to the exact returned audio with an envelope or an alignment step. This is cheap and multilingual at the
   architecture level, but approximate unless the audio is forced-aligned.
2. **Audio route:** run an acoustic classifier on the actual Fish audio. Its interface is language-neutral, but its
   model is not automatically multilingual. wawa/HeadAudio/wLipSync models must be evaluated or retrained for the
   target languages and voices; the inspected HeadAudio model is primarily English.
3. **Provider cue route:** use a provider that emits cues for the same audio it synthesizes, such as Azure's
   documented viseme events for supported `zh-CN` voices. This is timing-strong but requires that provider's audio;
   its cue IDs still need mapping into Taki's smaller costume-specific class set.
4. **Offline alignment route:** use a matching locale acoustic model and dictionary (for example, Mandarin MFA
   assets) against the exact Fish clip. This gives better phone timing at higher setup/latency cost and is naturally
   a batch/preplay stage rather than an incremental stream.

The first portable profile should therefore expose no language names at the Live2D boundary. It should expose a
small class set such as `rest`, `closed`, `open`, `spread`, `rounded`, `narrow-rounded`, `fricative` and `unknown`.
The locale adapter may use a richer internal phoneme inventory and collapse it into those classes. C2 `arbeit` can
advertise a reduced subset when its rig cannot visually separate rounded forms; C3 `live_01` can advertise the
larger set measured in `mouth-pose-capability-2026-09-08.md`.

This arrangement gives graceful multilingual degradation: a new language needs a cue producer/mapper and test
fixtures, not a new renderer or a new set of Live2D write semantics. It does not promise phoneme-accurate animation
without language-matched G2P/acoustic data and timing evidence.

## Proposed data flow

```text
TTS provider or local clip
          |
          v
  decoded PCM + exact playback duration
          |
          +--> cue source (provider cues / forced alignment / acoustic classifier / text heuristic)
          |              |
          |              v
          |       MouthTrack: start/end, class, openness, confidence
          |              |
          +----------> SpeechClock <---- actual audio playback position
                         |
                         v
                 Costume MouthProfile
                         |
                         v
                 one MouthWriter at beforeModelUpdate
                         |
                         v
                 declared Live2D parameters
```

The four boundaries are deliberately independent:

- **Cue source** says what to show and when. It may be approximate.
- **SpeechClock** indexes cues by audio position, never by network arrival time or a `speak()` promise resolve.
- **MouthProfile** maps generic classes to the parameters and ranges actually declared by one costume.
- **MouthWriter** is the only custom owner of mouth writes for a playback run. If it is enabled, native engine
  lip-sync must be disabled for that model, otherwise two writers add conflicting values.

A minimal contract can be represented as:

```ts
type MouthClass =
  | "rest" | "closed" | "open" | "wide" | "spread" | "rounded" | "narrow-rounded"
  | "fricative" | "unknown";

interface MouthCue {
  startMs: number;
  endMs: number;
  mouth: MouthClass;
  openness: number;       // 0..1, profile-mapped rather than a Live2D value
  confidence: number;     // 0..1; unknown/heuristic values remain visible in diagnostics
}

interface MouthTrack {
  durationMs: number;
  cues: MouthCue[];
  source: "native-energy" | "envelope" | "text-heuristic" | "aligned" | "provider-viseme" | "acoustic";
  approximate: boolean;
}

interface MouthProfile {
  characterId: string;
  costumeId: string;
  generation: "cubism2" | "cubism3";
  ids: { open: string; form?: string; width?: string; vertical?: string; strength?: string };
  ranges: Record<string, { min: number; max: number }>;
  poses: Partial<Record<MouthClass, { open: number; form?: number; width?: number; vertical?: number; strength?: number }>>;
}
```

`MouthProfile` values are not global constants. For example, `arbeit` uses `PARAM_MOUTH_FORM_01` in `[-0.5, 1]`,
whereas `live_01` uses `ParamMouthForm` in `[-1, 1]`. `PARAM_MOUTH_FORM` is not declared by `arbeit`; the legacy
runtime can register an unknown ID, so a successful get/set must not be used as a support check.

## Cue-source directions

### A. Native energy only

```text
decoded/playback audio -> engine analyser -> native MouthOpenY contribution
```

This is the current baseline. It has no extra model or dependency, works with any language and already passed
the local C2/C3 playback checks. It cannot choose form/width/rounded/spread classes. Keep it as a fallback and as
the control condition for every later A/B test.

### B. Envelope shaping plus authored poses

This is the low-risk improvement illustrated by Ryza/AgentAtelierR. Analyse the complete WAV in short frames,
remove the noise floor, smooth attack/release, detect pauses and insert short closure windows, then drive one
authored mouth track. It makes speech less like a continuously open jaw without pretending to know phonemes.

Advantages: all languages, deterministic replay, no text normalization, small CPU cost after decode. Limitations:
it still produces an open/closed energy track; it cannot tell `a` from `o`, and forced closures are a visual rhythm
heuristic rather than detection of `m/b/p`.

This is a reasonable first custom comparison for Fish because it preserves the exact Fish audio and fits the
current whole-reply buffered TTS policy. It should remain a Lab-only A/B path until the native baseline is compared
on several voices.

### C. Text heuristic or G2P schedule plus energy gating

Use the exact sanitized text sent to TTS, convert it to a small phoneme/viseme sequence, distribute candidate cue
intervals across the spoken audio and gate their strength with the measured envelope. The schedule selects classes;
the envelope controls how much the mouth is visibly active.

For Chinese, a real grapheme-to-phoneme step is needed. Han-character count alone is not a phoneme sequence. A
Pinyin/final-to-viseme table can be a useful approximation, but tones, coarticulation, neutral tones, punctuation,
speech rate and Fish's actual pronunciation still introduce timing error. The current Fish API does not return
phoneme or viseme offsets, so fixed characters-per-second must be treated as a heuristic and measured against
the resulting audio.

This is the closest adaptation of BANDORI's useful idea: separate `open` and `form`, then map text intent to a
costume profile. BANDORI itself uses character/substr heuristics and estimated unit timing; it is not a Chinese
forced aligner. Use its class vocabulary as a starting point, not its literal parameter IDs or universal numbers.

### D. Whole-clip forced alignment

Keep Fish as the voice, decode the returned clip, and run a recognizer/alignment process before playback. Produce
timestamped viseme cues, then start audio and cue playback from the same `AudioContext`/audio-element clock.

Possible tools:

- **Rhubarb Lip Sync**: Windows/macOS/Linux command-line tool, WAV/Ogg input, JSON/TSV cues in seconds, six basic
  mouth shapes plus optional extensions, MIT. Its PocketSphinx recognizer is English; its phonetic recognizer is
  language-independent but less precise and does not provide a Chinese accuracy guarantee. The local source's
  phonetic decoder does not turn a supplied Chinese dialog into a Mandarin forced aligner. Good for an offline
  diagnostic or simple English path, not a Chinese acceptance guarantee.
- **MFA (Montreal Forced Aligner)**: MIT code with separate acoustic models and dictionaries; current project
  releases document Kaldi/Pynini/Conda workflows and Mandarin model/dictionary assets under their own licenses.
  It can produce phone/word tiers when given matching text and audio. It is a desktop preprocessing service with
  meaningful installation and model-management cost, not a low-latency WebView2 hot path.
- **Rhubarb-derived WebAssembly packages**: convenient browser APIs exist, but package maturity, model loading,
  license provenance and non-English accuracy must be checked at the exact pinned version before adoption. A
  marketing claim of “streaming” does not establish stable incremental cue quality.

Forced alignment is the strongest direction when a Fish clip must retain its exact pronunciation and the system can
wait for preprocessing. It is not the same as real-time streaming: incomplete chunks do not have enough future
context for stable word/phone boundaries.

### E. Browser acoustic viseme classification

These tools infer visemes from arbitrary PCM/WebAudio and can work while a Fish clip is being streamed:

- **wawa-lipsync** (`wass08/wawa-lipsync`, MIT): TypeScript/WebAudio `AnalyserNode` library with a real-time
  viseme state and classes such as `PP`, `FF`, `TH`, `DD`, `kk`, `CH`, `SS`, `nn`, `RR`, `aa`, `E`, `I`, `O`, `U`.
  The public API connects an already-sourced HTML audio element and calls `processAudio()` in the animation loop.
  The examples target Three.js; a Live2D `MouthProfile` adapter would be ours. It is an attractive lightweight
  browser A/B candidate, but the repository does not provide Chinese accuracy evidence and a WebAudio connection
  must be created after a valid audio source exists.
- **HeadAudio** (`met4citizen/HeadAudio`, MIT): AudioWorklet + MFCC features + Gaussian/Mahalanobis classifier,
  with `onvalue` and optional timestamped viseme events. Its supplied `model-en-mixed.bin` was trained on four
  English Kokoro/HeadTTS voices; the README explicitly says VAD and prediction are imperfect. It is useful as an
  arbitrary-audio experiment, not a ready Chinese Fish model. Its documented sample also contains stale naming
  examples (`HeadAudioNode`/`.mjs` versus the current `HeadAudio`/`.bin` path); pin and inspect a release before use.
- **wLipSync** (`mrxz/wLipSync`, MIT): WASM AudioWorklet MFCC path with `weights` and `volume`, but requires a
  calibrated profile created externally with uLipSync. It is a framework candidate, not a zero-configuration
  solution for Taki's voices.

Acoustic classifiers avoid text alignment and can operate on Fish audio, but their viseme class is an inference with
speaker/model bias. For WebView2, keep analysis in an AudioWorklet or Worker and send small cue/weight messages to
the renderer; never block the Pixi frame with WASM or full-clip recognition.

### F. Provider-native timed visemes

Azure Speech JS exposes `visemeReceived` with `visemeId` and `audioOffset` (100-nanosecond ticks), and its language
support documentation lists `zh-CN` visemes and blend shapes. This gives a strong timing reference because the
cues belong to the exact audio Azure generated. The IDs are still shared viseme groups, not one Live2D parameter
per phoneme; map them into the active profile.

It cannot be used to annotate a Fish clip. Synthesizing the same text through Azure only to borrow its offsets is
wrong when pronunciation, pauses or duration differ. This direction requires accepting an Azure voice/provider or
using Azure only as a benchmark against Fish.

### G. Official Live2D MotionSync Web

Live2D's MotionSync Web/CRI Lipsync path is a real existing audio-analysis option. It supports audio-file and
microphone inputs and modern Cubism `.model3`/`.motionsync3` configuration. The official documentation lists
Windows browsers and a 2025 `5-r.2` package line, but the current pinned Pixi engine and Taki C2/C3 asset loader
are not documented as drop-in compatible.

It is therefore a possible C3 compatibility experiment, not a reason to replace the locked renderer. The official
components/Core have Live2D-specific licensing and distribution boundaries; the GitHub component repository alone
does not provide every proprietary runtime binary. No C2 path was established in this research.

## Recommended direction for TakiAgent

Use a staged hybrid rather than one universal recognizer:

1. **Keep native amplitude as the fallback and control condition.** It is stable, multilingual and already wired.
2. **Add a Lab-only profile/mapping layer.** Calibrate each costume to a small supported class set. C2 `arbeit`
   should start with `closed`, `open`, `spread` and one shape variant. C3 `live_01` can start with `closed`,
   `A`, `E`, `I`, `O`, `U/narrow-rounded`. Do not write undeclared IDs and do not share C2/C3 numeric tables.
3. **Run a buffered Fish A/B:** envelope + explicit pause/closure first, then text/G2P + envelope. Use the same
   clip and the same audio clock. This answers whether natural timing improves before introducing a recognizer.
4. **If Fish must remain and class changes are still inadequate, compare an acoustic classifier** (wawa first for
   small browser footprint; HeadAudio/wLipSync only after model/language calibration). Adapt output into the
   profile instead of exposing Oculus viseme names to the renderer.
5. **If provider choice is open, benchmark Azure zh-CN timed visemes** as a ceiling/reference for timing and class
   transitions. Do not mix Azure cues with Fish audio.
6. **Use MFA only for offline/high-quality batches** where startup/model cost is acceptable. Use Rhubarb as a
   practical Windows diagnostic, with English or phonetic limitations clearly reported.
7. **Consider MotionSync only as a separate C3 compatibility spike**, after license and pinned engine boundaries
   are approved.

The first implementation candidate should be a `MouthTrackSource` interface plus a Lab-only `MouthProfile` and
`MouthWriter`. The first custom source should be envelope shaping, because it gives a measurable improvement target
without claiming phoneme accuracy. A second source can consume text/G2P cues. An acoustic or forced-aligner source
should be plugged in only after the same profile and clock contracts pass replay, stop, model switch and disposal.

## Playback and lifecycle rules

- Decode the exact clip once and retain its duration/sample rate. Cues use clip-relative milliseconds.
- Start the audio and record a monotonic `audioStartContextTime`; sample cues from `AudioBufferSourceNode`/player
  position. Do not use HTTP arrival, synthesis completion or renderer wall time as the speech clock.
- Render a cue with a short crossfade/linear interpolation. Apply a silence gate before writing a positive mouth
  pose. Use a closed/rest cue at pause and end; do not leave the last vowel held indefinitely.
- The custom writer runs at `beforeModelUpdate` after the engine's motion/physics stage. Write only declared IDs,
  clamp to the profile's measured ranges, and use `set` with an explicit ownership weight. Keep expression and mouth
  policies separate; avoid `add` accumulation across frames.
- Native engine lip-sync and custom writing are mutually exclusive for one model/run. Native amplitude remains the
  fallback when no valid track is available.
- A new clip or source increments a generation and clears all previous cue/timing data immediately. A late provider,
  decoder or recognizer result must not refill a retired generation.
- Stop, natural end, costume switch, HMR and page disposal must retire the track, release audio/object URLs and
  detach the writer. Uncancellable native loads retain their captured old-manager cleanup until settlement.
- Unknown/low-confidence cue classes degrade to `open` or `closed` according to the profile, while diagnostics
  preserve `unknown` and confidence. Never turn missing observations into zero and claim measured silence.

## Acceptance plan before production discussion

The Lab should compare each source on the same text, Fish clip, costume and playback volume:

| Measure | Minimum evidence |
| --- | --- |
| Audio timing | cue clock follows actual playback; no network-arrival timing |
| Pause behavior | known leading/middle/trailing silences close the mouth |
| Shape behavior | C2/C3 profile produces distinct declared poses in screenshots |
| Lifecycle | replay, Stop, Resume, replacement, delayed result and disposal leave no active writer |
| Accuracy | per-class confusion/coverage on a labeled multilingual fixture; do not infer from parameter movement |
| Latency | time to first cue and end-to-end queue under WebView2; report p50/p95, not one observation |
| Cost | main-thread frame budget, AudioWorklet/Worker CPU and memory with one/two models |
| Fallback | provider failure, recognizer failure, missing parameter and low confidence remain audible/text-safe |
| Human quality | blinded A/B for naturalness and perceived articulation, separate from automated parameter assertions |

Suggested initial labeled fixture: the same short Chinese and English sentences synthesized by the chosen Fish
voice, with deliberate pauses and a small set of manually tagged target classes. A fixed voice/model/costume must
be named in every result. “The mouth moved” is not an articulation metric.

## Source references

- Current engine: `apps/desktop/node_modules/untitled-pixi-live2d-engine/dist/index.es.js:989-1004`, `:1519-1524`,
  `:12684-12692`.
- Current Taki rig evidence: `research/mouth-pose-capability-2026-09-08.md` and
  `research/mouth-pose-probe.mjs` in this task.
- Fish HTTP/WebSocket and model docs: <https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech>,
  <https://docs.fish.audio/api-reference/endpoint/websocket/tts-live>,
  <https://docs.fish.audio/features/realtime-streaming>.
- Ryza/AgentAtelierR: `references/AgentAtelierR-main/lib/src/audio_envelope.dart`,
  `references/AgentAtelierR-main/lib/src/chat_screen.dart:483`,
  `references/AgentAtelierR-main/lib/src/character_expression.dart:306`.
- BANDORI: `references/BANDORI-PET-REV-main/tts_manager.py:212,223,246,285,653,701`,
  `references/BANDORI-PET-REV-main/live2d_widget.py:879`,
  `references/BANDORI-PET-REV-main/live2d_lua_adapter.py:727,753`.
- wawa-lipsync: <https://github.com/wass08/wawa-lipsync> (MIT; README API connects an HTML audio element and calls
  `processAudio`).
- HeadAudio: <https://github.com/met4citizen/HeadAudio> (MIT; AudioWorklet/MFCC/Gaussian classifier, supplied
  English model and documented 50-100 ms processing compensation).
- wLipSync: <https://github.com/mrxz/wLipSync> (MIT; WASM AudioWorklet/MFCC, calibrated profile required).
- Rhubarb Lip Sync: <https://github.com/DanielSWolf/rhubarb-lip-sync> (Windows CLI, WAV/Ogg, JSON/TSV cues,
  PocketSphinx/phonetic recognizers, MIT source license).
- MFA: <https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner> (MIT code, Kaldi forced alignment;
  model/dictionary assets carry their own terms).
- Azure timed visemes: <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme>
  and <https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support#visemes>.
- Live2D MotionSync Web: <https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/>
  and <https://github.com/Live2D/CubismWebMotionSyncComponents>.

All external pages were read on 2026-09-09. They establish documented contracts and licenses, not TakiAgent's
Chinese recognition accuracy, WebView2 compatibility or production readiness.

## Selection decision for Chinese and Japanese (2026-09-09)

Do not adopt one existing lip-sync repository as the final TakiAgent implementation. Use a thin Taki-owned
adapter/orchestration layer and reuse an existing analyzer or aligner behind it. This keeps the renderer and
costume mapping under our control while avoiding a from-scratch audio classifier.

Recommended order:

1. **Lab benchmark:** use `wawa-lipsync` as the first browser A/B source. It is small, TypeScript/WebAudio and
   exposes broad viseme labels, so it can answer whether a live classifier improves the current native opening.
   Treat its output as approximate until Chinese and Japanese fixtures show acceptable class and timing behavior.
2. **First Taki candidate:** implement the cue orchestration ourselves: Fish clip -> PCM envelope/pause detection
   + locale-specific G2P (Mandarin Pinyin and Japanese mora/phoneme) -> universal viseme -> costume profile ->
   `MouthWriter`. This is a thin adapter and mapping project, not a new engine or neural recognizer. It preserves
   Fish's exact voice and supports code-switching through per-segment locale metadata.
3. **Accuracy branch:** for buffered clips where quality justifies preprocessing, run a language-matched MFA
   alignment service and feed its phone times into the same `MouthTrack`. Keep this out of the WebView2 frame path.
   Rhubarb is a convenient Windows diagnostic, but its non-English phonetic mode is not a Chinese/Japanese quality
   guarantee.
4. **Provider alternative:** benchmark Azure `zh-CN` viseme events only if switching the TTS provider is acceptable.
   It is the cleanest timed-cue reference because the events belong to the same generated audio. Never combine its
   offsets with Fish audio.

Do not make HeadAudio or wLipSync the first dependency: the inspected HeadAudio model is English-oriented and
wLipSync requires a calibrated profile. Do not choose official MotionSync as a drop-in fix: it is a separate
Cubism Web/C3 integration with proprietary/licensed components and no established C2 bridge for this renderer.

The decision gate for moving beyond the thin adapter is a fixed Chinese/Japanese fixture set on both `arbeit` and
`live_01`: pause closure, broad vowel-class timing, visible class separation, p50/p95 cue latency, CPU/frame cost,
and human A/B naturalness. If the hybrid route cannot beat native amplitude on those measures, keep native fallback
and avoid adding a dependency.
