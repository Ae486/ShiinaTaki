# Phase 4 live Fish synthesis findings (2026-09-10)

This is a Lab-only browser observation. The supplied Fish credential was used in memory for one run through the
existing fixed-target `/lab-tts/fish` proxy; it was not written to the repository, browser storage, screenshots or
the findings file. The supplied reference voice was used with the existing `s2.1-pro-free` model. No provider key or
full voice identifier is recorded here.

## Provider and playback result

- The Fish `/v1/tts` request returned HTTP 200 and `audio/wav` bytes.
- The Lab Speech panel synthesized the clip through the proxy and reported `providerId: fish-audio` with no page
  errors. The returned clip sizes were 340,012 bytes during the `arbeit` synthesis probe and 331,820 bytes during
  the `live_01` playback probe.
- The browser then played the returned clip through the existing native `model.speak()` path on `taki/live_01`.
  There was no engine, renderer or provider adapter change for this run.

## Native mouth observation

The `live_01` run collected 76 `beforeModelUpdate` frames over a five-second observation window. 62 frames had a
running audio context and active playback. The native analyser read `mouthSync()` values in the range `0..1`; the
declared `ParamMouthOpenY` final value ranged from `0` to `0.4000000059604645`, matching the engine's configured
`lipSyncWeight = 0.4` contribution boundary. The page finished with no active audio and no page errors.

This confirms real Fish audio reaches the Lab and drives the existing native amplitude path for a Cubism 3 costume.
It does not establish phoneme accuracy, visible articulation quality, or a human-perceived synchronization score. The
same clip was also replayed from a local in-memory file during the existing native regression run for both `arbeit`
and `live_01`; those local-file cases passed their lifecycle, nonblank-canvas and mouth-movement assertions.

## Decision impact

The native path remains the control condition and fallback. The new Lab `MouthWriter` contract is still opt-in and
does not alter `speech-actions` or production renderer behavior. The automatic source decision remains staged:
buffered envelope plus locale-aware cues first, then a separately approved `wawa-lipsync` benchmark. No third-party
dependency or custom automatic driver is accepted by this observation alone.
