/**
 * INPUT:  AI SDK v7 provider calls plus a Run-owned Effect lifecycle and optional model observer
 * OUTPUT: intent-before-dispatch middleware with exactly-once failure/interruption settlement
 * POS:    core/agents — raw provider boundary; successful normalized usage/timing settles through SDK telemetry
 */
import { createHash } from "node:crypto";
import type { LanguageModelMiddleware } from "ai";
import type { EffectLifecycle, UsageRecord } from "@taki/shared";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { withRunUsageOwner } from "../observability/model-usage-context.ts";

interface ModelEffectContext {
  lifecycle: EffectLifecycleService;
  runId: string;
  attemptId: string;
  observer?: ModelEffectObserver;
  onCommitModelIntent?: (effect: EffectLifecycle) => void;
}

type WrapStreamArgs = Parameters<NonNullable<LanguageModelMiddleware["wrapStream"]>>[0];
type ProviderStreamPart = Awaited<ReturnType<WrapStreamArgs["doStream"]>>["stream"] extends ReadableStream<infer Part>
  ? Part
  : never;

export interface ModelEffectBinding {
  effect: EffectLifecycle;
  callId: string;
}

export interface ModelEffectObserver {
  bindEffect(input: { effect: EffectLifecycle; provider: string; modelId: string }): ModelEffectBinding;
  firstOutput(input: ModelEffectBinding & { outputKind: "text" | "reasoning" | "tool" }): void;
  toolCall?(input: ModelEffectBinding & { toolCallId: string; toolName: string }): void;
  fail(input: ModelEffectBinding & { errorCode: string; outcome: "failed" | "outcome_unknown" }): void;
}

export function createModelEffectMiddleware(context: ModelEffectContext): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async wrapGenerate({ doGenerate, params, model }) {
      const binding = prepareBinding(context, model, params);
      try {
        const result = await withRunUsageOwner(doGenerate);
        if (!context.observer) settleDirect({ context, effect: binding.effect, model, usage: result.usage });
        return result;
      } catch (error) {
        fail(context, binding, params.abortSignal?.aborted ? "provider_abort" : "provider_error");
        throw error;
      }
    },
    async wrapStream({ doStream, params, model }) {
      const binding = prepareBinding(context, model, params);
      let result;
      try {
        result = await withRunUsageOwner(doStream);
      } catch (error) {
        fail(context, binding, params.abortSignal?.aborted ? "provider_abort" : "provider_error");
        throw error;
      }
      return {
        ...result,
        stream: observeStream({
          stream: result.stream,
          binding,
          context,
          model,
        }) as typeof result.stream,
      };
    },
  };
}

function prepareBinding(
  context: ModelEffectContext,
  model: { provider: string; modelId: string },
  params: unknown,
): ModelEffectBinding {
  const effect = context.lifecycle.prepare({
    runId: context.runId,
    attemptId: context.attemptId,
    kind: "model",
    sourceRef: { type: "model", provider: model.provider, modelId: model.modelId },
    executorRef: { type: "provider", provider: model.provider },
    inputDigest: digestForModelRequest(params),
    replayPosture: "never",
    onCommitIntent: context.onCommitModelIntent,
  });
  return context.observer?.bindEffect({ effect, provider: model.provider, modelId: model.modelId })
    ?? { effect, callId: effect.effectId };
}

interface ObservedModelStream {
  stream: ReadableStream<ProviderStreamPart>;
  binding: ModelEffectBinding;
  context: ModelEffectContext;
  model: { provider: string; modelId: string };
}

function observeStream(input: ObservedModelStream): ReadableStream<ProviderStreamPart> {
  const reader = input.stream.getReader();
  const observeOutput = createOutputObserver(input);
  let terminal = false;
  const interrupt = (errorCode: string): void => {
    if (terminal) return;
    terminal = true;
    fail(input.context, input.binding, errorCode);
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          interrupt("provider_stream_interrupted");
          controller.close();
          return;
        }
        const part = next.value;
        observeOutput(part);
        if (part.type === "error") interrupt("provider_stream_error");
        if (part.type === "finish") {
          terminal = true;
          if (!input.context.observer) {
            settleDirect({ context: input.context, effect: input.binding.effect, model: input.model, usage: part.usage });
          }
        }
        controller.enqueue(part);
      } catch (error) {
        interrupt("provider_stream_interrupted");
        controller.error(error);
      }
    },
    async cancel(reason) {
      interrupt("provider_stream_interrupted");
      await reader.cancel(reason);
    },
  });
}

