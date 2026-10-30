import { afterEach, describe, expect, it, vi } from "vitest";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";
import type { HindsightRuntimeClient } from "./hindsight-runtime-client.ts";
import { HindsightNativeRecallResponseSchema, HindsightNativeReflectResponseSchema,
  type HindsightNativeRecallRequest, type HindsightNativeReflectRequest } from "@taki/shared";
import { HINDSIGHT_DEFAULT_RESPONSE_BYTES } from "./hindsight-http-transport.ts";

const key = "native-read-fixture-key";
const context = { timeoutMs: 1_000 };
const methods = ["recallNative", "reflectNative"] as const;
const minimal = { recallNative: { results: [] }, reflectNative: { text: "" } };

function client(transport: HindsightTransport, resolveApiKey: () => string | null = () => key): HindsightRuntimeClient {
  const instance = createHindsightClient({ endpoint: "http://127.0.0.1:8888", transport, resolveApiKey });
  expect(instance.recallNative).toBeTypeOf("function");
  expect(instance.reflectNative).toBeTypeOf("function");
  return { recallNative: instance.recallNative!, reflectNative: instance.reflectNative! };
}

function response(value: unknown) { return { status: 200, body: JSON.stringify(value) }; }

type NativeRead = { method: "recallNative"; request: HindsightNativeRecallRequest }
  | { method: "reflectNative"; request: HindsightNativeReflectRequest };
async function expectNativeRoundTrip(read: NativeRead, native: unknown) {
  const wire = response(native);
  expect(new TextEncoder().encode(wire.body).byteLength).toBeLessThanOrEqual(HINDSIGHT_DEFAULT_RESPONSE_BYTES);
  const transport = vi.fn<HindsightTransport>(async () => wire);
  const instance = client(transport);
  const result = read.method === "recallNative"
    ? await instance.recallNative({ bankId: "bank", request: read.request, context })
    : await instance.reflectNative({ bankId: "bank", request: read.request, context });
  expect(result).toEqual(native);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(transport.mock.calls[0]![1]?.body))).toEqual(read.request);
  return result;
}

afterEach(() => vi.useRealTimers());

