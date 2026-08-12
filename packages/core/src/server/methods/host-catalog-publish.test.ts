import { describe, expect, it, vi } from "vitest";
import type { HostCatalogPublishParams } from "@taki/shared";
import { createHostCatalogStore } from "../../hosts/host-catalog.ts";
import type { Connection } from "../connection-registry.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { hostCatalogPublishMethod } from "./host-catalog-publish.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const params: HostCatalogPublishParams = {
  hostId: HOST, label: "Desktop", protocolVersion: 1, catalogSchemaVersion: 1,
  connectionGeneration: 1, catalogGeneration: 1, publishedAt: "2026-08-12T00:00:00.000Z",
  readiness: "ready", capabilities: [], workspaces: [], skills: [], mcpServers: [],
};

function ctx(hostId = HOST, connectionGeneration = 1): MethodContext {
  const connection: Connection = {
    state: {
      status: "authenticated", deviceId: hostId, role: "node", capabilities: [],
      host: { hostId, connectionGeneration, protocolVersion: 1, catalogSchemaVersion: 1 },
    },
  };
  return { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
}

function currentHost() {
  const connections = createConnectionRegistry();
  const catalogs = createHostCatalogStore();
  const connection = connections.create();
  const provenance = connections.authenticate(connection, {
    deviceId: HOST,
    role: "node",
    capabilities: [],
    host: { protocolVersion: 1, catalogSchemaVersion: 1 },
  })!;
  const candidate = { ...params, connectionGeneration: provenance.connectionGeneration };
  catalogs.publish(candidate, provenance);
  return {
    catalogs,
    candidate,
    connection,
    connections,
    method: hostCatalogPublishMethod(catalogs, connections),
  };
}

describe("hostCatalogPublishMethod", () => {
  it("publishes only when payload matches authenticated Host provenance", () => {
    const connections = createConnectionRegistry();
    const connection = connections.create();
    connections.authenticate(connection, { deviceId: HOST, role: "node", capabilities: [], host: { protocolVersion: 1, catalogSchemaVersion: 1 } });
    const method = hostCatalogPublishMethod(createHostCatalogStore(), connections);
    const methodCtx = { ...ctx(), connection };
    expect(method.handler(params, methodCtx)).toEqual({ accepted: true });
  });

  it("rejects publication from a replaced socket before its close event", () => {
    const connections = createConnectionRegistry();
    const old = connections.create();
    connections.authenticate(old, { deviceId: HOST, role: "node", capabilities: [], host: { protocolVersion: 1, catalogSchemaVersion: 1 } });
    const current = connections.create();
    connections.authenticate(current, { deviceId: HOST, role: "node", capabilities: [], host: { protocolVersion: 1, catalogSchemaVersion: 1 } });
    const catalogs = createHostCatalogStore();
    const provenance = current.state.status === "authenticated" ? current.state.host! : undefined;
    catalogs.publish({ ...params, connectionGeneration: 2 }, provenance!);
    const method = hostCatalogPublishMethod(catalogs, connections);
    expect(method.handler(params, { ...ctx(), connection: old })).toEqual({ accepted: false, reason: "stale_generation" });
    expect(catalogs.get(HOST)?.connectionGeneration).toBe(2);
  });

  it.each([
    ["protocol", { protocolVersion: 2 }],
    ["catalog schema", { catalogSchemaVersion: 2 }],
  ])("retires the current generation after an unsupported %s version for the same provenance", (_label, overrides) => {
    const { catalogs, candidate, connection, method } = currentHost();

    expect(method.handler({ ...candidate, ...overrides }, { ...ctx(), connection })).toEqual({
      accepted: false,
      reason: "unsupported_version",
    });
    expect(catalogs.get(HOST)).toBeUndefined();
  });

  it("retires the current generation after a non-monotonic catalog candidate for the same provenance", () => {
    const { catalogs, candidate, connection, connections } = currentHost();
    const method = hostCatalogPublishMethod(catalogs, connections);
    expect(method.handler({ ...candidate, catalogGeneration: 2 }, { ...ctx(), connection })).toEqual({ accepted: true });

    expect(method.handler(candidate, { ...ctx(), connection })).toEqual({
      accepted: false,
      reason: "stale_generation",
    });
    expect(catalogs.get(HOST)).toBeUndefined();
  });

  it("does not retire the current catalog for wrong-host or wrong-generation semantic candidates", () => {
    const { catalogs, candidate, connection, method } = currentHost();

    expect(method.handler({ ...candidate, hostId: "22222222-2222-4222-8222-222222222222" }, {
      ...ctx(), connection,
    })).toEqual({ accepted: false, reason: "wrong_host" });
    expect(method.handler({ ...candidate, connectionGeneration: 2 }, { ...ctx(), connection })).toEqual({
      accepted: false,
      reason: "stale_generation",
    });
    expect(catalogs.get(HOST)).toBeDefined();
  });

  it("retires the current generation catalog when a complete replacement candidate is invalid", async () => {
    const connections = createConnectionRegistry();
    const catalogs = createHostCatalogStore();
    const connection = connections.create();
    const provenance = connections.authenticate(connection, {
      deviceId: HOST,
      role: "node",
      capabilities: [],
      host: { protocolVersion: 1, catalogSchemaVersion: 1 },
    });
    catalogs.publish(params, provenance!);
    expect(catalogs.get(HOST)).toBeDefined();

    const registry = createMethodRegistry();
    registry.register(hostCatalogPublishMethod(catalogs, connections));
    const response = await registry.dispatch({
      jsonrpc: "2.0",
      id: "invalid-catalog",
      method: "host.catalogPublish",
      params: { ...params, connected: true },
    }, { ...ctx(), connection });

    expect(response).toMatchObject({ error: { code: -32602 } });
    expect(catalogs.get(HOST)).toBeUndefined();
    expect(catalogs.hostsForCapability("screenshot")).toHaveLength(0);
  });

  it("does not let an operator or stale socket retire the current Host catalog with invalid params", async () => {
    const connections = createConnectionRegistry();
    const catalogs = createHostCatalogStore();
    const old = connections.create();
    connections.authenticate(old, {
      deviceId: HOST,
      role: "node",
      capabilities: [],
      host: { protocolVersion: 1, catalogSchemaVersion: 1 },
    });
    const current = connections.create();
    const provenance = connections.authenticate(current, {
      deviceId: HOST,
      role: "node",
      capabilities: [],
      host: { protocolVersion: 1, catalogSchemaVersion: 1 },
    });
    catalogs.publish({ ...params, connectionGeneration: 2 }, provenance!);
    const retire = vi.spyOn(catalogs, "retire");

    const registry = createMethodRegistry();
    registry.register(hostCatalogPublishMethod(catalogs, connections));
    const invalid = { ...params, connectionGeneration: 2, connected: true };
    await registry.dispatch({ jsonrpc: "2.0", id: "stale", method: "host.catalogPublish", params: invalid }, {
      ...ctx(), connection: old,
    });

    const operator = connections.create();
    connections.authenticate(operator, { deviceId: "22222222-2222-4222-8222-222222222222", role: "operator", capabilities: [] });
    await registry.dispatch({ jsonrpc: "2.0", id: "operator", method: "host.catalogPublish", params: invalid }, {
      ...ctx(), connection: operator,
    });

    await registry.dispatch({
      jsonrpc: "2.0",
      id: "wrong-provenance",
      method: "host.catalogPublish",
      params: { ...invalid, hostId: "33333333-3333-4333-8333-333333333333" },
    }, { ...ctx(), connection: current });

    expect(catalogs.get(HOST)?.connectionGeneration).toBe(2);
    expect(retire).not.toHaveBeenCalled();
  });

  it("returns INTERNAL_ERROR when current-generation invalid-candidate retirement fails", async () => {
    const { catalogs, candidate, connection, connections } = currentHost();
    vi.spyOn(catalogs, "retire").mockImplementation(() => {
      throw new Error("catalog retirement failed");
    });
    const registry = createMethodRegistry();
    registry.register(hostCatalogPublishMethod(catalogs, connections));

    const response = await registry.dispatch({
      jsonrpc: "2.0",
      id: "cleanup-failure",
      method: "host.catalogPublish",
      params: { ...candidate, connected: true },
    }, { ...ctx(), connection });

    expect(response).toMatchObject({ error: { code: -32603, message: "catalog retirement failed" } });
  });
});
