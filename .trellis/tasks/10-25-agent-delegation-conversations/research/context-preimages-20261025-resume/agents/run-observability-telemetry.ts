/**
 * INPUT:  one Run/Attempt model, SDK callbacks, governed Effects, and captured tool display names
 * OUTPUT: middleware/telemetry composition with an immutable invocation bridge and bounded durable observations
 * POS:    core/agents — observer wiring only; model execution and canonical settlement keep their existing owners
 */
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware, type Telemetry } from "ai";
import type { EffectLifecycle } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";
import { createModelEffectMiddleware } from "./model-effect-middleware.ts";
import { createModelObserver } from "./model-observability.ts";
import { createToolObserver, type ToolActivityObserver } from "./tool-observability.ts";
import { createToolInvocationBridge, type ToolInvocationBridge } from "./tool-invocation.ts";
export type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";

export interface RunObservabilitySession {
  middleware?: LanguageModelMiddleware;
  telemetry: Telemetry;
  tools: ToolEffectObserver;
  invocations: ToolInvocationBridge;
  observeStreamPart(part: unknown): void;
  assertHealthy(): void;
}

export function createRunObservabilityModel(input: {
  model: LanguageModel;
  lifecycle?: EffectLifecycleService;
  runId?: string;
  attemptId?: string;
  toolDisplayNames?: Readonly<Record<string, string>>;
  activity?: ToolActivityObserver;
  onCommitModelIntent?: (effect: EffectLifecycle) => void;
}): { model: LanguageModel; observability?: RunObservabilitySession } {
  if (!input.lifecycle || !input.runId || !input.attemptId) {
    return { model: input.model, ...(input.activity ? { observability: untrackedToolSession(input) } : {}) };
  }
  const observability = createRunObservabilitySession({
    lifecycle: input.lifecycle, runId: input.runId, attemptId: input.attemptId,
    toolDisplayNames: input.toolDisplayNames,
    activity: input.activity,
    onCommitModelIntent: input.onCommitModelIntent,
  });
  return {
    model: observability.middleware ? wrapLanguageModel({
      model: input.model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: observability.middleware,
    }) : input.model,
    observability,
  };
}

export function createRunObservabilitySession(input: {
  lifecycle: EffectLifecycleService;
  runId: string;
  attemptId: string;
  toolDisplayNames?: Readonly<Record<string, string>>;
  activity?: ToolActivityObserver;
  now?: () => number;
  onCommitModelIntent?: (effect: EffectLifecycle) => void;
}): RunObservabilitySession {
  const now = input.now ?? Date.now;
  const invocations = createToolInvocationBridge(input);
  const model = createModelObserver(input, { now, invocations });
  const tools = createToolObserver({ ...input, invocations }, now);
  return {
    middleware: createModelEffectMiddleware({ ...input, observer: model.observer }),
    telemetry: {
      onLanguageModelCallStart: model.start, onLanguageModelCallEnd: model.end,
      onToolExecutionStart: tools.start, onToolExecutionEnd: tools.end, executeTool: tools.execute,
    },
    tools: { bindEffect: tools.bindEffect, phase: tools.phase, currentInvocation: tools.currentInvocation },
    invocations,
    observeStreamPart(part) {
      tools.observeStreamPart(part);
      model.assertHealthy();
    },
    assertHealthy: model.assertHealthy,
  };
}

function untrackedToolSession(input: {
  runId?: string; attemptId?: string; toolDisplayNames?: Readonly<Record<string, string>>; activity?: ToolActivityObserver;
}): RunObservabilitySession {
  const tools = createToolObserver(input, Date.now);
  return {
    telemetry: { onToolExecutionStart: tools.start, onToolExecutionEnd: tools.end, executeTool: tools.execute },
    tools: { bindEffect: tools.bindEffect, phase: tools.phase, currentInvocation: tools.currentInvocation },
    invocations: tools.invocations,
    observeStreamPart: tools.observeStreamPart,
    assertHealthy() { /* Legacy callers have no model Effect authority to validate or fabricate. */ },
  };
}
