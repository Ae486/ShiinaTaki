import { describe, expect, it } from "vitest";
import type { RunEvent } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createToolObserver } from "./tool-observability.ts";

function observer(record: (event: Omit<RunEvent, "eventId" | "seq">) => void) {
  const lifecycle = { record } as EffectLifecycleService;
  return createToolObserver({ lifecycle, runId: "run", attemptId: "attempt" }, () => 1_000);
}

describe("tool observability", () => {
  it("records one correlated successful result with SDK duration even when stream parts repeat it", () => {
    const events: Array<Omit<RunEvent, "eventId" | "seq">> = [];
    const tools = observer((event) => events.push(event));
    tools.bindEffect({ toolCallId: "tool-call", effectId: "effect" });
    tools.start({ callId: "model-call", toolCall: { toolCallId: "tool-call", toolName: "echo" } } as never);
    tools.end({
      callId: "model-call", toolCall: { toolCallId: "tool-call", toolName: "echo" },
      toolExecutionMs: 12.6, toolOutput: { type: "tool-result", output: { ok: true } },
    } as never);
    tools.observeStreamPart({ type: "tool-result", toolCallId: "tool-call", toolName: "echo", output: { ok: true } });
    expect(events.map((event) => event.kind)).toEqual(["tool.call.started", "tool.result.settled"]);
    expect(events[1]?.payload).toMatchObject({
      effectId: "effect", callId: "model-call", toolCallId: "tool-call", outcome: "completed", durationMs: 13,
    });
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
});
