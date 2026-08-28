/**
 * INPUT:  AI SDK v7 model/tool telemetry callbacks, normalized stream parts, and Run-owned Effect lifecycle
 * OUTPUT: replayable model/tool Run Events plus authoritative detailed usage and performance settlement
 * POS:    core/agents — per-attempt observer; never retains prompts, tool inputs/results, provider raw data, or errors
 */
import type {
  LanguageModel,
  LanguageModelCallEndEvent,
  LanguageModelCallStartEvent,
  LanguageModelMiddleware,
  LanguageModelUsage,
  Telemetry,
} from "ai";
import { wrapLanguageModel } from "ai";
import type { EffectLifecycle, RunEvent, UsageRecord } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import {
  createModelEffectMiddleware,
  type ModelEffectBinding,
  type ModelEffectObserver,
} from "./model-effect-middleware.ts";
import { createToolObserver } from "./tool-observability.ts";
import type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";
export type { ToolEffectObserver } from "../observability/tool-effect-observer.ts";

export interface RunObservabilitySession {
  middleware: LanguageModelMiddleware;
  telemetry: Telemetry;
  tools: ToolEffectObserver;
  observeStreamPart(part: unknown): void;
  assertHealthy(): void;
}

export function createRunObservabilityModel(input: {
  model: LanguageModel;
  lifecycle?: EffectLifecycleService;
  runId?: string;
  attemptId?: string;
}): { model: LanguageModel; observability?: RunObservabilitySession } {
  if (!input.lifecycle || !input.runId || !input.attemptId) return { model: input.model };
  const observability = createRunObservabilitySession({
    lifecycle: input.lifecycle, runId: input.runId, attemptId: input.attemptId,
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
  now?: () => number;
}): RunObservabilitySession {
  const now = input.now ?? Date.now;
  const model = createModelObserver(input, now);
  const tools = createToolObserver(input, now);
  return {
    middleware: createModelEffectMiddleware({ ...input, observer: model.observer }),
    telemetry: {
      onLanguageModelCallStart: model.start,
      onLanguageModelCallEnd: model.end,
      onToolExecutionStart: tools.start,
      onToolExecutionEnd: tools.end,
    },
    tools: { bindEffect: tools.bindEffect },
    observeStreamPart(part) {
      tools.observeStreamPart(part);
      model.assertHealthy();
    },
    assertHealthy: model.assertHealthy,
  };
}

function createModelObserver(
  input: { lifecycle: EffectLifecycleService; runId: string; attemptId: string },
  now: () => number,
): {
  observer: ModelEffectObserver;
  start(event: LanguageModelCallStartEvent): void;
  end(event: LanguageModelCallEndEvent): void;
  assertHealthy(): void;
} {
  const state: ModelObserverState = { pending: [], calls: new Map() };
  return {
    observer: {
      bindEffect: (binding) => bindModelEffect({ input, state, binding, now }),
      firstOutput: (binding) => recordFirstOutput({ input, state, binding, now }),
      fail: (binding) => settleModelFailure({ input, call: state.calls.get(binding.callId), binding, now }),
    },
    start: (modelEvent) => state.pending.push({ ...modelEvent, startedAt: new Date(now()).toISOString() }),
    end: (modelEvent) => settleModelSuccess({ input, state, modelEvent, now }),
    assertHealthy() { if (state.failure !== undefined) throw state.failure; },
  };
}

interface ModelObserverState {
  pending: Array<LanguageModelCallStartEvent & { startedAt: string }>;
  calls: Map<string, ModelCallState>;
  failure?: unknown;
}

interface ModelCallState {
  effect: EffectLifecycle;
  provider: string;
  modelId: string;
  settled: boolean;
  firstOutput: boolean;
}

function bindModelEffect(args: {
  input: { lifecycle: EffectLifecycleService; runId: string; attemptId: string };
  state: ModelObserverState;
  binding: { effect: EffectLifecycle; provider: string; modelId: string };
  now: () => number;
}): ModelEffectBinding {
  const { effect, provider, modelId } = args.binding;
  const observed = args.state.pending.shift();
  const callId = observed?.callId ?? effect.effectId;
  const startedAt = observed?.startedAt ?? new Date(args.now()).toISOString();
  args.state.calls.set(callId, { effect, provider, modelId, settled: false, firstOutput: false });
  record(args.input.lifecycle, modelEvent(args.input, startedAt, {
    kind: "model.request.started", state: "running", effectId: effect.effectId, callId,
    provider, modelId, startedAt,
  }));
  return { effect, callId };
}

function recordFirstOutput(args: {
  input: { lifecycle: EffectLifecycleService; runId: string; attemptId: string };
  state: ModelObserverState;
  binding: ModelEffectBinding & { outputKind: "text" | "reasoning" | "tool" };
  now: () => number;
}): void {
  const call = args.state.calls.get(args.binding.callId);
  if (!call || call.firstOutput) return;
  call.firstOutput = true;
  const firstOutputAt = new Date(args.now()).toISOString();
  record(args.input.lifecycle, modelEvent(args.input, firstOutputAt, {
    kind: "model.stream.first", state: "streaming", effectId: call.effect.effectId,
    callId: args.binding.callId, firstOutputAt, outputKind: args.binding.outputKind,
  }));
}

function settleModelSuccess(args: {
  input: { lifecycle: EffectLifecycleService; runId: string; attemptId: string };
  state: ModelObserverState;
  modelEvent: LanguageModelCallEndEvent;
  now: () => number;
}): void {
  const call = args.state.calls.get(args.modelEvent.callId);
  if (!call || call.settled) return;
  const usage = normalizedUsage(args.modelEvent.provider, args.modelEvent.modelId, args.modelEvent.usage);
  const outcome = args.modelEvent.finishReason === "error"
    ? "failed" as const : usage.quality === "unknown" ? "outcome_unknown" as const : "completed" as const;
  const errorCode = args.modelEvent.finishReason === "error"
    ? "provider_finish_error" : usage.quality === "unknown" ? "provider_usage_missing" : undefined;
  try {
    const settlement = args.input.lifecycle.settle({
      effectId: call.effect.effectId, runId: call.effect.runId, attemptId: call.effect.attemptId,
      expectedVersion: call.effect.version, outcome, ...(errorCode ? { errorCode } : {}), usage,
    });
    call.settled = true;
    if (settlement.stale || settlement.duplicate) return;
  } catch (error) {
    call.settled = true;
    args.state.failure ??= error;
    return;
  }
  const occurredAt = new Date(args.now()).toISOString();
  record(args.input.lifecycle, modelEvent(args.input, occurredAt, {
    kind: "model.response.settled", state: outcome, effectId: call.effect.effectId,
    callId: args.modelEvent.callId, provider: args.modelEvent.provider, modelId: args.modelEvent.modelId, outcome,
    finishReason: args.modelEvent.finishReason, responseId: args.modelEvent.responseId,
    durationMs: boundedDuration(args.modelEvent.performance.responseTimeMs),
    ...(args.modelEvent.performance.timeToFirstOutputMs === undefined ? {} : {
      timeToFirstOutputMs: boundedDuration(args.modelEvent.performance.timeToFirstOutputMs),
    }),
    ...(errorCode ? { errorCode } : {}),
  }));
}

function settleModelFailure(args: {
  input: { lifecycle: EffectLifecycleService; runId: string; attemptId: string };
  call: ModelCallState | undefined;
  binding: ModelEffectBinding & { errorCode: string; outcome: "failed" | "outcome_unknown" };
  now: () => number;
}): void {
  if (!args.call || args.call.settled) return;
  const settlement = args.input.lifecycle.settle({
    effectId: args.call.effect.effectId, runId: args.call.effect.runId, attemptId: args.call.effect.attemptId,
    expectedVersion: args.call.effect.version, outcome: args.binding.outcome, errorCode: args.binding.errorCode,
  });
  args.call.settled = true;
  if (settlement.stale || settlement.duplicate) return;
  const occurredAt = new Date(args.now()).toISOString();
  record(args.input.lifecycle, modelEvent(args.input, occurredAt, {
    kind: "model.response.settled", state: args.binding.outcome, effectId: args.call.effect.effectId,
    callId: args.binding.callId, provider: args.call.provider, modelId: args.call.modelId,
    outcome: args.binding.outcome, errorCode: args.binding.errorCode,
  }));
}

function normalizedUsage(
  provider: string,
  modelId: string,
  usage: LanguageModelUsage,
): Omit<UsageRecord, "usageId" | "schemaVersion" | "runId" | "attemptId" | "effectId" | "recordedAt"> {
  const values = [usage.inputTokens, usage.inputTokenDetails.noCacheTokens,
    usage.inputTokenDetails.cacheReadTokens, usage.inputTokenDetails.cacheWriteTokens,
    usage.outputTokens, usage.outputTokenDetails.textTokens, usage.outputTokenDetails.reasoningTokens,
    usage.totalTokens];
  return {
    provider, modelId, quality: values.some((value) => value !== undefined) ? "reported" : "unknown",
    inputTokens: usage.inputTokens,
    inputTokenDetails: compact({
      noCacheTokens: usage.inputTokenDetails.noCacheTokens,
      cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
    }),
    outputTokens: usage.outputTokens,
    outputTokenDetails: compact({
      textTokens: usage.outputTokenDetails.textTokens,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    }),
    totalTokens: usage.totalTokens,
  };
}

function boundedDuration(value: number): number {
  return Math.min(86_400_000, Math.max(0, Math.round(value)));
}

function compact<T extends Record<string, number | undefined>>(value: T): T | undefined {
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function modelEvent(
  input: { runId: string; attemptId: string },
  occurredAt: string,
  payload: Extract<RunEvent["payload"], { kind: `model.${string}` }>,
): Omit<RunEvent, "eventId" | "seq"> {
  return {
    runId: input.runId, attemptId: input.attemptId, schemaVersion: "run-event.v1",
    category: "model", kind: payload.kind, occurredAt, source: "core.model-observer", payload,
  };
}

function record(lifecycle: EffectLifecycleService, runEvent: Omit<RunEvent, "eventId" | "seq">): void {
  try { lifecycle.record?.(runEvent); } catch { /* observability never changes model execution */ }
}
