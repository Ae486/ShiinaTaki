import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../server/connection-registry.ts";
import { createPerceptionSubscriptions } from "./perception-subscriptions.ts";

function connection(role: "operator" | "node" = "operator"): Connection {
  return { state: { status: "authenticated", deviceId: "same-device-is-not-a-socket", role, capabilities: [] } };
}

describe("Perception operator subscription registry", () => {
  it("supports zero subscribers and only authenticated operator membership", () => {
    const interest = vi.fn();
    const subscriptions = createPerceptionSubscriptions(interest);
    const sink = vi.fn();
    expect(subscriptions.subscribe({ state: { status: "awaiting" } }, sink)).toBe(false);
    expect(subscriptions.subscribe(connection("node"), sink)).toBe(false);
    expect(() => subscriptions.publish({ revision: 1 })).not.toThrow();
    expect(subscriptions.count()).toBe(0);
    expect(sink).not.toHaveBeenCalled();
    expect(interest).not.toHaveBeenCalled();
  });

  it("keys two operators by connection, replaces duplicates, and reports only first/last interest", () => {
    const interest = vi.fn();
    const subscriptions = createPerceptionSubscriptions(interest);
    const one = connection();
    const two = connection();
    const retired = vi.fn();
    const current = vi.fn();
    const other = vi.fn();
    expect(subscriptions.subscribe(one, retired)).toBe(true);
    expect(subscriptions.subscribe(one, current)).toBe(false);
    expect(subscriptions.subscribe(two, other)).toBe(true);
    expect(subscriptions.count()).toBe(2);
    expect(interest).toHaveBeenCalledTimes(1);
    subscriptions.publish({ revision: 1 });
    expect(retired).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    expect(other).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    subscriptions.unsubscribe(one);
    subscriptions.unsubscribe(one);
    expect(interest).toHaveBeenCalledTimes(1);
    subscriptions.unsubscribe(two);
    expect(interest).toHaveBeenCalledTimes(2);
    expect(subscriptions.count()).toBe(0);
  });

  it("isolates a throwing subscriber and stops all publication/membership after disposal", () => {
    const subscriptions = createPerceptionSubscriptions();
    const other = vi.fn();
    subscriptions.subscribe(connection(), () => { throw new Error("retired sink with private details"); });
    subscriptions.subscribe(connection(), other);
    expect(() => subscriptions.publish({ revision: 1 })).not.toThrow();
    expect(other).toHaveBeenCalledExactlyOnceWith({ revision: 1 });
    subscriptions.dispose();
    subscriptions.dispose();
    expect(subscriptions.subscribe(connection(), other)).toBe(false);
    subscriptions.publish({ revision: 2 });
    expect(other).toHaveBeenCalledTimes(1);
    expect(subscriptions.count()).toBe(0);
  });
});
