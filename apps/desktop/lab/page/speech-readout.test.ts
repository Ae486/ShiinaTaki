import { describe, expect, it } from "vitest";

import { emptyMouthSnapshot } from "../scene/native-speech-monitor.ts";
import type { SpeechPanelSnapshot } from "./speech-actions.ts";
import { renderSpeechSnapshot, updateSpeechButtons } from "./speech-readout.ts";

const snapshot: SpeechPanelSnapshot = { status: "no-audio", error: null, clip: null, inputStatus: "empty", hasModel: true,
  pendingNativeLoad: false, sequence: 0, audio: { isPlaying: false, contextState: null, analyzerAvailable: false, durationSeconds: null },
  timing: { requestedAtMs: null, resolvedAtMs: null, observedAudioStartAtMs: null }, mouth: emptyMouthSnapshot() };

describe("speech readout and commands", () => {
  it("keeps unavailable values unknown and labels observation delta rather than speaker latency", () => {
    const text = renderSpeechSnapshot(snapshot);
    expect(text).toContain("mouthSync observed: n/a");
    expect(text).toContain("not speaker latency");
    expect(text).not.toContain("0.000");
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
