import { afterEach, describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { ChatSendResultSchema, JsonRpcSuccessResponseSchema, type JsonRpcRequest, type Role } from "@taki/shared";
import type { ChatAgent } from "../../agents/chat-agent.ts";
import { createTurnQueue } from "../../agents/turn-queue.ts";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createRunRepo } from "../../db/run-repo.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createRunService, type RunService } from "../../harness/run-service.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createRunServiceStub } from "../../testing/run-service-stub.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext, type MethodRegistry } from "../method-registry.ts";
import { chatCancelMethod } from "./chat-cancel.ts";
import { chatSendMethod, type TurnControls } from "./chat-send.ts";

interface CapturedCtx extends MethodContext {
  notes: { method: string; params: unknown }[];
  closeNow(): void;
}

function ctxFor(role: Role): CapturedCtx {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d", role, capabilities: [] } };
  const notes: { method: string; params: unknown }[] = [];
  const closeListeners: (() => void)[] = [];
  return {
    notify: (method, params) => notes.push({ method, params }),
    connection,
    close: () => undefined,
    onClose: (listener) => closeListeners.push(listener),
    notes,
    closeNow: () => closeListeners.splice(0).forEach((listener) => listener()),
  };
}

function request(method: string, params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: "1", method, params };
}

function harness(agent: ChatAgent, runs: RunService = createRunServiceStub()): { registry: MethodRegistry; controls: TurnControls } {
  const { logger } = createCaptureLogger();
  const controls: TurnControls = { queue: createTurnQueue(), turns: createTurnRegistry() };
  const registry = createMethodRegistry();
  registry.register(chatSendMethod(agent, logger, controls, runs));
  registry.register(chatCancelMethod(controls.turns, runs));
  return { registry, controls };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const memoryCapabilities = { providerId: "legacy-markdown", contractVersion: 1 as const, retain: true, recall: true,
  reflect: false, edit: false, invalidate: true, restore: false, conditionalMutation: false,
  idempotentWrites: false, sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };

function durableRuns(): RunService {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createRunService({
    repo: createRunRepo(db),
    provider: "test",
    modelId: "test",
    snapshot: { async capture(input) { return { snapshot: { schemaVersion: "test.v1",
      characterId: input.characterId, initiator: input.initiator, provenance: input.provenance,
      deliveryClass: input.deliveryClass, contextMode: input.contextMode, modelProvider: "test", modelId: "test",
      primaryHostId: "core-host", hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64),
      governance: { policyGeneration: 1, registryRevision: 1, approvalGeneration: 1 },
      memory: { providerId: "legacy-markdown", contractVersion: 1, capabilities: memoryCapabilities,
        capabilityDigest: "b".repeat(64) }, contextDecision: { sourceCategories: ["character"], tokenAccounting: "unknown" },
      replayDecision: { status: "not_captured" }, budget: {}, implementation: { runtimeVersion: "slice1", schemaVersion: "test.v1" }, sourceRefs: [] } }; } },
  });
}

