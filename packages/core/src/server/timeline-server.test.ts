import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  CHAT_METHODS,
  ConnectResultSchema,
  JsonRpcSuccessResponseSchema,
  TIMELINE_METHODS,
  TimelineEntrySchema,
  TimelineHistoryResultSchema,
  type ConnectResult,
  type Role,
} from "@taki/shared";
import { createChatAgent } from "../agents/chat-agent.ts";
import { createConversationStore } from "../agents/conversation-store.ts";
import { createTurnQueue } from "../agents/turn-queue.ts";
import { createTurnRegistry } from "../agents/turn-registry.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createTimelineRepo, type TimelineRepo } from "../db/timeline-repo.ts";
import { createDeviceRegistry } from "../devices/device-registry.ts";
import { createPairedDeviceStore } from "../devices/paired-device-store.ts";
import { createLogger } from "../logging/logger.ts";
import { createMemoryEngine } from "../memory/memory-engine.ts";
import { streamingMockModel } from "../testing/mock-language-model.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { appCode, notification, openClient, sendConnect, type TestClient } from "../testing/ws-test-client.ts";
import { createConnectionRegistry } from "./connection-registry.ts";
import { createMethodRegistry } from "./method-registry.ts";
import { chatSendMethod } from "./methods/chat-send.ts";
import { connectMethod, type PairingCodeInfo } from "./methods/connect.ts";
import { timelineHistoryMethod } from "./methods/timeline-history.ts";
import { timelineSubscribeMethod } from "./methods/timeline-subscribe.ts";
import { createTimelineSubscriptions, type TimelineSubscriptions } from "./timeline-subscriptions.ts";
import { startWsServer } from "./ws-server.ts";

const logger = createLogger("fatal");
const OPERATOR_ID = "550e8400-e29b-41d4-a716-446655440000";
const OPERATOR_ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const NODE_ID = "550e8400-e29b-41d4-a716-446655440001";

interface ServerHarness {
  url: string;
  codes: PairingCodeInfo[];
  subscriptions: TimelineSubscriptions;
  repo: TimelineRepo;
  db: Database;
  close(): Promise<void>;
}

const harnesses: ServerHarness[] = [];
const clients: TestClient[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await Promise.all(harnesses.map((harness) => harness.close()));
  harnesses.length = 0;
  for (const dir of dirs) rmTempDir(dir);
  dirs.length = 0;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "taki-tl-"));
  dirs.push(dir);
  return dir;
}

interface BootOptions {
  dataDir: string;
  model: LanguageModel;
}

// Replicates main.ts wiring so restart (T7) and fan-out (T6) exercise the real composition over a real socket.
async function bootServer(options: BootOptions): Promise<ServerHarness> {
  const db = openDatabase({ path: join(options.dataDir, "taki.db"), migrations: MIGRATIONS });
  const repo = createTimelineRepo(db);
  const subscriptions = createTimelineSubscriptions();
  const store = createConversationStore({ repo, onAppend: (entry) => subscriptions.publish(entry) });
  const deviceRegistry = createDeviceRegistry({ store: createPairedDeviceStore(join(options.dataDir, "devices.json")) });
  const connectionRegistry = createConnectionRegistry();
  const codes: PairingCodeInfo[] = [];
  const registry = createMethodRegistry();
  registry.register(connectMethod({ deviceRegistry, connectionRegistry, onPairingCode: (info) => codes.push(info) }));
  const memory = createMemoryEngine({ db, memoryRoot: join(options.dataDir, "workspace", "memory") });
  memory.reconcile();
  registry.register(
    chatSendMethod(createChatAgent({ model: options.model, store, memory }), logger, {
      queue: createTurnQueue(),
      turns: createTurnRegistry(),
    }),
  );
  registry.register(timelineHistoryMethod(repo));
  registry.register(timelineSubscribeMethod(subscriptions));
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry, logger });
  let closed = false;
  const harness: ServerHarness = {
    url: `ws://127.0.0.1:${server.port}`,
    codes,
    subscriptions,
    repo,
    db,
    close: async () => {
      if (closed) return;
      closed = true;
      await server.close();
      db.close();
    },
  };
  harnesses.push(harness);
  return harness;
}

async function open(url: string): Promise<TestClient> {
  const client = await openClient(url);
  clients.push(client);
  return client;
}

interface Identity {
  deviceId: string;
  role: Role;
  token?: string;
}

/** Pairs (or, with a token, reconnects) a device and returns its authenticated client + issued token. */
async function connect(harness: ServerHarness, identity: Identity): Promise<{ client: TestClient; token: string }> {
  const { deviceId, role, token } = identity;
  const client = await open(harness.url);
  if (token !== undefined) {
    sendConnect(client, { deviceId, deviceName: "test", role, token });
    return { client, token: parseOk(await client.take(1)).token ?? token };
  }
  sendConnect(client, { deviceId, deviceName: "test", role });
  expect(appCode((await client.take(1))[0])).toBe("PAIRING_REQUIRED");
  sendConnect(client, { deviceId, deviceName: "test", role, pairingCode: harness.codes.at(-1)?.code }, "c-pair");
  return { client, token: parseOk(await client.take(1)).token ?? "" };
}

function parseOk(frames: unknown[]): ConnectResult {
  const result = ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frames[0]).result);
  expect(result.status).toBe("ok");
  return result;
}

/** Drives one chat turn to completion, skipping the ack + deltas; throws on chat.error. */
async function runChatTurn(client: TestClient, message: string): Promise<void> {
  client.send({ jsonrpc: "2.0", id: "turn", method: CHAT_METHODS.send, params: { characterId: "taki", message } });
  for (;;) {
    const [frame] = await client.take(1);
    const method = (frame as { method?: string }).method;
    if (method === CHAT_METHODS.complete) return;
    if (method === CHAT_METHODS.error) throw new Error("chat turn errored");
  }
}

