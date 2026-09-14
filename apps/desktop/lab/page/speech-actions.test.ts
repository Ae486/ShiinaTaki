import { describe, expect, it, vi } from "vitest";

import type { FrameContext, Overlay } from "../scene/frame-hooks.ts";
import type { LabScene, ModelContext } from "../scene/lab-scene.ts";
import { createSpeechActions } from "./speech-actions.ts";

function fixture() {
  let listener: Overlay | null = null;
  const manager = {
    currentAudio: undefined as { isPlaying: boolean; volume: number } | undefined,
    currentContext: { state: "running", resume: async () => undefined },
    currentAnalyzer: {},
    mouthSync: () => 0.5,
    stopSpeaking: () => { manager.currentAudio = undefined; },
  };
  const ctx = {
    internal: { motionManager: manager, options: { lipSyncGain: 1.5, lipSyncWeight: 0.4 }, lipSync: true },
    model: { speak: async () => { manager.currentAudio = { isPlaying: true, volume: 1 }; return true; } },
    hooks: { add: (_position: string, fn: Overlay) => { listener = fn; return () => { listener = null; }; } },
    facts: { lipSyncIds: ["MOUTH"] },
  } as unknown as ModelContext;
  const scene = { current: ctx, onModel: () => () => undefined, onBeforeDispose: () => () => undefined } as unknown as LabScene;
  const actions = createSpeechActions(scene, vi.fn());
  const frame = { nowMs: 10, params: { has: () => true, get: () => 0.9 } } as unknown as FrameContext;
  return { actions, frame: () => listener?.(frame) };
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
