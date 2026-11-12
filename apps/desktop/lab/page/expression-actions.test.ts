import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExpressionTarget } from "../scene/expression-control.ts";
import type { LabScene, ModelContext } from "../scene/lab-scene.ts";
import { createExpressionActions } from "./expression-actions.ts";

function harness() {
  const modelListeners: ((ctx: ModelContext) => void)[] = [];
  const disposeListeners: ((ctx: ModelContext) => void)[] = [];
  const expressions = [{ name: "smile" }, { name: "angry" }];
  const manager: ExpressionTarget = {
    expressions, currentExpression: {}, reserveExpressionIndex: -1, destroyed: false,
    getExpressionIndex: (name) => ["smile", "angry"].indexOf(name),
    setExpression: vi.fn(async (name) => {
      const index = manager.getExpressionIndex(name);
      if (index < 0) return false;
      manager.currentExpression = expressions[index];
      return true;
    }),
    resetExpression: vi.fn(), restoreExpression: vi.fn(),
  };
  const track = vi.fn();
  const ctx = {
    internal: { motionManager: { expressionManager: manager, isFinished: () => false }, parallelMotionManager: [] },
    facts: { faceParams: {
      smile: [{ id: "SMILE", value: 1, calc: "set", blend: "add" }],
      angry: [{ id: "ANGRY", value: -1, calc: "set", blend: "add" }],
    } },
    params: { has: () => true },
    sampler: { track, ids: () => [], snapshot: () => ({ samples: {
      SMILE: { before: -1, after: -1, final: 1 }, ANGRY: { before: 0, after: 0, final: -1 },
    } }) },
  } as unknown as ModelContext;
  const scene = {
    current: ctx as ModelContext | null,
    onModel: (fn: (ctx: ModelContext) => void) => { modelListeners.push(fn); return () => undefined; },
    onBeforeDispose: (fn: (ctx: ModelContext) => void) => { disposeListeners.push(fn); return () => undefined; },
  } as unknown as LabScene;
  const log = vi.fn();
  const actions = createExpressionActions(scene, log, vi.fn());
  for (const listener of modelListeners) listener(ctx);
  return { actions, log, manager, track, dispose: () => { for (const listener of disposeListeners) listener(ctx); } };
}

describe("expression action evidence lifecycle", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => vi.useRealTimers());

  it("tracks the last successful Set independently of the dropdown selection", async () => {
    const h = harness();
    h.actions.sample();
    expect(h.log).toHaveBeenLastCalledWith(expect.stringContaining("no successfully applied expression"));
    await h.actions.set("smile");
    h.actions.sample();
    expect(h.log).toHaveBeenLastCalledWith(expect.stringContaining("settling"));
    await vi.advanceTimersByTimeAsync(1300);
    expect(h.log).toHaveBeenLastCalledWith(expect.stringContaining("expression smile; SMILE"));
    h.actions.sample();
    expect(h.log).toHaveBeenLastCalledWith(expect.stringContaining("expression smile; SMILE"));
  });

  it("cancels automatic samples on reset, request replacement, failure and costume disposal", async () => {
    const h = harness();
    await h.actions.set("smile");
    h.actions.reset();
    h.log.mockClear();
    await vi.advanceTimersByTimeAsync(1300);
    expect(h.log).not.toHaveBeenCalled();
    await h.actions.set("smile");
    await h.actions.set("angry");
    h.log.mockClear();
    await vi.advanceTimersByTimeAsync(1300);
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveBeenLastCalledWith(expect.stringContaining("expression angry; ANGRY"));
    await h.actions.set("smile");
    await h.actions.set("missing");
    h.log.mockClear();
    await vi.advanceTimersByTimeAsync(1300);
    expect(h.log).not.toHaveBeenCalled();
    h.actions.sample();
    expect(h.log).toHaveBeenLastCalledWith(expect.stringContaining("no successfully applied expression"));
    await h.actions.set("smile");
    h.dispose();
    h.log.mockClear();
    await vi.advanceTimersByTimeAsync(1300);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("does not rearm the sampler or timer after a pending Set's costume is disposed", async () => {
    const h = harness();
    let resolve!: (success: boolean) => void;
    const pending = new Promise<boolean>((done) => { resolve = done; });
    vi.mocked(h.manager.setExpression).mockImplementationOnce(() => pending);
    const result = h.actions.set("smile");
    await Promise.resolve();
    h.dispose();
    resolve(true);
    await result;
    await vi.advanceTimersByTimeAsync(1300);
    expect(h.track).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });

  it("does not rearm a timer when Reset wins between engine completion and the panel continuation", async () => {
    for (let resetAt = 0; resetAt < 8; resetAt += 1) {
      const h = harness();
      const result = h.actions.set("smile");
      for (let turn = 0; turn < resetAt; turn += 1) await Promise.resolve();
      h.actions.reset();
      await result;
      expect(vi.getTimerCount(), `reset after ${resetAt} microtasks`).toBe(0);
      h.dispose();
    }
  });
});
