import { describe, expect, it } from "vitest";
import { ChatActivitySchema, type ChatActivity } from "@taki/shared";
import { createChatTurnActivity } from "./chat-activity.ts";
import { createToolObserver } from "./tool-observability.ts";

function fixture() {
  const events: ChatActivity[] = [];
  let nextId = 0;
  const turn = createChatTurnActivity({ identity: { characterId: "taki", messageId: "message", runId: "run" },
    publish: (event) => events.push(ChatActivitySchema.parse(event)), newId: () => `text-${++nextId}` });
  turn.start();
  const attempt = turn.beginAttempt("attempt");
  const tools = createToolObserver({ runId: "run", attemptId: "attempt", activity: attempt.observer,
    toolDisplayNames: { echo: "原始名称" } }, () => 100);
  const part = (value: unknown) => { tools.observeStreamPart(value); attempt.observe(value, tools.invocations); };
  part({ type: "start-step" });
  return { turn, attempt, tools, events, part };
}
const call = (toolCallId: string) => ({ type: "tool-call", toolCallId, toolName: "echo", input: { secret: "RAW_INPUT" } });

describe("ordered foreground activity producer", () => {
  it("buffers execution callbacks until ordered receipt after preceding language", async () => {
    const f = fixture();
    const toolCall = call("one");
    f.tools.start({ callId: "generation", toolCall } as never);
    await f.tools.execute({ callId: "generation", toolCallId: "one", toolCall, execute: async () => {
      f.tools.phase({ toolCallId: "one", phase: "approval" });
      f.tools.phase({ toolCallId: "one", phase: "executing" });
    } } as never);
    f.tools.end({ callId: "generation", toolCall, toolOutput: { type: "tool-result", output: { isError: true, content: ["RAW_RESULT"] } }, toolExecutionMs: 3 } as never);
    expect(f.events.map((event) => event.kind)).toEqual(["turn.started"]);
    f.part({ type: "text-start", id: "a" });
    f.part({ type: "text-delta", id: "a", text: "A" });
    f.part(toolCall);
    expect(f.events.map((event) => event.kind)).toEqual(["turn.started", "text.delta", "tool.received", "tool.phase", "tool.phase", "tool.phase", "tool.terminal"]);
    expect(f.events.at(-1)).toMatchObject({ outcome: "failed", message: "工具返回了错误" });
    expect(JSON.stringify(f.events)).not.toMatch(/RAW_INPUT|RAW_RESULT|secret|input|output/);
    expect(f.events.map((event) => event.seq)).toEqual(f.events.map((_, index) => index + 1));
  });

  it("keeps concurrent invocations ordered while results finish in reverse, and separates later language", () => {
    const f = fixture();
    const first = call("one");
    const second = call("two");
    f.part({ type: "text-delta", id: "a", text: "A" });
    f.part(first); f.part(second);
    f.tools.end({ toolCall: second, toolOutput: { type: "tool-result", output: { ok: true } }, toolExecutionMs: 2 } as never);
    f.tools.end({ toolCall: first, toolOutput: { type: "tool-result", output: { ok: false, code: "CANCELLED" } }, toolExecutionMs: 3 } as never);
    f.part({ type: "text-delta", id: "b", text: "B" });
    const receipts = f.events.filter((event) => event.kind === "tool.received");
    const terminals = f.events.filter((event) => event.kind === "tool.terminal");
    expect(receipts.map((event) => event.toolCallId)).toEqual(["one", "two"]);
    expect(terminals.map((event) => event.itemId)).toEqual([receipts[1]?.itemId, receipts[0]?.itemId]);
    expect(f.events.filter((event) => event.kind === "text.delta").map((event) => event.itemId)).toEqual(["text-1", "text-2"]);
  });

  it("does not settle preliminary results and never aliases reused request call IDs", () => {
    const f = fixture();
    const a = call("same"); const b = call("same");
    f.tools.invocations.bindModelContent([a], { callId: "generation", modelEffectId: "request-a" });
    f.part(a);
    f.part({ ...a, type: "tool-result", preliminary: true, output: { ok: true } });
    expect(f.events.some((event) => event.kind === "tool.terminal")).toBe(false);
    f.tools.invocations.bindModelContent([b], { callId: "generation", modelEffectId: "request-b" });
    f.part({ type: "start-step" }); f.part(b);
    f.tools.end({ toolCall: a, toolOutput: { type: "tool-result", output: { ok: false } }, toolExecutionMs: 7 } as never);
    const receipts = f.events.filter((event) => event.kind === "tool.received");
    expect(receipts[0]?.itemId).not.toBe(receipts[1]?.itemId);
    expect(f.events.at(-1)).toMatchObject({ kind: "tool.terminal", itemId: receipts[0]?.itemId, outcome: "failed" });
  });

  it("references two segments inside a canonical text part without copying or rewriting that part", () => {
    const f = fixture();
    const tool = call("one");
    f.part({ type: "text-start", id: "source" });
    f.part({ type: "text-delta", id: "source", text: "A" }); f.part(tool);
    f.part({ type: "text-delta", id: "source", text: "B" });
    f.attempt.close(false);
    const row = { role: "assistant" as const, content: "AB", parts: [
      { type: "text" as const, text: "AB" }, { type: "tool-call" as const, toolCallId: "one", toolName: "echo" },
    ] };
    const refs = f.attempt.references(0, row);
    expect(refs.filter((ref) => ref.kind === "text")).toEqual([
      { kind: "text", itemId: "text-1", order: 0, partIndex: 0, start: 0, end: 1 },
      { kind: "text", itemId: "text-2", order: 2, partIndex: 0, start: 1, end: 2 },
    ]);
    expect(refs.find((ref) => ref.kind === "tool")).toMatchObject({ partIndex: 1, outcome: "outcome_unknown" });
    expect(row.parts[0]?.text).toBe("AB");
  });

  it("settles an interrupted Approval without replaying callbacks or resetting the accepted sequence", async () => {
    const f = fixture();
    const toolCall = call("one");
    f.part(toolCall);
    await f.tools.execute({ callId: "generation", toolCallId: "one", toolCall, execute: async () => {
      f.tools.phase({ toolCallId: "one", phase: "approval" });
    } } as never);
    f.attempt.close(true);
    expect(f.events.at(-1)).toMatchObject({ outcome: "cancelled" });
    const count = f.events.length;
    f.tools.end({ toolCall, toolOutput: { type: "tool-result", output: { ok: true } }, toolExecutionMs: 9 } as never);
    expect(f.events).toHaveLength(count);
    const replacement = f.turn.beginAttempt("replacement");
    replacement.observe({ type: "text-delta", text: "B" }, f.tools.invocations);
    expect(f.events.at(-1)?.seq).toBe(count + 1);
    expect(f.events.at(-1)?.attemptId).toBe("replacement");
    f.turn.terminal({ outcome: "completed" });
    replacement.observe({ type: "text-delta", text: "late" }, f.tools.invocations);
    expect(f.events.at(-1)?.kind).toBe("turn.terminal");
  });
});
