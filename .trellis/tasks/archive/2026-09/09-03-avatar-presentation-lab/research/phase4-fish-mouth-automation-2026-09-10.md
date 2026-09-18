# Automated Fish mouth capability report (2026-09-10)

This report is a Lab-only browser result. The real Fish credential and reference voice were supplied for this run and
were kept in process memory only. The generated WAV, screenshots and JSON are under the ignored
`.trellis/.runtime/avatar-lab-fish-mouth-20260910-final/` and are not repository artefacts.

## Command and coverage

The reusable runner is `apps/desktop/lab/automation/fish-mouth-check.mjs`. It performs one real Fish request, then
uses the same returned clip for both costumes and both playback paths:

1. native engine analyser/lip-sync;
2. an opt-in Lab envelope -> `MouthTrack` -> measured `MouthProfile` -> `MouthWriter` path with native lip-sync
   disabled for that run.

Each path records browser frame state, raw analyser readings, final parameter ranges, first useful cue timing, and
canvas foreground/change ratios. The static `research/mouth-pose-probe.mjs` candidate run adds seven direct parameter
poses for each costume.

## Provider and processing timings

| Measure | Result |
| --- | ---: |
| Fish request and response | 3,871.9 ms |
| Returned audio | 360,492 bytes, 4,086.7 ms decoded duration |
| Envelope frames | 256 frames, 16 ms frame size |
| Detected closure frames | 103 |
| C2 decode / envelope calculation | 20.1 ms / 2.2 ms |
| C3 decode / envelope calculation | 64.6 ms / 1.9 ms |

The C3 writer setup was 287.1 ms versus 118.4 ms for C2 because the browser dynamically loaded the Lab modules and
profile on the first run. This is setup cost, not per-frame mouth calculation cost.

## Native and custom results

| Costume | Path | Playing frames | Native raw range | Final mouth range | First useful mouth |
| --- | --- | ---: | ---: | ---: | ---: |
| `taki/arbeit` C2 | native | 255 | `0..1` | `0..0.400` | 650.7 ms after audio start |
| `taki/arbeit` C2 | custom writer | 220 | analyser `0..1` (observation only) | `0..0.673` | 57.8 ms after audio start |
| `taki/live_01` C3 | native | 66 | `0..1` | `0..0.400` | 69.0 ms after audio start |
| `taki/live_01` C3 | custom writer | 68 | analyser `0..1` (observation only) | `0..0.578` | 62.7 ms after audio start |

The custom path remained active for 148 C2 frames and 55 C3 frames. Its envelope openness ranges were `0.015..0.841`
and `0.015..0.802`. Both custom runs produced nonblank, changing canvases:

- `arbeit`: foreground ratio `0.176`, changed-pixel ratio `0.035`;
- `live_01`: foreground ratio `0.113`, changed-pixel ratio `0.049`.

The custom run reports `mouthSync()` only as an analyser observation. Native lip-sync was disabled, so those raw values
were not the source of the custom final writes. The direct writer used only measured profile IDs and `set` writes.

The C2 native first-positive delay is an outlier relative to the C3 run and should not be treated as a stable engine
latency measurement. It includes the browser's initial analyser/audio scheduling and the utterance's quiet interval.
The custom first-cue measurements are the useful real-time comparison for this run, but they are still browser frame
observations, not physical speaker latency or perceptual synchronization scores.

## Static pose capability

The candidate pose probe ran seven cases per costume (`closed-MBP`, `A`, `E`, `I`, `O`, `U`, `U-umlaut`). Every requested
parameter read back within `0.001` of the model's clamped value. Every non-closed candidate changed rendered pixels:

- C2 `arbeit`: 5,860 to 8,659 changed pixels per candidate capture;
- C3 `live_01`: 1,570 to 3,116 changed pixels per candidate capture.

This proves that both rigs can display more than a single open/closed value when their costume-specific parameters are
used. It does not prove that Fish text, Mandarin/Japanese phonemes, or a classifier can select the correct pose.

## Outcome

Automated capability verification is successful for the following bounded claim: real Fish audio reaches the Lab,
native amplitude moves both model generations, the measured custom writer can drive declared mouth parameters from an
audio envelope with roughly 58-63 ms first-cue browser delay, and both rigs visibly support multiple static mouth
poses. No browser or page errors occurred.

The following claims remain unproven: phoneme or viseme correctness, Chinese/Japanese timing accuracy, naturalness,
human-perceived synchronization, and superiority of the custom writer over native lip-sync. The automatic driver
therefore remains Lab-only and opt-in.

## Optimization directions

1. Warm or bundle the Lab mouth modules after page load so the first-run 118-287 ms writer setup does not overlap a
   user's first utterance.
2. Keep the custom writer's audio clock tied to the actual playing source, and measure p50/p95 first-cue delay over
   multiple Fish clips instead of relying on one run.
3. Compare native and custom paths on the same labeled Chinese/Japanese fixture, including leading, middle and trailing
   pauses; score closure recall and broad viseme-class timing separately from parameter movement.
4. Add a locale-aware cue source only behind the existing universal class/profile contract. Do not use a fixed
   characters-per-second schedule as a phoneme alignment substitute.
5. Benchmark `wawa-lipsync` against this envelope control condition before adding any dependency; reject it if it
   cannot improve class timing or perceptual A/B quality on the fixed fixtures.
