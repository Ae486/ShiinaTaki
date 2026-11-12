import { describe, expect, it, vi } from "vitest";
import type { ExtensionChanged, ExtensionConvergenceResult } from "@taki/shared";
import { createExtensionResource, extensionResource } from "./extension-convergence-resource.ts";

const DATA: ExtensionConvergenceResult = { observedAt: "2026-09-08T00:00:00.000Z", coreHostId: "11111111-1111-4111-8111-111111111111", hosts: [], entries: [], collisions: [] };
const observation = () => ({ subscribeExtensions: async () => "supported" as const, onExtensionChanged: () => () => undefined });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
describe("shared extension projection demand", () => {
  it("binds only effect-owned consumers, ignores unrelated targets and restores only uncovered gaps", async () => {
    const handlers = new Set<(event: ExtensionChanged) => void>();
    const client = {
      extensionStatus: vi.fn(async () => DATA), subscribeExtensions: vi.fn(async () => "supported" as const),
      onExtensionChanged: vi.fn((handler: (event: ExtensionChanged) => void) => { handlers.add(handler); return () => { handlers.delete(handler); }; }),
    };
    const resource = createExtensionResource(client);
    expect(client.onExtensionChanged).not.toHaveBeenCalled();
    expect(client.subscribeExtensions).not.toHaveBeenCalled();
    const listener = vi.fn();
    const stop = resource.observe(listener);
    expect(client.onExtensionChanged).toHaveBeenCalledTimes(1);
    expect(client.subscribeExtensions).not.toHaveBeenCalled();
    resource.setVisible(listener, true);
    await resource.refresh();
    expect(client.extensionStatus).toHaveBeenCalledTimes(1);
    resource.setVisible(listener, false);
    resource.setVisible(listener, true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.extensionStatus).toHaveBeenCalledTimes(1);
    resource.setVisible(listener, false);
    const hiddenCount = listener.mock.calls.length;
    for (const handler of handlers) handler({ revision: 1, targets: ["mcp", "skills"] });
    for (const handler of handlers) handler({ revision: 2, targets: ["extension-status"] });
    for (const handler of handlers) handler({ revision: 2, targets: ["extension-status"] });
    expect(listener).toHaveBeenCalledTimes(hiddenCount);
    expect(client.extensionStatus).toHaveBeenCalledTimes(1);
    resource.setVisible(listener, true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.extensionStatus).toHaveBeenCalledTimes(2);
    stop();
    expect(handlers.size).toBe(0);
    const final = resource.observe(listener);
    resource.setVisible(listener, true);
    await resource.refresh();
    expect(client.extensionStatus).toHaveBeenCalledTimes(3);
    final();
  });

  it("shares one active read for identical same-client consumers and publishes only to visible ones", async () => {
    const pending = deferred<ExtensionConvergenceResult>();
    const client = { ...observation(), extensionStatus: vi.fn(() => pending.promise) };
    const resource = extensionResource(client);
    expect(extensionResource(client)).toBe(resource);
    const first = vi.fn();
    const second = vi.fn();
    resource.observe(first);
    resource.observe(second);
    resource.setVisible(first, true);
    resource.setVisible(second, true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(client.extensionStatus).toHaveBeenCalledTimes(1);
    resource.setVisible(second, false);
    const hiddenCount = second.mock.calls.length;
    pending.resolve(DATA);
    await resource.refresh();
    expect(first).toHaveBeenLastCalledWith({ kind: "ready", data: DATA, observation: "live" });
    expect(second).toHaveBeenCalledTimes(hiddenCount);
  });

  it("does no work without a visible consumer and reconciles a finite hidden burst once on return", async () => {
    const client = { ...observation(), extensionStatus: vi.fn(async () => DATA) };
    const resource = createExtensionResource(client);
    const listener = vi.fn();
    const stop = resource.observe(listener);
    await resource.invalidate();
    await resource.invalidate();
    expect(client.extensionStatus).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    resource.setVisible(listener, true);
    await resource.refresh();
    expect(client.extensionStatus).toHaveBeenCalledTimes(1);
    stop();
    await resource.invalidate();
    expect(client.extensionStatus).toHaveBeenCalledTimes(1);
  });
});
