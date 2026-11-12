import { describe, expect, it, vi } from "vitest";

import { createNativeSpeechPlayback, type NativeSpeechTarget } from "../speech/native-speech-playback.ts";
import type { FrameContext, FrameHooks, Overlay } from "./frame-hooks.ts";
import { createNativeSpeechMonitor } from "./native-speech-monitor.ts";

function fixture() {
  let listener: Overlay | null = null;
  const off = vi.fn(() => { listener = null; });
  const hooks: FrameHooks = { add: (_position, fn) => { listener = fn; return off; }, clear: () => undefined, dispose: () => undefined };
  const target: NativeSpeechTarget = {
    manager: { mouthSync: vi.fn(() => 0.2), currentAudio: undefined, currentAnalyzer: undefined,
      currentContext: { state: "running", resume: async () => undefined } },
    settings: { lipSyncGain: 1.5, lipSyncWeight: 0.4 }, lipSyncEnabled: () => true,
    speak: async () => { target.manager.currentAudio = { isPlaying: true, volume: 1 }; return true; },
    stop: () => { target.manager.currentAudio = undefined; },
  };
  const playback = createNativeSpeechPlayback({ now: () => 100, createUrl: () => "blob:test", revokeUrl: () => undefined });
  playback.attach(target);
  const monitor = createNativeSpeechMonitor({ hooks, target, ids: ["MOUTH", "MISSING"], playback }, () => 104);
  const frame: FrameContext = { nowMs: 96, dtMs: 16, params: {
    generation: "cubism3", has: (id) => id === "MOUTH", get: () => 0.9, set: () => undefined, add: () => undefined, mult: () => undefined, listIds: () => ["MOUTH"],
  } };
  return { target, playback, monitor, frame: () => listener?.(frame), off };
}

describe("native speech observations", () => {
  it("does not report the engine's absent-analyzer zero as measured silence", () => {
    const f = fixture();
    f.target.manager.currentAudio = { isPlaying: true, volume: 1 };
    f.frame();
    expect(f.target.manager.mouthSync).not.toHaveBeenCalled();
    expect(f.monitor.snapshot()).toMatchObject({ raw: null, computedContribution: null, final: { MOUTH: 0.9, MISSING: null } });
  });

  it("keeps independently observed final mouth values separate from calculated contribution and speaker latency", async () => {
    const f = fixture();
    f.target.manager.currentAnalyzer = {};
    await f.playback.play({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", providerId: "local-file", elapsedMs: 0 });
    f.frame();
    const observed = f.monitor.snapshot();
    expect(observed.raw).toBe(0.2);
    expect(observed.computedContribution).toBeCloseTo((0.2 * 1.5) ** 1.15 * 0.4);
    expect(observed.final.MOUTH).toBe(0.9);
    expect(observed.firstNonzeroMouthAtMs).toBe(104);
    expect(observed.observedAudioToMouthMs).toBe(4);
    f.playback.stop();
    f.frame();
    expect(f.monitor.snapshot().raw).toBeNull();
    f.monitor.dispose();
    f.monitor.dispose();
    expect(f.off).toHaveBeenCalled();
  });

  it("does not claim a first lip-sync contribution from positive analyzer samples when native output is disabled", async () => {
    for (const mute of ["gain", "weight", "lipSync"] as const) {
      const f = fixture();
      f.target.manager.currentAnalyzer = {};
      if (mute === "gain") f.playback.configure({ volume: 1, gain: 0, weight: 0.4 });
      if (mute === "weight") f.playback.configure({ volume: 1, gain: 1.5, weight: 0 });
      if (mute === "lipSync") f.target.lipSyncEnabled = () => false;
      await f.playback.play({ bytes: new ArrayBuffer(8), mimeType: "audio/wav", providerId: "local-file", elapsedMs: 0 });
      f.frame();
      expect(f.monitor.snapshot().raw).toBe(0.2);
      expect(f.monitor.snapshot().firstNonzeroMouthAtMs).toBeNull();
      expect(f.monitor.snapshot().observedAudioToMouthMs).toBeNull();
      f.monitor.dispose();
      f.playback.dispose();
    }
  });
});
