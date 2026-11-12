import { describe, expect, it } from "vitest";
import type { RunEvent } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createToolObserver } from "./tool-observability.ts";

function observer(record: (event: Omit<RunEvent, "eventId" | "seq">) => void) {
  const lifecycle = { record } as EffectLifecycleService;
  return createToolObserver({ lifecycle, runId: "run", attemptId: "attempt" }, () => 1_000);
}

describe("tool observability", () => {
  it("records one correlated successful result with SDK duration even when stream parts repeat it", async () => {
    const events: Array<Omit<RunEvent, "eventId" | "seq">> = [];
    const tools = observer((event) => events.push(event));
    const toolCall = { type: "tool-call", toolCallId: "tool-call", toolName: "echo" };
    tools.invocations.bindModelContent([toolCall], { callId: "model-call", modelEffectId: "model-effect" });
    tools.observeStreamPart(toolCall);
    tools.start({ callId: "model-call", toolCall } as never);
    await tools.execute({ callId: "model-call", toolCallId: "tool-call", toolCall, execute: async () => {
      tools.bindEffect({ toolCallId: "tool-call", effectId: "effect" });
    } } as never);
    const toolOutput = { type: "tool-result", toolCallId: "tool-call", toolName: "echo", output: { ok: true } };
    tools.end({
      callId: "model-call", toolCall, toolExecutionMs: 12.6, toolOutput,
    } as never);
    tools.observeStreamPart(toolOutput);
    expect(events.map((event) => event.kind)).toEqual(["tool.call.started", "tool.result.settled"]);
    expect(events[1]?.payload).toMatchObject({
      effectId: "effect", modelEffectId: "model-effect", callId: "model-call", toolCallId: "tool-call", outcome: "completed", durationMs: 13,
    });
    expect(events[0]?.payload).toMatchObject({ state: "received" });
  });

  it("classifies validation failures once and leaves pending calls unsettled", () => {
    const events: Array<Omit<RunEvent, "eventId" | "seq">> = [];
    const tools = observer((event) => events.push(event));
    tools.observeStreamPart({ type: "tool-call", toolCallId: "invalid", toolName: "echo", invalid: true });
    tools.observeStreamPart({ type: "tool-error", toolCallId: "invalid", toolName: "echo" });
    tools.start({ callId: "model-call", toolCall: { toolCallId: "pending", toolName: "wait" } } as never);
    expect(events.filter((event) => event.payload.kind === "tool.result.settled")).toHaveLength(1);
    expect(events.find((event) => event.payload.kind === "tool.result.settled")?.payload).toMatchObject({
      outcome: "failed", errorClass: "validation", errorCode: "tool_validation_failed",
    });
    expect(events.some((event) => event.payload.kind === "tool.call.started"
      && event.payload.toolCallId === "pending")).toBe(true);
    expect(events.some((event) => event.payload.kind === "tool.result.settled"
      && event.payload.toolCallId === "pending")).toBe(false);
  });

  it("isolates event writer failures from SDK callbacks and stream observation", () => {
    const tools = observer(() => { throw new Error("observer failed"); });
    expect(() => tools.start({ callId: "model-call", toolCall: { toolCallId: "call", toolName: "echo" } } as never))
      .not.toThrow();
    expect(() => tools.observeStreamPart({ type: "tool-result", toolCallId: "call", toolName: "echo", output: { ok: true } }))
      .not.toThrow();
  });

  it("keeps receipt and wrapper entry nonterminal and ignores preliminary output", () => {
    const events: Array<Omit<RunEvent, "eventId" | "seq">> = [];
    const tools = observer((event) => events.push(event));
    const toolCall = { type: "tool-call", toolCallId: "call", toolName: "echo" };
    tools.observeStreamPart(toolCall);
    tools.start({ callId: "generation", toolCall } as never);
    tools.observeStreamPart({ ...toolCall, type: "tool-result", preliminary: true, output: { ok: true } });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ state: "received" });
    const toolOutput = { ...toolCall, type: "tool-result", output: { isError: true, content: [] } };
    tools.end({ callId: "generation", toolCall, toolOutput, toolExecutionMs: 5 } as never);
    tools.observeStreamPart(toolOutput);
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toMatchObject({ outcome: "failed", errorCode: "mcp_tool_error", durationMs: 5 });
  });

  it("binds a late governed effect inside its immutable SDK execution context", async () => {
    const events: Array<Omit<RunEvent, "eventId" | "seq">> = [];
    const tools = observer((event) => events.push(event));
    const first = { type: "tool-call", toolCallId: "same", toolName: "echo" };
    const second = { ...first };
    tools.invocations.bindModelContent([first], { callId: "generation", modelEffectId: "model-a" });
    tools.start({ callId: "generation", toolCall: first } as never);
    let release!: () => void;
    const pending = tools.execute({ callId: "generation", toolCallId: "same", toolCall: first, execute: async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      tools.bindEffect({ toolCallId: "same", effectId: "first-effect" });
    } } as never);
    tools.invocations.bindModelContent([second], { callId: "generation", modelEffectId: "model-b" });
    tools.start({ callId: "generation", toolCall: second } as never);
    release();
    await pending;
    tools.end({ callId: "generation", toolCall: first, toolOutput: { type: "tool-result", output: { ok: true } }, toolExecutionMs: 2 } as never);
    expect(events.at(-1)?.payload).toMatchObject({ effectId: "first-effect", modelEffectId: "model-a" });
  });
});
