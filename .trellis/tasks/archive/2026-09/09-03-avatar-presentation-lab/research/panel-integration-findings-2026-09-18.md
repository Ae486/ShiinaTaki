# Phase 5 panel integration findings (2026-09-18)

Lab-only browser result for the 2026-09-11 authorized subset with the 2026-09-14 three-arm amendments. The run used
the retained real Fish WAV from 2026-09-10 through route interception of the normal Speech panel; no live provider
request, no credential and no product code change. Evidence stays under the ignored
`.trellis/.runtime/avatar-lab-panel-20260918/` (`summary.json`, per-arm frame JSON, page/model/pose PNGs).

## What the normal panel now does

- `mouth mode` selects one of three arms on the same retained clip and costume: `native` (engine defaults captured
  from the loaded model before the panel writes anything; gain/weight inputs locked), `native-tuned` (sliders live,
  preset weight 1.0) and `envelope` (Lab writer over the measured `MouthProfile`; native lip-sync disabled for the run
  only). Mode change resets the pose preview and stops playback.
- `pose preview` shows the authored `closed / a / e / i / o / u` candidates on the calibrated costumes without raw
  parameter ids; `model view` = `face` magnifies the head for observation and survives costume switches.
- The readout prints the effective native gain/weight, whether sliders are live, and one line per mouth parameter
  with the final range of every arm side by side. Ranges reset when a new clip is loaded or a new model is attached.

## Command and matrix

```
TAKI_LAB_PLAYWRIGHT_MODULE=<installed index.mjs> \
TAKI_LAB_FISH_FIXTURE=.trellis/.runtime/avatar-lab-fish-mouth-20260910-final/fish-live.wav \
node apps/desktop/lab/automation/mouth-panel-check.mjs .trellis/.runtime/avatar-lab-panel-20260918
```

24/24 passed: `arbeit` (C2) and `live_01` (C3) x 1440x1000 and 390x844 x `native`, `native-tuned`, `envelope`,
`suspend-resume`, `poses`, `replacement`. Chromium 139.0.7258.5 headless (SwiftShader), zero page errors, no layout
overflow at either viewport, nonblank moving canvas in every playback arm.

## Three-arm result on the primary open parameter (same clip)

| Run | native default | native tuned (weight 1.0) | envelope |
| --- | ---: | ---: | ---: |
| `arbeit` 1440 | `0..0.400` (120 f) | `0..1.000` (113 f) | `0..0.642` (113 f) |
| `live_01` 1440 | `0..0.400` (40 f) | `0..1.000` (38 f) | `0..0.606` (39 f) |
| `arbeit` 390 | `0..0.400` (237 f) | `0..1.000` (225 f) | `0..0.673` (228 f) |
| `live_01` 390 | `0..0.400` (50 f) | `0..1.000` (45 f) | `0..0.562` (44 f) |

The native default ceiling is exactly the engine's `lipSyncWeight = 0.4`; the tuned arm reaches the declared maximum.
The envelope arm's lower peak is the profile pose scaled by measured openness, not a cap. Any perceptual comparison
must therefore treat `native-tuned` as the baseline; the default arm mostly shows the amplitude cap.

Lifecycle checks passed as specified: the writer detaches and native lip-sync is restored on stop, natural finish,
mode change and costume replacement (the retired model reports `lipSync = true` and no playing audio); suspension
freezes the audio-position clock and Resume advances it; every pose preview reports `lipSync = false` while shown
and restores it on `off`.

## Defects found in the pre-existing automation (not the panel)

- `mouth-panel-observations.mjs` sampled inside `queueMicrotask` after `beforeModelUpdate`. The engine's `update()`
  emits that event, then runs `model.update()` and `model.loadParam()`, which restores the saved parameter snapshot,
  so every deferred read returned 0. Sampling now happens synchronously inside the hook, subscribed after `play()`
  so it runs after the writer. This engine order matters for any future per-frame observer.
- `checkReplacement` dereferenced `motionManager` on a destroyed model; the engine nulls it. The handle is now kept
  before the switch.

## Limitations and owner-only checks

- Ranges, lifecycle, rendering and layout are proven; perceptual lip-sync quality, naturalness and the choice between
  `native-tuned` and `envelope` are not. That verdict is the owner's, made with audible playback on a real screen.
- `live_01` frame intervals under headless SwiftShader were p50 ~90-110 ms (`arbeit` ~17-36 ms); this is a headless
  render cost, not a speaker-latency or synchronization claim.
- The `envelope` arm files its ranges under `envelope` even when it falls back to native (no profile / no envelope);
  the readout's `effective native` and `fallback:` lines disclose that state.
- Only `taki/arbeit` and `taki/live_01` have calibrated profiles; other costumes get the two native arms only.
- `mouth-language.ts` stays frozen and unwired; the wawa benchmark stays deferred pending the owner's verdict.
