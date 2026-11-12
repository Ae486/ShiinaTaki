import { describe, expect, it, vi } from "vitest";

import type { LayeredMotionRequest } from "./layered-motion.ts";
import { createMotionPlayback, type PlaybackManager } from "./motion-playback.ts";

const request: LayeredMotionRequest = { group: "angry", index: 0, priority: 3, channel: "primary", loop: true, ignoreParamIds: ["FACE"] };

function fakeManager() {
  const listeners = new Map<string, Set<() => void>>();
  let finished = true;
  let complete = true;
  const manager: PlaybackManager = {
    destroyed: false,
    startMotion: vi.fn(async () => {
      if (!complete) return false;
      finished = false;
      return true;
    }),
    stopAllMotions: vi.fn(() => { finished = true; }),
    isFinished: () => finished,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
    },
    off(event, listener) { listeners.get(event)?.delete(listener); },
  };
  const finish = () => {
    finished = true;
    complete = false;
    for (const fn of listeners.get("motionFinish") ?? []) fn();
    complete = true;
  };
  return { manager, finish, listeners };
}

function harness(generation: "cubism2" | "cubism3" = "cubism2") {
  const primary = fakeManager();
  const parallel = [fakeManager(), fakeManager(), fakeManager()];
  const internal = { motionManager: primary.manager, parallelMotionManager: parallel.map((p) => p.manager), extendParallelMotionManager: vi.fn() };
  const log = vi.fn();
  return { primary, parallel, log, control: createMotionPlayback(internal, generation, log) };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("lab C2 replay loop", () => {
  it("replays after the engine completes its state, including each parallel channel", async () => {
    const h = harness();
    await h.control.play(request);
    for (let channel = 0; channel < 3; channel += 1) await h.control.play({ ...request, channel });
    h.primary.finish();
    for (const channel of h.parallel) channel.finish();
    await flush();
    for (const channel of [h.primary, ...h.parallel]) {
      expect(channel.manager.startMotion).toHaveBeenCalledTimes(2);
      expect(channel.manager.startMotion).toHaveBeenLastCalledWith("angry", 0, 3, { ignoreParamIds: ["FACE"], loop: false });
    }
  });

  it("leaves C3 looping to the engine", async () => {
    const h = harness("cubism3");
    await h.control.play(request);
    h.primary.finish();
    await flush();
    expect(h.primary.manager.startMotion).toHaveBeenCalledTimes(1);
    expect(h.primary.manager.startMotion).toHaveBeenCalledWith("angry", 0, 3, { ignoreParamIds: ["FACE"], loop: true });
  });

  it("replaces a loop on one channel and does not reuse the old request", async () => {
    const h = harness();
    await h.control.play(request);
    await h.control.play({ ...request, group: "idle", ignoreParamIds: [] });
    h.primary.finish();
    await flush();
    expect(h.primary.manager.startMotion).toHaveBeenLastCalledWith("idle", 0, 3, { ignoreParamIds: [], loop: false });
    await h.control.play({ ...request, loop: false });
    h.primary.finish();
    await flush();
    expect(h.primary.manager.startMotion).toHaveBeenCalledTimes(4);
  });

  it("cancels queued replay on Stop all and clears finish listeners on disposal", async () => {
    const h = harness();
    await h.control.play(request);
    h.primary.finish();
    h.control.stopAll();
    await flush();
    expect(h.primary.manager.startMotion).toHaveBeenCalledTimes(1);
    expect(h.primary.manager.isFinished()).toBe(true);
    await h.control.play(request);
    h.primary.finish();
    h.control.dispose();
    await flush();
    expect(h.primary.listeners.get("motionFinish")?.size).toBe(0);
    expect(h.primary.manager.startMotion).toHaveBeenCalledTimes(2);
    expect(await h.control.play(request)).toBe(false);
  });

  it("stops late async starts after Stop all and orders a replacement after stale cleanup", async () => {
    const h = harness();
    let resolve!: (value: boolean) => void;
    const pending = new Promise<boolean>((done) => { resolve = done; });
    vi.mocked(h.primary.manager.startMotion).mockImplementationOnce(() => pending);
    const first = h.control.play({ ...request, priority: 1 });
    await flush();
    h.control.stopAll();
    const second = h.control.play({ ...request, group: "idle" });
    resolve(true);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    const lastStop = vi.mocked(h.primary.manager.stopAllMotions).mock.invocationCallOrder.at(-1);
    const replacementStart = vi.mocked(h.primary.manager.startMotion).mock.invocationCallOrder.at(-1);
    expect(lastStop).toBeLessThan(replacementStart!);
    expect(h.primary.manager.isFinished()).toBe(false);
  });

  it("catches delayed engine rejection after costume disposal without touching the destroyed manager", async () => {
    const h = harness();
    let reject!: (error: Error) => void;
    const pending = new Promise<boolean>((_, fail) => { reject = fail; });
    vi.mocked(h.primary.manager.startMotion).mockImplementationOnce(() => pending);
    const first = h.control.play(request);
    await flush();
    h.control.dispose();
    h.primary.manager.destroyed = true;
    reject(new Error("queue destroyed"));
    expect(await first).toBe(false);
    expect(h.log).not.toHaveBeenCalled();
    expect(h.primary.manager.stopAllMotions).toHaveBeenCalledTimes(1);
  });
});
