import { describe, expect, it, vi } from "vitest";
import { JsonRpcSuccessResponseSchema, type JsonRpcRequest, type Role } from "@taki/shared";
import type { ChatAgent } from "../../agents/chat-agent.ts";
import { createTurnQueue } from "../../agents/turn-queue.ts";
import { createTurnRegistry } from "../../agents/turn-registry.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext, type MethodRegistry } from "../method-registry.ts";
import { chatCancelMethod } from "./chat-cancel.ts";
import { chatSendMethod, type TurnControls } from "./chat-send.ts";

interface CapturedCtx extends MethodContext {
  notes: { method: string; params: unknown }[];
}

function ctxFor(role: Role): CapturedCtx {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d", role, capabilities: [] } };
  const notes: { method: string; params: unknown }[] = [];
  return {
    notify: (method, params) => notes.push({ method, params }),
    connection,
    close: () => undefined,
    onClose: () => undefined,
    notes,
  };
}

function request(method: string, params: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id: "1", method, params };
}

function harness(agent: ChatAgent): { registry: MethodRegistry; controls: TurnControls } {
  const { logger } = createCaptureLogger();
  const controls: TurnControls = { queue: createTurnQueue(), turns: createTurnRegistry() };
  const registry = createMethodRegistry();
  registry.register(chatSendMethod(agent, logger, controls));
  registry.register(chatCancelMethod(controls.turns));
  return { registry, controls };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
