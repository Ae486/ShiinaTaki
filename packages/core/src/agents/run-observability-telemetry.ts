/**
 * INPUT:  one Run/Attempt model, SDK callbacks, governed Effects, and captured tool display names
 * OUTPUT: middleware/telemetry composition with an immutable invocation bridge and bounded durable observations
 * POS:    core/agents — observer wiring only; model execution and canonical settlement keep their existing owners
 */
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware, type Telemetry } from "ai";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";
import { createModelEffectMiddleware } from "./model-effect-middleware.ts";
import { createModelObserver } from "./model-observability.ts";
import { createToolObserver } from "./tool-observability.ts";
import { createToolInvocationBridge, type ToolInvocationBridge } from "./tool-invocation.ts";
export type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";

export interface RunObservabilitySession {
  middleware: LanguageModelMiddleware;
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
}): { model: LanguageModel; observability?: RunObservabilitySession } {
  if (!input.lifecycle || !input.runId || !input.attemptId) return { model: input.model };
  const observability = createRunObservabilitySession({
    lifecycle: input.lifecycle, runId: input.runId, attemptId: input.attemptId,
    toolDisplayNames: input.toolDisplayNames,
  });
  return {
    model: wrapLanguageModel({
      model: input.model as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: observability.middleware,
    }),
    observability,
  };
}

export function createRunObservabilitySession(input: {
  lifecycle: EffectLifecycleService;
  runId: string;
  attemptId: string;
  toolDisplayNames?: Readonly<Record<string, string>>;
  now?: () => number;
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
    tools: { bindEffect: tools.bindEffect },
    invocations,
    observeStreamPart(part) {
      tools.observeStreamPart(part);
      model.assertHealthy();
    },
    assertHealthy: model.assertHealthy,
  };
}