describe("chatSendMethod durable Harness admission", () => {
  it("acks a queryable Run before streaming and atomically settles its Receipt", async () => {
    const runs = durableRuns();
    const agent: ChatAgent = { async *stream() { yield "ok"; } };
    const { registry } = harness(agent, runs);
    const ctx = ctxFor("operator");
    const response = await registry.dispatch(request("chat.send", { characterId: "taki", message: "hi" }), ctx);
    const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(response).result);
    expect(runs.status(ack.runId).run.state).toBe("queued");
    await vi.waitFor(() => expect(runs.status(ack.runId).run.state).toBe("completed"));
    expect(runs.status(ack.runId)).toMatchObject({ attempts: [{ state: "completed" }],
      receipt: { outcome: "completed", attemptCount: 1 } });
  });

  it("keeps the mutable turn identity in sync when overflow replaces the Attempt", async () => {
    const runs = durableRuns();
    const seen: string[] = [];
    const agent: ChatAgent = {
      async *stream(_params, turn) {
        seen.push(turn?.attemptId ?? "missing");
        expect(turn?.onRetry?.("context_overflow")).toBe(true);
        seen.push(turn?.attemptId ?? "missing");
        yield "ok";
      },
    };
    const { registry } = harness(agent, runs);
    const ctx = ctxFor("operator");
    const response = await registry.dispatch(request("chat.send", { characterId: "taki", message: "hi" }), ctx);
    const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(response).result);

    await vi.waitFor(() => expect(runs.status(ack.runId).run.state).toBe("completed"));
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(runs.status(ack.runId).attempts).toMatchObject([
      { ordinal: 1, state: "failed" },
      { ordinal: 2, state: "completed" },
    ]);
  });

  it("durably cancels a queued close before the second model effect can start", async () => {
    const runs = durableRuns();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const seen: string[] = [];
    const agent: ChatAgent = { async *stream({ message }) { seen.push(message); if (message === "first") await gate; yield message; } };
    const { registry } = harness(agent, runs);
    const firstCtx = ctxFor("operator");
    const secondCtx = ctxFor("operator");
    await registry.dispatch(request("chat.send", { characterId: "taki", message: "first" }), firstCtx);
    await vi.waitFor(() => expect(seen).toEqual(["first"]));
    const second = await registry.dispatch(request("chat.send", { characterId: "taki", message: "second" }), secondCtx);
    const secondAck = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(second).result);
    secondCtx.closeNow();
    releaseFirst();
    await vi.waitFor(() => expect(runs.status(secondAck.runId).run.state).toBe("cancelled"));
    expect(seen).toEqual(["first"]);
    expect(runs.status(secondAck.runId).attempts[0]?.state).toBe("cancelled");
  });

  it("cancels an exact queued Run without aborting the active Run for the same character", async () => {
    const runs = durableRuns();
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const seen: string[] = [];
    const agent: ChatAgent = { async *stream({ message }) { seen.push(message); if (message === "first") await gate; yield message; } };
    const { registry } = harness(agent, runs);
    const first = await registry.dispatch(request("chat.send", { characterId: "taki", message: "first" }), ctxFor("operator"));
    const firstAck = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(first).result);
    await vi.waitFor(() => expect(seen).toEqual(["first"]));
    const second = await registry.dispatch(request("chat.send", { characterId: "taki", message: "second" }), ctxFor("operator"));
    const secondAck = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(second).result);

    const cancel = await registry.dispatch(request("chat.cancel", { characterId: "taki", runId: secondAck.runId }), ctxFor("operator"));
    expect(JsonRpcSuccessResponseSchema.parse(cancel).result).toEqual({ cancelled: true });
    expect(runs.status(firstAck.runId).run.state).toBe("running");
    releaseFirst();
    await vi.waitFor(() => expect(runs.status(secondAck.runId).run.state).toBe("cancelled"));
    expect(seen).toEqual(["first"]);
  });

  it("refuses an exact cancel when the Run belongs to a different character", async () => {
    const runs = durableRuns();
    const admitted = await runs.admit({ triggerRequestId: "trigger-yui", idempotencyKey: "idem-yui",
      characterId: "yui", initiator: "primary", provenance: { provider: "chat" },
      deliveryClass: "class_a", contextMode: "primary" });
    const { registry } = harness({ async *stream() { yield "unused"; } }, runs);
    const response = await registry.dispatch(request("chat.cancel", { characterId: "taki", runId: admitted.run.runId }), ctxFor("operator"));
    expect(JsonRpcSuccessResponseSchema.parse(response).result).toEqual({ cancelled: false });
    expect(runs.status(admitted.run.runId).run.state).toBe("queued");
  });

  it("keeps provider bodies and prompt-like error text out of durable Run evidence", async () => {
    const sentinel = "SENTINEL-RAW-PROMPT-AND-SECRET";
    const runs = durableRuns();
    const agent: ChatAgent = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new APICallError({
          message: `provider echoed ${sentinel}`,
          url: "https://provider.invalid/chat",
          requestBodyValues: { prompt: sentinel },
          statusCode: 500,
          responseHeaders: {},
          responseBody: sentinel,
          isRetryable: true,
        });
      },
    };
    const ctx = ctxFor("operator");
    const { registry } = harness(agent, runs);
    const response = await registry.dispatch(request("chat.send", { characterId: "taki", message: "hi" }), ctx);
    const ack = ChatSendResultSchema.parse(JsonRpcSuccessResponseSchema.parse(response).result);
    await vi.waitFor(() => expect(runs.status(ack.runId).run.state).toBe("failed"));
    const status = runs.status(ack.runId);
    expect(JSON.stringify(status)).not.toContain(sentinel);
    expect(JSON.stringify(ctx.notes)).not.toContain(sentinel);
    expect(status).toMatchObject({ attempts: [{ resultSummary: "Provider request failed (HTTP 500)", errorCode: "500" }],
      receipt: { summary: "Provider request failed (HTTP 500)" } });
  });

  it("treats an unknown exact Run cancel as an idempotent no-op", async () => {
    const runs = durableRuns();
    const { registry } = harness({ async *stream() { yield "unused"; } }, runs);
    const response = await registry.dispatch(request("chat.cancel", {
      characterId: "taki", runId: "550e8400-e29b-41d4-a716-446655440099",
    }), ctxFor("operator"));
    expect(JsonRpcSuccessResponseSchema.parse(response).result).toEqual({ cancelled: false });
  });
});

