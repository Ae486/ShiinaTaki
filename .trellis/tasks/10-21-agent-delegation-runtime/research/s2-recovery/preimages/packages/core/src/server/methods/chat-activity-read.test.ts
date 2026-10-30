import { describe, expect, it, vi } from "vitest";
import { ChatActivityReadResultSchema, ChatActivitySchema, ChatSendResultSchema, JsonRpcErrorResponseSchema,
  JsonRpcSuccessResponseSchema, type JsonRpcRequest, type Role } from "@taki/shared";
import type { ChatAgent } from "../../agents/chat-agent.ts";
import { createChatActivityProjection } from "../../agents/chat-activity-projection.ts";
import { createToolInvocationBridge } from "../../agents/tool-invocation.ts";
import { createTurnQueue } from "../../agents/turn-queue.ts";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createRunServiceStub } from "../../testing/run-service-stub.ts";
import { openClient } from "../../testing/ws-test-client.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { createTimelineSubscriptions } from "../timeline-subscriptions.ts";
import { startWsServer } from "../ws-server.ts";
import { timelineSubscribeMethod } from "./timeline-subscribe.ts";
import { chatSendMethod } from "./chat-send.ts";
import { chatActivityReadMethod } from "./chat-activity-read.ts";

function context(role: Role = "operator") {
  const notes: Array<{ method: string; params: unknown }> = [];
  const closeHandlers: Array<() => void> = [];
  const ctx: MethodContext = {
    connection: { state: { status: "authenticated", deviceId: "fixture", role, capabilities: [] } },
    notify: (method, params) => notes.push({ method, params }), close: () => undefined,
    onClose: (handler) => closeHandlers.push(handler),
  };
  return { ...ctx, notes, closeNow: () => closeHandlers.splice(0).forEach((handler) => handler()) };
}
const request = (method: string, params: unknown): JsonRpcRequest => ({ jsonrpc: "2.0", id: 1, method, params });

