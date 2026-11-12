import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { createApprovalGate } from "../approval/approval-gate.ts";
import type { ApprovalBroker, ApprovalOutcome } from "../approval/approval-broker.ts";
import type { DecisionStore } from "../approval/decision-store.ts";
import { createCompanionFixture, type CompanionFixture } from "../testing/companion-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createChatAgent, type TurnContext } from "./chat-agent.ts";

const fixtures: CompanionFixture[] = [];
function fresh(): CompanionFixture {
  const f = createCompanionFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

const TEST_CONNECTION: Connection = {
  state: { status: "authenticated", deviceId: "chat-agent-test", role: "operator", capabilities: [] },
};
const NOOP_TURN: TurnContext = { connection: TEST_CONNECTION, notify: () => undefined, onClose: () => undefined };

// A gate whose broker.ask is spied, describing only `files_read` as an MCP tool.
function spyGate(outcome: ApprovalOutcome) {
  const ask = vi.fn(async () => outcome);
  const broker: ApprovalBroker = { ask, resolve: () => ({ accepted: true }), denyAll: () => undefined };
  const decisions: DecisionStore = { get: () => undefined, remember: () => undefined };
  const mcp = { describe: (k: string) => (k === "files_read" ? { serverName: "files", toolName: "read" } : undefined) };
  return { gate: createApprovalGate({ mcp, broker, decisions }), ask };
}

async function drain(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}

describe("createChatAgent tool approval (T14/T15)", () => {
  it("asks approval for an MCP tool call, then runs it when approved", async () => {
    const f = fresh();
    const execute = vi.fn(() => ({ ok: true, data: "read!" }));
    const filesRead = tool({ description: "read a file", inputSchema: z.object({ text: z.string() }), execute });
    const { gate, ask } = spyGate({ approved: true, scope: "once" });
    const model = scriptedModel([
      { kind: "tool", toolCallId: "c1", toolName: "files_read", input: { text: "x" } },
      { kind: "text", deltas: ["done"] },
    ]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, extraTools: { files_read: filesRead }, approval: gate });

    const out = await drain(agent.stream({ characterId: "taki", message: "read it" }, NOOP_TURN));

    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ serverName: "files", toolName: "read" }), expect.any(Function));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out).toBe("done");
  });

  it("denies an MCP tool call: it never executes and the model's next call sees execution-denied", async () => {
    const f = fresh();
    const execute = vi.fn(() => ({ ok: true }));
    const filesRead = tool({ description: "read a file", inputSchema: z.object({ text: z.string() }), execute });
    const { gate } = spyGate({ approved: false, scope: "once", reason: "operator denied" });
    const model = scriptedModel([
      { kind: "tool", toolCallId: "c1", toolName: "files_read", input: { text: "x" } },
      { kind: "text", deltas: ["ok, skipped"] },
    ]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, extraTools: { files_read: filesRead }, approval: gate });

    await drain(agent.stream({ characterId: "taki", message: "read it" }, NOOP_TURN));

    expect(execute).not.toHaveBeenCalled();
    // The SDK feeds the model an execution-denied tool result on the next call (research §1 B).
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt ?? [])).toContain("execution-denied");
  });

  it("denies an MCP tool call when the stream runs without a TurnContext (fail-closed, no bypass)", async () => {
    const f = fresh();
    const execute = vi.fn(() => ({ ok: true }));
    const filesRead = tool({ description: "read a file", inputSchema: z.object({ text: z.string() }), execute });
    const { gate, ask } = spyGate({ approved: true, scope: "once" });
    const model = scriptedModel([
      { kind: "tool", toolCallId: "c1", toolName: "files_read", input: { text: "x" } },
      { kind: "text", deltas: ["cannot"] },
    ]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, extraTools: { files_read: filesRead }, approval: gate });

    await drain(agent.stream({ characterId: "taki", message: "read it" }));

    expect(execute).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled(); // no operator to ask -> immediate deny, not a hang
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt ?? [])).toContain("execution-denied");
  });

  it("never asks approval for an internal (memory) tool call (T15)", async () => {
    const f = fresh();
    const { gate, ask } = spyGate({ approved: true, scope: "once" });
    const model = scriptedModel([
      { kind: "tool", toolCallId: "c1", toolName: "memory_search", input: { query: "x" } },
      { kind: "text", deltas: ["answer"] },
    ]);
    const agent = createChatAgent({ model, store: f.conversation, memory: f.memory, approval: gate });

    const out = await drain(agent.stream({ characterId: "taki", message: "recall" }, NOOP_TURN));

    expect(ask).not.toHaveBeenCalled();
    expect(out).toBe("answer");
  });
});
