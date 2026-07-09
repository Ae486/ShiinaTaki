import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError, type LanguageModel } from "ai";
import {
  CHAT_METHODS,
  CONNECT_METHOD,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatSendResultSchema,
  ConnectResultSchema,
  JSON_RPC_ERROR_CODES,
  JsonRpcErrorResponseSchema,
  JsonRpcSuccessResponseSchema,
  type Role,
} from "@taki/shared";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createDeviceRegistry } from "../devices/device-registry.ts";
import { createPairedDeviceStore } from "../devices/paired-device-store.ts";
import { createLogger } from "../logging/logger.ts";
import { createMemoryStore } from "../testing/memory-store.ts";
import { failingMockModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { appCode, notification, openClient, sendConnect, type TestClient } from "../testing/ws-test-client.ts";
import { createConnectionRegistry, type ConnectionRegistry } from "./connection-registry.ts";
import { createMethodRegistry } from "./method-registry.ts";
import { chatSendMethod } from "./methods/chat-send.ts";
import { connectMethod, type PairingCodeInfo } from "./methods/connect.ts";
import { startWsServer, type WsServer } from "./ws-server.ts";

const logger = createLogger("fatal"); // keep test output clean
const OPERATOR_ID = "550e8400-e29b-41d4-a716-446655440000";
const NODE_ID = "550e8400-e29b-41d4-a716-446655440001";

interface Harness {
  url: string;
  codes: PairingCodeInfo[];
  connections: ConnectionRegistry;
}

const servers: WsServer[] = [];
const clients: TestClient[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

async function boot(model: LanguageModel): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "taki-wss-"));
  dirs.push(dir);
  const deviceRegistry = createDeviceRegistry({ store: createPairedDeviceStore(join(dir, "devices.json")) });
  const connectionRegistry = createConnectionRegistry();
  const codes: PairingCodeInfo[] = [];
  const registry = createMethodRegistry();
  registry.register(connectMethod({ deviceRegistry, connectionRegistry, onPairingCode: (info) => codes.push(info) }));
  registry.register(chatSendMethod(createChatAgent({ model, store: createMemoryStore().store }), logger));
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry, logger });
  servers.push(server);
  return { url: `ws://127.0.0.1:${server.port}`, codes, connections: connectionRegistry };
}

async function open(url: string): Promise<TestClient> {
  const client = await openClient(url);
  clients.push(client);
  return client;
}

/** Runs the full pairing handshake for a device and returns its authenticated client + issued token. */
async function pair(harness: Harness, deviceId: string, role: Role): Promise<{ client: TestClient; token: string }> {
  const { url, codes } = harness;
  const client = await open(url);
  sendConnect(client, { deviceId, deviceName: "test", role });
  expect(appCode((await client.take(1))[0])).toBe("PAIRING_REQUIRED");
  const code = codes[codes.length - 1]?.code;
  sendConnect(client, { deviceId, deviceName: "test", role, pairingCode: code }, "c-pair");
  const result = ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await client.take(1))[0]).result);
  expect(result.status).toBe("ok");
  return { client, token: result.token ?? "" };
}

