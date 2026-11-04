import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERCEPTION_METHODS, PerceptionCardSchema, PerceptionChangedSchema, PerceptionSubscribeResultSchema,
  JsonRpcSuccessResponseSchema,
} from "@taki/shared";
import { createDeviceRegistry } from "../../devices/device-registry.ts";
import type { PairedDevice } from "../../devices/paired-device-store.ts";
import { createPerceptionLayer, type PerceptionLayer } from "../../perception/perception-layer.ts";
import { createPerceptionSubscriptions } from "../../perception/perception-subscriptions.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { appCode, notification, openClient, sendConnect, type TestClient } from "../../testing/ws-test-client.ts";
import { createConnectionRegistry, type Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { startWsServer, type WsServer } from "../ws-server.ts";
import { connectMethod } from "./connect.ts";
import { registerPerceptionMethods } from "./perception-methods.ts";
import { perceptionSubscribeMethod } from "./perception-subscribe.ts";

function context(role: "operator" | "node" = "operator") {
  const connection: Connection = { state: { status: "authenticated", deviceId: "same-device", role, capabilities: [] } };
  const closed: Array<() => void> = [];
  const notify = vi.fn();
  const ctx: MethodContext = { connection, notify, close: () => undefined, onClose: (cb) => { closed.push(cb); } };
  return { ctx, closed, notify };
}

describe("perception.subscribe method", () => {
  it("acknowledges duplicate setup with one membership/cleanup and no initial snapshot push", async () => {
    const subscriptions = createPerceptionSubscriptions();
    const registry = createMethodRegistry();
    registry.register(perceptionSubscribeMethod(subscriptions));
    const h = context();
    for (const id of [1, 2]) {
      const response = await registry.dispatch({ jsonrpc: "2.0", id, method: PERCEPTION_METHODS.subscribe, params: {} }, h.ctx);
      expect(response).toEqual({ jsonrpc: "2.0", id, result: { status: "ok" } });
    }
    expect(subscriptions.count()).toBe(1);
    expect(h.closed).toHaveLength(1);
    expect(h.notify).not.toHaveBeenCalled();
    subscriptions.publish({ revision: 1 });
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(PERCEPTION_METHODS.changed, { revision: 1 });
    h.closed[0]?.();
    h.closed[0]?.();
    expect(subscriptions.count()).toBe(0);
  });

  it("refuses a Node, an unauthenticated caller, and nonempty params before membership", async () => {
    const subscriptions = createPerceptionSubscriptions();
    const registry = createMethodRegistry();
    registry.register(perceptionSubscribeMethod(subscriptions));
    const node = context("node");
    const awaiting = context();
    awaiting.ctx.connection.state = { status: "awaiting" };
    const request = { jsonrpc: "2.0" as const, id: 1, method: PERCEPTION_METHODS.subscribe, params: {} };
    expect(await registry.dispatch(request, node.ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(await registry.dispatch(request, awaiting.ctx)).toMatchObject({ error: { data: { code: "NOT_AUTHENTICATED" } } });
    expect(await registry.dispatch({ ...request, params: { hostId: "host" } }, context().ctx)).toMatchObject({ error: { code: -32602 } });
    expect(subscriptions.count()).toBe(0);
  });
});

const servers: WsServer[] = [];
const clients: TestClient[] = [];
const perceptions: PerceptionLayer[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const perception of perceptions.splice(0)) perception.dispose();
});

async function boot() {
  const devices = new Map<string, PairedDevice>();
  const deviceRegistry = createDeviceRegistry({ store: {
    find: (id) => devices.get(id), save: (device) => { devices.set(device.deviceId, device); },
  } });
  const connectionRegistry = createConnectionRegistry();
  const registry = createMethodRegistry();
  registry.register(connectMethod({ deviceRegistry, connectionRegistry, trustLoopbackOperator: true,
    onPairingCode: () => undefined, onAutoTrust: () => undefined }));
  const { logger } = createCaptureLogger();
  const route = vi.fn(async () => ({ ok: false as const, code: "NO_NODE" as const, message: "no synthetic capture host" }));
  const save = vi.fn();
  const perception = createPerceptionLayer({
    route, hasNode: () => false, logger,
    ambient: { enabled: false, retention: { mode: "keep" } },
    ambientShotsDir: join(process.cwd(), "target", "unused-perception-ws"),
    pauseStore: { load: () => undefined, save },
  });
  perceptions.push(perception);
  registerPerceptionMethods(registry, perception);
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry, logger });
  servers.push(server);
  const url = `ws://127.0.0.1:${server.port}`;
  async function open() { const client = await openClient(url); clients.push(client); return client; }
  async function authenticated(deviceId: string, role: "operator" | "node") {
    const client = await open();
    const token = deviceRegistry.trustDevice(deviceId, { deviceName: "synthetic", role });
    sendConnect(client, { deviceId, deviceName: "synthetic", role, token });
    expect(JsonRpcSuccessResponseSchema.parse((await client.take(1))[0]).result).toMatchObject({ status: "ok" });
    return client;
  }
  return { server, perception, route, save, open, authenticated };
}

