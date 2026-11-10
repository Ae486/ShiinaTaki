import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostumeSceneObserver } from "./costume-scene-observer.ts";
import { IDLE, reduceCostumeSelect } from "./costume-select-state.ts";

function harness() {
  let state = IDLE;
  const request = vi.fn<(requestId: string) => Promise<void>>().mockResolvedValue(undefined);
  const error = vi.fn();
  const observer = new CostumeSceneObserver({ request, error, timeoutMs: () => 100,
    observe: (costumeId) => { state = reduceCostumeSelect(state, { kind: "observed", costumeId }); } });
  return { observer, request, error, state: () => state, id: () => request.mock.lastCall?.[0] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Home's actual worn-costume observation", () => {
  it("starts unknown, reads an already-mounted Pet on reopen and preserves an explicit empty scene", () => {
    const h = harness();
    expect(h.state().selected).toBeNull();
    h.observer.start();
    expect(h.state().selected).toBeNull();
    h.observer.receive({ requestId: h.id(), costumeId: "actually-worn" });
    expect(h.state().selected).toBe("actually-worn");
    h.observer.refresh();
    expect(h.state().selected).toBeNull();
    h.observer.receive({ requestId: h.id(), costumeId: null });
    expect(h.state().selected).toBeNull();
    h.observer.stop();
  });

  it("rejects a pre-switch snapshot after success invalidates it", () => {
    const h = harness();
    h.observer.start();
    const old = h.id();
    h.observer.refresh(); // The successful switch/scene-changed boundary retires the covering read.
    h.observer.receive({ requestId: old, costumeId: "old" });
    expect(h.state().selected).toBeNull();
    h.observer.receive({ requestId: h.id(), costumeId: "new" });
    expect(h.state().selected).toBe("new");
    h.observer.receive({ requestId: old, costumeId: "old" });
    expect(h.state().selected).toBe("new");
    h.observer.stop();
  });

  it("retires hidden/disposed work and makes a fresh read when Home returns", () => {
    const h = harness();
    h.observer.start();
    const old = h.id();
    h.observer.receive({ requestId: old, costumeId: "before-hide" });
    expect(h.state().selected).toBe("before-hide");
    h.observer.stop();
    expect(h.state().selected).toBeNull();
    h.observer.receive({ requestId: old, costumeId: "retired" });
    h.observer.refresh();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    h.observer.start();
    expect(h.id()).not.toBe(old);
    h.observer.receive({ requestId: old, costumeId: "retired" });
    h.observer.receive({ requestId: h.id(), costumeId: "after-reload" });
    expect(h.state().selected).toBe("after-reload");
    h.observer.stop();
  });

  it("bounds absent-Pet reads without a poll or a late timeout overwriting a newer read", async () => {
    const h = harness();
    h.observer.start();
    const old = h.id();
    await vi.advanceTimersByTimeAsync(50);
    h.observer.refresh();
    await vi.advanceTimersByTimeAsync(50);
    expect(h.error).not.toHaveBeenCalledWith(expect.stringContaining("超时"));
    await vi.advanceTimersByTimeAsync(50);
    expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining("超时"));
    h.observer.receive({ requestId: old, costumeId: "late" });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.state().selected).toBeNull();
    h.observer.stop();
  });

  it("ignores malformed, uncorrelated and duplicate snapshots", () => {
    const h = harness();
    h.observer.start();
    for (const payload of [null, {}, { requestId: h.id() }, { requestId: "other", costumeId: "fake" },
      { requestId: h.id(), costumeId: "" }, { requestId: h.id(), costumeId: 1 }]) h.observer.receive(payload);
    expect(h.state().selected).toBeNull();
    const id = h.id();
    h.observer.receive({ requestId: id, costumeId: "real" });
    h.observer.receive({ requestId: id, costumeId: "duplicate" });
    expect(h.state().selected).toBe("real");
    h.observer.stop();
  });

  it("clears a destroyed Pet without waiting for React cleanup and permits a later ready notification", () => {
    const h = harness();
    h.observer.start();
    const old = h.id();
    h.observer.receive({ requestId: old, costumeId: "before-close" });
    h.observer.unavailable();
    expect(h.state().selected).toBeNull();
    h.observer.receive({ requestId: old, costumeId: "before-close" });
    expect(h.state().selected).toBeNull();
    h.observer.refresh();
    h.observer.receive({ requestId: h.id(), costumeId: null });
    expect(h.error).toHaveBeenLastCalledWith(null);
    h.observer.stop();
  });

  it("reports delivery failure without choosing a default or issuing another request", async () => {
    const h = harness();
    h.request.mockRejectedValueOnce(new Error("Pet missing"));
    h.observer.start();
    await Promise.resolve();
    expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining("无法读取"));
    expect(h.state().selected).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(h.request).toHaveBeenCalledTimes(1);
    h.observer.stop();
  });
});
