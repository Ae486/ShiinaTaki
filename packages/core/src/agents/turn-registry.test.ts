import { describe, expect, it } from "vitest";
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

  it("end only unregisters the controller that is still active (a later begin wins)", () => {
    const registry = createTurnRegistry();
    const stale = registry.begin("taki");
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
});
