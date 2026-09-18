# Research: Provider timing and official Live2D MotionSync options

- Query: Can the current Fish Audio path obtain timed mouth shapes, and can Azure Speech or official Live2D MotionSync supply a practical alternative for the current Windows/WebView2 renderer?
- Scope: mixed; existing Lab contracts and current official provider/plugin documentation.
- Date: 2026-09-09 (follow-up to the 2026-09-08 Lab mouth-pose findings).
- Active task: `.trellis/tasks/09-03-avatar-presentation-lab`, confirmed from `.trellis/.current-task`.
- Authority: research and documentation only. No package installation, synthesis request, production change, or engine replacement was performed.

## Findings

### Decision summary

| Direction | Preserve the exact Fish audio? | What supplies timing and shape? | Fit for this Lab |
| --- | --- | --- | --- |
| Current Fish HTTP/WS alone | Yes | Audio bytes only; no documented viseme/phoneme timeline | Insufficient by itself for phoneme-shaped playback |
| Fish plus an independent audio analyzer | Yes | Analyzer runs on decoded PCM and supplies weights/cues | Appropriate branch when the Fish voice must remain |
| Azure Speech SDK synthesis | No | The same synthesis produces audio and timestamped viseme IDs, optionally blend shapes | Strong provider-native timing reference; requires a different TTS voice/provider |
| Official Live2D MotionSync Web | Yes, as decoded audio input | CRI Lipsync/MotionSync audio analysis and configured parameter mapping | Relevant existing solution to evaluate, but not a drop-in plugin for the pinned Pixi engine or its C2 runtime |

There are two independent requirements: the analyzer must choose a useful visible shape at the correct audio time, and the costume must be able to display that shape. The existing static pose experiment establishes the latter for several candidates. It does not establish audio recognition or timing quality.

### 1. Current local contract is buffered audio, without cues

`apps/desktop/lab/speech/fish-audio-provider.ts:10` builds a `POST /v1/tts` request with a model header and a body containing `text`, `reference_id`, `format`, `prosody.speed`, and `latency: "normal"`.

`apps/desktop/lab/speech/provider-request.ts:46` reads the response with `await response.arrayBuffer()`.

`apps/desktop/lab/speech/speech-provider.ts:15` defines the result as `SpeechClip { bytes, mimeType, providerId, elapsedMs }`; `:31` exposes `synthesize(...) -> Promise<SpeechClip>`. There is no phoneme, viseme, word-boundary, or audio-offset field.

`docs/TTS-INTERFACE.md:40` documents whole-reply, TTS-ready presentation. Real-time animation during playback does not require changing this policy into network streaming. An analyzer may inspect a fully received clip before playback, then animate it from the playback clock. True receive-analyze-play streaming is a separate latency direction.

### 2. Fish currently does not document native mouth-shape events

Official HTTP TTS documentation describes generated audio, including a chunked successful response. The inspected public HTTP contract does not declare a viseme/phoneme timing response.

The official WebSocket protocol is more explicit:

```text
Client -> server:
  StartEvent { event: "start", request: ... }
  TextEvent  { event: "text", text: ... }
  FlushEvent { event: "flush" }
  CloseEvent { event: "stop" }

Server -> client:
  AudioEvent  { event: "audio", audio: <binary bytes> }
  FinishEvent { event: "finish", reason: "stop" | "error" }
```

Frames use MessagePack. The server contract lists only audio and completion messages. Text events are upstream text submissions, not downstream aligned transcript events. The schema instructs clients to ignore unknown events for future extension; it does not currently define a viseme, phoneme, character timestamp, or word timestamp event.

Consequences:

- A WebSocket migration can reduce time to first audio, but does not provide mouth shapes automatically.
- An audio chunk boundary is not an aligned word or phoneme boundary. A `TextEvent` or `FlushEvent` is not a mouth-shape timestamp.
- Transport arrival time must not become animation time. Decode to PCM and index analysis/cues by sample position, then consume them against actual playback position.
- If the Fish voice is required, keep Fish and obtain the missing shape information from an independent audio analyzer, or from text-to-phoneme generation plus alignment against the actual Fish audio.
- This is a statement about the public contract inspected on this date. It is not proof that Fish has no internal alignment representation or could not add metadata later.

Official references:

- https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
- https://docs.fish.audio/api-reference/endpoint/websocket/tts-live
- https://docs.fish.audio/features/realtime-streaming
- https://docs.fish.audio/developer-guide/sdk-guide/cookbook/realtime-llm-to-speech

### 3. Azure Speech supplies a native timed-viseme contract

The JavaScript Speech SDK exposes the synthesis event as:

