import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { APICallError } from "ai";
import {
  CHAT_METHODS,
  ChatCompleteSchema,
  ChatDeltaSchema,
  ChatErrorSchema,
  ChatSendResultSchema,
  JSON_RPC_ERROR_CODES,
  JsonRpcErrorResponseSchema,
  JsonRpcNotificationSchema,
  JsonRpcSuccessResponseSchema,
  type ChatSendParams,
} from "@taki/shared";
import { createChatAgent, type ChatAgent } from "../agents/chat-agent.ts";
import { createLogger } from "../logging/logger.ts";
import { failingMockModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createMethodRegistry } from "./method-registry.ts";
import { chatSendMethod } from "./methods/chat-send.ts";
import { startWsServer, type WsServer } from "./ws-server.ts";

const logger = createLogger("fatal"); // keep test output clean

interface TestClient {
  send(frame: unknown): void;
  sendRaw(text: string): void;
  take(count: number): Promise<unknown[]>;
  close(): void;
}

function makeClient(ws: WebSocket): TestClient {
  const queue: unknown[] = [];
  let waiter: ((frame: unknown) => void) | null = null;
  ws.on("message", (data) => {
    const frame: unknown = JSON.parse(data.toString());
    if (waiter) {
      const resolve = waiter;
      waiter = null;
      resolve(frame);
    } else {
      queue.push(frame);
    }
  });
  const next = (): Promise<unknown> =>
    new Promise((resolve) => {
      const queued = queue.shift();
      if (queued !== undefined) resolve(queued);
      else waiter = resolve;
    });
  return {
    send: (frame) => ws.send(JSON.stringify(frame)),
    sendRaw: (text) => ws.send(text),
    take: async (count) => {
      const frames: unknown[] = [];
      for (let i = 0; i < count; i += 1) frames.push(await next());
      return frames;
    },
    close: () => ws.close(),
  };
}

const servers: WsServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

async function boot(agent: ChatAgent): Promise<TestClient> {
  const registry = createMethodRegistry();
  registry.register(chatSendMethod(agent, logger));
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, logger });
  servers.push(server);
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
  await once(ws, "open");
  const client = makeClient(ws);
  clients.push(client);
  return client;
}

function sendRequest(client: TestClient, params: ChatSendParams, id: string): void {
  client.send({ jsonrpc: "2.0", id, method: CHAT_METHODS.send, params });
}

function notification(frame: unknown): { method: string; params: unknown } {
  const note = JsonRpcNotificationSchema.parse(frame);
  return { method: note.method, params: note.params };
}

describe("startWsServer envelope errors", () => {
  it("T6 replies PARSE_ERROR (id null) to malformed JSON", async () => {
    const client = await boot(createChatAgent({ model: streamingMockModel([]) }));

    client.sendRaw("definitely not json {");
    const [frame] = await client.take(1);

    const res = JsonRpcErrorResponseSchema.parse(frame);
    expect(res.error.code).toBe(JSON_RPC_ERROR_CODES.PARSE_ERROR);
    expect(res.id).toBeNull();
  });

  it("T7 replies INVALID_REQUEST to valid JSON that is not a frame", async () => {
    const client = await boot(createChatAgent({ model: streamingMockModel([]) }));

    client.send({ foo: 1 });
    const [frame] = await client.take(1);

    const res = JsonRpcErrorResponseSchema.parse(frame);
    expect(res.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_REQUEST);
  });
});

describe("startWsServer chat.send streaming", () => {
  it("T8 acks, then streams deltas, then completes — in order, all carrying characterId", async () => {
    const client = await boot(createChatAgent({ model: streamingMockModel(["Hel", "lo ", "you"]) }));

    sendRequest(client, { characterId: "taki", message: "hi" }, "1");
    const frames = await client.take(5);

    const ack = JsonRpcSuccessResponseSchema.parse(frames[0]);
    const { messageId } = ChatSendResultSchema.parse(ack.result);
    expect(messageId.length).toBeGreaterThan(0);

    const streamed = [frames[1], frames[2], frames[3]].map(notification);
    expect(streamed.map((n) => n.method)).toEqual([CHAT_METHODS.delta, CHAT_METHODS.delta, CHAT_METHODS.delta]);
    const parsed = streamed.map((n) => ChatDeltaSchema.parse(n.params));
    expect(parsed.map((d) => d.delta)).toEqual(["Hel", "lo ", "you"]);
    expect(parsed.every((d) => d.characterId === "taki" && d.messageId === messageId)).toBe(true);

    const done = notification(frames[4]);
    expect(done.method).toBe(CHAT_METHODS.complete);
    const complete = ChatCompleteSchema.parse(done.params);
    expect(complete).toEqual({ messageId, characterId: "taki" });
  });

  it("T9 emits a structured chat.error on provider failure and keeps serving", async () => {
    const failing = createChatAgent({
      model: failingMockModel(
        new APICallError({
          message: "Invalid API key",
          url: "https://api.example.com/chat/completions",
          requestBodyValues: {},
          statusCode: 401,
          isRetryable: false,
        }),
      ),
    });
    const client = await boot(failing);

    sendRequest(client, { characterId: "taki", message: "hi" }, "1");
    const [ackFrame, errFrame] = await client.take(2);

    const { messageId } = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(ackFrame).result);
    const errNote = notification(errFrame);
    expect(errNote.method).toBe(CHAT_METHODS.error);
    const chatError = ChatErrorSchema.parse(errNote.params);
    expect(chatError.code).toBe("PROVIDER_ERROR");
    expect(chatError.characterId).toBe("taki");
    expect(chatError.messageId).toBe(messageId);
    expect(chatError.message.length).toBeGreaterThan(0);

    // The server survived the failed turn and still answers the next request.
    client.send({ jsonrpc: "2.0", id: "2", method: "does.not.exist", params: {} });
    const [nextFrame] = await client.take(1);
    const next = JsonRpcErrorResponseSchema.parse(nextFrame);
    expect(next.error.code).toBe(JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
    expect(next.id).toBe("2");
  });
});
