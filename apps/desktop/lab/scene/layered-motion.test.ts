/**
 * INPUT:  a fake internalModel whose managers record startMotion calls and whose extendParallelMotionManager grows the
 *         parallel array like the engine does.
 * OUTPUT: assertions on primary vs channel-n routing (with ignoreParamIds/loop passed through), ensureChannels
 *         idempotence, and invalidateMotion writing undefined (never null) into the cache slot.
 * POS:    unit test for the lab's layered-motion module. No engine, no DOM. Exempt from caps.
 */

import { describe, expect, it, vi } from "vitest";

import { type ChannelManager, ensureChannels, invalidateMotion, type LayeredInternal, playLayered } from "./layered-motion.ts";

function fakeManager(): ChannelManager & { startMotion: ReturnType<typeof vi.fn> } {
  return { startMotion: vi.fn(() => Promise.resolve(true)) };
}

function fakeInternal(): LayeredInternal & { extend: ReturnType<typeof vi.fn> } {
  const parallel: ChannelManager[] = [];
  const extend = vi.fn((count: number) => {
    while (parallel.length < count) parallel.push(fakeManager());
  });
  return { motionManager: fakeManager(), parallelMotionManager: parallel, extendParallelMotionManager: extend, extend };
}

describe("ensureChannels", () => {
  it("grows once and is a no-op when enough channels exist", () => {
    const internal = fakeInternal();
    ensureChannels(internal, 2);
    ensureChannels(internal, 2);
    ensureChannels(internal, 1);
    expect(internal.parallelMotionManager).toHaveLength(2);
    expect(internal.extend).toHaveBeenCalledTimes(1);
  });
});

describe("playLayered", () => {
  it("routes channel primary to motionManager.startMotion with ignoreParamIds and loop", async () => {
    const internal = fakeInternal();
    const started = await playLayered(internal, {
      group: "angry01",
      index: 0,
      priority: 2,
      loop: true,
      channel: "primary",
      ignoreParamIds: ["PARAM_BROW_L_Y"],
    });
    expect(started).toBe(true);
    expect(internal.motionManager.startMotion).toHaveBeenCalledWith("angry01", 0, 2, { ignoreParamIds: ["PARAM_BROW_L_Y"], loop: true });
    expect(internal.parallelMotionManager).toHaveLength(0);
  });

  it("routes channel n to parallelMotionManager[n], extending to n+1 channels first", async () => {
    const internal = fakeInternal();
    await playLayered(internal, { group: "g", index: 1, priority: 3, channel: 1, ignoreParamIds: [] });
    expect(internal.extend).toHaveBeenCalledWith(2);
    expect(internal.parallelMotionManager).toHaveLength(2);
    expect((internal.parallelMotionManager[1] as ReturnType<typeof fakeManager>).startMotion).toHaveBeenCalledWith("g", 1, 3, {
      ignoreParamIds: [],
      loop: undefined,
    });
    expect((internal.parallelMotionManager[0] as ReturnType<typeof fakeManager>).startMotion).not.toHaveBeenCalled();
    expect(internal.motionManager.startMotion).not.toHaveBeenCalled();
  });
});

describe("invalidateMotion", () => {
  it("resets the slot to undefined — never null, which the engine reads as a failed load", () => {
    const cached = { name: "m" };
    const manager = { motionGroups: { idle01: [cached, cached], other: [cached] } };
    invalidateMotion(manager, "idle01", 1);
    expect(manager.motionGroups.idle01).toHaveLength(2);
    expect(manager.motionGroups.idle01[1]).toBeUndefined();
    expect(manager.motionGroups.idle01[1]).not.toBeNull();
    expect(manager.motionGroups.idle01[0]).toBe(cached);
    expect(manager.motionGroups.other[0]).toBe(cached);
  });

  it("ignores unknown groups and out-of-range indices", () => {
    const manager = { motionGroups: { idle01: [{}] } };
    invalidateMotion(manager, "missing", 0);
    invalidateMotion(manager, "idle01", 5);
    expect(manager.motionGroups.idle01).toHaveLength(1);
    expect(manager.motionGroups.idle01[0]).toBeDefined();
  });
});