```ts
synthesizer.visemeReceived = (_sender, event) => {
  const seconds = event.audioOffset / 10_000_000;
  const visemeId = event.visemeId;
  const animation = event.animation;
  // Store a cue relative to the synthesized audio; do not animate on arrival.
};
```

The official contract specifies `audioOffset` in 100-nanosecond ticks. Dividing by 10,000 gives milliseconds; dividing by 10,000,000 gives seconds. The viseme is associated with its start time in the synthesized audio, not with callback wall-clock time.

The service documents 22 IDs, including silence (`0`) and the shared P/B/M closure group (`21`). IDs are visible shape groups, not a one-to-one phoneme inventory. Mapping must respect the locale's phoneme-to-viseme definition; the general illustrative IPA table is not a Chinese pronunciation dictionary.

For this Live2D use case, IDs and offsets are already useful: map them into the Lab's smaller costume-specific pose vocabulary. Requesting and adopting all facial blend shapes is not a prerequisite.

The SDK can also provide animation data:

- Viseme IDs can be obtained with normal text synthesis.
- SSML `<mstts:viseme type="FacialExpression"/>` requests facial blend shapes.
- Blend-shape output contains `FrameIndex` and `BlendShapes`, with 55 values per frame at 60 FPS according to the official overview. These are facial blend-shape coefficients, not Live2D parameter IDs.
- SVG/red-lips output is documented for `en-US`; it is not the Chinese solution.

Chinese and voice constraints:

- The live language-support document's **Visemes** table explicitly lists `zh-CN` as supporting **Viseme ID** and **Blend shapes**.
- The same voice catalog lists standard `zh-CN-XiaoxiaoNeural` and `zh-CN-YunxiNeural`; a standard zh-CN neural voice is a sensible first test candidate.
- This is documentation-level support. No chosen voice, style, region, HD model, or multilingual model was live-tested. Do not generalize locale support into a guarantee that every new voice family returns the same metadata.
- Check the actual event stream for the selected voice and language before treating the timeline as accepted.

The provider boundary matters: `VisemeReceived` accompanies **Azure's own synthesis**. It is not an API that accepts arbitrary Fish audio and returns matching visemes. Synthesizing the same text through Azure solely to borrow its timeline for Fish is unreliable because pauses, pronunciation, and durations can differ. An audio analyzer/alignment stage remains necessary when preserving the original Fish clip.

Official references:

- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support#visemes
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice#viseme-element
- https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis

### 4. Official Live2D MotionSync is a real audio-analysis option

Live2D provides **Cubism SDK MotionSync Plugin for Web**. It uses CRI Lipsync and is designed to run the motion-sync feature with Cubism SDK for Web. The official sample can analyze audio files and microphone input.

The inspected official repository changelog's newest entry is `5-r.2`, dated 2025-03-27. It states that microphone input was separated into an interface providing an audio buffer, to support other inputs. This makes Fish decoded PCM a relevant input direction to investigate. It is not necessary to change the TTS voice merely to consider MotionSync.

The repository README lists Windows Chrome, Edge, and Firefox in its tested operation environments, and names Cubism 5 SDK for Web R3 as its SDK environment. This supports considering it for a Windows web renderer. WebView2 and our exact Pixi setup were not explicitly listed or tested in this research.

Configuration documented by the Web manual includes viseme blending, analysis rate, and smoothing. Its `SampleRate` setting is described in **analysis frames per second**, not the PCM sampling frequency. The Web settings manual and changelog are not perfectly synchronized: the changelog records removal of `SetAudioLevelEffectRatio` in `5-r.1`, while the settings page still discusses the value. Use the selected package's actual API when evaluating it, not copied manual snippets alone.

#### Generation and integration boundary

The official scene setup requires:

1. Cubism SDK for Web.
2. MotionSync Core and its framework components.
3. A `.model3.json` model and its `.motionsync3.json` mapping/configuration.

The official instructions for models exported for Cubism 4.2 or earlier still work through `.model3.json`, adding `FileReferences.MotionSync`. They do not document the legacy Cubism 2 `.model.json`/`.moc` runtime.

Therefore:

- For the modern C3-format model family, this is an established official mechanism, but the current `untitled-pixi-live2d-engine@1.3.1` integration and missing configuration still require a separate compatibility experiment.
- For C2, no drop-in official plugin path was established. Reusing an audio-analysis result through our C2 parameter adapter is conceptually possible, but separating the analyzer from its modern Cubism model/framework dependency must be validated. Do not present that bridge as already supported.
- Do not replace the pinned renderer to obtain this feature without an explicit engine decision. The project's spec locks its renderer stack.
- Neither official MotionSync nor another analyzer creates deformation that a costume lacks. The measured weak O/U distinction of `taki/arbeit` still requires reduced pose groups.

