/**
 * INPUT:  AI SDK v7 normalized tool callbacks/stream parts and optional governed Effect bindings
 * OUTPUT: exactly-once call/result Run Events with outcome, validation class, and measured duration
 * POS:    core/agents — per-attempt tool observer; raw arguments, results, and thrown errors never persist
 */
import type { ToolExecutionEndEvent, ToolExecutionStartEvent } from "ai";
import type { RunEvent } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";

export function createToolObserver(
  input: { lifecycle: EffectLifecycleService; runId: string; attemptId: string },
  now: () => number,
) {
  const state: ToolObserverState = {
    started: new Set(), settled: new Set(), validationFailed: new Set(), effectIds: new Map(),
  };
  const recorder = createToolRecorder({ input, state, now });
  return {
    bindEffect({ toolCallId, effectId }: { toolCallId: string; effectId: string }) {
      state.effectIds.set(toolCallId, effectId);
    },
    start(toolEvent: ToolExecutionStartEvent) {
      recorder.start({
        toolCallId: toolEvent.toolCall.toolCallId, toolName: toolEvent.toolCall.toolName, callId: toolEvent.callId,
      });
    },
    end(toolEvent: ToolExecutionEndEvent) {
      recorder.start({
        toolCallId: toolEvent.toolCall.toolCallId, toolName: toolEvent.toolCall.toolName, callId: toolEvent.callId,
      });
      recorder.result({
        toolCallId: toolEvent.toolCall.toolCallId, toolName: toolEvent.toolCall.toolName,
        callId: toolEvent.callId, durationMs: toolEvent.toolExecutionMs,
        ...classifyToolOutput(toolEvent.toolOutput),
      });
    },
    observeStreamPart: (part: unknown) => observeToolPart({ part, state, recorder }),
  };
}

interface ToolObserverState {
  started: Set<string>;
  settled: Set<string>;
  validationFailed: Set<string>;
  effectIds: Map<string, string>;
}

interface ToolRecorder {
  start(input: { toolCallId: string; toolName: string; callId?: string; failed?: boolean }): void;
  result(input: ToolResultObservation): void;
}

function createToolRecorder(args: {
  input: { lifecycle: EffectLifecycleService; runId: string; attemptId: string };
  state: ToolObserverState;
  now: () => number;
}): ToolRecorder {
  return {
    start(value) {
      if (args.state.started.has(value.toolCallId)) return;
      args.state.started.add(value.toolCallId);
      if (value.failed) args.state.validationFailed.add(value.toolCallId);
      const occurredAt = new Date(args.now()).toISOString();
      record(args.input.lifecycle, toolEvent(args.input, occurredAt, {
        kind: "tool.call.started", state: value.failed ? "validation_failed" : "running",
        toolName: value.toolName, toolCallId: value.toolCallId,
        validationState: value.failed ? "failed" : "accepted", ...(value.callId ? { callId: value.callId } : {}),
      }));
    },
    result(value) {
      if (args.state.settled.has(value.toolCallId)) return;
      args.state.settled.add(value.toolCallId);
      const occurredAt = new Date(args.now()).toISOString();
      const effectId = args.state.effectIds.get(value.toolCallId);
      record(args.input.lifecycle, toolEvent(args.input, occurredAt, {
        kind: "tool.result.settled", state: value.outcome,
        toolName: value.toolName, toolCallId: value.toolCallId, outcome: value.outcome,
        ...(value.callId ? { callId: value.callId } : {}), ...(effectId ? { effectId } : {}),
        ...(value.durationMs === undefined ? {} : { durationMs: boundedDuration(value.durationMs) }),
        ...(value.errorClass ? { errorClass: value.errorClass } : {}),
        ...(value.errorCode ? { errorCode: value.errorCode } : {}),
      }));
    },
  };
}

