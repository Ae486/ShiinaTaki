import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TakiApplicationReflectRequestSchema, type MemoryResult, type ReflectResult } from "@taki/shared";
import { createHindsightRuntimeAdmissionRepo } from "../../db/hindsight-runtime-admission-repo.ts";
import { createPendingMemoryRepo } from "../../db/pending-memory-repo.ts";
import { APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";
import { createHindsightMemoryProvider } from "./hindsight-memory-provider.ts";
import type { HindsightMemoryProviderDeps } from "./hindsight-memory-provider-context.ts";
import { curatorTestBank } from "./hindsight-policy-curator-fixtures.ts";
import { createHindsightRuntimeConnection } from "./hindsight-runtime-connection.ts";

const call = { requestId: "reflect-deadline", authorityEpochId: "epoch", actor: "foreground-agent" as const };
const request = { bankId: "bank-a", query: "What do we know?", budget: "low" as const, maxTokens: 128 };
const fixtures: ReturnType<typeof createFixture>[] = [];

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT); });
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function waitFor(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", aborted); resolve(); }, ms);
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

function afterDelay<Args extends unknown[], Result>(action: (...args: Args) => Promise<Result>, ms: number) {
  return async (...args: Args): Promise<Result> => { const result = await action(...args); await waitFor(ms); return result; };
}

function createFixture(requestTimeoutMs?: number) {
  const bank = curatorTestBank(); const base = hindsightRuntimeFixture({ banks: [bank] });
  if (requestTimeoutMs !== undefined) base.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", requestTimeoutMs);
  const control = { reflectMs: 150_000, recallMs: 150_000, synchronizeMs: 0, invalidContextHash: false };
  const reflectEntered = deferred(); const recallEntered = deferred(); const runtimeAbort = new AbortController();
  // Only the native response is simulated. The real client owns its timeout,
  // abort signal, schema validation and guarded-reflect response identity checks.
  const transport = vi.fn<HindsightTransport>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/ext/taki-memory/banks/bank-a/application-state/reflect") {
      const body = TakiApplicationReflectRequestSchema.parse(JSON.parse(String(init?.body)));
      reflectEntered.resolve(); await waitFor(control.reflectMs, init?.signal);
      return { status: 200, body: JSON.stringify({ namespace: body.namespace, bank_id: bank.scope.bankId,
        request_id: body.request_id, admission: { checkpoint: { native_cursor: 2, state_cursor: 0 },
          context_hash: control.invalidContextHash ? "a".repeat(64) : body.policy_context_ref.payload_hash,
          admitted_memories: 1, withheld_inputs: ["whole_sources"], linearization: "before_each_model_submission" },
        native_response: { text: "A completed reflection", based_on: { memories: [{ id: "memory-a", text: "A verified fact" }] },
          usage: { input_tokens: 11, output_tokens: 7 } } }) };
    }
    if (path === "/v1/default/banks/bank-a/memories/recall") {
      recallEntered.resolve(); await waitFor(control.recallMs, init?.signal);
      return { status: 200, body: JSON.stringify({ results: [] }) };
    }
    throw new Error("unexpected deadline fixture route");
  });
  const native = createHindsightClient({ endpoint: "http://127.0.0.1:18481", resolveApiKey: () => "deadline-fixture-key", transport });
  const client = { ...base.remote.client, reflectApplication: native.reflectApplication!, recallNative: native.recallNative! };
  const runtime = createHindsightRuntimeConnection({ db: base.db, epochId: "epoch", config: base.source, secrets: base.secrets.catalog, client });
  // The existing fixture publishes a complete verified replica. This seam adds
  // controlled synchronization latency without synthesizing Bank/policy evidence.
  const synchronize = vi.fn<HindsightMemoryProviderDeps["synchronize"]>(async ({ context }) => waitFor(control.synchronizeMs, context.signal));
  const unused = async (): Promise<never> => { throw new Error("deadline fixture forbids memory writes"); };
  const provider = createHindsightMemoryProvider({ ...runtime, epochId: "epoch", replica: base.replica,
    admission: createHindsightRuntimeAdmissionRepo(base.db), pending: createPendingMemoryRepo(base.db),
    writes: { retain: unused, mutate: unused }, synchronize, signal: runtimeAbort.signal });
  const calls = { health: vi.spyOn(client, "health"), version: vi.spyOn(client, "version"), compatibility: vi.spyOn(client, "compatibility"),
    upload: vi.spyOn(client, "uploadApplicationBody"), part: vi.spyOn(client, "putApplicationBodyPart"), seal: vi.spyOn(client, "sealApplicationBody"),
    reflect: vi.spyOn(client, "reflectApplication"), recall: vi.spyOn(client, "recallNative") };
  return { base, bank, client, runtime, runtimeAbort, control, calls, synchronize, provider, transport, reflectEntered, recallEntered,
    close: async () => { await provider.stop(); runtime.stop(); await base.close(); } };
}

