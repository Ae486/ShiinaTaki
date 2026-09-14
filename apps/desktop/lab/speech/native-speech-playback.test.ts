import { describe, expect, it, vi } from "vitest";

import { createNativeSpeechPlayback, type NativeSpeechTarget, type NativeSpeakOptions } from "./native-speech-playback.ts";
import type { SpeechClip } from "./speech-provider.ts";

const clip: SpeechClip = { bytes: new ArrayBuffer(8), mimeType: "audio/wav", providerId: "local-file", elapsedMs: 0 };

function harness() {
  const audio = { isPlaying: false, volume: 1 };
  const context = { state: "running", resume: vi.fn(async () => { context.state = "running"; }) };
  let options: NativeSpeakOptions | undefined;
  const target: NativeSpeechTarget = {
    manager: { currentAudio: undefined, currentContext: context, currentAnalyzer: {}, mouthSync: () => 0.5 },
    settings: { lipSyncGain: 1.5, lipSyncWeight: 0.4 },
    lipSyncEnabled: () => true,
    speak: vi.fn(async (_url, opts) => {
      options = opts;
      target.manager.currentAudio = audio;
      audio.isPlaying = true;
      return true;
    }),
    stop: vi.fn(() => { audio.isPlaying = false; target.manager.currentAudio = undefined; }),
  };
  let clock = 100;
  const deps = { now: () => clock, createUrl: vi.fn(() => "blob:clip"), revokeUrl: vi.fn(), log: vi.fn() };
  const playback = createNativeSpeechPlayback(deps);
  playback.attach(target);
  return { playback, target, deps, audio, context, options: () => options, time: (value: number) => { clock = value; } };
}

describe("native speech playback lifecycle", () => {
  it("plays and replays one retained clip using only native speak, preserving expressions", async () => {
    const h = harness();
    expect(await h.playback.play(clip)).toBe(true);
    expect(h.options()?.resetExpression).toBe(false);
    expect(h.playback.snapshot().status).toBe("playing");
    h.playback.stop();
    expect(h.playback.snapshot().status).toBe("stopped");
    expect(h.deps.revokeUrl).toHaveBeenCalledTimes(1);
    expect(await h.playback.play(clip)).toBe(true);
    h.playback.dispose();
    h.playback.dispose();
    expect(h.deps.revokeUrl).toHaveBeenCalledTimes(2);
  });

  it("holds a pending-load lock after Stop and retires late audio before a new speak is allowed", async () => {
    const h = harness();
    let complete!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { complete = resolve; });
    vi.mocked(h.target.speak).mockImplementationOnce(() => pending);
    const first = h.playback.play(clip);
    h.playback.stop();
    expect(h.playback.snapshot().pendingNativeLoad).toBe(true);
    expect(h.deps.revokeUrl).not.toHaveBeenCalled();
    expect(await h.playback.play(clip)).toBe(false);
    h.target.manager.currentAudio = h.audio;
    h.audio.isPlaying = true;
    complete(true);
    expect(await first).toBe(false);
    expect(h.audio.isPlaying).toBe(false);
    expect(h.playback.snapshot().pendingNativeLoad).toBe(false);
    expect(h.deps.revokeUrl).toHaveBeenCalledTimes(1);
    expect(await h.playback.play(clip)).toBe(true);
  });

  it("stops a retired old-model manager after disposal without writing the new model's state", async () => {
    const h = harness();
    const newer = harness();
    let complete!: (value: boolean) => void;
    vi.mocked(h.target.speak).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const result = h.playback.play(clip);
    h.playback.attach(null);
    h.playback.attach(newer.target);
    expect(await h.playback.play(clip)).toBe(false);
    h.target.manager.currentAudio = h.audio;
    complete(true);
    expect(await result).toBe(false);
    expect(h.target.manager.currentAudio).toBeUndefined();
    expect(newer.target.stop).not.toHaveBeenCalled();
    expect(await h.playback.play(clip)).toBe(true);
  });

  it("reports suspended actual audio as suspended and resumes the engine's own context", async () => {
    const h = harness();
    h.context.state = "suspended";
    h.context.resume.mockImplementation(async () => undefined);
    await h.playback.play(clip);
    expect(h.playback.snapshot().status).toBe("suspended");
    h.context.resume.mockImplementation(async () => { h.context.state = "running"; });
    await h.playback.resume();
    expect(h.playback.snapshot().status).toBe("playing");
    expect(h.playback.snapshot().audio.contextState).toBe("running");
  });

  it("does not resurrect finished/error callbacks that arrive before speak resolves", async () => {
    const h = harness();
    vi.mocked(h.target.speak).mockImplementationOnce(async (_url, opts) => { opts.onFinish(); return true; });
    await h.playback.play(clip);
    expect(h.playback.snapshot().status).toBe("stopped");
    vi.mocked(h.target.speak).mockImplementationOnce(async (_url, opts) => { opts.onError(new Error("bad audio")); return false; });
    expect(await h.playback.play(clip)).toBe(false);
    expect(h.playback.snapshot().status).toBe("error");
    expect(h.deps.revokeUrl).toHaveBeenCalledTimes(2);
  });

  it("rejects busy playback, updates live volume/gain/weight, and ignores old callbacks", async () => {
    const h = harness();
    await h.playback.play(clip);
    const oldFinish = h.options()?.onFinish;
    expect(await h.playback.play(clip)).toBe(false);
    h.playback.configure({ volume: 0.6, gain: 2, weight: 0.3 });
    expect(h.audio.volume).toBe(0.6);
    expect(h.target.settings).toEqual({ lipSyncGain: 2, lipSyncWeight: 0.3 });
    h.playback.stop();
    await h.playback.play(clip);
    oldFinish?.();
    expect(h.playback.snapshot().status).toBe("playing");
  });

  it("starts a fresh observation generation on reset and does not refill its timing from a retired load", async () => {
    const h = harness();
    await h.playback.play(clip);
    expect(h.playback.snapshot().timing.observedAudioStartAtMs).toBe(100);
    h.playback.stop();
    let complete!: (value: boolean) => void;
    vi.mocked(h.target.speak).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const pendingA = h.playback.play(clip);
    const priorSequence = h.playback.snapshot().sequence;
    h.playback.reset();
    const unplayedB = h.playback.snapshot();
    expect(unplayedB.sequence).toBeGreaterThan(priorSequence);
    expect(unplayedB.timing).toEqual({ requestedAtMs: null, resolvedAtMs: null, observedAudioStartAtMs: null });
    h.time(500);
    h.target.manager.currentAudio = h.audio;
    h.audio.isPlaying = true;
    complete(true);
    expect(await pendingA).toBe(false);
    expect(h.playback.snapshot()).toMatchObject({ sequence: unplayedB.sequence, timing: unplayedB.timing, pendingNativeLoad: false });
    expect(h.audio.isPlaying).toBe(false);
  });
});
