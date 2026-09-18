import { describe, expect, it } from "vitest";

import { emptyMouthSnapshot } from "../scene/native-speech-monitor.ts";
import type { SpeechPanelSnapshot } from "./speech-actions.ts";
import { renderSpeechSnapshot, updateSpeechButtons } from "./speech-readout.ts";

const snapshot: SpeechPanelSnapshot = { status: "no-audio", error: null, clip: null, inputStatus: "empty", hasModel: true,
  pendingNativeLoad: false, sequence: 0, audio: { isPlaying: false, contextState: null, analyzerAvailable: false, durationSeconds: null },
  timing: { requestedAtMs: null, resolvedAtMs: null, observedAudioStartAtMs: null }, mouth: emptyMouthSnapshot(),
  custom: { mode: "envelope", effectiveMode: "native", profileId: null, preview: "off", writer: null,
    preparation: { status: "empty", decodeMs: null, envelopeMs: null, durationMs: null, error: null },
    clock: { positionMs: null, source: null, contextState: null }, fallbackReason: "No calibrated profile for this character/costume" },
  nativeArm: { mode: "envelope", gain: null, weight: null, slidersLive: true },
  ranges: { native: null, "native-tuned": null, envelope: null } };

describe("speech readout and commands", () => {
  it("keeps unavailable values unknown and labels observation delta rather than speaker latency", () => {
    const text = renderSpeechSnapshot(snapshot);
    expect(text).toContain("mouthSync observed: n/a");
    expect(text).toContain("not speaker latency");
    expect(text).toContain("mouth ranges: n/a");
    expect(text).toContain("native arm: gain n/a / weight n/a (sliders); sliders live");
    expect(text).not.toContain("0.000");
  });

  it("renders the three arms side by side per parameter and the locked engine-default arm", () => {
    const text = renderSpeechSnapshot({ ...snapshot,
      nativeArm: { mode: "native", gain: 1.5, weight: 0.4, slidersLive: false },
      ranges: { native: { PARAM_MOUTH_OPEN_Y: { min: 0, max: 0.4, frames: 255 } }, "native-tuned": null,
        envelope: { PARAM_MOUTH_OPEN_Y: { min: 0, max: 0.673, frames: 220 }, PARAM_MOUTH_FORM_01: { min: -0.5, max: 0, frames: 220 } } } });
    expect(text).toContain("native arm: gain 1.500 / weight 0.400 (engine defaults); sliders locked");
    expect(text).toContain("range PARAM_MOUTH_OPEN_Y: native 0.000..0.400 (255f) | native-tuned n/a | envelope 0.000..0.673 (220f)");
    expect(text).toContain("range PARAM_MOUTH_FORM_01: native n/a | native-tuned n/a | envelope -0.500..0.000 (220f)");
    expect(text).not.toContain("mouth ranges: n/a");
  });

  it("renders the custom mouth state with its fallback reason and unavailable clock", () => {
    const text = renderSpeechSnapshot(snapshot);
    expect(text).toContain("mouth mode: envelope (effective native); profile: none");
    expect(text).toContain("fallback: No calibrated profile for this character/costume");
    expect(text).toContain("envelope: empty");
    expect(text).toContain("audio clock: n/a ms (n/a)");
    expect(text).toContain("custom writer: detached");
    const ready = renderSpeechSnapshot({ ...snapshot, custom: { ...snapshot.custom, profileId: "taki/arbeit", fallbackReason: null,
      preparation: { status: "ready", decodeMs: 20.13, envelopeMs: 2.2, durationMs: 4086.7, error: null },
      clock: { positionMs: 512.5, source: "pixi-sound-progress", contextState: "running" },
      writer: { enabled: true, active: true, fallback: false, elapsedMs: 512.5, source: "envelope", skippedIds: [], mapped: null,
        sample: { mouth: "open", openness: 0.6, confidence: 1, active: true }, writes: [{ id: "PARAM_MOUTH_OPEN_Y", value: 0.48 }] } } });
    expect(ready).toContain("profile: taki/arbeit");
    expect(ready).toContain("envelope: ready (decode 20.130 ms, analysis 2.200 ms, 4086.700 ms clip)");
    expect(ready).toContain("audio clock: 512.500 ms (pixi-sound-progress)");
    expect(ready).toContain("custom writer: active; PARAM_MOUTH_OPEN_Y=0.480");
    expect(ready).not.toContain("fallback:");
  });

  it("blocks overlapping speak while a stopped native load retires and offers resume only for actual suspension", () => {
    const buttons = { synthesize: { disabled: false }, play: { disabled: false }, stop: { disabled: false }, resume: { disabled: false }, file: { disabled: false } };
    const controls = buttons as unknown as Parameters<typeof updateSpeechButtons>[0];
    updateSpeechButtons(controls, { ...snapshot, status: "stopped", pendingNativeLoad: true });
    expect(buttons.play.disabled).toBe(true);
    expect(buttons.synthesize.disabled).toBe(true);
    expect(buttons.stop.disabled).toBe(false);
    expect(buttons.resume.disabled).toBe(true);
    updateSpeechButtons(controls, { ...snapshot, status: "suspended", audio: { ...snapshot.audio, contextState: "suspended" } });
    expect(buttons.resume.disabled).toBe(false);
  });
});
