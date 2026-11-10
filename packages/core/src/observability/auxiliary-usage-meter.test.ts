import { APICallError, generateText, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { AuxiliaryUsageRepo } from "../db/auxiliary-usage-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createAuxiliaryUsageMeter } from "./auxiliary-usage-meter.ts";
import { withAuxiliaryUsageTask, withRunUsageOwner, withMaintenanceUsageOwner } from "./model-usage-context.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";

const USAGE = {
  inputTokens: { total: 6, noCache: 2, cacheRead: 4, cacheWrite: undefined },
  outputTokens: { total: 3, text: 2, reasoning: 1 },
};
type ProviderStreamPart = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>["stream"] extends
  ReadableStream<infer Part> ? Part : never;

function result(usage: unknown = USAGE) {
  return {
    content: [{ type: "text" as const, text: "ok" }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
    response: { id: "response-1" },
  } as Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
}

function fixture(repoOverrides: Partial<AuxiliaryUsageRepo> = {}) {
  const starts: Array<Record<string, unknown>> = [];
  const settlements: Array<Record<string, unknown>> = [];
  const repo = {
    start(input: Record<string, unknown>) { starts.push(input); },
    settle(input: Record<string, unknown>) { settlements.push(input); },
    reconcileInterrupted: () => 0,
    query: vi.fn(),
    ...repoOverrides,
  } as unknown as AuxiliaryUsageRepo;
  const { logger, records } = createCaptureLogger();
  return { starts, settlements, records, meter: createAuxiliaryUsageMeter({ repo, logger }) };
}

describe("auxiliary usage generate observation", () => {
  it("captures each queued task owner without leaking a maintenance association to intervening work", async () => {
    const f = fixture(); const { logger } = createCaptureLogger();
    const slot = createUtilitySlot({ mainModel: new MockLanguageModelV4({ doGenerate: async () => result() }),
      logger, usageMeter: f.meter });
    const operation = { kind: "tidy", operationId: "tidy-operation", characterId: "taki" } as const;
    const run = () => generateText({ model: slot.model, prompt: "test" });
    const first = withMaintenanceUsageOwner(operation, () => slot.run("tidy", run));
    const independent = slot.run("episodic", run);
    const second = withMaintenanceUsageOwner(operation, () => slot.run("tidy", run));
    await Promise.all([first, independent, second]);
    expect(f.starts.map((entry) => entry.operation)).toEqual([operation, undefined, operation]);
    expect(new Set(f.starts.map((entry) => entry.taskId)).size).toBe(3);
    await slot.stop();
  });

  it("records each actual SDK invocation even when a Utility task discards both results", async () => {
    const f = fixture();
    const provider = new MockLanguageModelV4({ doGenerate: async () => result() });
    const model = f.meter.wrapModel(provider, { source: "utility", label: "fallback" });
    await withAuxiliaryUsageTask("canonical extraction", async () => {
      await generateText({ model, prompt: "first" });
      await generateText({ model, prompt: "second" });
    });

    expect(provider.doGenerateCalls).toHaveLength(2);
    expect(f.starts).toHaveLength(2);
    expect(f.starts[0]).toMatchObject({ source: "utility", label: "canonical extraction" });
    expect(f.starts[0]!.taskId).toBe(f.starts[1]!.taskId);
    expect(f.settlements).toHaveLength(2);
    expect(f.settlements[0]).toMatchObject({ status: "completed", responseId: "response-1", usage: {
      inputTokens: 6, noCacheTokens: 2, cacheReadTokens: 4, cacheWriteTokens: null,
      outputTokens: 3, reasoningTokens: 1, totalTokens: 9,
    } });
  });

  it("records retry attempts separately through the actual SDK and preserves the successful result", async () => {
    const f = fixture();
    const retryable = new APICallError({ message: "private provider body", url: "https://fixture.invalid",
      requestBodyValues: {}, statusCode: 503, responseBody: "PRIVATE", isRetryable: true });
    const provider = new MockLanguageModelV4({ doGenerate: async () => result() });
    const requests = vi.spyOn(provider, "doGenerate").mockRejectedValueOnce(retryable).mockResolvedValueOnce(result());
    const model = f.meter.wrapModel(provider, { source: "image-description", label: "retry fixture" });

    await expect(generateText({ model, prompt: "fixture", maxRetries: 1 })).resolves.toMatchObject({ text: "ok" });
    expect(requests).toHaveBeenCalledTimes(2);
    expect(f.starts).toHaveLength(2);
    expect(f.settlements.map((entry) => entry.status)).toEqual(["failed", "completed"]);
    expect(JSON.stringify(f.records)).not.toContain("PRIVATE");
  });

  it("skips calls owned by authoritative Run accounting", async () => {
    const f = fixture();
    const provider = new MockLanguageModelV4({ doGenerate: async () => result() });
    const model = f.meter.wrapModel(provider, { source: "screenshot-description", label: "screen" }) as MockLanguageModelV4;
    await withRunUsageOwner(() => model.doGenerate({ prompt: [] }));
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect(f.starts).toEqual([]);
  });

  it("preserves the exact provider response and exception across repository failures", async () => {
    const completed = result();
    const failedFinish = fixture({ settle() { throw new Error("db payload"); } });
    const provider = new MockLanguageModelV4({ doGenerate: async () => completed });
    const wrapped = failedFinish.meter.wrapModel(provider, { source: "image-description", label: "image" }) as MockLanguageModelV4;
    expect(await wrapped.doGenerate({ prompt: [] })).toBe(completed);
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect(failedFinish.records).toContainEqual(expect.objectContaining({
      obj: { code: "AUXILIARY_USAGE_SETTLE_FAILED", source: "image-description", label: "image" },
    }));
    expect(JSON.stringify(failedFinish.records)).not.toContain("db payload");

    const providerError = new Error("raw provider exception");
    const failedStart = fixture({ start() { throw new Error("db unavailable"); } });
    const rejecting = new MockLanguageModelV4({ doGenerate: async () => { throw providerError; } });
    const rejected = failedStart.meter.wrapModel(rejecting, { source: "image-description", label: "image" }) as MockLanguageModelV4;
    await expect(rejected.doGenerate({ prompt: [] })).rejects.toBe(providerError);
    expect(rejecting.doGenerateCalls).toHaveLength(1);
    expect(failedStart.settlements).toEqual([]);
    expect(JSON.stringify(failedStart.records)).not.toContain("raw provider exception");
    expect(JSON.stringify(failedStart.records)).not.toContain("db unavailable");

    const failedErrorSettlement = fixture({ settle() { throw new Error("db settle unavailable"); } });
    const rejectingAfterStart = new MockLanguageModelV4({ doGenerate: async () => { throw providerError; } });
    const observedRejection = failedErrorSettlement.meter.wrapModel(rejectingAfterStart, {
      source: "image-description", label: "image",
    }) as MockLanguageModelV4;
    await expect(observedRejection.doGenerate({ prompt: [] })).rejects.toBe(providerError);
    expect(rejectingAfterStart.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(failedErrorSettlement.records)).not.toContain("db settle unavailable");
  });

  it("isolates throwing usage metadata and throwing diagnostics from the completed provider response", async () => {
    const f = fixture();
    const completed = result();
    Object.defineProperty(completed, "usage", { enumerable: true, get() { throw new Error("private metadata"); } });
    const provider = new MockLanguageModelV4({ doGenerate: async () => completed });
    const wrapped = f.meter.wrapModel(provider, { source: "image-description", label: "image" }) as MockLanguageModelV4;
    expect(await wrapped.doGenerate({ prompt: [] })).toBe(completed);
    expect(f.settlements).toEqual([expect.objectContaining({ status: "completed", responseId: null,
      usage: expect.objectContaining({ inputTokens: null, outputTokens: null }) })]);
    expect(JSON.stringify(f.records)).not.toContain("private metadata");

    const start = vi.fn(); const settle = vi.fn();
    const noisy = createAuxiliaryUsageMeter({
      repo: { start, settle, reconcileInterrupted: vi.fn(), query: vi.fn() } as unknown as AuxiliaryUsageRepo,
      logger: { warn() { throw new Error("log unavailable"); } },
    }).wrapModel(new MockLanguageModelV4({ doGenerate: async () => completed }), {
      source: "image-description", label: "image",
    }) as MockLanguageModelV4;
    await expect(noisy.doGenerate({ prompt: [] })).resolves.toBe(completed);
    expect(start).toHaveBeenCalledOnce(); expect(settle).toHaveBeenCalledOnce();
  });

  it("creates no durable row for an auxiliary task that makes no provider call", async () => {
    const f = fixture();
    await withAuxiliaryUsageTask("zero-call task", async () => "done");
    expect(f.starts).toEqual([]);
    expect(f.settlements).toEqual([]);
  });
});

describe("auxiliary usage stream observation", () => {
  it("uses the actual SDK stream path and captures finish usage", async () => {
    const f = fixture();
    const provider = streamModel([
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "ok" },
      { type: "text-end", id: "t" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
    ]);
    const model = f.meter.wrapModel(provider, { source: "screenshot-description", label: "screen" });
    await streamText({ model, prompt: "fixture" }).consumeStream();
    expect(provider.doStreamCalls).toHaveLength(1);
    expect(f.settlements).toEqual([expect.objectContaining({ status: "completed", usage: expect.objectContaining({ totalTokens: 9 }) })]);
  });

  it("keeps error then finish failed while retaining the later usage", async () => {
    const f = fixture();
    const providerError = new Error("private stream error");
    const model = f.meter.wrapModel(streamModel([
      { type: "error", error: providerError },
      { type: "finish", finishReason: { unified: "error", raw: undefined }, usage: USAGE },
    ]), { source: "utility", label: "stream" }) as MockLanguageModelV4;
    const output = await model.doStream({ prompt: [] });
    const parts = await readAll(output.stream);
    expect(parts.map((part) => part.type)).toEqual(["error", "finish"]);
    expect(f.settlements).toEqual([expect.objectContaining({ status: "failed", usage: expect.objectContaining({ inputTokens: 6 }) })]);
  });

  it("captures task identity at provider entry rather than stream callback time", async () => {
    const f = fixture();
    const model = f.meter.wrapModel(streamModel([
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
    ]), { source: "utility", label: "fallback" }) as MockLanguageModelV4;
    const output = await withAuxiliaryUsageTask("entry owner", async () => model.doStream({ prompt: [] }));
    await withAuxiliaryUsageTask("consumer owner", () => readAll(output.stream));
    expect(f.starts).toEqual([expect.objectContaining({ label: "entry owner", taskId: expect.any(String) })]);
    expect(f.settlements).toHaveLength(1);
  });

  it("keeps finish completed after consumer cancel and forwards cancellation exactly once", async () => {
    const f = fixture(); const cancelled = vi.fn();
    const provider = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({
      start(controller) { controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE }); },
      cancel: cancelled,
    }) }) });
    const model = f.meter.wrapModel(provider, { source: "utility", label: "stream" }) as MockLanguageModelV4;
    const output = await model.doStream({ prompt: [] }); const reader = output.stream.getReader();
    expect((await reader.read()).value?.type).toBe("finish"); await reader.cancel("done");
    expect(cancelled).toHaveBeenCalledOnce();
    expect(f.settlements.map((entry) => entry.status)).toEqual(["completed"]);
  });

  it("classifies consumer cancel, unfinished close and read error without draining or replaying", async () => {
    const cancelFixture = fixture(); const cancelled = vi.fn();
    const cancelModel = cancelFixture.meter.wrapModel(new MockLanguageModelV4({ doStream: async () => ({
      stream: new ReadableStream({ start(controller) { controller.enqueue({ type: "text-start", id: "t" }); }, cancel: cancelled }),
    }) }), { source: "utility", label: "cancel" }) as MockLanguageModelV4;
    const cancelReader = (await cancelModel.doStream({ prompt: [] })).stream.getReader();
    await cancelReader.read(); await cancelReader.cancel("stop");
    expect(cancelled).toHaveBeenCalledOnce();
    expect(cancelFixture.settlements.map((entry) => entry.status)).toEqual(["cancelled"]);

    const interrupted = fixture();
    await readAll((await (interrupted.meter.wrapModel(streamModel([]), {
      source: "utility", label: "closed",
    }) as MockLanguageModelV4).doStream({ prompt: [] })).stream);
    expect(interrupted.settlements.map((entry) => entry.status)).toEqual(["interrupted"]);

    const readError = new Error("provider read failed"); const failed = fixture();
    const failedModel = failed.meter.wrapModel(new MockLanguageModelV4({ doStream: async () => ({
      stream: new ReadableStream({ start(controller) { controller.error(readError); } }),
    }) }), { source: "utility", label: "read" }) as MockLanguageModelV4;
    const failedReader = (await failedModel.doStream({ prompt: [] })).stream.getReader();
    await expect(failedReader.read()).rejects.toBe(readError);
    expect(failed.settlements.map((entry) => entry.status)).toEqual(["failed"]);
  });
});

function streamModel(chunks: ProviderStreamPart[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
  }) }) as Awaited<ReturnType<MockLanguageModelV4["doStream"]>> });
}

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const values: T[] = []; const reader = stream.getReader();
  for (;;) { const next = await reader.read(); if (next.done) return values; values.push(next.value); }
}
