import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { LocalAuthChallengeSchema, JsonRpcErrorResponseSchema, JsonRpcSuccessResponseSchema, ConnectResultSchema,
  type ConnectParams } from "@taki/shared";
import { createLocalConnectionAuth, localAuthMac } from "../../devices/local-connection-auth.ts";
import { createDeviceRegistry } from "../../devices/device-registry.ts";
import { createPairedDeviceStore } from "../../devices/paired-device-store.ts";
import { createLogger } from "../../logging/logger.ts";
import { openClient, sendConnect, appCode, type TestClient } from "../../testing/ws-test-client.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry } from "../method-registry.ts";
import { startWsServer, type WsServer } from "../ws-server.ts";
import { connectMethod } from "./connect.ts";

const key = new Uint8Array(32).fill(7);
const id = "550e8400-e29b-41d4-a716-446655440002";
const clients: TestClient[] = [];
const servers: WsServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(servers.splice(0).map((server) => server.close()));
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

async function boot() {
  const dataDir = mkdtempSync(join(tmpdir(), "taki-local-socket-")); dirs.push(dataDir);
  const logger = createLogger("fatal");
  const localAuth = createLocalConnectionAuth({ dataDir, env: {}, logger, coreId: "550e8400-e29b-41d4-a716-446655440000", endpoint: "ws://127.0.0.1:1",
    keySource: { canCreate: false, read: () => key, create: () => {} } });
  const store = createPairedDeviceStore(join(dataDir, "devices.json"));
  const deviceRegistry = createDeviceRegistry({ store });
  const connectionRegistry = createConnectionRegistry();
  const registry = createMethodRegistry();
  registry.register(connectMethod({ localAuth, deviceRegistry, connectionRegistry, trustLoopbackOperator: false,
    onPairingCode: () => {}, onAutoTrust: () => {} }));
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry, logger });
  servers.push(server);
  const endpoint = `ws://127.0.0.1:${server.port}`; localAuth.publishEndpoint(endpoint);
  const open = async () => { const client = await openClient(endpoint); clients.push(client); return client; };
  return { open, store, deviceRegistry };
}

async function authenticate(client: TestClient, input: { role?: "node" | "operator"; token?: string } = {}) {
  const params = { deviceId: id, deviceName: "fixture", role: input.role ?? "operator", capabilities: [],
    ...(input.role === "node" ? { host: { protocol: { min: 3, max: 3 }, catalogSchemaVersions: [2] } } : {}),
  } satisfies ConnectParams;
  sendConnect(client, { ...params, localAuth: { kind: "begin", clientNonce: "02".repeat(32) } });
  const data = JsonRpcErrorResponseSchema.parse((await client.take(1))[0]).error.data;
  expect(data).toMatchObject({ code: "LOCAL_AUTH_REQUIRED" });
  const challenge = LocalAuthChallengeSchema.parse((data as { challenge: unknown }).challenge);
  sendConnect(client, { ...params, token: input.token,
    localAuth: { kind: "proof", nonce: challenge.nonce, proof: localAuthMac(key, "client", challenge) } });
  return (await client.take(1))[0];
}

it("uses actual loopback sockets without trusting unrelated clients and preserves concurrent operator tokens", async () => {
  const h = await boot();
  const unrelated = await h.open();
  sendConnect(unrelated, { deviceId: id, deviceName: "unrelated", role: "operator" });
  expect(appCode((await unrelated.take(1))[0])).toBe("PAIRING_REQUIRED");
  const first = ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await authenticate(await h.open())).result);
  expect(first.token).toBeTruthy();
  const concurrent = await Promise.all([h.open(), h.open(), h.open()]);
  for (const client of concurrent) {
    const result = ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await authenticate(client)).result);
    expect(result.token).toBeUndefined();
  }
  expect(h.deviceRegistry.verifyToken(id, first.token!, "operator")).toBe(true);
  expect(appCode(await authenticate(await h.open(), { token: "revoked-token" }))).toBe("LOCAL_AUTH_FAILED");
  expect(h.deviceRegistry.verifyToken(id, first.token!, "operator")).toBe(true);
});

it("refuses operator-to-Node privilege changes even with a valid bootstrap proof", async () => {
  const h = await boot();
  await authenticate(await h.open());
  expect(appCode(await authenticate(await h.open(), { role: "node" }))).toBe("LOCAL_AUTH_FAILED");
  expect(h.store.find(id)?.role).toBe("operator");
});
