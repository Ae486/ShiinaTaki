/**
 * INPUT:  a real Core process against an isolated data dir + a local scripted OpenAI-compatible provider that answers
 *         every chat request with text and one avatar_set_expression{name:"smile"} tool call
 * OUTPUT: proves the D80 outcome path end to end: a subscribed fake Pet operator receives avatar.command with a Core
 *         commandId, answers avatar.outcome{rejected,motion_busy}, and the persisted tool result + Chat activity
 *         terminal reflect the rejection; a second operator with no subscriber gets not_rendered without waiting
 *         for the deadline
 * POS:    e2e — composes the process/RPC primitives directly (scripted provider, like core-shutdown); no LLM key,
 *         no Node binary, no production bypass
 */
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  AVATAR_METHODS,
  AvatarCommandSchema,
  AvatarOutcomeResultSchema,
  CHAT_METHODS,
  ChatActivitySchema,
  ChatSendResultSchema,
  ConnectResultSchema,
  JsonRpcSuccessResponseSchema,
  TIMELINE_METHODS,
  type AvatarCommand,
} from "@taki/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonLine } from "./fixture/line-buffer.ts";
import { fetchTimelineEntries } from "./fixture/operator-drivers.ts";
import { CORE_DIR, dummyProviderEnv } from "./fixture/paths.ts";
import { childEnv, getFreePort, killTree, spawnProc, type Proc } from "./fixture/procs.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";

const DEADLINE_MS = 5_000;

// One SSE reply per request: text + one tool call, finish_reason tool_calls. presentationTailStop then ends the turn
// after the tool settles, so exactly one provider request happens per chat.send.
function scriptedProvider(): Server {
  return createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const chunk = (delta: unknown, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(chunk({ role: "assistant", content: "好呀" }));
      response.write(chunk({ tool_calls: [{ index: 0, id: `call-${randomUUID()}`, type: "function",
        function: { name: "avatar_set_expression", arguments: JSON.stringify({ name: "smile" }) } }] }));
      response.write(chunk({}, "tool_calls"));
      response.end("data: [DONE]\n\n");
    });
  });
}

function startCore(spec: { dataDir: string; port: number; providerPort: number }): Proc {
  return spawnProc({
    command: process.execPath,
    args: ["src/main.ts"],
    cwd: CORE_DIR,
    env: childEnv({
      ...dummyProviderEnv(),
      TAKI_PROVIDER_BASE_URL: `http://127.0.0.1:${spec.providerPort}/v1`,
      TAKI_DATA_DIR: spec.dataDir,
      TAKI_WS_HOST: "127.0.0.1",
      TAKI_WS_PORT: String(spec.port),
      TAKI_TRUST_LOOPBACK_OPERATOR: "true",
      TAKI_LOG_LEVEL: "info",
      TAKI_AVATAR_OUTCOME_DEADLINE_MS: String(DEADLINE_MS),
    }),
  });
}

async function connectOperator(wsUrl: string, name: string): Promise<RpcSocket> {
  const socket = await openRpcSocket(wsUrl);
  const frame = await socket.request("connect", { deviceId: randomUUID(), deviceName: name, role: "operator", capabilities: [] });
  expect(ConnectResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result).status).toBe("ok");
  return socket;
}

async function sendAndAwaitTurn(socket: RpcSocket): Promise<{ messageId: string; elapsedMs: number }> {
  const started = Date.now();
  const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(
    await socket.request(CHAT_METHODS.send, { characterId: "taki", message: "笑一个" }),
  ).result);
  await socket.waitForNotification((note) =>
    (note.method === CHAT_METHODS.complete || note.method === CHAT_METHODS.error)
      && (note.params as { messageId?: string }).messageId === ack.messageId, 60_000);
  return { messageId: ack.messageId, elapsedMs: Date.now() - started };
}