describe("chatSendMethod turn serialization (D1 #3)", () => {
  it("a second send for the same character starts only after the first turn fully ends", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const agent: ChatAgent = {
      async *stream({ message }) {
        events.push(`start:${message}`);
        if (calls++ === 0) await gate;
        yield message;
        events.push(`end:${message}`);
      },
    };
    const { registry } = harness(agent);
    const ctx = ctxFor("operator");

    await registry.dispatch(request("chat.send", { characterId: "taki", message: "m1" }), ctx);
    await registry.dispatch(request("chat.send", { characterId: "taki", message: "m2" }), ctx);
    await sleep(20);
    expect(events).toEqual(["start:m1"]); // m2 must NOT interleave while m1 is mid-turn

    releaseFirst();
    await vi.waitFor(() => {
      expect(events).toEqual(["start:m1", "end:m1", "start:m2", "end:m2"]);
    });
  });
});

describe("chatCancelMethod (D1 #4)", () => {
  it("aborts the in-flight turn: the stream ends and chat.complete still closes the exchange", async () => {
    const agent: ChatAgent = {
      async *stream(_params, turn) {
        while (turn?.signal?.aborted !== true) {
          await sleep(5);
          yield ".";
        }
      },
    };
    const { registry } = harness(agent);
    const ctx = ctxFor("operator");

    await registry.dispatch(request("chat.send", { characterId: "taki", message: "go" }), ctx);
    await vi.waitFor(() => {
      expect(ctx.notes.some((note) => note.method === "chat.delta")).toBe(true);
    });

    const res = await registry.dispatch(request("chat.cancel", { characterId: "taki" }), ctx);
    expect(JsonRpcSuccessResponseSchema.parse(res).result).toEqual({ cancelled: true });
    await vi.waitFor(() => {
      expect(ctx.notes.some((note) => note.method === "chat.complete")).toBe(true);
    });
  });

  it("reports cancelled:false when the character has no active turn", async () => {
    const agent: ChatAgent = {
      // eslint-disable-next-line require-yield
      async *stream() {
        return;
      },
    };
    const { registry } = harness(agent);

    const res = await registry.dispatch(request("chat.cancel", { characterId: "taki" }), ctxFor("operator"));
    expect(JsonRpcSuccessResponseSchema.parse(res).result).toEqual({ cancelled: false });
  });

  it("is operator-only (a node may not cancel turns)", async () => {
    const agent: ChatAgent = {
      // eslint-disable-next-line require-yield
      async *stream() {
        return;
      },
    };
    const { registry } = harness(agent);

    const res = await registry.dispatch(request("chat.cancel", { characterId: "taki" }), ctxFor("node"));
    expect(res).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
  });
});

describe("chatSendMethod cancel-retract (M4 closeout)", () => {
  it("closes a retracted turn with chat.error { retracted: true } and never chat.complete", async () => {
    const agent: ChatAgent = {
      // eslint-disable-next-line require-yield
      async *stream(_params, turn) {
        // Mimic the agent's retract seam: nothing streamed, the user row was deleted, signal the pump.
        turn?.onRetract?.();
        return;
      },
    };
    const { registry } = harness(agent);
    const ctx = ctxFor("operator");

    await registry.dispatch(request("chat.send", { characterId: "taki", message: "oops" }), ctx);
    await vi.waitFor(() => {
      expect(ctx.notes.some((note) => note.method === "chat.error")).toBe(true);
    });
    expect(ctx.notes.find((note) => note.method === "chat.error")?.params).toMatchObject({
      characterId: "taki",
      code: "PROVIDER_ERROR",
      retracted: true,
    });
    expect(ctx.notes.some((note) => note.method === "chat.complete")).toBe(false);
  });

  it("a normal (non-retracted) turn still closes with chat.complete", async () => {
    const agent: ChatAgent = {
      async *stream({ message }) {
        yield message;
      },
    };
    const { registry } = harness(agent);
    const ctx = ctxFor("operator");

    await registry.dispatch(request("chat.send", { characterId: "taki", message: "hi" }), ctx);
    await vi.waitFor(() => {
      expect(ctx.notes.some((note) => note.method === "chat.complete")).toBe(true);
    });
    expect(ctx.notes.some((note) => note.method === "chat.error")).toBe(false);
  });
});
