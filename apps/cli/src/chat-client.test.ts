import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  CHAT_METHODS,
  ChatSendParamsSchema,
  JsonRpcRequestSchema,
  type ChatSendParams,
  type JsonRpcId,
} from "@taki/shared";
import { connectChatClient, type ChatClient } from "./chat-client.ts";

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