describe("Perception over authenticated WS connections", () => {
  it("reaches two opted-in operators, denies Node/pre-auth requests and cleans membership on close", async () => {
    const h = await boot();
    const one = await h.authenticated("550e8400-e29b-41d4-a716-446655440010", "operator");
    const two = await h.authenticated("550e8400-e29b-41d4-a716-446655440011", "operator");
    const node = await h.authenticated("550e8400-e29b-41d4-a716-446655440012", "node");
    const idle = await h.authenticated("550e8400-e29b-41d4-a716-446655440013", "operator");
    const pending = await h.open();
    const request = { jsonrpc: "2.0", id: "subscribe", method: PERCEPTION_METHODS.subscribe, params: {} };
    pending.send(request);
    expect(appCode((await pending.take(1))[0])).toBe("NOT_AUTHENTICATED");
    await pending.waitClosed();
    node.send(request);
    expect(appCode((await node.take(1))[0])).toBe("FORBIDDEN");
    for (const client of [one, one, two]) {
      client.send(request);
      const response = JsonRpcSuccessResponseSchema.parse((await client.take(1))[0]);
      expect(PerceptionSubscribeResultSchema.parse(response.result)).toEqual({ status: "ok" });
    }
    expect(h.perception.changes.subscriptions.count()).toBe(2);
    for (const sideEffect of [h.route, h.save]) expect(sideEffect).not.toHaveBeenCalled();
    h.perception.activity.state.push({ available: true, processName: "Code.exe", windowTitle: "accepted sample", idleSeconds: 0 }, Date.now());
    for (const client of [one, two]) {
      const hint = notification((await client.take(1))[0]);
      expect(hint.method).toBe(PERCEPTION_METHODS.changed);
      expect(PerceptionChangedSchema.parse(hint.params)).toEqual({ revision: 1 });
    }
    one.send({ jsonrpc: "2.0", id: "pause", method: PERCEPTION_METHODS.pauseSet, params: { paused: true } });
    const ownFrames = await one.take(2);
    expect(ownFrames).toContainEqual({ jsonrpc: "2.0", id: "pause", result: { paused: true, until: null } });
    expect(ownFrames).toContainEqual({ jsonrpc: "2.0", method: PERCEPTION_METHODS.changed, params: { revision: 2 } });
    expect(notification((await two.take(1))[0])).toEqual({ method: PERCEPTION_METHODS.changed, params: { revision: 2 } });
    // The next frame on an unobserving/denied peer must be its explicit read response, never an unsolicited hint.
    idle.send({ jsonrpc: "2.0", id: "read", method: PERCEPTION_METHODS.card, params: {} });
    const read = JsonRpcSuccessResponseSchema.parse((await idle.take(1))[0]);
    // Consent retirement clears the old activity immediately; an explicit read cannot revive it.
    expect(PerceptionCardSchema.parse(read.result).current).toBeNull();
    node.send(request);
    expect(appCode((await node.take(1))[0])).toBe("FORBIDDEN");
    await h.server.close();
    servers.splice(servers.indexOf(h.server), 1);
    expect(h.perception.changes.subscriptions.count()).toBe(0);
    expect(h.route).not.toHaveBeenCalled();
    expect(h.save).toHaveBeenCalledExactlyOnceWith({ paused: true, until: null });
  });
});
