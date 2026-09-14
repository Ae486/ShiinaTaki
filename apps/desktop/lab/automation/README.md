# Avatar lab browser checks

These are local lab experiments against real imported models, not production E2E tests. All control actions go
through the existing page. Each case gets a new browser context and a fresh model. Playwright intercepts only its
own copy of the bootstrap response to expose the existing scene for observations; no debug global is added to the
normal app, and no engine behavior is monkey-patched.

## Run

Start the lab with `pnpm --filter @taki/desktop dev`. Use an existing Playwright installation; this experiment does
not add a project dependency. `TAKI_LAB_PLAYWRIGHT_MODULE` points to that installation's `index.mjs`.

On the current workstation, Python Playwright already includes the JavaScript driver and Chromium:

```powershell
$env:TAKI_LAB_PLAYWRIGHT_MODULE = 'G:/Roaming/Python/Python312/site-packages/playwright/driver/package/index.mjs'
node apps/desktop/lab/automation/browser-check.mjs .trellis/.runtime/avatar-lab-browser
```

Optional controls:

- `TAKI_LAB_URL`: defaults to `http://localhost:1420`.
- `TAKI_LAB_CASES`: comma-separated scenario ids from `browser-scenarios.mjs`; omitted runs the acceptance matrix.
- Positional arguments after the output directory select costumes: `arbeit`, `live_01`, or both (default).
- `TAKI_LAB_VIEWPORT_WIDTH` / `TAKI_LAB_VIEWPORT_HEIGHT`: defaults to 1440 x 1000.
- Scenarios marked `diagnostic` use explicit engine control calls and run only when selected, never as acceptance.

The process returns nonzero on any failed assertion or browser exception. Each case writes findings before the
next case starts; a failed case does not discard completed evidence. Use a fresh output directory for a narrower
rerun so the original full-matrix summary remains available.

## Evidence

- `summary.json`: pass/fail details, browser version, actual cached curve counts, several face/body ranges, errors,
  and active-motion frame counts.
- `<case>.json`: every sampled frame at the lab's existing hooks, plus current-expression/cache/readout state.
- `<case>-page.png`: the actual full page.
- `<case>-model.png` / `-model-next.png`: two real canvas captures; the runner checks nonblank foreground and changed
  pixels. Breathing also moves pixels, so motion-manager activity and motion-output samples are checked separately.
- `comparison.png`: motion alone / expression plus unfiltered motion / expression plus filtered motion, assembled
  from screenshots. Poses and breathing phase differ; the picture is visual evidence, not a pixel-equality test.
- `reset-comparison.png`: applied expression / Reset / the same expression successfully applied again.

Raw values and several face parameters are the acceptance evidence; the page's single-parameter probe is not
whole-face certification. There is intentionally no assertion requiring unfiltered playback to destroy the smile.

Keep output beneath `.trellis/.runtime/` or another ignored local directory: model screenshots contain copyrighted
assets and must not be committed, published, or bundled. The report and reproduction script may be versioned.

## Files

- `browser-check.mjs`: scenario orchestration, assertions, incremental summary, process exit status.
- `browser-driver.mjs`: UI actions, response-only observation handle, frame/readout/cache/screenshot capture.
- `browser-scenarios.mjs`: command-order, cache, channel, loop, eye-open, Reset/Set, cancellation and failure cases.
- `browser-images.mjs`: PNG foreground/movement measurements and the comparison image.
- `production-command-check.mjs`: actual Core tool/schema publication and unchanged production renderer calls;
  logs original engine outcomes and tests native cross-kind composition versus same-kind rejection/replacement.

## Production entry comparison

```powershell
node apps/desktop/lab/automation/production-command-check.mjs .trellis/.runtime/production-avatar-command-check
```

This comparison imports existing production functions unchanged. Core publication and browser playback are real;
the harness passes the command between them without a live LLM or WebSocket service. Its four `diagnostic-preserve-off`
cases deliberately toggle the existing engine setting inside isolated contexts to identify the effect of that
setting. The other sixteen cases use current production defaults. Never treat diagnostic configuration as evidence
of the owner's installed runtime state, and never equate the synchronous tool `{ok:true}` with engine playback.

## Phase 4 native speech

Create a local speech fixture with the installed Windows system voice, or supply a WAV that contains speech and
natural pauses. The fixture is real synthesized speech, but it does not represent a Fish voice or live Fish API acceptance.

```powershell
powershell.exe -NoProfile -File apps/desktop/lab/automation/create-speech-fixture.ps1
$env:TAKI_LAB_PLAYWRIGHT_MODULE = 'G:/Roaming/Python/Python312/site-packages/playwright/driver/package/index.mjs'
node apps/desktop/lab/automation/speech-check.mjs .trellis/.runtime/avatar-lab-speech .trellis/.runtime/avatar-lab-speech-20260908/system-voice.wav
```

The default matrix tests C2 `arbeit` and C3 `live_01`: native playback through natural ending, replay/Stop, actual
AudioContext suspension/Resume, costume replacement, intercepted synthesis success/503, cancelled or replaced
pending synthesis, and decode failure followed by recovery. No request reaches an external provider. Scenario ids
can be selected with `TAKI_LAB_CASES`; positional costume names follow the WAV path. Pending native-load retirement
is covered by deterministic controller tests because the engine's internal blob load cannot be aborted by fetch.
The matrix also includes `replace-input` (new unplayed clip has no previous timing) and `native-gain-one` (same
clip with native gain=1 versus the default 1.5). This diagnostic changes only the lab control in its isolated case.

For narrow-screen coverage, set `TAKI_LAB_VIEWPORT_WIDTH=390`, `TAKI_LAB_VIEWPORT_HEIGHT=844` and
`TAKI_LAB_CASES=native-playback`, then use a separate evidence directory. The runner asserts nonblank/moving pixels,
no horizontal overflow, real audio state and final mouth parameter variation. Frame JSON retains zero and positive
analyser samples, computed contribution, final mouth parameters, and actual browser observation timestamps.
Those timestamps are not physical speaker latency or perceptual synchronization certification.

The native engine can retain analyser/context references after clearing `currentAudio`. The monitor reports that
reference truthfully but leaves raw/contribution unavailable without active audio; tests require stopped playback
and retired model cleanup, not a fabricated disappearance of native references.

For an actual provider run, enter its base URL, voice, model, text and key in the lab's Speech panel. Proxy mode
accepts `https://api.fish.audio/v1/tts` or the configured local `/v1/audio/speech` endpoint only. Change
`TAKI_LAB_TTS_LOCAL_TARGET` before starting Vite to configure that local target, including an optional path prefix.
Other services require direct mode and their browser CORS support. Keys are never persisted; automated captures
use empty key fields. Synthesized bytes remain in memory and can be replayed without another upstream request.