async function fixture(requestTimeoutMs?: number) {
  const value = createFixture(requestTimeoutMs); fixtures.push(value);
  await value.provider.capabilities();
  for (const spy of Object.values(value.calls)) spy.mockClear();
  return value;
}

describe("Hindsight provider Reflect operation deadline", () => {
  it.each([undefined, 120_000])("returns a completed reflection after 120 seconds with generic timeout %s", async (configured) => {
    const f = await fixture(configured);
    expect(f.runtime.connection.requestTimeoutMs).toBe(configured ?? 10_000);
    let settled: MemoryResult<ReflectResult> | undefined;
    const running = f.provider.reflect(call, request).then((result) => { settled = result; return result; });
    await f.reflectEntered.promise;
    const signal = f.transport.mock.calls[0]![1]!.signal!;
    await vi.advanceTimersByTimeAsync(120_001);
    expect(settled).toBeUndefined(); expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(await running).toMatchObject({ ok: true, providerId: "hindsight", authorityEpochId: "epoch", data: {
      text: "A completed reflection", evidence: { memoryIds: ["memory-a"] }, usage: { inputTokens: 11, outputTokens: 7 } } });
    expect(f.calls.reflect).toHaveBeenCalledOnce(); expect(f.transport).toHaveBeenCalledOnce();
  });

  it("subtracts synchronization, admission and every policy upload step from the final request budget", async () => {
    const f = await fixture(120_000); f.control.synchronizeMs = 40_000; f.control.reflectMs = 170_000;
    f.calls.health.mockImplementationOnce(afterDelay(f.base.remote.client.health, 20_000));
    f.calls.version.mockImplementationOnce(afterDelay(f.base.remote.client.version, 15_000));
    f.calls.compatibility.mockImplementationOnce(afterDelay(f.base.remote.client.compatibility, 10_000));
    f.calls.upload.mockImplementationOnce(afterDelay(f.base.remote.client.uploadApplicationBody, 10_000));
    f.calls.part.mockImplementationOnce(afterDelay(f.base.remote.client.putApplicationBodyPart, 15_000));
    f.calls.seal.mockImplementationOnce(afterDelay(f.base.remote.client.sealApplicationBody, 10_000));
    const running = f.provider.reflect(call, request);
    await vi.advanceTimersByTimeAsync(120_000); await f.reflectEntered.promise;
    expect([f.synchronize.mock.calls[0]![0].context.timeoutMs, f.calls.health.mock.calls[0]![0].timeoutMs,
      f.calls.version.mock.calls[0]![0].timeoutMs, f.calls.compatibility.mock.calls[0]![0].timeoutMs,
      f.calls.upload.mock.calls[0]![0].context.timeoutMs, f.calls.part.mock.calls[0]![0].context.timeoutMs,
      f.calls.seal.mock.calls[0]![0].context.timeoutMs, f.calls.reflect.mock.calls[0]![0].context.timeoutMs])
      .toEqual([300_000, 260_000, 240_000, 225_000, 215_000, 205_000, 190_000, 180_000]);
    await vi.advanceTimersByTimeAsync(170_000);
    expect(await running).toMatchObject({ ok: true, data: { text: "A completed reflection" } });
    expect(Date.now() - Date.parse(APPLICATION_TEST_AT)).toBe(290_000);
  });

  it("expires at five minutes even when the native reflection remains pending", async () => {
    const f = await fixture(); f.control.reflectMs = 400_000;
    let settled = false; const running = f.provider.reflect(call, request).then((result) => { settled = true; return result; });
    await f.reflectEntered.promise;
    await vi.advanceTimersByTimeAsync(299_999); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toMatchObject({ ok: false, error: { code: "MEMORY_PROVIDER_UNAVAILABLE", retryable: true } });
    expect(f.transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(f.calls.reflect).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it("refuses further admission or native dispatch once earlier work consumes the whole allowance", async () => {
    const f = await fixture(); f.control.synchronizeMs = 299_000;
    f.calls.health.mockImplementationOnce(afterDelay(f.base.remote.client.health, 1_000));
    const running = f.provider.reflect(call, request);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await running).toMatchObject({ ok: false, error: { code: "MEMORY_PROVIDER_UNAVAILABLE" } });
    expect(f.calls.health.mock.calls[0]![0].timeoutMs).toBe(1_000);
    expect(f.calls.version).not.toHaveBeenCalled(); expect(f.calls.upload).not.toHaveBeenCalled();
    expect(f.calls.reflect).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(["caller", "runtime", "stop"] as const)("honors %s cancellation after the generic timeout has elapsed", async (source) => {
    const f = await fixture(); const caller = new AbortController();
    const running = f.provider.reflect({ ...call, signal: caller.signal }, request);
    await f.reflectEntered.promise; await vi.advanceTimersByTimeAsync(125_000);
    if (source === "caller") caller.abort("private caller reason");
    else if (source === "runtime") f.runtimeAbort.abort("private runtime reason");
    else await f.provider.stop();
    const result = await running;
    expect(result).toMatchObject({ ok: false, error: { code: "MEMORY_OPERATION_CANCELLED" } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(f.transport.mock.calls[0]![1]!.signal!.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, 120_000])("enforces ordinary recall's individual HTTP timeout %s", async (configured) => {
    const f = await fixture(configured); const budget = configured ?? 10_000; f.control.recallMs = budget + 1;
    let settled = false;
    const running = f.provider.recall(call, { ...request, query: "fact", queryTimestamp: null, limit: 5,
      factTypes: ["world"], layerIds: [], includeInvalidated: false }).then((result) => { settled = true; return result; });
    await f.recallEntered.promise;
    expect(f.synchronize.mock.calls[0]![0].context.timeoutMs).toBe(budget);
    expect(f.calls.recall.mock.calls[0]![0].context.timeoutMs).toBe(budget);
    await vi.advanceTimersByTimeAsync(budget - 1); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toMatchObject({ ok: true, data: { partial: true, vectorState: "degraded",
      branchFailures: [{ code: "MEMORY_PROVIDER_UNAVAILABLE" }] } });
    expect(f.calls.reflect).not.toHaveBeenCalled(); expect(f.transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("rechecks the captured connection after a long reflection before exposing its result", async () => {
    const f = await fixture(); const running = f.provider.reflect(call, request);
    await f.reflectEntered.promise; await vi.advanceTimersByTimeAsync(125_000);
    f.base.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", 20_000);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await running).toMatchObject({ ok: false, error: { code: "MEMORY_AUTHORITY_MISMATCH" } });
  });

  it("still refuses a reflection whose returned admission does not bind the uploaded policy context", async () => {
    const f = await fixture(); f.control.invalidContextHash = true;
    const running = f.provider.reflect(call, request); await f.reflectEntered.promise;
    await vi.advanceTimersByTimeAsync(150_000);
    expect(await running).toMatchObject({ ok: false, error: { code: "MEMORY_INTEGRITY_ERROR" } });
  });
});
