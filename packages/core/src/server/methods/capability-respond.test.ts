import { describe, expect, it } from "vitest";
import type { CapabilityRequest, JsonRpcRequest } from "@taki/shared";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { fakeHost, testApproval } from "../../testing/capability-tool-harness.ts";
import { createCapabilityBroker, type CapabilityBroker } from "../../capabilities/capability-broker.ts";
import { createConnectionRegistry, type Connection, type ConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { capabilityRespondMethod } from "./capability-respond.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
function ctxFor(connection: Connection): MethodContext {
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}
function request(params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: "1", method: "capability.respond", params };
}
function makeBroker(): CapabilityBroker {
  const { logger } = createCaptureLogger();
  return createCapabilityBroker({ logger, approval: testApproval() });
}
function registryFor(broker: CapabilityBroker, connections: ConnectionRegistry) {
  const registry = createMethodRegistry();
  registry.register(capabilityRespondMethod(broker, connections));
  return registry;
}

describe("capabilityRespondMethod", () => {
  it("forbids an operator role", async () => {
    const connections = createConnectionRegistry();
    const operator = connections.create();
    connections.authenticate(operator, { deviceId: HOST, role: "operator", capabilities: [] });
    const res = await registryFor(makeBroker(), connections).dispatch(request({}), ctxFor(operator));
    expect(res).toMatchObject({ error: { code: -32602 } });
  });

  it("accepts a response from the current owning Host generation", async () => {
    const connections = createConnectionRegistry();
    const current = connections.create();
    connections.authenticate(current, {
      deviceId: HOST,
      role: "node",
      capabilities: [],
      host: { protocolVersion: 2, catalogSchemaVersion: 2 },
    });
    const broker = makeBroker();
    let sent: CapabilityRequest | undefined;
    const pending = broker.request({
      hostId: HOST, connectionGeneration: 1, catalogGeneration: 1,
      descriptor: { capabilityId: "screenshot", execution: "read", cancellation: "cooperative", governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 } },
      policyGeneration: 1,
      governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" }], digest: "a".repeat(64) },
      connection: fakeHost("screenshot"),
      isCurrent: () => true,
      notify: (_m, p) => (sent = p as CapabilityRequest),
    }, {});
    const params = { requestId: sent!.requestId, control: sent!.control, state: "completed", output: {}, governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "auto", constraint: "none" } };
    expect(await registryFor(broker, connections).dispatch(request(params), ctxFor(current))).toMatchObject({
      result: { accepted: true },
    });
    await expect(pending).resolves.toEqual({ ok: true, output: {} });
  });

  it("rejects an old generation response immediately after replacement authentication", async () => {
    const connections = createConnectionRegistry();
    const broker = makeBroker();
    connections.onRemove((connection) => {
      const state = connection.state;
      if (state.status === "authenticated" && state.host) {
        broker.cancelGeneration(state.host.hostId, state.host.connectionGeneration, "Host replaced");
      }
    });
    const old = connections.create();
    connections.authenticate(old, {
      deviceId: HOST,
      role: "node",
      capabilities: [],
      host: { protocolVersion: 2, catalogSchemaVersion: 2 },
    });
    let sent: CapabilityRequest | undefined;
    const pending = broker.request({
      hostId: HOST,
      connectionGeneration: 1,
      catalogGeneration: 1,
      descriptor: { capabilityId: "screenshot", execution: "read", cancellation: "cooperative", governance: { descriptorRevision: 1, classifierId: "fixed-risk", classifierRevision: 1 } },
      policyGeneration: 1,
      governanceProjection: { registryRevision: 1, descriptorRevision: 1, classifierRevision: 1, cells: [{ key: "screenshot", posture: "auto" }], digest: "a".repeat(64) },
      connection: fakeHost("screenshot"),
      isCurrent: () => true,
      notify: (_method, params) => (sent = params as CapabilityRequest),
    }, {});
    const replacement = connections.create();
    connections.authenticate(replacement, {
      deviceId: HOST,
      role: "node",
      capabilities: [],
      host: { protocolVersion: 2, catalogSchemaVersion: 2 },
    });
    const params = { requestId: sent!.requestId, control: sent!.control, state: "completed", output: {}, governance: { descriptorRevision: 1, classifierRevision: 1, cellKey: "screenshot", effectivePosture: "auto", constraint: "none" } };
    expect(await registryFor(broker, connections).dispatch(request(params), ctxFor(old))).toMatchObject({
      result: { accepted: false, reason: "stale_generation" },
    });
    await expect(pending).resolves.toMatchObject({ ok: false, code: "CANCELLED", state: "cancelled" });
  });
});