describe("startWsServer envelope errors", () => {
  it("replies PARSE_ERROR (id null) to malformed JSON and closes the pre-auth socket", async () => {
    const { url } = await boot(streamingMockModel([]));
    const client = await open(url);

    client.sendRaw("definitely not json {");
    const [frame] = await client.take(1);

    const res = JsonRpcErrorResponseSchema.parse(frame);
    expect(res.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
    expect(res.id).toBeNull();
    await client.waitClosed(); // fail-closed: unauthenticated peers don't get to spam garbage
  });

  it("replies INVALID_REQUEST to valid JSON that is not a frame and closes the pre-auth socket", async () => {
    const { url } = await boot(streamingMockModel([]));
    const client = await open(url);

    client.send({ foo: 1 });
    const [frame] = await client.take(1);

    expect(JsonRpcErrorResponseSchema.parse(frame).error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
    await client.waitClosed();
  });

  it("tolerates a malformed frame on an authenticated socket (session survives)", async () => {
    const harness = await boot(streamingMockModel([]));
    const { client } = await pair(harness, OPERATOR_ID, "operator");

    client.sendRaw("garbage {");
    const [errFrame] = await client.take(1);
    expect(JsonRpcErrorResponseSchema.parse(errFrame).error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);

    client.send({ jsonrpc: "2.0", id: "after", method: "does.not.exist", params: {} });
    const [nextFrame] = await client.take(1);
    expect(JsonRpcErrorResponseSchema.parse(nextFrame).id).toBe("after");
  });
});

describe("startWsServer pre-auth gate + pairing handshake", () => {
  it("T4 rejects a pre-auth chat.send with NOT_AUTHENTICATED and closes the socket", async () => {
    const { url } = await boot(streamingMockModel([]));
    const client = await open(url);

    client.send({ jsonrpc: "2.0", id: "1", method: CHAT_METHODS.send, params: { characterId: "taki", message: "hi" } });
    const [frame] = await client.take(1);

    expect(appCode(frame)).toBe("NOT_AUTHENTICATED");
    await client.waitClosed();
  });

  it("T4 rejects a pre-auth NOTIFICATION — even one named connect — and closes the socket", async () => {
    const { url } = await boot(streamingMockModel([]));
    const client = await open(url);

    client.send({ jsonrpc: "2.0", method: CONNECT_METHOD, params: {} }); // no id: not a request
    const [frame] = await client.take(1);

    const res = JsonRpcErrorResponseSchema.parse(frame);
    expect(res.id).toBeNull();
    expect(appCode(frame)).toBe("NOT_AUTHENTICATED");
    await client.waitClosed();
  });

  it("T4 gates a pre-auth unknown method before METHOD_NOT_FOUND is even considered", async () => {
    const { url } = await boot(streamingMockModel([]));
    const client = await open(url);

    client.send({ jsonrpc: "2.0", id: "1", method: "does.not.exist", params: {} });
    const [frame] = await client.take(1);

    expect(appCode(frame)).toBe("NOT_AUTHENTICATED");
    await client.waitClosed();
  });

  it("T5 answers an unknown connect with PAIRING_REQUIRED and emits a 6-digit code to the sink", async () => {
    const { url, codes } = await boot(streamingMockModel([]));
    const client = await open(url);

    sendConnect(client, { deviceId: OPERATOR_ID, deviceName: "laptop", role: "operator" });
    const [frame] = await client.take(1);

    expect(appCode(frame)).toBe("PAIRING_REQUIRED");
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ deviceId: OPERATOR_ID, deviceName: "laptop" });
    expect(codes[0]?.code).toMatch(/^\d{6}$/);
  });

  it("T6 completes pairing, reconnects with the token on a new socket, then chats", async () => {
    const harness = await boot(streamingMockModel(["Hi"]));
    const { client: first, token } = await pair(harness, OPERATOR_ID, "operator");
    expect(token.length).toBeGreaterThan(0);
    first.close();

    const second = await open(harness.url);
    sendConnect(second, { deviceId: OPERATOR_ID, deviceName: "test", role: "operator", token }, "c-reconnect");
    const reconnected = ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await second.take(1))[0]).result);
    expect(reconnected).toEqual({ status: "ok" }); // no token re-issued on reconnect

    second.send({ jsonrpc: "2.0", id: "m1", method: CHAT_METHODS.send, params: { characterId: "taki", message: "hi" } });
    const [ackFrame, deltaFrame] = await second.take(2);
    expect(ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(ackFrame).result).messageId.length).toBeGreaterThan(0);
    expect(notification(deltaFrame).method).toBe(CHAT_METHODS.delta);
  });

  it("T7 rejects a wrong token with AUTH_FAILED and closes the socket", async () => {
    const harness = await boot(streamingMockModel([]));
    const { client } = await pair(harness, OPERATOR_ID, "operator");
    client.close();

    const attacker = await open(harness.url);
    sendConnect(attacker, { deviceId: OPERATOR_ID, deviceName: "test", role: "operator", token: "not-the-real-token" });
    const [frame] = await attacker.take(1);

    expect(appCode(frame)).toBe("AUTH_FAILED");
    await attacker.waitClosed();
  });

  it("T8 lets a node pair but forbids it from calling chat.send", async () => {
    const harness = await boot(streamingMockModel(["hi"]));
    const { client } = await pair(harness, NODE_ID, "node");

    client.send({ jsonrpc: "2.0", id: "m1", method: CHAT_METHODS.send, params: { characterId: "taki", message: "hi" } });
    const [frame] = await client.take(1);

    expect(appCode(frame)).toBe("FORBIDDEN");
  });

  it("T9 rejects a second connect on an already-authenticated socket with ALREADY_CONNECTED", async () => {
    const harness = await boot(streamingMockModel([]));
    const { client } = await pair(harness, OPERATOR_ID, "operator");

    sendConnect(client, { deviceId: OPERATOR_ID, deviceName: "test", role: "operator" }, "again");
    const [frame] = await client.take(1);
    expect(appCode(frame)).toBe("ALREADY_CONNECTED");

    // the refusal is not fatal: the session stays authenticated and keeps dispatching
    client.send({ jsonrpc: "2.0", id: "still-alive", method: "does.not.exist", params: {} });
    const [nextFrame] = await client.take(1);
    expect(JsonRpcErrorResponseSchema.parse(nextFrame).id).toBe("still-alive");
  });

  it("removes the connection from the registry when its socket closes (no state leak)", async () => {
    const harness = await boot(streamingMockModel([]));
    const { client } = await pair(harness, OPERATOR_ID, "operator");
    expect(harness.connections.list()).toHaveLength(1);

    client.close();
    await vi.waitFor(() => {
      expect(harness.connections.list()).toHaveLength(0);
    });
  });

  it("tracks two concurrent sockets of the same device as independent authenticated connections", async () => {
    const harness = await boot(streamingMockModel([]));
    const { token } = await pair(harness, OPERATOR_ID, "operator");

    const second = await open(harness.url);
    sendConnect(second, { deviceId: OPERATOR_ID, deviceName: "test", role: "operator", token }, "c2");
    ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await second.take(1))[0]).result);

    const states = harness.connections.list().map((connection) => connection.state);
    expect(states).toHaveLength(2);
    expect(states.every((state) => state.status === "authenticated" && state.deviceId === OPERATOR_ID)).toBe(true);
  });
});

