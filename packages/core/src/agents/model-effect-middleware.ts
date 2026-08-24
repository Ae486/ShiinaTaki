import { createHash } from "node:crypto";
import type { LanguageModelMiddleware } from "ai";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";

interface ModelEffectContext {
  lifecycle: EffectLifecycleService;
  runId: string;
  attemptId: string;
}
type ProviderStreamPart = { type: string; usage?: { inputTokens: { total?: number }; outputTokens: { total?: number } } };

export function createModelEffectMiddleware(context: ModelEffectContext): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async wrapGenerate({ doGenerate, params, model }) {
      const effect = context.lifecycle.prepare({
        runId: context.runId,
        attemptId: context.attemptId,
        kind: "model",
        sourceRef: { type: "model", provider: model.provider, modelId: model.modelId },
        executorRef: { type: "provider", provider: model.provider },
        inputDigest: digestForModelRequest(params),
        replayPosture: "never",
      });
      try {
        const result = await doGenerate();
        const inputTokens = result.usage.inputTokens.total;
        const outputTokens = result.usage.outputTokens.total;
        context.lifecycle.settle({ effectId: effect.effectId, runId: context.runId, attemptId: context.attemptId, expectedVersion: effect.version, outcome: "completed", usage: usageFor({ provider: model.provider, modelId: model.modelId, inputTokens, outputTokens, prompt: params.prompt }) });
        return result;
      } catch (error) {
        context.lifecycle.settle({ effectId: effect.effectId, runId: context.runId, attemptId: context.attemptId, expectedVersion: effect.version, outcome: params.abortSignal?.aborted ? "outcome_unknown" : "failed", errorCode: params.abortSignal?.aborted ? "provider_abort" : "provider_error" });
        throw error;
      }
    },
    async wrapStream({ doStream, params, model }) {
      const effect = context.lifecycle.prepare({
        runId: context.runId,
        attemptId: context.attemptId,
        kind: "model",
        sourceRef: { type: "model", provider: model.provider, modelId: model.modelId },
        executorRef: { type: "provider", provider: model.provider },
        inputDigest: digestForModelRequest(params),
        replayPosture: "never",
      });
      let result;
      try {
        result = await doStream();
      } catch (error) {
        context.lifecycle.settle({ effectId: effect.effectId, runId: context.runId, attemptId: context.attemptId, expectedVersion: effect.version, outcome: params.abortSignal?.aborted ? "outcome_unknown" : "failed", errorCode: params.abortSignal?.aborted ? "provider_abort" : "provider_error" });
        throw error;
      }
      return { ...result, stream: settleStream(result.stream as ReadableStream<ProviderStreamPart>, (part) => settlePart({ context, effect, provider: model.provider, modelId: model.modelId, part }), () => context.lifecycle.settle({ effectId: effect.effectId, runId: context.runId, attemptId: context.attemptId, expectedVersion: effect.version, outcome: "outcome_unknown", errorCode: "provider_stream_interrupted" })) as typeof result.stream };
    },
  };
}

function settlePart(input: { context: ModelEffectContext; effect: ReturnType<EffectLifecycleService["prepare"]>; provider: string; modelId: string; part: ProviderStreamPart }): void {
  const { context, effect, provider, modelId, part } = input;
  if (part.type === "error") { context.lifecycle.settle({ effectId: effect.effectId, runId: context.runId, attemptId: context.attemptId, expectedVersion: effect.version, outcome: "outcome_unknown", errorCode: "provider_stream_error" }); return; }
  if (part.type !== "finish") return;
  if (!part.usage) { context.lifecycle.settle({ effectId: effect.effectId, runId: context.runId, attemptId: context.attemptId, expectedVersion: effect.version, outcome: "outcome_unknown", errorCode: "provider_usage_missing" }); return; }
  const inputTokens = part.usage.inputTokens.total;
  const outputTokens = part.usage.outputTokens.total;
  context.lifecycle.settle({ effectId: effect.effectId, runId: context.runId, attemptId: context.attemptId, expectedVersion: effect.version, outcome: "completed", usage: usageFor({ provider, modelId, inputTokens, outputTokens }) });
}

function usageFor(input: { provider: string; modelId: string; inputTokens?: number; outputTokens?: number; prompt?: unknown }) {
  const estimated = input.inputTokens === undefined && input.outputTokens === undefined ? Math.max(1, Math.ceil(JSON.stringify(input.prompt ?? "").length / 4)) : undefined;
  return { provider: input.provider, modelId: input.modelId, quality: input.inputTokens === undefined && input.outputTokens === undefined ? "estimated" as const : "reported" as const, inputTokens: input.inputTokens ?? estimated, outputTokens: input.outputTokens, totalTokens: input.inputTokens !== undefined || input.outputTokens !== undefined ? (input.inputTokens ?? 0) + (input.outputTokens ?? 0) : estimated };
}

function settleStream<T extends ProviderStreamPart>(stream: ReadableStream<T>, onPart: (part: T) => void, onInterrupted: () => void): ReadableStream<T> {
  const reader = stream.getReader();
  let settled = false;
  const onceInterrupted = () => { if (!settled) { settled = true; onInterrupted(); } };
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { if (!settled) { settled = true; onInterrupted(); } controller.close(); return; }
        onPart(next.value); if (next.value.type === "finish") settled = true; controller.enqueue(next.value);
      } catch (error) { onceInterrupted(); controller.error(error); }
    },
    async cancel(reason) { onceInterrupted(); await reader.cancel(reason); },
  });
}

export function digestForModelRequest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
