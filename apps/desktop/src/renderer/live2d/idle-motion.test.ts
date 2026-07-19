/**
 * INPUT:  a fake model (controllable isFinished/currentPriority/definitions) driven under vi fake timers.
 * OUTPUT: assertions that the scheduler derives the pool by name, plays IDLE one-shots when nothing is playing, holds
 *         while a foreground motion plays, returns to idle promptly after a foreground one-shot, disposes when stale,
 *         and stays dormant with no idle-pool motions (1a).
 * POS:    unit test for the framework-free Idle Motion scheduler. Engine mocked so MotionPriority loads in node. Exempt from caps.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("untitled-pixi-live2d-engine", () => ({
  MotionPriority: { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 },
}));

import { createIdleMotionScheduler, deriveIdlePool, type IdleMotionDeps } from "./idle-motion.ts";

interface Ctrl {
  finished: boolean;
  priority: number;
  destroyed: boolean;
}

function fakeModel(definitions: Record<string, unknown[]>, ctrl: Ctrl) {
  const motion = vi.fn();
  const model = {
    motion,
    internalModel: {
      motionManager: {
        definitions,
        isFinished: () => ctrl.finished,
        get destroyed() {
          return ctrl.destroyed;
        },
        state: {
          get currentPriority() {
            return ctrl.priority;
          },
        },
      },
    },
  };
  return { model: model as unknown as IdleMotionDeps["model"], motion };
}

const IDLE_DEFS = { mtn_idle01_C: [], mtn_idle01_L: [], mtn_smile01_C: [] };

afterEach(() => {
  vi.useRealTimers();
});

describe("deriveIdlePool", () => {
  it("selects only the idle-named motion groups (case-insensitive: taki mtn_idle + C3 convention Idle)", () => {
    expect(deriveIdlePool({ mtn_idle01_C: [], mtn_smile01_C: [], Idle: [] })).toEqual(["mtn_idle01_C", "Idle"]);
  });

  it("returns empty when no group name reads as idle", () => {
    expect(deriveIdlePool({ mtn_smile01_C: [], mtn_angry01_C: [] })).toEqual([]);
  });
});

describe("createIdleMotionScheduler", () => {
  it("plays an idle-pool one-shot at IDLE priority once nothing is playing and the gap elapsed", () => {
    vi.useFakeTimers();
    const { model, motion } = fakeModel(IDLE_DEFS, { finished: true, priority: 0, destroyed: false });
    createIdleMotionScheduler({ model, isStale: () => false });
    vi.advanceTimersByTime(20_000); // past MAX_GAP so the random gap has certainly elapsed
    expect(motion).toHaveBeenCalledTimes(1);
    const [name, index, priority, options] = motion.mock.calls[0]!;
    expect(["mtn_idle01_C", "mtn_idle01_L"]).toContain(name);
    expect(index).toBeUndefined();
    expect(priority).toBe(1); // MotionPriority.IDLE
    expect(options).toEqual({ loop: false });
  });

  it("does not play an idle motion while a foreground motion is playing", () => {
    vi.useFakeTimers();
    const { model, motion } = fakeModel(IDLE_DEFS, { finished: false, priority: 2, destroyed: false });
    createIdleMotionScheduler({ model, isStale: () => false });
    vi.advanceTimersByTime(20_000);
    expect(motion).not.toHaveBeenCalled();
  });

  it("returns to idle promptly after a foreground one-shot finishes (no 4-12s wait)", () => {
    vi.useFakeTimers();
    const ctrl = { finished: false, priority: 2, destroyed: false };
    const { model, motion } = fakeModel(IDLE_DEFS, ctrl);
    createIdleMotionScheduler({ model, isStale: () => false });
    vi.advanceTimersByTime(2_100); // a few ticks of a foreground motion playing (well under MIN_GAP)
    expect(motion).not.toHaveBeenCalled();
    ctrl.finished = true; // the one-shot ended
    vi.advanceTimersByTime(800); // one tick later
    expect(motion).toHaveBeenCalledTimes(1); // prompt return to idle, not gap-delayed
  });

  it("disposes on staleness and stops touching the model", () => {
    vi.useFakeTimers();
    const { model, motion } = fakeModel(IDLE_DEFS, { finished: true, priority: 0, destroyed: false });
    let stale = false;
    createIdleMotionScheduler({ model, isStale: () => stale });
    stale = true;
    vi.advanceTimersByTime(20_000);
    expect(motion).not.toHaveBeenCalled();
  });

  it("stays dormant (never plays) with no idle-pool motions", () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { model, motion } = fakeModel({ mtn_smile01_C: [], mtn_angry01_C: [] }, { finished: true, priority: 0, destroyed: false });
    createIdleMotionScheduler({ model, isStale: () => false });
    vi.advanceTimersByTime(20_000);
    expect(motion).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("stops ticking after dispose() via the returned handle", () => {
    vi.useFakeTimers();
    const { model, motion } = fakeModel(IDLE_DEFS, { finished: true, priority: 0, destroyed: false });
    const scheduler = createIdleMotionScheduler({ model, isStale: () => false });
    scheduler.dispose();
    vi.advanceTimersByTime(20_000);
    expect(motion).not.toHaveBeenCalled();
  });
});
