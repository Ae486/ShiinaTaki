/**
 * INPUT:  SDK tool callbacks/stream objects and governed Effect bindings within one Attempt
 * OUTPUT: idempotent receipt/result facts over immutable invocations, with pre-conversion outcomes
 * POS:    core/agents — observation only; receipt and wrapper entry never prove underlying dispatch
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Telemetry, ToolExecutionEndEvent, ToolExecutionStartEvent } from "ai";
import type { RunEvent } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createToolInvocationBridge, type ToolInvocationBridge, type ToolInvocationSnapshot } from "./tool-invocation.ts";
import { classifyToolOutcome, type ToolOutcome, type ToolOutcomeInput } from "./tool-outcome.ts";

interface ToolObserverInput {
  lifecycle: EffectLifecycleService;
  runId: string;
  attemptId: string;
  toolDisplayNames?: Readonly<Record<string, string>>;
  invocations?: ToolInvocationBridge;
}

interface ToolObserverState {
  started: Set<string>;
  settled: Set<string>;
  effectIds: Map<string, string>;
  processingStartedAt: Map<string, string>;
}

export function createToolObserver(input: ToolObserverInput, now: () => number) {
  const invocations = input.invocations ?? createToolInvocationBridge(input);
  const execution = new AsyncLocalStorage<ToolInvocationSnapshot>();
  const state: ToolObserverState = {
    started: new Set(), settled: new Set(), effectIds: new Map(), processingStartedAt: new Map(),
  };
  const recorder = createToolRecorder({ input, state, now });
  const execute: NonNullable<Telemetry["executeTool"]> = (event) => {
    const invocation = event.toolCall ? invocations.capture(event.toolCall) : undefined;
    return invocation ? execution.run(invocation, event.execute) : event.execute();
  };
  return {
    invocations,
    execute,
    bindEffect({ toolCallId, effectId }: { toolCallId: string; effectId: string }) {
      const invocation = execution.getStore();
      if (invocation?.toolCallId === toolCallId) state.effectIds.set(invocation.invocationId, effectId);
    },
    start(event: ToolExecutionStartEvent) {
      const invocation = invocations.capture(event.toolCall);
      if (!state.processingStartedAt.has(invocation.invocationId)) {
        state.processingStartedAt.set(invocation.invocationId, new Date(now()).toISOString());
      }
      recorder.start(invocation, "processing");
    },
    end: (event: ToolExecutionEndEvent) => observeTerminal({ event, invocations, recorder }),
    observeStreamPart: (part: unknown) => observeToolPart({ part, invocations, recorder }),
  };
}

interface ToolRecorder {
  start(invocation: ToolInvocationSnapshot, phase: "received" | "processing"): void;
  result(invocation: ToolInvocationSnapshot, outcome: ToolOutcome, durationMs?: number): void;
}

function createToolRecorder(args: {
  input: ToolObserverInput; state: ToolObserverState; now: () => number;
}): ToolRecorder {
  return {
    start(invocation, phase) {
      if (args.state.started.has(invocation.invocationId)) return;
      args.state.started.add(invocation.invocationId);
      const occurredAt = new Date(args.now()).toISOString();
      record(args.input.lifecycle, toolEvent(args.input, occurredAt, {
        kind: "tool.call.started",
        state: invocation.validationState === "failed" ? "validation_failed" : phase,
        ...identityFields(invocation), validationState: invocation.validationState,
      }));
    },
    result(invocation, outcome, durationMs) {
      if (args.state.settled.has(invocation.invocationId)) return;
      args.state.settled.add(invocation.invocationId);
      const occurredAt = new Date(args.now()).toISOString();
      const effectId = args.state.effectIds.get(invocation.invocationId);
      const startedAt = args.state.processingStartedAt.get(invocation.invocationId);
      record(args.input.lifecycle, toolEvent(args.input, occurredAt, {
        kind: "tool.result.settled", state: outcome.outcome, ...identityFields(invocation), ...outcome,
        ...(effectId ? { effectId } : {}), ...(startedAt ? { startedAt } : {}),
        ...(durationMs === undefined ? {} : { durationMs: boundedDuration(durationMs) }),
      }));
    },
  };
}

function identityFields(invocation: ToolInvocationSnapshot) {
  return {
    invocationId: invocation.invocationId, toolCallId: invocation.toolCallId, toolName: invocation.toolName,
    ...(invocation.callId ? { callId: invocation.callId } : {}),
    ...(invocation.modelEffectId ? { modelEffectId: invocation.modelEffectId } : {}),
    ...(invocation.displayName ? { displayName: invocation.displayName } : {}),
  };
}

function observeTerminal(args: {
  event: ToolExecutionEndEvent; invocations: ToolInvocationBridge; recorder: ToolRecorder;
}): void {
  const invocation = args.invocations.capture(args.event.toolCall);
  const outcome = classifyToolOutcome({
    type: args.event.toolOutput.type,
    output: args.event.toolOutput.type === "tool-result" ? args.event.toolOutput.output : undefined,
    preliminary: args.event.toolOutput.type === "tool-result" ? args.event.toolOutput.preliminary : undefined,
    invalid: invocation.validationState === "failed",
  });
  if (!outcome) return;
  args.invocations.alias(args.event.toolOutput, invocation);
  args.recorder.start(invocation, "processing");
  args.recorder.result(invocation, outcome, args.event.toolExecutionMs);
}

function observeToolPart(args: {
  part: unknown; invocations: ToolInvocationBridge; recorder: ToolRecorder;
}): void {
  if (!isToolPart(args.part)) return;
  const part = args.part;
  if (part.type === "tool-call") {
    const invocation = args.invocations.capture(part);
    args.recorder.start(invocation, "received");
    if (invocation.validationState === "failed") {
      args.recorder.result(invocation, classifyToolOutcome({ type: "tool-error", invalid: true })!);
    }
    return;
  }
  if (part.preliminary) return;
  const invocation = args.invocations.result(part);
  const outcome = classifyToolOutcome({
    type: part.type, output: part.output, preliminary: part.preliminary,
    invalid: invocation.validationState === "failed",
  });
  if (!outcome) return;
  args.recorder.start(invocation, "received");
  args.recorder.result(invocation, outcome);
}

type ToolPart = {
  toolCallId: string; toolName: string; invalid?: boolean; preliminary?: boolean; output?: unknown;
} & ({ type: "tool-call" } | ToolOutcomeInput);

function isToolPart(value: unknown): value is ToolPart {
  if (typeof value !== "object" || value === null) return false;
  const part = value as Record<string, unknown>;
  return ["tool-call", "tool-result", "tool-error", "tool-output-denied"].includes(String(part.type))
    && typeof part.toolCallId === "string" && typeof part.toolName === "string";
}

function boundedDuration(value: number): number {
  return Math.min(86_400_000, Math.max(0, Math.round(value)));
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

function record(lifecycle: EffectLifecycleService, event: Omit<RunEvent, "eventId" | "seq">): void {
  try { lifecycle.record?.(event); } catch { /* Optional observation must not alter tool execution. */ }
}
