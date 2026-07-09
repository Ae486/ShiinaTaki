import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  CHAT_METHODS,
  ChatSendParamsSchema,
  JSON_RPC_APP_ERROR,
  JsonRpcRequestSchema,
  type ChatSendParams,
  type JsonRpcId,
} from "@taki/shared";
import { connectChatClient, type ChatClient } from "./chat-client.ts";

const DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";

interface ScriptApi {
  send: (frame: unknown) => void;
  requestId: JsonRpcId;
  params: ChatSendParams;
}

interface ScriptedServer {
  url: string;
  close: () => Promise<void>;
}

/** A ws server that runs `onRequest` for each chat.send it receives, letting the test script the reply frames. */
async function scriptServer(onRequest: (api: ScriptApi) => void): Promise<ScriptedServer> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const request = JsonRpcRequestSchema.parse(JSON.parse(data.toString()));
      onRequest({
        send: (frame) => socket.send(JSON.stringify(frame)),
        requestId: request.id,
        params: ChatSendParamsSchema.parse(request.params),
      });
    });
  });
  await once(wss, "listening");
  const address = wss.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of wss.clients) client.terminate();
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const servers: ScriptedServer[] = [];
const clients: ChatClient[] = [];

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

async function boot(onRequest: (api: ScriptApi) => void): Promise<ChatClient> {
  const server = await scriptServer(onRequest);
  servers.push(server);
  const client = await connectChatClient(server.url);
  clients.push(client);
  return client;
}

describe("connectChatClient", () => {
  it("T12 renders streamed deltas in order and resolves on complete", async () => {
    const client = await boot(({ send, requestId, params }) => {
      const messageId = "m-1";
      send({ jsonrpc: "2.0", id: requestId, result: { messageId } });
      for (const delta of ["Hel", "lo ", "you"]) {
        send({
          jsonrpc: "2.0",
          method: CHAT_METHODS.delta,
          params: { messageId, characterId: params.characterId, delta },
        });
      }
      send({ jsonrpc: "2.0", method: CHAT_METHODS.complete, params: { messageId, characterId: params.characterId } });
    });

    const received: string[] = [];
    let completed = false;
    await client.chat(
      { characterId: "taki", message: "hi" },
      {
        onDelta: (delta) => received.push(delta),
        onComplete: () => {
          completed = true;
        },
      },
    );

    expect(received).toEqual(["Hel", "lo ", "you"]);
    expect(completed).toBe(true);
  });

  it("T13 surfaces a chat.error with its code and settles the turn", async () => {
    const client = await boot(({ send, requestId, params }) => {
      const messageId = "m-1";
      send({ jsonrpc: "2.0", id: requestId, result: { messageId } });
      send({
        jsonrpc: "2.0",
        method: CHAT_METHODS.error,
        params: { messageId, characterId: params.characterId, code: "PROVIDER_ERROR", message: "boom" },
      });
    });

    const errors: Array<{ code: string; message: string }> = [];
    await client.chat(
      { characterId: "taki", message: "hi" },
      { onDelta: () => {}, onError: (code, message) => errors.push({ code, message }) },
    );

    expect(errors).toEqual([{ code: "PROVIDER_ERROR", message: "boom" }]);
  });
});

interface ConnectApi {
  send: (frame: unknown) => void;
  requestId: JsonRpcId;
  params: Record<string, unknown>;
}

/** A ws server that runs `onConnect` for each connect request, letting the test script the reply. */
async function scriptConnect(onConnect: (api: ConnectApi) => void): Promise<ScriptedServer> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const request = JsonRpcRequestSchema.parse(JSON.parse(data.toString()));
      onConnect({
        send: (frame) => socket.send(JSON.stringify(frame)),
        requestId: request.id,
        params: (request.params ?? {}) as Record<string, unknown>,
      });
    });
  });
  await once(wss, "listening");
  const address = wss.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `ws://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of wss.clients) client.terminate();
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function bootConnect(onConnect: (api: ConnectApi) => void): Promise<ChatClient> {
  const server = await scriptConnect(onConnect);
  servers.push(server);
  const client = await connectChatClient(server.url);
  clients.push(client);
  return client;
}

describe("ChatClient.connect (pairing handshake)", () => {
  it("T11 surfaces PAIRING_REQUIRED, then succeeds with a code and exposes the token", async () => {
    const client = await bootConnect(({ send, requestId, params }) => {
      if (params.pairingCode === undefined) {
        send({
          jsonrpc: "2.0",
          id: requestId,
          error: { code: JSON_RPC_APP_ERROR, message: "pairing required", data: { code: "PAIRING_REQUIRED" } },
        });
      } else {
        send({ jsonrpc: "2.0", id: requestId, result: { status: "ok", token: "tok-xyz" } });
      }
    });

    const first = await client.connect({ deviceId: DEVICE_ID, deviceName: "laptop", role: "operator", capabilities: [] });
    expect(first).toEqual({ ok: false, code: "PAIRING_REQUIRED", message: "pairing required" });

    const second = await client.connect({
      deviceId: DEVICE_ID,
      deviceName: "laptop",
      role: "operator",
      capabilities: [],
      pairingCode: "123456",
    });
    expect(second).toEqual({ ok: true, token: "tok-xyz" });
  });

  it("T11 returns ok without a token on a token reconnect", async () => {
    const client = await bootConnect(({ send, requestId }) => {
      send({ jsonrpc: "2.0", id: requestId, result: { status: "ok" } });
    });

    const outcome = await client.connect({
      deviceId: DEVICE_ID,
      deviceName: "laptop",
      role: "operator",
      capabilities: [],
      token: "tok",
    });
    expect(outcome).toEqual({ ok: true, token: undefined });
  });
});
