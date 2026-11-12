/**
 * INPUT:  SDK model callbacks and exact middleware Effect bindings within one Attempt
 * OUTPUT: request-specific model facts, authoritative usage settlement, and immutable tool-object association
 * POS:    core/agents — never keys a request by the generation-wide callId or retains callback payloads
 */
import type { LanguageModelCallStartEvent, LanguageModelCallEndEvent, LanguageModelUsage } from "ai";
import type { EffectLifecycle, RunEvent, UsageRecord } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { ModelEffectBinding, ModelEffectObserver } from "./model-effect-middleware.ts";
import type { ToolInvocationBridge } from "./tool-invocation.ts";

interface ModelObserverInput {
  lifecycle: EffectLifecycleService;
  runId: string;
  attemptId: string;
}

interface ModelCallState {
  effect: EffectLifecycle;
  callId: string;
  provider: string;
  modelId: string;
  firstOutput: boolean;
}

interface ModelObserverState {
  pending: Array<{ callId: string; startedAt: string }>;
  calls: Map<string, ModelCallState>;
  ended: WeakSet<object>;
  failure?: unknown;
}

interface ObserverContext {
  input: ModelObserverInput;
  state: ModelObserverState;
  now: () => number;
  invocations: ToolInvocationBridge;
}

export function createModelObserver(input: ModelObserverInput, options: {
  now: () => number;
  invocations: ToolInvocationBridge;
}): {
  observer: ModelEffectObserver;
  start(event: LanguageModelCallStartEvent): void;
  end(event: LanguageModelCallEndEvent): void;
  assertHealthy(): void;
} {
  const state: ModelObserverState = { pending: [], calls: new Map(), ended: new WeakSet() };
  const context: ObserverContext = { input, state, ...options };
  return {
    observer: {
      bindEffect: (binding) => bindModelEffect(context, binding),
      firstOutput: (binding) => recordFirstOutput(context, binding),
      toolCall: (binding) => options.invocations.observeRequestTool({
        modelEffectId: binding.effect.effectId, callId: binding.callId,
      }, { toolCallId: binding.toolCallId, toolName: binding.toolName }),
      fail: (binding) => settleModelFailure(context, binding),
    },
    start: (event) => state.pending.push({ callId: event.callId, startedAt: new Date(options.now()).toISOString() }),
    end: (event) => settleModelSuccess(context, event),
    assertHealthy() { if (state.failure !== undefined) throw state.failure; },
  };
}

function bindModelEffect(context: ObserverContext, binding: {
  effect: EffectLifecycle; provider: string; modelId: string;
}): ModelEffectBinding {
  const { effect, provider, modelId } = binding;
  const observed = context.state.pending.length === 1 ? context.state.pending.shift() : undefined;
  const callId = observed?.callId ?? effect.effectId;
  const startedAt = observed?.startedAt ?? new Date(context.now()).toISOString();
  context.state.calls.set(effect.effectId, { effect, callId, provider, modelId, firstOutput: false });
  record(context.input.lifecycle, modelEvent(context.input, startedAt, {
    kind: "model.request.started", state: "running", effectId: effect.effectId, callId,
    provider, modelId, startedAt,
  }));
  return { effect, callId };
}

function recordFirstOutput(context: ObserverContext, binding: ModelEffectBinding & {
  outputKind: "text" | "reasoning" | "tool";
}): void {
  const call = context.state.calls.get(binding.effect.effectId);
  if (!call || call.firstOutput) return;
  call.firstOutput = true;
  const firstOutputAt = new Date(context.now()).toISOString();
  record(context.input.lifecycle, modelEvent(context.input, firstOutputAt, {
    kind: "model.stream.first", state: "streaming", effectId: call.effect.effectId,
    callId: call.callId, firstOutputAt, outputKind: binding.outputKind,
  }));
}

function settleModelSuccess(context: ObserverContext, event: LanguageModelCallEndEvent): void {
  if (context.state.ended.has(event) || context.state.ended.has(event.content)) return;
  context.state.ended.add(event);
  context.state.ended.add(event.content);
  const candidates = [...context.state.calls.values()].filter((call) => call.callId === event.callId);
  if (candidates.length !== 1) {
    if (candidates.length > 1) context.state.failure ??= new Error("MODEL_OBSERVATION_AMBIGUOUS");
    return;
  }
  const call = candidates[0]!;
  context.invocations.bindModelContent(event.content, { callId: call.callId, modelEffectId: call.effect.effectId });
  context.state.calls.delete(call.effect.effectId);
  const usage = normalizedUsage(event.provider, event.modelId, event.usage);
  const outcome = event.finishReason === "error"
    ? "failed" as const : usage.quality === "unknown" ? "outcome_unknown" as const : "completed" as const;
  const errorCode = event.finishReason === "error"
    ? "provider_finish_error" : usage.quality === "unknown" ? "provider_usage_missing" : undefined;
  try {
    const settlement = context.input.lifecycle.settle({
      effectId: call.effect.effectId, runId: call.effect.runId, attemptId: call.effect.attemptId,
      expectedVersion: call.effect.version, outcome, ...(errorCode ? { errorCode } : {}), usage,
    });
    if (settlement.stale || settlement.duplicate) return;
  } catch (error) {
    context.state.failure ??= error;
    return;
  }
  const occurredAt = new Date(context.now()).toISOString();
  record(context.input.lifecycle, modelEvent(context.input, occurredAt, {
    kind: "model.response.settled", state: outcome, effectId: call.effect.effectId,
    callId: call.callId, provider: event.provider, modelId: event.modelId, outcome,
    finishReason: event.finishReason, responseId: event.responseId,
    durationMs: boundedDuration(event.performance.responseTimeMs),
    ...(event.performance.timeToFirstOutputMs === undefined ? {} : {
      timeToFirstOutputMs: boundedDuration(event.performance.timeToFirstOutputMs),
    }),
    ...(errorCode ? { errorCode } : {}),
  }));
}

function settleModelFailure(context: ObserverContext, binding: ModelEffectBinding & {
  errorCode: string; outcome: "failed" | "outcome_unknown";
}): void {
  const call = context.state.calls.get(binding.effect.effectId);
  if (!call) return;
  const settlement = context.input.lifecycle.settle({
    effectId: call.effect.effectId, runId: call.effect.runId, attemptId: call.effect.attemptId,
    expectedVersion: call.effect.version, outcome: binding.outcome, errorCode: binding.errorCode,
  });
  context.state.calls.delete(call.effect.effectId);
  context.invocations.retireRequest(call.effect.effectId);
  if (settlement.stale || settlement.duplicate) return;
  const occurredAt = new Date(context.now()).toISOString();
  record(context.input.lifecycle, modelEvent(context.input, occurredAt, {
    kind: "model.response.settled", state: binding.outcome, effectId: call.effect.effectId,
    callId: call.callId, provider: call.provider, modelId: call.modelId,
    outcome: binding.outcome, errorCode: binding.errorCode,
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