describe("native Hindsight runtime reads", () => {
  it("sends the native recall options and preserves complete native evidence without Canonical defaults", async () => {
    const metadata = JSON.parse('{"null_value":null,"boolean":false,"number":1.5,"text":"[1,true]","empty_string":"","empty_object":{},"empty_array":[],"array":[true,0,null],"nested":{"snake_case":"kept"},"__proto__":{"own":true},"constructor":"kept"}');
    const fact = { id: "fact-1", text: "An actual native fact", type: "world", entities: ["Alice"], context: "",
      occurred_start: null, occurred_end: "2026-09-11T00:00:00Z", mentioned_at: null, document_id: "document-1",
      metadata, chunk_id: "chunk-1", tags: [], source_fact_ids: null,
      scores: { final: 0.3, reranker: null, semantic: 0.1, keyword: null } };
    const native = { results: [fact], trace: { num_results: 1, time_seconds: 0.125, query: "fixture query" },
      entities: JSON.parse('{"__proto__":{"entity_id":"entity-1","canonical_name":"__proto__","observations":[{"text":"Native observation","mentioned_at":null}]}}'),
      chunks: { "chunk-1": { id: "chunk-1", text: "Actual source chunk", chunk_index: 0, truncated: true } },
      source_facts: { "fact-1": fact } };
    const transport = vi.fn<HindsightTransport>(async () => response(native));
    const request: HindsightNativeRecallRequest = { query: "fixture query", types: ["world", "experience", "observation"],
      budget: "mid", max_tokens: 2_048, query_timestamp: "2023-05-30T23:40:00", prefer_observations: true, trace: false,
      include: { entities: null, chunks: { max_tokens: 0 }, source_facts: { max_tokens: 4096, max_tokens_per_observation: -1 } },
      tags: [], tags_match: "exact", min_scores: { semantic: 0, keyword: null, reranker: null, final: -0.25 } };
    const result = await client(transport).recallNative({ bankId: "Bank /?#雪", request, context });

    expect(result).toEqual(native);
    expect(Object.hasOwn(result.results[0]!.metadata!, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.entities!, "__proto__")).toBe(true);
    expect(result.results[0]).not.toHaveProperty("revision");
    expect(result.results[0]).not.toHaveProperty("policy");
    expect(result.results[0]).not.toHaveProperty("provenance");
    const [url, init, maxBytes] = transport.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:8888/v1/default/banks/Bank%20%2F%3F%23%E9%9B%AA/memories/recall");
    expect(init).toMatchObject({ method: "POST", redirect: "manual", headers: {
      authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json",
    } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(maxBytes).toBeUndefined();
  });

  it("sends reflect-specific options without folding context or inventing missing evidence", async () => {
    const request: HindsightNativeReflectRequest = { query: "fixture query", context: "native deprecated context", budget: "high", max_tokens: 4096,
      include: { facts: {}, tool_calls: { output: false } }, response_schema: { type: "object", properties: { ready: { type: "boolean" } } },
      tag_groups: [{ and: [{ tags: ["scope"], match: "all_strict" }, { or: [{ tags: [], match: "exact" }, { not: { tags: ["excluded"] } }] }] }],
      apply_all_directives: true, fact_types: ["observation"], exclude_mental_models: false, exclude_mental_model_ids: ["model-excluded"] };
    const native = { text: "An actual native reflection", based_on: {
      memories: [{ id: null, text: "Evidence", type: "observation", context: null, occurred_start: null, occurred_end: null }],
      mental_models: [{ id: "model-1", text: "Model evidence", context: "" }],
      directives: [{ id: "directive-1", name: "Directive", content: "Native rule" }],
    }, structured_output: { ready: true, count: 0, empty: [], absent_value: null },
    usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12, cached_tokens: 0, thoughts_tokens: 4 },
    trace: { tool_calls: [{ tool: "recall", input: { query: "fixture" }, output: null, duration_ms: 5, iteration: 1 }],
      llm_calls: [{ scope: "agent_1", duration_ms: 10 }] } };
    const transport = vi.fn<HindsightTransport>(async () => response(native));
    expect(await client(transport).reflectNative({ bankId: "Bank /?#", request, context })).toEqual(native);
    expect(String(transport.mock.calls[0]![0])).toBe("http://127.0.0.1:8888/v1/default/banks/Bank%20%2F%3F%23/reflect");
    expect(JSON.parse(String(transport.mock.calls[0]![1]?.body))).toEqual(request);
    expect(transport.mock.calls[0]![1]?.headers).toMatchObject({ authorization: `Bearer ${key}` });
  });

  it.each(methods)("preserves omission and explicit null in %s", async (method) => {
    const explicitNull = method === "recallNative"
      ? { results: [{ id: "native", text: "", type: null, entities: null, metadata: null, context: null,
        occurred_start: null, occurred_end: null, mentioned_at: null, document_id: null, chunk_id: null, tags: null,
        source_fact_ids: null, scores: null }], trace: null, entities: null, chunks: null, source_facts: null }
      : { text: "", based_on: null, structured_output: null, usage: null, trace: null };
    for (const native of [minimal[method], explicitNull]) {
      const transport = vi.fn<HindsightTransport>(async () => response(native));
      expect(await client(transport)[method]({ bankId: "bank", request: { query: "fixture" }, context })).toEqual(native);
      expect(JSON.parse(String(transport.mock.calls[0]![1]?.body))).toEqual({ query: "fixture" });
    }
  });

  it("keeps partial usage unknown and preserves deep, wide typed metadata", async () => {
    expect(await client(async () => response({ text: "", usage: { cached_tokens: 0 } }))
      .reflectNative({ bankId: "bank", request: { query: "fixture" }, context })).toEqual({ text: "", usage: { cached_tokens: 0 } });
    let metadata: Record<string, unknown> = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`key-${i}`, i]));
    for (let i = 0; i < 80; i++) metadata = { nested: metadata };
    const native = { results: [{ id: "native", text: "", metadata }] };
    expect(await client(async () => response(native)).recallNative({ bankId: "bank", request: { query: "fixture" }, context })).toEqual(native);
  });

  it.each([
    { label: "empty", value: "" }, { label: "long", value: "x".repeat(513) },
  ])("round-trips $label native strings across filters, IDs, evidence and map keys", async ({ value }) => {
    const fact = { id: value, text: value, type: value, entities: [value], context: value,
      occurred_start: value, occurred_end: value, mentioned_at: value, document_id: value, chunk_id: value,
      tags: [value], source_fact_ids: [value] };
    const recall = { results: [fact], source_facts: { [value]: fact },
      entities: { [value]: { entity_id: value, canonical_name: value, observations: [{ text: value, mentioned_at: value }] } },
      chunks: { [value]: { id: value, text: value, chunk_index: 0 } } };
    const reflect = { text: value, based_on: {
      memories: [{ id: value, text: value, type: value, context: value, occurred_start: value, occurred_end: value }],
      mental_models: [{ id: `used-${value}`, text: value, context: value }], directives: [{ id: value, name: value, content: value }] },
    trace: { tool_calls: [{ tool: value, input: {}, output: {}, duration_ms: 0 }], llm_calls: [{ scope: value, duration_ms: 0 }] } };
    for (const filter of [{ tags: [value] }, { tag_groups: [{ tags: [value] }] }]) {
      await expectNativeRoundTrip({ method: "recallNative", request: { query: "fixture", ...filter,
        include: { chunks: {}, source_facts: {} } } }, recall);
      await expectNativeRoundTrip({ method: "reflectNative", request: { query: "fixture", ...filter, context: value,
        include: { facts: {}, tool_calls: {} }, exclude_mental_model_ids: [value] } }, reflect);
    }
  });

  it("round-trips long native context, text and ISO fractions", async () => {
    const timestamp = `2026-09-11T00:00:00.${"1".repeat(150)}Z`;
    const text = "x".repeat(100_001);
    expect(timestamp).toHaveLength(171);
    await expectNativeRoundTrip({ method: "recallNative", request: { query: "fixture", query_timestamp: timestamp } }, {
      results: [{ id: "fact", text, context: text, occurred_start: timestamp, occurred_end: timestamp, mentioned_at: timestamp }],
    });
    await expectNativeRoundTrip({ method: "reflectNative", request: { query: "fixture", context: text, include: { facts: {} } } }, {
      text, based_on: { memories: [{ id: "fact", text, context: text, occurred_start: timestamp, occurred_end: timestamp }] },
    });
  });

  it("round-trips native response schemas and corresponding JSON without snapshot field quotas", async () => {
    const names = ["", "__proto__", "constructor", ...Array.from({ length: 254 }, (_, index) => `property-${index}`.padEnd(129, "x"))];
    const property = { type: "string" };
    const schema = { type: "object", properties: Object.fromEntries(names.map((name) => [name, property])),
      required: names, additionalProperties: false, description: "d".repeat(100_001) };
    const output = JSON.parse(JSON.stringify(Object.fromEntries(names.map((name, index) => [name, index === 0 ? "s".repeat(100_001) : "[1,true]"]))));
    expect(Object.keys(schema.properties)).toHaveLength(257);
    expect(names.some((name) => name.length === 129)).toBe(true);
    const reflected = await expectNativeRoundTrip({ method: "reflectNative", request: { query: "fixture", response_schema: schema, include: { tool_calls: {} } } }, {
      text: "", structured_output: output,
      trace: { tool_calls: [{ tool: "recall", input: output, output, duration_ms: 0 }] },
    });
    expect("structured_output" in reflected && Object.hasOwn(reflected.structured_output!, "__proto__")).toBe(true);
    expect("structured_output" in reflected && Object.hasOwn(reflected.structured_output!, "constructor")).toBe(true);
    await expectNativeRoundTrip({ method: "recallNative", request: { query: "fixture", trace: true } }, {
      results: [{ id: "fact", text: "", metadata: { output, values: Array.from({ length: 257 }, () => null) } }], trace: output,
    });
  });

  it("rejects unsafe JSON across request schemas and every opaque response field without invoking accessors", async () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    const getter = vi.fn(() => "private");
    const accessor = Object.defineProperty({}, "field", { enumerable: true, get: getter });
    const hidden = Object.defineProperty({}, "field", { value: "private", enumerable: false });
    const invalidValues = [cyclic, accessor, hidden, { value: Number.POSITIVE_INFINITY }, { value: Number.NaN },
      { value: undefined }, { value: 1n }, { value: () => "private" }, { value: Symbol("private") },
      { value: new Date(0) }, { value: new Array(2) }, { [Symbol("private")]: true }];
    const transport = vi.fn<HindsightTransport>();
    for (const value of invalidValues) {
      const request = { query: "fixture", response_schema: value } as HindsightNativeReflectRequest;
      await expect(client(transport).reflectNative({ bankId: "bank", request, context })).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
      for (const native of [{ results: [{ id: "fact", text: "", metadata: value }] }, { results: [], trace: value }, { results: [], entities: value }]) {
        expect(HindsightNativeRecallResponseSchema.safeParse(native).success).toBe(false);
      }
      for (const native of [{ text: "", structured_output: value },
        { text: "", trace: { tool_calls: [{ tool: "recall", input: value, output: {}, duration_ms: 0 }] } },
        { text: "", trace: { tool_calls: [{ tool: "recall", input: {}, output: value, duration_ms: 0 }] } }]) {
        expect(HindsightNativeReflectResponseSchema.safeParse(native).success).toBe(false);
      }
    }
    expect(transport).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    { results: null }, { results: [{ text: "private missing identity" }] },
    { results: [{ id: "native", text: "private", metadata: [] }] },
    { results: [{ id: "native", text: "private", type: 1 }] },
    { results: [{ id: "native", text: "private", scores: { semantic: 0.5 } }] },
    { results: [], entities: { entity: { entity_id: "id", canonical_name: "private", observations: [null] } } },
    { results: [], chunks: { chunk: { id: "chunk", text: "private", chunk_index: -1 } } },
    { results: [], source_facts: { fact: { text: "private missing identity" } } },
    { results: [], trace: [] },
  ])("refuses malformed native recall responses without provider details", async (native) => {
    const error = await client(async () => response(native)).recallNative({ bankId: "bank", request: { query: "fixture" }, context })
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    expect(String(error)).not.toContain("private");
  });

  it.each([
    { text: null }, { text: "private", based_on: { memories: [{ id: "native" }] } },
    { text: "private", based_on: { mental_models: [{ id: null, text: "native" }] } },
    { text: "private", based_on: { directives: [{ id: "d", name: "n", content: 1 }] } },
    { text: "private", structured_output: [] }, { text: "private", usage: { input_tokens: null } },
    { text: "private", usage: { output_tokens: -1 } },
    { text: "private", trace: { tool_calls: [{ tool: "recall", input: [], output: null, duration_ms: 1 }] } },
    { text: "private", trace: { llm_calls: [{ scope: "agent_1", duration_ms: "1" }] } },
  ])("refuses malformed native reflect responses without provider details", async (native) => {
    const error = await client(async () => response(native)).reflectNative({ bankId: "bank", request: { query: "fixture" }, context })
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    expect(String(error)).not.toContain("private");
  });

  it.each(methods)("enforces the ordinary UTF-8 response byte limit for %s", async (method) => {
    const native = method === "recallNative" ? { results: [{ id: "id", text: "雪" }] } : { text: "雪" };
    const json = JSON.stringify(native);
    const length = new TextEncoder().encode(json).byteLength;
    const atLimit = json + " ".repeat(HINDSIGHT_DEFAULT_RESPONSE_BYTES - length);
    expect(await client(async () => ({ status: 200, body: atLimit }))[method]({ bankId: "bank", request: { query: "fixture" }, context }))
      .toEqual(native);
    await expect(client(async () => ({ status: 200, body: atLimit + " " }))[method]({ bankId: "bank", request: { query: "fixture" }, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
  });

  it.each(methods)("keeps request bodies independent of the response byte limit for %s", async (method) => {
    const request = method === "recallNative"
      ? { query: "fixture", tags: Array.from({ length: 1100 }, () => "x".repeat(512)) }
      : { query: "fixture", response_schema: { type: "object", properties: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
        `field-${index}`, { type: "string", description: "x".repeat(100_000) },
      ])) } };
    const body = JSON.stringify(request);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(HINDSIGHT_DEFAULT_RESPONSE_BYTES);
    const transport = vi.fn<HindsightTransport>(async () => response(minimal[method]));

    expect(await client(transport)[method]({ bankId: "bank", request, context })).toEqual(minimal[method]);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![1]?.body).toBe(body);
  });

  it.each(methods)("preserves native tag groups beyond snapshot container limits for %s", async (method) => {
    for (const count of [257, 1100]) {
      const tags = Array.from({ length: count }, (_, index) => `tag-${index}`);
      const leaf = { tags, match: "all_strict" as const };
      const requests = [{ query: "fixture", tags, tags_match: "all_strict" as const },
        { query: "fixture", tag_groups: [leaf] }, { query: "fixture", tag_groups: [{ and: [leaf, leaf] }] },
        { query: "fixture", tag_groups: [{ or: tags.map((tag) => ({ tags: [tag] })) }] }];
      for (const request of requests) {
        const transport = vi.fn<HindsightTransport>(async () => response(minimal[method]));
        expect(await client(transport)[method]({ bankId: "bank", request, context })).toEqual(minimal[method]);
        expect(transport).toHaveBeenCalledTimes(1);
        expect(transport.mock.calls[0]![1]?.body).toBe(JSON.stringify(request));
      }
    }
  });

  it.each(methods)("refuses cyclic or malformed native tag groups before dispatch for %s", async (method) => {
    const cyclic: Record<string, unknown> = {}; cyclic.not = cyclic;
    const getter = vi.fn(() => ["private"]);
    const accessor = Object.defineProperty({}, "tags", { get: getter, enumerable: true });
    const transport = vi.fn<HindsightTransport>();
    for (const group of [cyclic, accessor, { tags: [1] }, { and: "private" }, { or: [null] },
      { not: [] }, { tags: [], match: "invalid" }, { tags: [() => "private"] }]) {
      const request = { query: "fixture", tag_groups: [group] } as HindsightNativeRecallRequest;
      const error = await client(transport)[method]({ bankId: "bank", request, context }).catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
      expect(String(error)).not.toContain("private");
    }
    expect(transport).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([
    "", "private malformed JSON", '{"results":[{"id":"i","text":"t","metadata":{"n":1e400}}]}',
  ])("refuses undecodable or non-finite native JSON", async (body) => {
    await expect(client(async () => ({ status: 200, body })).recallNative({ bankId: "bank", request: { query: "fixture" }, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
  });

  it.each(methods)("refuses unsafe Bank paths and invalid request envelopes before dispatch for %s", async (method) => {
    const transport = vi.fn<HindsightTransport>();
    for (const bankId of ["", ".", "..", "x".repeat(513), "\ud800"]) {
      await expect(client(transport)[method]({ bankId, request: { query: "fixture" }, context }))
        .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    }
    for (const request of [{ query: "" }, { query: "x".repeat(16_385) }, { query: "fixture", max_tokens: 0 },
      { query: "fixture", max_tokens: 32_001 }, { query: "fixture", budget: "invalid" },
      { query: "fixture", tags: [], tag_groups: [] }, { query: "fixture", tag_groups: [{ unknown: [] }] }]) {
      await expect(client(transport)[method]({ bankId: "bank", request: request as HindsightNativeRecallRequest, context }))
        .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses unsupported options and cyclic JSON before dispatch", async () => {
    const transport = vi.fn<HindsightTransport>();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    for (const request of [{ query: "fixture", fact_types: [] }, { query: "fixture", types: ["world"] },
      { query: "fixture", response_schema: cyclic }]) {
      await expect(client(transport).reflectNative({ bankId: "bank", request: request as HindsightNativeReflectRequest, context }))
        .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    }
    await expect(client(transport).recallNative({ bankId: "bank", request: { query: "fixture", types: ["invalid"] } as unknown as HindsightNativeRecallRequest, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("native Hindsight transport boundaries", () => {
  it("resolves the current secret for each native read", async () => {
    const resolveApiKey = vi.fn<() => string | null>().mockReturnValueOnce("key-one").mockReturnValueOnce("key-two");
    const transport = vi.fn<HindsightTransport>(async (url) => response(String(url).endsWith("/reflect") ? minimal.reflectNative : minimal.recallNative));
    const instance = client(transport, resolveApiKey);
    for (const method of methods) await instance[method]({ bankId: "bank", request: { query: "fixture" }, context });
    expect(transport.mock.calls.map((call) => new Headers(call[1]?.headers).get("authorization"))).toEqual(["Bearer key-one", "Bearer key-two"]);
    expect(resolveApiKey).toHaveBeenCalledTimes(2);
  });

  it.each(methods)("refuses missing secrets, prior cancellation, and invalid deadlines for %s", async (method) => {
    const transport = vi.fn<HindsightTransport>();
    await expect(client(transport, () => null)[method]({ bankId: "bank", request: { query: "fixture" }, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_SECRET_UNAVAILABLE" });
    const caller = new AbortController(); caller.abort("private cancellation reason");
    await expect(client(transport)[method]({ bankId: "bank", request: { query: "fixture" }, context: { ...context, signal: caller.signal } }))
      .rejects.toMatchObject({ code: "HINDSIGHT_CANCELLED" });
    for (const timeoutMs of [0, -1, 1.5, 2_147_483_648, Number.POSITIVE_INFINITY]) {
      await expect(client(transport)[method]({ bankId: "bank", request: { query: "fixture" }, context: { timeoutMs } }))
        .rejects.toMatchObject({ code: "HINDSIGHT_TIMEOUT" });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(methods)("preserves the first deadline/caller abort when %s settles late", async (method) => {
    vi.useFakeTimers();
    for (const first of ["deadline", "caller"]) {
      for (const ending of ["resolve", "reject"]) {
        const caller = new AbortController();
        const transport = vi.fn<HindsightTransport>(async () => new Promise((resolve, reject) => {
          setTimeout(() => ending === "resolve" ? resolve(response(minimal[method])) : reject(new Error("private native error")), 100);
        }));
        setTimeout(() => caller.abort("private cancellation reason"), first === "caller" ? 10 : 30);
        const settled = client(transport)[method]({ bankId: "bank", request: { query: "fixture" }, context: { timeoutMs: 20, signal: caller.signal } })
          .catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(100);
        expect(await settled).toMatchObject({ code: first === "deadline" ? "HINDSIGHT_TIMEOUT" : "HINDSIGHT_CANCELLED" });
        expect(String(await settled)).not.toContain("private");
        expect(transport).toHaveBeenCalledTimes(1);
        expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true);
      }
    }
  });

  it.each(methods)("retains sanitized HTTP/authentication classifications and never retries %s", async (method) => {
    for (const [status, code] of [[401, "HINDSIGHT_AUTHENTICATION_FAILED"], [403, "HINDSIGHT_AUTHENTICATION_FAILED"],
      [302, "HINDSIGHT_UNREACHABLE"], [408, "HINDSIGHT_TIMEOUT"], [500, "HINDSIGHT_UNREACHABLE"], [404, "HINDSIGHT_RESPONSE_INVALID"]] as const) {
      const transport = vi.fn<HindsightTransport>(async () => ({ status, body: "private query and provider details" }));
      const error = await client(transport)[method]({ bankId: "bank", request: { query: "private query" }, context }).catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain("private");
      expect(transport).toHaveBeenCalledTimes(1);
    }
    await expect(client(async () => { throw new Error("private network failure"); })[method]({ bankId: "bank", request: { query: "fixture" }, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_UNREACHABLE", message: expect.not.stringContaining("private") });
  });

  it.each(methods)("never misdiagnoses a native %s request refusal as a Bank Template problem", async (method) => {
    for (const status of [400, 422]) {
      const transport = vi.fn<HindsightTransport>(async () => ({ status, body: `private query or key: ${key}` }));
      const error = await client(transport)[method]({ bankId: "bank", request: { query: "fixture" }, context }).catch((failure: unknown) => failure);
      expect(error).toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
      expect(JSON.stringify(error)).not.toMatch(/private|Template|native-read-fixture-key/);
      expect(transport).toHaveBeenCalledTimes(1);
    }
    const templateClient = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => key,
      transport: async () => ({ status: 422, body: "private template refusal" }) });
    await expect(templateClient.importTemplate({ bankId: "bank", template: { version: "1" }, dryRun: true, context }))
      .rejects.toMatchObject({ code: "HINDSIGHT_TEMPLATE_INVALID" });
    await expect(templateClient.createOrUpdateBank("reflect", context)).rejects.toMatchObject({ code: "HINDSIGHT_TEMPLATE_INVALID" });
  });
});