#### License and distribution boundary

The official manual says CRI Lipsync is licensed by Live2D, is royalty-free for MotionSync users, and does not require the CRIWARE logo. This does not make the entire package MIT/public-domain software.

The framework components use the Live2D Open Software License; MotionSync Core is proprietary and is omitted from GitHub. A repository checkout alone is insufficient to run the plugin. The official package supplies the Core binary/library, with Live2D's license and release-license conditions applying. No package was downloaded or license acceptance action taken in this research.

Official references:

- https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-motionsync-plugin-for-web/
- https://docs.live2d.com/en/cubism-sdk-manual/use-on-scene-motion-sync-web/
- https://docs.live2d.com/en/cubism-sdk-manual/use-models-cubism-4-2/
- https://docs.live2d.com/en/cubism-sdk-manual/motion-sync-setting-web/
- https://docs.live2d.com/en/cubism-sdk-manual/motionsync-plugin-platform/
- https://github.com/Live2D/CubismWebMotionSyncComponents
- https://raw.githubusercontent.com/Live2D/CubismWebMotionSyncComponents/develop/README.md
- https://raw.githubusercontent.com/Live2D/CubismWebMotionSyncComponents/develop/CHANGELOG.md
- https://raw.githubusercontent.com/Live2D/CubismWebMotionSyncComponents/develop/LICENSE.md

### Recommended evaluation order

1. Preserve the existing buffered Fish clip and its exact text for repeatable comparisons. Use the current costume pose calibration as the rendering endpoint.
2. Design a provider-independent, audio-relative cue/weight stream. Keep generation/analyzing, playback clock, and costume parameter mapping separate. Replay should reuse the clip and its cues.
3. If the Fish voice is mandatory, evaluate an analyzer on that audio. MotionSync is a credible official candidate with extra integration work, not an automatic first dependency.
4. If provider choice is open, test Azure's zh-CN viseme events as a timing-quality reference and simpler source of native cues. Compare voice quality and timing separately.
5. Only after buffered playback works, evaluate true streaming with a small analyzed-audio queue. Handling incomplete input, underflow, stop, replay, and costume replacement is separate from whether the model can display a mouth shape.

The external analyzer shortlist and the unified player design are handled by the parallel research topics; this file does not rank uninspected third-party recognizers.

## Files Found and Related Specs

| File | Purpose/evidence |
| --- | --- |
| `.trellis/workflow.md` | Existing task and research persistence rules |
| `.trellis/tasks/09-03-avatar-presentation-lab/prd.md` | Lab-only boundary; no production mouth driver or recognizer authorization |
| `.trellis/spec/frontend/live2d-renderer.md:5` | Pinned renderer stack |
| `.trellis/spec/frontend/live2d-renderer.md:37` | Generation-specific raw parameter APIs |
| `docs/TTS-INTERFACE.md:3` | External synthesis and low-footprint policy |
| `docs/TTS-INTERFACE.md:40` | Whole-reply TTS-ready presentation policy |
| `apps/desktop/lab/speech/fish-audio-provider.ts:10` | Current Fish request construction |
| `apps/desktop/lab/speech/provider-request.ts:46` | Buffered audio read |
| `apps/desktop/lab/speech/speech-provider.ts:15` | Audio-only clip contract |
| `references/BANDORI-PET-REV-main/tts_manager.py:212` | Reference pose table; its text estimator uses a generic Chinese fallback |
| `.trellis/tasks/09-03-avatar-presentation-lab/research/mouth-pose-capability-2026-09-08.md:5` | Measured C2/C3 pose capacity and costume limitations |

## Caveats / Not Found

- Research establishes documented APIs and source contracts, not recognition accuracy, latency, CPU cost, audible quality, or visual acceptance.
- No paid/provider call, microphone capture, package install, production modification, or application execution was performed.
- No public Fish viseme/phoneme/word-timing field was found in the inspected HTTP and WebSocket schemas.
- No official direct C2 MotionSync Web integration was found. The exact audio-input interface type and decoupled Core API were not inspected successfully; two guessed source paths returned 404 and repository tree listing hit GitHub's unauthenticated API rate limit.
- Exa search reached its free MCP quota after the primary pages were found. Remaining verification used direct read-only HTTP requests to official Microsoft Learn and Live2D GitHub raw documentation. This did not block the main API and generation conclusions.
- The Azure locale table supports zh-CN, but the selected voice/style/region and actual output events still require a live trial. The MotionSync sample's Windows browser support is not a measured WebView2/Pixi integration result.
- Public documentation and repository branches can change. Sources were read on 2026-09-09; versions are reported as inspected, not claimed to be installed locally.
