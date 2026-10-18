import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HINDSIGHT_CONFIGURATION_METHODS, type HindsightConfigurationStatus, type Role } from "@taki/shared";
import { configurationObservationFixture } from "../../testing/hindsight-configuration-fixture.ts";
import { createDeviceRegistry } from "../../devices/device-registry.ts";
import type { PairedDevice } from "../../devices/paired-device-store.ts";
import { createLogger } from "../../logging/logger.ts";
import { createConnectionRegistry, type Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { startWsServer } from "../ws-server.ts";
import { openClient, sendConnect, type TestClient } from "../../testing/ws-test-client.ts";
import { connectMethod } from "./connect.ts";
import { registerHindsightConfigurationMethods } from "./hindsight-configuration-methods.ts";

const params = { scope: { kind: "global" } };
describe("configuration observation operator boundary", () => {
  it("rejects untrusted roles and input through actual dispatcher before any Native read", async () => {
    const f = configurationObservationFixture(); const registry = createMethodRegistry();
    registerHindsightConfigurationMethods(registry, f.service);
    try {
      for (const role of ["node", "awaiting"] as const) {
        const connection: Connection = { state: role === "awaiting" ? { status: "awaiting" }
          : { status: "authenticated", deviceId: "d", role, capabilities: [] } };
        const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
        for (const method of Object.values(HINDSIGHT_CONFIGURATION_METHODS)) {
          expect(await registry.dispatch({ jsonrpc: "2.0", id: 1, method, params }, ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
        }
      }
      expect(f.state.calls).toEqual([]);
    } finally { f.service.dispose(); }
  });

  it("shares Core evidence across two authenticated sockets and reconnect, with failed refresh withdrawal", async () => {
    const f = configurationObservationFixture(); const registry = createMethodRegistry();
    registerHindsightConfigurationMethods(registry, f.service);
    const stored = new Map<string, PairedDevice>();
    const devices = createDeviceRegistry({ store: { find: (id) => stored.get(id), save: (value) => { stored.set(value.deviceId, value); } } });
    const connections = createConnectionRegistry();
    registry.register(connectMethod({ deviceRegistry: devices, connectionRegistry: connections, trustLoopbackOperator: true,
      onPairingCode: () => undefined, onAutoTrust: () => undefined }));
    const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger: createLogger("fatal") });
    const clients: TestClient[] = [];
    const open = async (role: Role = "operator", token?: string, id = randomUUID()) => {
      const client = await openClient(`ws://127.0.0.1:${server.port}`); clients.push(client);
      const credential = token ?? devices.trustDevice(id, { deviceName: "fixture", role });
      sendConnect(client, { role, token: credential, deviceId: id, deviceName: "fixture" });
      expect((await client.take(1))[0]).toHaveProperty("result");
      return { client, credential, id };
    };
    const call = async (client: TestClient, method: string): Promise<HindsightConfigurationStatus> => {
      client.send({ jsonrpc: "2.0", id: randomUUID(), method, params });
      const frame = (await client.take(1))[0] as { result: HindsightConfigurationStatus };
      return frame.result;
    };
    try {
      const first = await open(); const second = await open();
      const observed = await call(first.client, HINDSIGHT_CONFIGURATION_METHODS.observe);
      expect(observed.status).toBe("observed");
      expect(await call(second.client, HINDSIGHT_CONFIGURATION_METHODS.status)).toEqual(observed);
      first.client.close(); await first.client.waitClosed();
      const reconnected = await open("operator", first.credential, first.id);
      expect(await call(reconnected.client, HINDSIGHT_CONFIGURATION_METHODS.status)).toEqual(observed);
      f.state.mode = "deny";
      expect(await call(second.client, HINDSIGHT_CONFIGURATION_METHODS.observe)).toMatchObject({ status: "not_authorized", observation: null });
      expect(await call(reconnected.client, HINDSIGHT_CONFIGURATION_METHODS.status)).toMatchObject({ status: "not_authorized", observation: null });
      const node = await open("node");
      node.client.send({ jsonrpc: "2.0", id: "forbidden", method: HINDSIGHT_CONFIGURATION_METHODS.observe, params });
      expect((await node.client.take(1))[0]).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    } finally { for (const client of clients) client.close(); await server.close(); f.service.dispose(); }
  });
});
