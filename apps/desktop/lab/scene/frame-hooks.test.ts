/**
 * INPUT:  a fake emitter (records on/off, fires by name), a stub ParamAccess and an injected clock.
 * OUTPUT: assertions on listener registration, overlay add/dispose/clear, dt between beforeMotionUpdate firings shared
 *         across the frame's later positions, throwing-overlay ejection, and dispose (offs listeners; add throws).
 * POS:    unit test for the lab's frame-hook registry. No engine import. Exempt from caps.
 */

import { describe, expect, it, vi } from "vitest";

import { createFrameHooks, type FrameContext } from "./frame-hooks.ts";
import type { ParamAccess } from "./param-access.ts";

const PARAMS = { generation: "cubism2" } as unknown as ParamAccess;

function fakeEmitter() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    on: vi.fn((event: string, fn: () => void) => {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(fn));
    }),
    off: vi.fn((event: string, fn: () => void) => void listeners.get(event)?.delete(fn)),
    fire(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
    frame() {
      this.fire("beforeMotionUpdate");
      this.fire("afterMotionUpdate");
      this.fire("beforeModelUpdate");
    },
  };
}

describe("createFrameHooks", () => {
  it("subscribes the three engine events once and runs overlays only at their position", () => {
    const emitter = fakeEmitter();
    const hooks = createFrameHooks(emitter, PARAMS, () => 0);
    expect(emitter.on.mock.calls.map(([e]) => e)).toEqual(["beforeMotionUpdate", "afterMotionUpdate", "beforeModelUpdate"]);
    const before = vi.fn();
    const final = vi.fn();
    hooks.add("beforeMotionUpdate", before);
    hooks.add("beforeModelUpdate", final);
    emitter.fire("afterMotionUpdate");
    expect(before).not.toHaveBeenCalled();
    emitter.frame();
    expect(before).toHaveBeenCalledTimes(1);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it("measures dt between consecutive beforeMotionUpdate firings and shares it with the frame's later positions", () => {
    const emitter = fakeEmitter();
    let t = 1000;
    const hooks = createFrameHooks(emitter, PARAMS, () => t);
    const seen: FrameContext[] = [];
    hooks.add("afterMotionUpdate", (ctx) => void seen.push(ctx));
    emitter.frame();
    t = 1016;
    emitter.frame();
    expect(seen.map((c) => [c.nowMs, c.dtMs])).toEqual([
      [1000, 0],
      [1016, 16],
    ]);
    expect(seen[0]?.params).toBe(PARAMS);
  });

  it("removes an overlay through its dispose fn and everything through clear()", () => {
    const emitter = fakeEmitter();
    const hooks = createFrameHooks(emitter, PARAMS, () => 0);
    const a = vi.fn();
    const b = vi.fn();
    const offA = hooks.add("beforeMotionUpdate", a);
    hooks.add("beforeMotionUpdate", b);
    offA();
    emitter.frame();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    hooks.clear();
    emitter.frame();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("ejects a throwing overlay instead of breaking the frame", () => {
    const emitter = fakeEmitter();
    const hooks = createFrameHooks(emitter, PARAMS, () => 0);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    hooks.add("beforeModelUpdate", bad);
    hooks.add("beforeModelUpdate", good);
    emitter.frame();
    emitter.frame();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("dispose offs the listeners, is idempotent, and makes further add() throw", () => {
    const emitter = fakeEmitter();
    const hooks = createFrameHooks(emitter, PARAMS, () => 0);
    const fn = vi.fn();
    hooks.add("afterMotionUpdate", fn);
    hooks.dispose();
    hooks.dispose();
    expect(emitter.off).toHaveBeenCalledTimes(3);
    expect([...emitter.listeners.values()].every((set) => set.size === 0)).toBe(true);
    emitter.frame();
    expect(fn).not.toHaveBeenCalled();
    expect(() => hooks.add("afterMotionUpdate", fn)).toThrow(/after dispose/u);
  });
});
