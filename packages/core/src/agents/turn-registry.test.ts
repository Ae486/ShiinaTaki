import { describe, expect, it, vi } from "vitest";
import { createTurnRegistry } from "./turn-registry.ts";

describe("createTurnRegistry", () => {
  it("cancel aborts the active turn's signal and reports true", () => {
    const registry = createTurnRegistry();
    const controller = registry.begin("taki");

    expect(registry.cancel("taki")).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("cancel is false when the character has no active turn (idempotent)", () => {
    const registry = createTurnRegistry();
    expect(registry.cancel("taki")).toBe(false);

    const controller = registry.begin("taki");
    registry.end("taki", controller);
    expect(registry.cancel("taki")).toBe(false);
  });

  it("a second cancel of the same turn reports false (already aborted)", () => {
    const registry = createTurnRegistry();
    registry.begin("taki");
    expect(registry.cancel("taki")).toBe(true);
    expect(registry.cancel("taki")).toBe(false);
  });

  it("refuses replacement and late cleanup cannot evict a subsequent registered controller", () => {
    const registry = createTurnRegistry();
    const stale = registry.begin("taki");
    expect(() => registry.begin("taki")).toThrow("TURN_SCOPE_OCCUPIED");
    registry.end("taki", stale);
    const current = registry.begin("taki");

    registry.end("taki", stale); // late cleanup from an earlier turn must not evict the live one
    expect(registry.cancel("taki")).toBe(true);
    expect(current.signal.aborted).toBe(true);
    expect(stale.signal.aborted).toBe(false);
  });

  it("keeps characters independent", () => {
    const registry = createTurnRegistry();
    registry.begin("taki");
    const yui = registry.begin("yui");

    expect(registry.cancel("taki")).toBe(true);
    expect(yui.signal.aborted).toBe(false);
  });

  it("does not let an exact Run cancel target a different active Run", () => {
    const registry = createTurnRegistry();
    const active = registry.begin("taki", undefined, "run-active");
    expect(registry.cancel("taki", "run-queued")).toBe(false);
    expect(active.signal.aborted).toBe(false);
    expect(registry.cancel("taki", "run-active")).toBe(true);
  });

  it("drains active turns by aborting them and resolving after the bounded wait", async () => {
    const registry = createTurnRegistry();
    const controller = registry.begin("taki");
    const pending = registry.drain(25);
    expect(controller.signal.aborted).toBe(true);
    registry.end("taki", controller);
    await expect(pending).resolves.toBeUndefined();
  });

  it("drains Character and private scopes together and clears every completed waiter", async () => {
    vi.useFakeTimers();
    try {
      const registry = createTurnRegistry();
      const parent = registry.begin("taki", undefined, "parent-run");
      const child = registry.beginScoped({ characterId: "taki", scopeKey: "child-work", runId: "child-run", controller: new AbortController() });
      const finished = vi.fn();
      const first = registry.drain(25).then(finished);
      const second = registry.drain(50).then(finished);
      expect(parent.signal.reason).toBe("core shutdown");
      expect(child.signal.reason).toBe("core shutdown");

      registry.end("taki", parent);
      await Promise.resolve();
      expect(finished).not.toHaveBeenCalled();
      registry.end("child-work", child);
      await Promise.all([first, second]);
      expect(finished).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a stuck scope without unregistering it before its own cleanup", async () => {
    vi.useFakeTimers();
    try {
      const registry = createTurnRegistry();
      const controller = registry.begin("taki", undefined, "stuck-run");
      const pending = registry.drain(5);
      await vi.advanceTimersByTimeAsync(5);
      await expect(pending).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      expect(() => registry.begin("taki")).toThrow("TURN_SCOPE_OCCUPIED");
      registry.end("taki", controller);
      const next = registry.begin("taki", undefined, "next-run");
      expect(next.signal.aborted).toBe(false);
      registry.end("taki", next);
    } finally {
      vi.useRealTimers();
    }
  });
});
