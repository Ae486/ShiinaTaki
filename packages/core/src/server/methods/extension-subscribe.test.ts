import { describe, expect, it, vi } from "vitest";
import { EXTENSION_METHODS, ExtensionChangedSchema } from "@taki/shared";
import { createExtensionSubscriptions } from "../../extensions/extension-subscriptions.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { extensionSubscribeMethod } from "./extension-subscribe.ts";

function context(role: "operator" | "node" = "operator") {
  const connection: Connection = { state: { status: "authenticated", deviceId: "fixture", role, capabilities: [] } };
  const closed: (() => void)[] = [];
  const notify = vi.fn();
  const ctx: MethodContext = { connection, notify, close: () => undefined, onClose: (callback) => { closed.push(callback); } };
  return { ctx, closed, notify };
}

describe("extension.subscribe", () => {
  it("installs membership before acknowledgement and retries lost acknowledgement without duplicating cleanup", async () => {
    const subscriptions = createExtensionSubscriptions();
    const method = extensionSubscribeMethod(subscriptions);
    const h = context();
    const result = method.handler({}, h.ctx);
    expect(subscriptions.count()).toBe(1);
    expect(result).toEqual({ status: "ok" });
    expect(h.closed).toHaveLength(1);
    expect(h.notify).not.toHaveBeenCalled();

    const registry = createMethodRegistry(); registry.register(method);
    const nextNotify = vi.fn();
    const retry = await registry.dispatch({ jsonrpc: "2.0", id: "lost-ack-retry", method: EXTENSION_METHODS.subscribe, params: {} }, { ...h.ctx, notify: nextNotify });
    expect(retry).toEqual({ jsonrpc: "2.0", id: "lost-ack-retry", result: { status: "ok" } });
    expect(subscriptions.count()).toBe(1);
    expect(h.closed).toHaveLength(1);
    subscriptions.publish(["mcp"]);
    await Promise.resolve();
    expect(h.notify).not.toHaveBeenCalled();
    expect(nextNotify).toHaveBeenCalledExactlyOnceWith(EXTENSION_METHODS.changed, { revision: 1, targets: ["mcp"] });
    h.closed[0]!(); h.closed[0]!();
    subscriptions.publish(["skills"]);
    await Promise.resolve();
    expect(subscriptions.count()).toBe(0);
    expect(nextNotify).toHaveBeenCalledTimes(1);
  });

  it("refuses Node, pre-auth and invalid-filter requests before registering a sink", async () => {
    const subscriptions = createExtensionSubscriptions();
    const registry = createMethodRegistry(); registry.register(extensionSubscribeMethod(subscriptions));
    const node = context("node"); const awaiting = context(); awaiting.ctx.connection.state = { status: "awaiting" };
    const request = { jsonrpc: "2.0" as const, id: 1, method: EXTENSION_METHODS.subscribe, params: {} };
    expect(await registry.dispatch(request, node.ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(await registry.dispatch(request, awaiting.ctx)).toMatchObject({ error: { data: { code: "NOT_AUTHENTICATED" } } });
    const operator = context();
    expect(await registry.dispatch({ ...request, params: { targets: ["mcp"] } }, operator.ctx)).toMatchObject({ error: { code: -32602 } });
    expect(subscriptions.count()).toBe(0);
    expect(node.closed).toEqual([]); expect(awaiting.closed).toEqual([]); expect(operator.closed).toEqual([]);
  });

  it("fans a bounded coherent hint to two operators while one notify throws", async () => {
    const subscriptions = createExtensionSubscriptions();
    const method = extensionSubscribeMethod(subscriptions);
    const first = context(); const second = context();
    first.ctx.notify = () => { throw new Error("transport rejected frame"); };
    method.handler({}, first.ctx); method.handler({}, second.ctx);
    subscriptions.publish(["skills"]); subscriptions.publish(["extension-status"]);
    await Promise.resolve();
    expect(second.notify).toHaveBeenCalledExactlyOnceWith(EXTENSION_METHODS.changed, { revision: 1, targets: ["skills", "extension-status"] });
    expect(ExtensionChangedSchema.parse(second.notify.mock.calls[0]![1])).toEqual({ revision: 1, targets: ["skills", "extension-status"] });
    first.closed[0]!(); second.closed[0]!();
    expect(subscriptions.count()).toBe(0);
  });
});