describe("startWsServer chat.send streaming (authenticated)", () => {
  it("acks, then streams deltas, then completes — in order, all carrying characterId", async () => {
    const harness = await boot(streamingMockModel(["Hel", "lo ", "you"]));
    const { client } = await pair(harness, OPERATOR_ID, "operator");

    client.send({ jsonrpc: "2.0", id: "1", method: CHAT_METHODS.send, params: { characterId: "taki", message: "hi" } });
    const frames = await client.take(5);

    const { messageId } = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frames[0]).result);
    expect(messageId.length).toBeGreaterThan(0);

    const streamed = [frames[1], frames[2], frames[3]].map(notification);
    expect(streamed.map((n) => n.method)).toEqual([CHAT_METHODS.delta, CHAT_METHODS.delta, CHAT_METHODS.delta]);
    const deltas = streamed.map((n) => ChatDeltaSchema.parse(n.params));
    expect(deltas.map((d) => d.delta)).toEqual(["Hel", "lo ", "you"]);
    expect(deltas.every((d) => d.characterId === "taki" && d.messageId === messageId)).toBe(true);

    const done = notification(frames[4]);
    expect(done.method).toBe(CHAT_METHODS.complete);
    expect(ChatCompleteSchema.parse(done.params)).toEqual({ messageId, characterId: "taki" });
  });

  it("emits a structured chat.error on provider failure and keeps serving", async () => {
    const harness = await boot(
      failingMockModel(
        new APICallError({
          message: "Invalid API key",
          url: "https://api.example.com/chat/completions",
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        }),
      ),
    );
    const { client } = await pair(harness, OPERATOR_ID, "operator");

    client.send({ jsonrpc: "2.0", id: "1", method: CHAT_METHODS.send, params: { characterId: "taki", message: "hi" } });
    const [ackFrame, errFrame] = await client.take(2);

    const { messageId } = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(ackFrame).result);
    const errNote = notification(errFrame);
    expect(errNote.method).toBe(CHAT_METHODS.error);
    const chatError = ChatErrorSchema.parse(errNote.params);
    expect(chatError).toMatchObject({ code: "PROVIDER_ERROR", characterId: "taki", messageId });
    expect(chatError.message.length).toBeGreaterThan(0);

    // The server survived the failed turn and still answers the next request on the same socket.
    client.send({ jsonrpc: "2.0", id: "2", method: "does.not.exist", params: {} });
    const [nextFrame] = await client.take(1);
    const next = JsonRpcErrorResponseSchema.parse(nextFrame);
    expect(next.error.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    expect(next.id).toBe("2");
  });
});
