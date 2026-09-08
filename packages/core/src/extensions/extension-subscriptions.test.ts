import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionChangedSchema } from "@taki/shared";
import type { Connection } from "../server/connection-registry.ts";
import { createExtensionSubscriptions } from "./extension-subscriptions.ts";

function connection(role: "operator" | "node" = "operator"): Connection {
  return { state: { status: "authenticated", deviceId: "same-device-different-connection", role, capabilities: [] } };
}
afterEach(() => { vi.restoreAllMocks(); });

describe("aggregate extension operator subscriptions", () => {
  it("admits only authenticated operators and does not schedule work with zero consumers", async () => {
    const queue = vi.spyOn(globalThis, "queueMicrotask");
    const subscriptions = createExtensionSubscriptions();
    const sink = vi.fn();
    expect(subscriptions.subscribe({ state: { status: "awaiting" } }, sink)).toBe(false);
    expect(subscriptions.subscribe(connection("node"), sink)).toBe(false);
    subscriptions.publish(["mcp"]);
    subscriptions.publish(["skills", "extension-status"]);
    await Promise.resolve();
    expect(subscriptions.count()).toBe(0);
    expect(queue).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });

  it("keeps one sink per connection and unions an entire producer burst into one unique target set", async () => {
    const subscriptions = createExtensionSubscriptions();
    const one = connection(); const two = connection();
    const stale = vi.fn(); const current = vi.fn(); const other = vi.fn();
    expect(subscriptions.subscribe(one, stale)).toBe(true);
    expect(subscriptions.subscribe(one, current)).toBe(false);
    expect(subscriptions.subscribe(two, other)).toBe(true);
    expect(subscriptions.count()).toBe(2);
    subscriptions.publish(["skills"]);
    subscriptions.publish(["mcp", "extension-status"]);
    subscriptions.publish(["mcp"]);
    expect(current).not.toHaveBeenCalled();
    await Promise.resolve();
    const first = { revision: 1, targets: ["mcp", "skills", "extension-status"] };
    expect(current).toHaveBeenCalledExactlyOnceWith(first);
    expect(other).toHaveBeenCalledExactlyOnceWith(first);
    expect(stale).not.toHaveBeenCalled();
    subscriptions.publish([]);
    await Promise.resolve();
    expect(current).toHaveBeenCalledTimes(1);
    subscriptions.publish(["skills"]);
    await Promise.resolve();
    expect(current).toHaveBeenLastCalledWith({ revision: 2, targets: ["skills"] });
  });

  it("isolates a throwing or mutating sink from later observers and future source changes", async () => {
    const subscriptions = createExtensionSubscriptions();
    const other = vi.fn();
    subscriptions.subscribe(connection(), (change) => { change.targets.push("skills"); throw new Error("private sink error"); });
    subscriptions.subscribe(connection(), other);
    subscriptions.publish(["mcp"]);
    await Promise.resolve();
    subscriptions.publish(["extension-status"]);
    await Promise.resolve();
    expect(other.mock.calls).toEqual([[{ revision: 1, targets: ["mcp"] }], [{ revision: 2, targets: ["extension-status"] }]]);
    for (const [change] of other.mock.calls) expect(ExtensionChangedSchema.parse(change)).toEqual(change);
  });

  it("drops queued hints at last-unsubscribe and never replays them to a replacement connection", async () => {
    const subscriptions = createExtensionSubscriptions();
    const old = connection(); const replacement = connection();
    const oldSink = vi.fn(); const current = vi.fn();
    subscriptions.subscribe(old, oldSink);
    subscriptions.publish(["mcp"]);
    subscriptions.unsubscribe(old);
    subscriptions.unsubscribe(old);
    subscriptions.subscribe(replacement, current);
    await Promise.resolve();
    expect(oldSink).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    subscriptions.publish(["skills"]);
    await Promise.resolve();
    expect(current).toHaveBeenCalledExactlyOnceWith({ revision: 1, targets: ["skills"] });
  });

  it("retains a new invalidation produced during fan-out for a later ordered batch", async () => {
    const subscriptions = createExtensionSubscriptions();
    const other = vi.fn();
    subscriptions.subscribe(connection(), (change) => { if (change.revision === 1) subscriptions.publish(["skills"]); });
    subscriptions.subscribe(connection(), other);
    subscriptions.publish(["mcp"]);
    await Promise.resolve();
    expect(other).toHaveBeenCalledExactlyOnceWith({ revision: 1, targets: ["mcp"] });
    await Promise.resolve();
    expect(other).toHaveBeenLastCalledWith({ revision: 2, targets: ["skills"] });
  });

  it("rechecks recipient authority and suppresses queued work after disposal", async () => {
    const subscriptions = createExtensionSubscriptions();
    const target = connection(); const sink = vi.fn();
    subscriptions.subscribe(target, sink);
    subscriptions.publish(["mcp"]);
    target.state = { status: "awaiting" };
    await Promise.resolve();
    expect(sink).not.toHaveBeenCalled();
    const other = connection(); subscriptions.subscribe(other, sink);
    subscriptions.publish(["skills"]);
    subscriptions.dispose(); subscriptions.dispose();
    await Promise.resolve();
    expect(subscriptions.count()).toBe(0);
    expect(subscriptions.subscribe(connection(), sink)).toBe(false);
    subscriptions.publish(["extension-status"]);
    await Promise.resolve();
    expect(sink).not.toHaveBeenCalled();
  });
});
