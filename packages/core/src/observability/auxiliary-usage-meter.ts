/**
 * INPUT:  AI SDK v4 models, auxiliary call metadata, ownership context and AuxiliaryUsageRepo
 * OUTPUT: non-interfering per-provider-invocation durable usage observation
 * POS:    core/observability — optional auxiliary accounting middleware beside authoritative Run accounting
 */
import { randomUUID } from "node:crypto";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import type { AuxiliaryCallSource, AuxiliaryUsageCounts } from "@taki/shared";
import type { AuxiliaryUsageRepo } from "../db/auxiliary-usage-repo.ts";
import { currentModelUsageOwner } from "./model-usage-context.ts";
import { normalizeAuxiliaryUsage, unknownAuxiliaryUsage } from "./auxiliary-usage-normalization.ts";

interface MeterLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

export interface AuxiliaryUsageMeter {
  wrapModel(model: LanguageModel, context: { source: AuxiliaryCallSource; label: string }): LanguageModel;
}

export function createAuxiliaryUsageMeter(input: {
  repo: AuxiliaryUsageRepo;
  logger: MeterLogger;
}): AuxiliaryUsageMeter {
  return {
    wrapModel(model, context) {
      if (typeof model === "string") return model;
      return wrapLanguageModel({ model, middleware: middleware(input, Object.freeze({ ...context })) });
    },
  };
}

function middleware(
  deps: { repo: AuxiliaryUsageRepo; logger: MeterLogger },
  context: { source: AuxiliaryCallSource; label: string },
): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    async wrapGenerate({ doGenerate, model, params }) {
      const call = beginCall(deps, context, model);
      if (!call) return doGenerate();
      let result;
      try {
        result = await doGenerate();
      } catch (error) {
        call.settle(cancelled(error, params.abortSignal) ? "cancelled" : "failed", unknownAuxiliaryUsage(), null);
        throw error;
      }
      observeGenerate(call, result);
      return result;
    },
    async wrapStream({ doStream, model, params }) {
      const call = beginCall(deps, context, model);
      if (!call) return doStream();
      try {
        const result = await doStream();
        return { ...result, stream: observeStream(result.stream, call, params.abortSignal) };
      } catch (error) {
        call.settle(cancelled(error, params.abortSignal) ? "cancelled" : "failed", unknownAuxiliaryUsage(), null);
        throw error;
      }
    },
  };
}

interface ActiveCall {
  settle(
    status: "completed" | "failed" | "cancelled" | "interrupted",
    usage: AuxiliaryUsageCounts,
    responseId: string | null,
  ): void;
  metadataFailed(): void;
}

function beginCall(
  deps: { repo: AuxiliaryUsageRepo; logger: MeterLogger },
  context: { source: AuxiliaryCallSource; label: string },
  model: { provider: string; modelId: string },
): ActiveCall | undefined {
  const owner = currentModelUsageOwner();
  if (owner?.owner === "run") return undefined;
  const label = owner?.owner === "auxiliary" ? owner.label : context.label;
  let callId: string;
  let provider: string;
  let modelId: string;
  let startedAt: string;
  try {
    callId = randomUUID();
    provider = model.provider;
    modelId = model.modelId;
    startedAt = new Date().toISOString();
  } catch {
    warn(deps.logger, { source: context.source, label }, "AUXILIARY_USAGE_METADATA_FAILED");
    return undefined;
  }
  try {
    const taskId = owner?.owner === "auxiliary" ? owner.taskId : null;
    deps.repo.start({ callId, taskId, source: context.source, label, provider, modelId, startedAt,
      ...(owner?.operation ? { operation: owner.operation } : {}) });
  } catch {
    warn(deps.logger, { source: context.source, label }, "AUXILIARY_USAGE_START_FAILED");
    return undefined;
  }
  let settled = false;
  return {
    metadataFailed() {
      warn(deps.logger, { source: context.source, label }, "AUXILIARY_USAGE_METADATA_FAILED");
    },
    settle(status, usage, id) {
      if (settled) return;
      settled = true;
      try {
        deps.repo.settle({ callId, status, finishedAt: new Date().toISOString(), usage, responseId: id });
      } catch {
        warn(deps.logger, { source: context.source, label }, "AUXILIARY_USAGE_SETTLE_FAILED");
      }
    },
  };
}

type StreamPart = Awaited<ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>>["stream"] extends
  ReadableStream<infer Part> ? Part : never;

function observeGenerate(
  call: ActiveCall,
  result: { usage: unknown; response?: unknown },
): void {
  try {
    call.settle("completed", normalizeAuxiliaryUsage(result.usage), responseId(result.response));
  } catch {
    call.metadataFailed();
    call.settle("completed", unknownAuxiliaryUsage(), null);
  }
}

function observeStream(
  stream: ReadableStream<StreamPart>,
  call: ActiveCall,
  abortSignal: AbortSignal | undefined,
): ReadableStream<StreamPart> {
  const reader = stream.getReader();
  let ending: "failed" | "cancelled" | undefined;
  let id: string | null = null;
  let terminal = false;
  const settle = (status: "completed" | "failed" | "cancelled" | "interrupted", usage = unknownAuxiliaryUsage()) => {
    if (terminal) return;
    terminal = true;
    call.settle(status, usage, id);
  };
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          settle(ending ?? "interrupted");
          controller.close();
          return;
        }
        const part = next.value;
        let type: StreamPart["type"] | undefined;
        try {
          type = part.type;
          if (type === "response-metadata") id = responseId(part) ?? id;
          if (type === "error") ending = cancelled(errorFrom(part), abortSignal) ? "cancelled" : "failed";
          if (type === "finish") {
            settle(ending ?? "completed", normalizeAuxiliaryUsage(usageFrom(part)));
          }
        } catch {
          call.metadataFailed();
          if (type === "finish") settle(ending ?? "completed");
        }
        controller.enqueue(part);
      } catch (error) {
        settle(cancelled(error, abortSignal) ? "cancelled" : "failed");
        controller.error(error);
      }
    },
    async cancel(reason) {
      settle(ending ?? "cancelled");
      await reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
}

function responseId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("id" in value)) return null;
  return typeof value.id === "string" && value.id.length > 0 ? value.id : null;
}

function warn(
  logger: MeterLogger,
  context: { source: AuxiliaryCallSource; label: string },
  code: string,
): void {
  try { logger.warn({ code, ...context }, "auxiliary usage observation failed"); } catch {
    // An optional observer and its diagnostics must never alter provider execution.
  }
}

function cancelled(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function errorFrom(part: StreamPart): unknown {
  return (part as Extract<StreamPart, { type: "error" }>).error;
}

function usageFrom(part: StreamPart): unknown {
  return (part as Extract<StreamPart, { type: "finish" }>).usage;
}