describe("Character-scoped live activity transport", () => {
  it("keeps the running snapshot and all its events when a second sender is admitted to the same Character queue", async () => {
    const projection = createChatActivityProjection();
    const subscriptions = createTimelineSubscriptions();
    const registry = createMethodRegistry();
    const { logger } = createCaptureLogger();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const starts: string[] = [];
    const agent: ChatAgent = { async *stream({ message }, turn) {
      starts.push(message);
      const attempt = turn?.activity?.beginAttempt(turn.attemptId);
      const invocations = createToolInvocationBridge({ runId: turn?.runId, attemptId: turn?.attemptId });
      attempt?.observe({ type: "text-delta", id: "text", text: `${message}:A` }, invocations);
      yield `${message}:A`;
      await (message === "first" ? firstGate : secondGate);
      attempt?.observe({ type: "text-delta", id: "text", text: ":B" }, invocations);
      yield ":B";
      attempt?.close(false);
    } };
    registry.register(chatSendMethod(agent, logger, { queue: createTurnQueue(), turns: createTurnRegistry(),
      live: { activity: projection, subscriptions } }, createRunServiceStub()));
    registry.register(timelineSubscribeMethod(subscriptions));
    registry.register(chatActivityReadMethod(projection));
    const first = context();
    const second = context();
    const live = (ctx: ReturnType<typeof context>) => ctx.notes.filter((note) => note.method === "chat.activity")
      .map((note) => ChatActivitySchema.parse(note.params));
    try {
      for (const ctx of [first, second]) await registry.dispatch(request("timeline.subscribe", { characterId: "taki" }), ctx);
      const firstResponse = await registry.dispatch(request("chat.send", { characterId: "taki", message: "first" }), first);
      const firstAck = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(firstResponse).result);
      await vi.waitFor(() => expect(projection.read("taki")).toMatchObject({ messageId: firstAck.messageId, seq: 2 }));

      const secondResponse = await registry.dispatch(request("chat.send", { characterId: "taki", message: "second" }), second);
      const secondAck = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(secondResponse).result);
      const snapshotResponse = await registry.dispatch(request("chat.activity.read", { characterId: "taki" }), second);
      expect(ChatActivityReadResultSchema.parse(JsonRpcSuccessResponseSchema.parse(snapshotResponse).result)).toMatchObject({
        status: "active", messageId: firstAck.messageId, seq: 2, items: [{ text: "first:A" }],
      });
      expect(starts).toEqual(["first"]);
      expect(live(first).some((event) => event.messageId === secondAck.messageId)).toBe(false);

      releaseFirst();
      await vi.waitFor(() => expect(projection.read("taki")).toMatchObject({ messageId: secondAck.messageId, seq: 2 }));
      expect(starts).toEqual(["first", "second"]);
      expect(live(first).filter((event) => event.messageId === firstAck.messageId).map((event) => event.kind))
        .toEqual(["turn.started", "text.delta", "text.delta", "turn.terminal"]);
      expect(live(first).map((event) => event.messageId))
        .toEqual([firstAck.messageId, firstAck.messageId, firstAck.messageId, firstAck.messageId, secondAck.messageId, secondAck.messageId]);
      expect(live(first)).toEqual(live(second));

      releaseSecond();
      await vi.waitFor(() => expect(projection.read("taki")).toMatchObject({ status: "terminal", messageId: secondAck.messageId }));
      expect(live(first).filter((event) => event.messageId === secondAck.messageId).map((event) => event.kind))
        .toEqual(["turn.started", "text.delta", "text.delta", "turn.terminal"]);
      expect(live(first)).toEqual(live(second));
    } finally {
      releaseFirst(); releaseSecond(); first.closeNow(); second.closeNow(); projection.dispose();
    }
  });

  it("fans out once to both windows, restores an observing window read-only, and isolates another Character", async () => {
    const projection = createChatActivityProjection();
    const subscriptions = createTimelineSubscriptions();
    const registry = createMethodRegistry();
    const { logger } = createCaptureLogger();
    let release!: () => void;
    let starts = 0;
    let signal: AbortSignal | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const agent: ChatAgent = { async *stream(_params, turn) {
      starts += 1; signal = turn?.signal;
      const attempt = turn?.activity?.beginAttempt(turn.attemptId);
      const invocations = createToolInvocationBridge({ runId: turn?.runId, attemptId: turn?.attemptId });
      attempt?.observe({ type: "text-delta", id: "a", text: "A" }, invocations); yield "A";
      await gate;
      attempt?.observe({ type: "text-delta", id: "a", text: "B" }, invocations); yield "B";
      attempt?.close(false);
    } };
    registry.register(chatSendMethod(agent, logger, { queue: createTurnQueue(), turns: createTurnRegistry(),
      live: { activity: projection, subscriptions } }, createRunServiceStub()));
    registry.register(timelineSubscribeMethod(subscriptions)); registry.register(chatActivityReadMethod(projection));
    const initiator = context(); const observer = context(); const other = context();
    for (const [ctx, characterId] of [[initiator, "taki"], [observer, "taki"], [other, "other"]] as const) {
      await registry.dispatch(request("timeline.subscribe", { characterId }), ctx);
    }
    const response = await registry.dispatch(request("chat.send", { characterId: "taki", message: "fixture" }), initiator);
    const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(response).result);
    expect(initiator.notes).toEqual([]);
    await vi.waitFor(() => expect(observer.notes.some((note) => note.method === "chat.activity"
      && ChatActivitySchema.parse(note.params).kind === "text.delta")).toBe(true));
    const live = (ctx: ReturnType<typeof context>) => ctx.notes.filter((note) => note.method === "chat.activity").map((note) => ChatActivitySchema.parse(note.params));
    expect(live(initiator)).toEqual(live(observer));
    expect(new Set(live(initiator).map((event) => event.seq)).size).toBe(live(initiator).length);
    observer.closeNow();
    expect(signal?.aborted).toBe(false);
    const replacement = context();
    await registry.dispatch(request("timeline.subscribe", { characterId: "taki" }), replacement);
    const snapshot = await registry.dispatch(request("chat.activity.read", { characterId: "taki" }), replacement);
    expect(ChatActivityReadResultSchema.parse(JsonRpcSuccessResponseSchema.parse(snapshot).result)).toMatchObject({
      status: "active", messageId: ack.messageId, items: [{ text: "A" }],
    });
    expect(projection.read("other")).toEqual({ status: "idle", characterId: "other" });
    expect(other.notes).toEqual([]);
    release();
    await vi.waitFor(() => expect(projection.read("taki").status).toBe("terminal"));
    expect(starts).toBe(1);
    expect(live(replacement).at(-1)?.kind).toBe("turn.terminal");
    initiator.closeNow(); replacement.closeNow(); other.closeNow(); projection.dispose();
  });

  it("refuses node reads/subscriptions and never reaches a read from a pre-auth socket", async () => {
    const projection = createChatActivityProjection();
    const read = vi.spyOn(projection, "read");
    const registry = createMethodRegistry();
    registry.register(chatActivityReadMethod(projection)); registry.register(timelineSubscribeMethod(createTimelineSubscriptions()));
    for (const method of ["chat.activity.read", "timeline.subscribe"]) {
      const response = JsonRpcErrorResponseSchema.parse(await registry.dispatch(request(method, { characterId: "taki" }), context("node")));
      expect(response.error.data).toMatchObject({ code: "FORBIDDEN" });
    }
    const { logger } = createCaptureLogger();
    const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: createConnectionRegistry(), logger });
    const client = await openClient(`ws://127.0.0.1:${server.port}`);
    try {
      client.send(request("chat.activity.read", { characterId: "taki" }));
      expect(JsonRpcErrorResponseSchema.safeParse((await client.take(1))[0]).success).toBe(true);
      await client.waitClosed();
      expect(read).not.toHaveBeenCalled();
    } finally { client.close(); await server.close(); projection.dispose(); }
  });
});