function observeToolPart(args: { part: unknown; state: ToolObserverState; recorder: ToolRecorder }): void {
  if (!isToolPart(args.part)) return;
  const { part } = args;
  if (part.type === "tool-call") {
    const failed = part.invalid === true;
    args.recorder.start({ toolCallId: part.toolCallId, toolName: part.toolName, failed });
    if (failed) args.recorder.result({
      toolCallId: part.toolCallId, toolName: part.toolName, outcome: "failed",
      errorClass: "validation", errorCode: "tool_validation_failed",
    });
    return;
  }
  const invalid = args.state.validationFailed.has(part.toolCallId);
  args.recorder.start({ toolCallId: part.toolCallId, toolName: part.toolName, failed: invalid });
  if (part.type === "tool-result") {
    args.recorder.result({ toolCallId: part.toolCallId, toolName: part.toolName, ...classifyToolValue(part.output) });
  } else if (part.type === "tool-output-denied") {
    args.recorder.result({ toolCallId: part.toolCallId, toolName: part.toolName, outcome: "failed", errorClass: "governance", errorCode: "tool_output_denied" });
  } else {
    args.recorder.result({
      toolCallId: part.toolCallId, toolName: part.toolName, outcome: "failed",
      errorClass: invalid ? "validation" : "execution",
      errorCode: invalid ? "tool_validation_failed" : "tool_error",
    });
  }
}

interface ToolResultObservation {
  toolCallId: string;
  toolName: string;
  callId?: string;
  durationMs?: number;
  outcome: "completed" | "failed" | "cancelled" | "outcome_unknown";
  errorClass?: "validation" | "execution" | "governance" | "stale" | "unknown";
  errorCode?: string;
}

function classifyToolOutput(output: ToolExecutionEndEvent["toolOutput"]): Pick<ToolResultObservation, "outcome" | "errorClass" | "errorCode"> {
  return output.type === "tool-error"
    ? { outcome: "failed", errorClass: "execution", errorCode: "tool_error" }
    : classifyToolValue(output.output);
}

function classifyToolValue(value: unknown): Pick<ToolResultObservation, "outcome" | "errorClass" | "errorCode"> {
  if (typeof value !== "object" || value === null || !("ok" in value) || (value as { ok?: unknown }).ok !== false) {
    return { outcome: "completed" };
  }
  const failure = value as { code?: unknown; state?: unknown };
  const code = typeof failure.code === "string" ? boundedErrorCode(failure.code) : "tool_failed";
  const outcome = failure.state === "outcome_unknown" || code.includes("outcome_unknown")
    ? "outcome_unknown" as const
    : failure.state === "cancelled" || code.includes("cancelled") ? "cancelled" as const : "failed" as const;
  const errorClass = code.includes("governance") || code.includes("approval")
    ? "governance" as const
    : code.includes("stale") ? "stale" as const : "execution" as const;
  return { outcome, errorClass, errorCode: code };
}

function isToolPart(value: unknown): value is {
  type: "tool-call" | "tool-result" | "tool-error" | "tool-output-denied";
  toolCallId: string;
  toolName: string;
  invalid?: boolean;
  output?: unknown;
} {
  if (typeof value !== "object" || value === null) return false;
  const part = value as Record<string, unknown>;
  return ["tool-call", "tool-result", "tool-error", "tool-output-denied"].includes(String(part.type))
    && typeof part.toolCallId === "string" && typeof part.toolName === "string";
}

function boundedDuration(value: number): number {
  return Math.min(86_400_000, Math.max(0, Math.round(value)));
}

function boundedErrorCode(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+/, "").slice(0, 100);
  return normalized || "tool_failed";
}

function toolEvent(
  input: { runId: string; attemptId: string },
  occurredAt: string,
  payload: Extract<RunEvent["payload"], { kind: "tool.call.started" | "tool.result.settled" }>,
): Omit<RunEvent, "eventId" | "seq"> {
  return {
    runId: input.runId, attemptId: input.attemptId, schemaVersion: "run-event.v1",
    category: "tool", kind: payload.kind, occurredAt, source: "core.tool-observer", payload,
  };
}

function record(lifecycle: EffectLifecycleService, runEvent: Omit<RunEvent, "eventId" | "seq">): void {
  try { lifecycle.record?.(runEvent); } catch { /* observability never changes tool execution */ }
}