function createOutputObserver(input: Pick<ObservedModelStream, "binding" | "context">) {
  let firstOutput = false;
  return (part: ProviderStreamPart): void => {
    if (part.type === "tool-call") input.context.observer?.toolCall?.({
      ...input.binding, toolCallId: part.toolCallId, toolName: part.toolName,
    });
    const outputKind = meaningfulOutput(part);
    if (!firstOutput && outputKind) {
      firstOutput = true;
      input.context.observer?.firstOutput({ ...input.binding, outputKind });
    }
  };
}

function meaningfulOutput(part: ProviderStreamPart): "text" | "reasoning" | "tool" | undefined {
  if (part.type === "text-delta") return "text";
  if (part.type === "reasoning-delta") return "reasoning";
  if (part.type === "tool-call") return "tool";
  return undefined;
}

function fail(context: ModelEffectContext, binding: ModelEffectBinding, errorCode: string): void {
  const outcome = errorCode === "provider_error" ? "failed" as const : "outcome_unknown" as const;
  if (context.observer) {
    context.observer.fail({ ...binding, errorCode, outcome });
    return;
  }
  context.lifecycle.settle({
    effectId: binding.effect.effectId,
    runId: binding.effect.runId,
    attemptId: binding.effect.attemptId,
    expectedVersion: binding.effect.version,
    outcome,
    errorCode,
  });
}

function settleDirect(input: {
  context: ModelEffectContext;
  effect: EffectLifecycle;
  model: { provider: string; modelId: string };
  usage: ProviderUsage | undefined;
}): void {
  const accepted = usageRecord(input.model, input.usage);
  const hasUsage = accepted.quality === "reported";
  input.context.lifecycle.settle({
    effectId: input.effect.effectId,
    runId: input.effect.runId,
    attemptId: input.effect.attemptId,
    expectedVersion: input.effect.version,
    outcome: hasUsage ? "completed" : "outcome_unknown",
    ...(hasUsage ? {} : { errorCode: "provider_usage_missing" }),
    usage: accepted,
  });
}

interface ProviderUsage {
  inputTokens: { total?: number; noCache?: number; cacheRead?: number; cacheWrite?: number };
  outputTokens: { total?: number; text?: number; reasoning?: number };
}

function usageRecord(
  model: { provider: string; modelId: string },
  usage: ProviderUsage | undefined,
): Omit<UsageRecord, "usageId" | "schemaVersion" | "runId" | "attemptId" | "effectId" | "recordedAt"> {
  const normalized = usage ?? { inputTokens: {}, outputTokens: {} };
  const counts = [normalized.inputTokens.total, normalized.inputTokens.noCache, normalized.inputTokens.cacheRead,
    normalized.inputTokens.cacheWrite, normalized.outputTokens.total, normalized.outputTokens.text, normalized.outputTokens.reasoning];
  return {
    provider: model.provider,
    modelId: model.modelId,
    quality: counts.some((value) => value !== undefined) ? "reported" : "unknown",
    inputTokens: normalized.inputTokens.total,
    inputTokenDetails: compactDetails({
      noCacheTokens: normalized.inputTokens.noCache,
      cacheReadTokens: normalized.inputTokens.cacheRead,
      cacheWriteTokens: normalized.inputTokens.cacheWrite,
    }),
    outputTokens: normalized.outputTokens.total,
    outputTokenDetails: compactDetails({
      textTokens: normalized.outputTokens.text,
      reasoningTokens: normalized.outputTokens.reasoning,
    }),
    totalTokens: sumKnown(normalized.inputTokens.total, normalized.outputTokens.total),
  };
}

function compactDetails<T extends Record<string, number | undefined>>(value: T): T | undefined {
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function sumKnown(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

export function digestForModelRequest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