function persistedAvatarResults(entries: Awaited<ReturnType<typeof fetchTimelineEntries>>): unknown[] {
  return entries.flatMap((entry) => entry.parts ?? [])
    .filter((part) => part.type === "tool-result" && part.toolName === "avatar_set_expression")
    .map((part) => (part as { output: { value?: unknown } }).output.value);
}

describe("avatar command outcome (D80) through a real Core", () => {
  const fixtureParent = resolve(tmpdir());
  const fixtureRoot = mkdtempSync(join(fixtureParent, "taki-avatar-outcome-"));
  const provider = scriptedProvider();
  let core: Proc | undefined;
  let wsUrl = "";
  const sockets: RpcSocket[] = [];

  beforeAll(async () => {
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const address = provider.address();
    if (!address || typeof address === "string") throw new Error("missing provider port");
    const port = await getFreePort();
    wsUrl = `ws://127.0.0.1:${port}`;
    core = startCore({ dataDir: join(fixtureRoot, "core"), port, providerPort: address.port });
    await Promise.race([
      core.stdout.waitFor((line) => jsonLine(line)?.msg === "ws server listening", 30_000),
      core.exited.then(() => { throw new Error(`core exited: ${core?.stderr.lines().slice(-5).join(" | ")}`); }),
    ]);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    if (core && core.child.exitCode === null) {
      killTree(core);
      await core.exited;
    }
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    expect(dirname(fixtureRoot)).toBe(fixtureParent);
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("a subscribed fake Pet rejects the command and the tool result + Chat activity say so", async () => {
    const pet = await connectOperator(wsUrl, "avatar-outcome-pet");
    sockets.push(pet);
    await pet.request(AVATAR_METHODS.report, { characterId: "taki", motions: [], expressions: ["smile", "default"] });
    await pet.request(AVATAR_METHODS.subscribe, { characterId: "taki" });
    await pet.request(TIMELINE_METHODS.subscribe, { characterId: "taki" });

    const reply = pet.waitForNotification((note) => note.method === AVATAR_METHODS.command, 30_000).then(async (note) => {
      const command: AvatarCommand = AvatarCommandSchema.parse(note.params);
      expect(command).toMatchObject({ characterId: "taki", kind: "expression", name: "smile" });
      expect(command.commandId.length).toBeGreaterThan(0);
      const frame = await pet.request(AVATAR_METHODS.outcome, {
        characterId: "taki", commandId: command.commandId, outcome: "rejected", reason: "motion_busy",
      });
      expect(AvatarOutcomeResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result)).toEqual({ status: "ok" });
      return command;
    });
    const turn = await sendAndAwaitTurn(pet);
    await reply;
    expect(turn.elapsedMs).toBeLessThan(DEADLINE_MS);

    const results = persistedAvatarResults(await fetchTimelineEntries(pet, "taki"));
    expect(results).toEqual([{ ok: false, outcome: "rejected", code: "AVATAR_REJECTED", reason: "motion_busy" }]);

    const terminals = pet.notifications()
      .filter((note) => note.method === CHAT_METHODS.activity)
      .map((note) => ChatActivitySchema.parse(note.params))
      .filter((event) => event.messageId === turn.messageId && event.kind === "tool.terminal");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({ outcome: "failed", message: "画面未采用这次表情或动作" });
  });

  it("with no subscriber the tool settles not_rendered without waiting for the deadline", async () => {
    for (const socket of sockets.splice(0)) socket.close();
    const chat = await connectOperator(wsUrl, "avatar-outcome-chat");
    sockets.push(chat);
    // Membership is connection-scoped: the pet socket above is closed, so nobody receives the command now.
    await new Promise((done) => setTimeout(done, 200));
    const turn = await sendAndAwaitTurn(chat);
    expect(turn.elapsedMs).toBeLessThan(DEADLINE_MS - 1_000);

    const results = persistedAvatarResults(await fetchTimelineEntries(chat, "taki"));
    expect(results).toHaveLength(2);
    expect(results[1]).toEqual({ ok: true, outcome: "not_rendered" });
  });
});
