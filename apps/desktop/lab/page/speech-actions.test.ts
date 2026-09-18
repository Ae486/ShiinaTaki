import { describe, expect, it, vi } from "vitest";

import type { FrameContext, Overlay } from "../scene/frame-hooks.ts";
import type { LabScene, ModelContext } from "../scene/lab-scene.ts";
import { createSpeechActions } from "./speech-actions.ts";

function fixture() {
  const listeners = new Set<Overlay>();
  const manager = {
    currentAudio: undefined as { isPlaying: boolean; volume: number } | undefined,
    currentContext: { state: "running", resume: async () => undefined },
    currentAnalyzer: {},
    mouthSync: () => 0.5,
    stopSpeaking: () => { manager.currentAudio = undefined; },
  };
  const options = { lipSyncGain: 1.5, lipSyncWeight: 0.4 };
  const ctx = {
    entry: { characterId: "taki", costume: "casual" },
    internal: { motionManager: manager, options, lipSync: true },
    model: { speak: async () => { manager.currentAudio = { isPlaying: true, volume: 1 }; return true; } },
    hooks: { add: (_position: string, fn: Overlay) => { listeners.add(fn); return () => { listeners.delete(fn); }; } },
    facts: { lipSyncIds: ["MOUTH"], generation: "cubism2" },
  } as unknown as ModelContext;
  const scene = { current: ctx, onModel: () => () => undefined, onBeforeDispose: () => () => undefined } as unknown as LabScene;
  const actions = createSpeechActions(scene, vi.fn());
  let value = 0.9;
  const frame = { nowMs: 10, params: { has: () => true, get: () => value } } as unknown as FrameContext;
  return { actions, options, manager, frame: (next = value) => { value = next; for (const fn of listeners) fn(frame); } };
}

describe("speech source observation ownership", () => {
  it("invalidates A's readings immediately when loading an unplayed B, before another render frame", async () => {
    const f = fixture();
    await f.actions.loadFile(new File([new Uint8Array(8)], "A.wav", { type: "audio/wav" }));
    expect(await f.actions.play()).toBe(true);
    f.frame();
    const a = f.actions.snapshot();
    expect(a.timing.observedAudioStartAtMs).not.toBeNull();
    expect(a.mouth.firstNonzeroMouthAtMs).not.toBeNull();
    expect(a.mouth.computedContribution).toBeGreaterThan(0);
    const loadingB = f.actions.loadFile(new File([new Uint8Array(16)], "B.wav", { type: "audio/wav" }));
    const immediate = f.actions.snapshot();
    expect(immediate.sequence).toBeGreaterThan(a.sequence);
    expect(immediate.timing).toEqual({ requestedAtMs: null, resolvedAtMs: null, observedAudioStartAtMs: null });
    expect(immediate.mouth).toMatchObject({ sampledAtMs: null, raw: null, computedClamped: null, computedContribution: null,
      firstNonzeroMouthAtMs: null, observedAudioToMouthMs: null, final: {} });
    await loadingB;
    const b = f.actions.snapshot();
    expect(b).toMatchObject({ status: "ready", clip: { name: "B.wav" }, timing: immediate.timing, mouth: immediate.mouth });
    f.frame();
    expect(f.actions.snapshot().mouth).toMatchObject({ raw: null, computedContribution: null, firstNonzeroMouthAtMs: null });
    f.actions.dispose();
  });
});

describe("comparison arms", () => {
  it("pins the engine defaults for native, follows the sliders elsewhere and reports the arm in effect", async () => {
    const f = fixture();
    expect(f.actions.snapshot().custom.mode).toBe("native");
    f.actions.configure({ volume: 0.5, gain: 3, weight: 1 });
    expect(f.options).toEqual({ lipSyncGain: 1.5, lipSyncWeight: 0.4 });
    expect(f.actions.snapshot().nativeArm).toEqual({ mode: "native", gain: 1.5, weight: 0.4, slidersLive: false });
    f.actions.setMouthMode("native-tuned");
    expect(f.options).toEqual({ lipSyncGain: 3, lipSyncWeight: 1 });
    expect(f.actions.snapshot().nativeArm).toEqual({ mode: "native-tuned", gain: 3, weight: 1, slidersLive: true });
    expect(f.actions.snapshot().custom.effectiveMode).toBe("native-tuned");
    f.actions.configure({ volume: 0.5, gain: 2, weight: 0.8 });
    expect(f.options).toEqual({ lipSyncGain: 2, lipSyncWeight: 0.8 });
    f.actions.setMouthMode("native");
    expect(f.options).toEqual({ lipSyncGain: 1.5, lipSyncWeight: 0.4 });
    f.actions.dispose();
  });

  it("collects per-arm final ranges only while audio plays and clears them on a new clip", async () => {
    const f = fixture();
    await f.actions.loadFile(new File([new Uint8Array(8)], "A.wav", { type: "audio/wav" }));
    f.frame(0.3);
    expect(f.actions.snapshot().ranges).toEqual({ native: null, "native-tuned": null, envelope: null });
    expect(await f.actions.play()).toBe(true);
    f.frame(0.1);
    f.frame(0.4);
    // A suspended AudioContext keeps the clip "playing" but its frames are not comparable across arms.
    f.manager.currentContext.state = "suspended";
    f.frame(0.7);
    f.manager.currentContext.state = "running";
    expect(f.actions.snapshot().ranges.native).toEqual({ MOUTH: { min: 0.1, max: 0.4, frames: 2 } });
    f.actions.stop();
    f.actions.setMouthMode("native-tuned");
    expect(await f.actions.play()).toBe(true);
    f.frame(0.9);
    const both = f.actions.snapshot().ranges;
    expect(both.native).toEqual({ MOUTH: { min: 0.1, max: 0.4, frames: 2 } });
    expect(both["native-tuned"]).toEqual({ MOUTH: { min: 0.9, max: 0.9, frames: 1 } });
    await f.actions.loadFile(new File([new Uint8Array(16)], "B.wav", { type: "audio/wav" }));
    expect(f.actions.snapshot().ranges).toEqual({ native: null, "native-tuned": null, envelope: null });
    f.actions.dispose();
  });
});