function historyRequest(client: TestClient, params: Record<string, unknown>): void {
  client.send({ jsonrpc: "2.0", id: "h", method: TIMELINE_METHODS.history, params });
}

describe("timeline.history over WS", () => {
  it("T5 pages the timeline backward across two pages for a paired operator", async () => {
    const harness = await bootServer({ dataDir: tempDir(), model: streamingMockModel([]) });
    for (let i = 1; i <= 3; i += 1) harness.repo.append({ characterId: "taki", role: "user", content: `m${i}` });
    const { client } = await connect(harness, { deviceId: OPERATOR_ID, role: "operator" });

    historyRequest(client, { characterId: "taki", limit: 2 });
    const page1 = TimelineHistoryResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await client.take(1))[0]).result);
    expect(page1.entries.map((entry) => entry.content)).toEqual(["m3", "m2"]);
    expect(page1.nextBefore).not.toBeNull();

    historyRequest(client, { characterId: "taki", before: page1.nextBefore, limit: 2 });
    const page2 = TimelineHistoryResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await client.take(1))[0]).result);
    expect(page2.entries.map((entry) => entry.content)).toEqual(["m1"]);
    expect(page2.nextBefore).toBeNull();
  });

  it("T5 forbids a node from calling timeline.history", async () => {
    const harness = await bootServer({ dataDir: tempDir(), model: streamingMockModel([]) });
    const { client } = await connect(harness, { deviceId: NODE_ID, role: "node" });

    historyRequest(client, { characterId: "taki" });
    expect(appCode((await client.take(1))[0])).toBe("FORBIDDEN");
  });
});

describe("timeline.subscribe fan-out over WS", () => {
  it("T6 pushes timeline.appended for the user and assistant turns to a subscriber, not to a non-subscriber", async () => {
    const harness = await bootServer({ dataDir: tempDir(), model: streamingMockModel(["Hi ", "there"]) });
    const { client: subscriber } = await connect(harness, { deviceId: OPERATOR_ID, role: "operator" });
    const { client: chatter } = await connect(harness, { deviceId: OPERATOR_ID_2, role: "operator" });

    subscriber.send({ jsonrpc: "2.0", id: "s1", method: TIMELINE_METHODS.subscribe, params: { characterId: "taki" } });
    expect(JsonRpcSuccessResponseSchema.parse((await subscriber.take(1))[0]).result).toEqual({ status: "ok" });
    expect(harness.subscriptions.count("taki")).toBe(1);

    chatter.send({ jsonrpc: "2.0", id: "c1", method: CHAT_METHODS.send, params: { characterId: "taki", message: "hello" } });

    const [userPush, asstPush] = await subscriber.take(2);
    expect(notification(userPush).method).toBe(TIMELINE_METHODS.appended);
    expect(TimelineEntrySchema.parse(notification(userPush).params)).toMatchObject({ role: "user", content: "hello" });
    expect(TimelineEntrySchema.parse(notification(asstPush).params)).toMatchObject({ role: "assistant", content: "Hi there" });

    // The chatter never subscribed: its frames are the chat ack + deltas + complete, no timeline.appended.
    const chatterFrames = await chatter.take(4);
    expect(chatterFrames.map((frame) => (frame as { method?: string }).method)).not.toContain(TIMELINE_METHODS.appended);
  });

  it("T6 auto-unsubscribes a connection when its socket closes", async () => {
    const harness = await bootServer({ dataDir: tempDir(), model: streamingMockModel([]) });
    const { client } = await connect(harness, { deviceId: OPERATOR_ID, role: "operator" });

    client.send({ jsonrpc: "2.0", id: "s1", method: TIMELINE_METHODS.subscribe, params: { characterId: "taki" } });
    await client.take(1);
    expect(harness.subscriptions.count("taki")).toBe(1);

    client.close();
    await vi.waitFor(() => expect(harness.subscriptions.count("taki")).toBe(0));
  });
});

describe("timeline restart integration (AC-2)", () => {
  it("T7 persists the timeline across a full restart and replays it to the model", async () => {
    const dataDir = tempDir();

    // --- first boot: pair, run one chat turn, then shut down server + db ---
    const first = await bootServer({ dataDir, model: streamingMockModel(["Nice to meet you"]) });
    const { client: c1, token } = await connect(first, { deviceId: OPERATOR_ID, role: "operator" });
    await runChatTurn(c1, "remember apples");
    await first.close();

    // --- second boot on the SAME dataDir: reconnect with the stored token ---
    const model2 = streamingMockModel(["Sure"]);
    const second = await bootServer({ dataDir, model: model2 });
    const { client: c2 } = await connect(second, { deviceId: OPERATOR_ID, role: "operator", token });

    historyRequest(c2, { characterId: "taki", limit: 10 });
    const page = TimelineHistoryResultSchema.parse(JsonRpcSuccessResponseSchema.parse((await c2.take(1))[0]).result);
    expect(page.entries.map((entry) => ({ role: entry.role, content: entry.content }))).toEqual([
      { role: "assistant", content: "Nice to meet you" },
      { role: "user", content: "remember apples" },
    ]);

    // A fresh turn's model call must include the replayed prior history (ascending), then the new message,
    // behind the assembled system prompt (memory context).
    await runChatTurn(c2, "what did I say?");
    const prompt = model2.doStreamCalls[0]?.prompt ?? [];
    expect(prompt[0]?.role).toBe("system");
    expect(prompt.filter((message) => message.role !== "system").map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    const serialized = JSON.stringify(prompt);
    expect(serialized).toContain("remember apples");
    expect(serialized).toContain("Nice to meet you");
    expect(serialized).toContain("what did I say?");
  });
});
