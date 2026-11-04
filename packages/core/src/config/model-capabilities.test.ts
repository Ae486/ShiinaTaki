import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelCapabilitiesResultSchema, type ConfigValue } from "@taki/shared";
import { createConfigSource } from "./config-source.ts";
import { createModelCapabilitiesReader, createModelCatalogCache } from "./model-capabilities.ts";

afterEach(() => vi.restoreAllMocks());

const catalog = {
  openai: { name: "OpenAI", models: {
    "gpt-5.4-pro": {
      id: "gpt-5.4-pro", name: "GPT-5.4 Pro", canonical_model_id: "openai/gpt-5.4-pro", reasoning: true, tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 1_050_000, output: 128_000 }, last_updated: "2026-03-05",
    },
    "text-only": { id: "text-only", tool_call: false, modalities: { input: ["text"] } },
    incomplete: { id: "incomplete" },
  } },
  openrouter: { api: "https://openrouter.ai/api/v1", models: {
    "org/model": { id: "org/model", tool_call: true, modalities: { input: ["image"] } },
  } },
  deepseek: { name: "DeepSeek", api: "https://api.deepseek.com", models: {
    "deepseek-v4-flash": { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash",
      canonical_model_id: "deepseek/deepseek-v4.1-flash-1017", reasoning: true, tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 1_000_000, output: 384_000 } },
    "deepseek-flash": { id: "deepseek-flash", name: "DeepSeek V4.1 Flash 1017",
      canonical_model_id: "deepseek/deepseek-v4.1-flash-1017", reasoning: true, tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 1_000_000, output: 384_000 } },
  } },
};
const response = (value: unknown = catalog) => new Response(JSON.stringify(value), { status: 200 });

function fixture(options: { baseURL?: string; model?: string; env?: Record<string, string> } = {}) {
  const values = new Map<string, ConfigValue>([
    ["TAKI_PROVIDER_BASE_URL", options.baseURL ?? "https://api.openai.com/v1"],
    ["TAKI_PROVIDER_MODEL", options.model ?? "gpt-5.4-pro"],
  ]);
  const repo = {
    get: (key: string) => values.get(key) ?? null,
    all: () => values,
    upsert: (key: string, value: ConfigValue) => { values.set(key, value); },
    delete: (key: string) => { values.delete(key); },
  };
  const source = createConfigSource({ env: options.env ?? {}, repo });
  const fetchCatalog = vi.fn<typeof fetch>(async () => response());
  const cache = createModelCatalogCache(fetchCatalog);
  return { values, source, fetchCatalog, read: createModelCapabilitiesReader(source, cache) };
}

describe("configured MAIN catalog declarations", () => {
  it("projects the current public provider/model shape without changing configured windows", async () => {
    const f = fixture();
    const before = f.source.resolve("TAKI_PROVIDER_CONTEXT_TOKENS");
    const result = ModelCapabilitiesResultSchema.parse(await f.read());
    expect(result.catalog).toMatchObject({
      status: "declared", provider: "openai", model: "gpt-5.4-pro",
      toolCalling: true, imageInput: true, lastUpdated: "2026-03-05", source: "models.dev",
      metadata: { displayName: "GPT-5.4 Pro", providerName: "OpenAI", canonicalModelId: "openai/gpt-5.4-pro",
        logoUrl: "https://models.dev/logos/openai.svg", reasoning: true,
        inputModalities: ["text", "image"], outputModalities: ["text"], contextLimit: 1_050_000, outputLimit: 128_000 },
    });
    expect(result).toMatchObject({ apply: "restart", adapter: { nativeWebSearch: false } });
    expect(f.source.resolve("TAKI_PROVIDER_CONTEXT_TOKENS")).toEqual(before);
  });

  it("matches an exact catalog API and full model ID", async () => {
    expect((await fixture({ baseURL: "https://openrouter.ai/api/v1/", model: "org/model" }).read()).catalog)
      .toMatchObject({ status: "declared", provider: "openrouter", model: "org/model" });
  });

  it.each([
    ["https://private-relay.example/v1", "gpt-5.4-pro", "endpoint"],
    ["https://api.openai.com/v1/relay", "gpt-5.4-pro", "endpoint"],
    ["https://api.openai.com/v1?token=private", "gpt-5.4-pro", "endpoint"],
    ["https://user:private@api.openai.com/v1", "gpt-5.4-pro", "endpoint"],
    ["https://api.openai.com/v1", "openai/gpt-5.4-pro", "model"],
    ["https://api.openai.com/v1", "model-alias", "model"],
  ])("keeps unknown endpoint/alias truthful: %s %s", async (baseURL, model, reason) => {
    expect((await fixture({ baseURL, model }).read()).catalog).toEqual({ status: "unknown", reason });
  });

  it("preserves explicit false and missing capability fields independently", async () => {
    expect((await fixture({ model: "text-only" }).read()).catalog)
      .toMatchObject({ status: "declared", toolCalling: false, imageInput: false });
    expect((await fixture({ model: "incomplete" }).read()).catalog)
      .toMatchObject({ status: "declared", toolCalling: null, imageInput: null, metadata: {
        displayName: null, providerName: "OpenAI", canonicalModelId: null, logoUrl: "https://models.dev/logos/openai.svg",
        reasoning: null, inputModalities: null, outputModalities: null, contextLimit: null, outputLimit: null,
      } });
  });

  it("uses explicit upstream canonical relationships while preserving both configured alias IDs", async () => {
    const results = await Promise.all(["deepseek-v4-flash", "deepseek-flash"].map((model) =>
      fixture({ baseURL: "https://api.deepseek.com", model }).read()));
    expect(results.map((result) => result.configured.model)).toEqual(["deepseek-v4-flash", "deepseek-flash"]);
    expect(results[0]!.configured.identity).not.toBe(results[1]!.configured.identity);
    for (const result of results) {
      expect(result.catalog).toMatchObject({ status: "declared", provider: "deepseek", model: result.configured.model,
        metadata: { providerName: "DeepSeek", canonicalModelId: "deepseek/deepseek-v4.1-flash-1017",
          logoUrl: "https://models.dev/logos/deepseek.svg" } });
    }
    expect(results[0]!.catalog).toMatchObject({ metadata: { displayName: "DeepSeek V4 Flash" } });
    expect(results[1]!.catalog).toMatchObject({ metadata: { displayName: "DeepSeek V4.1 Flash 1017" } });
  });

  it("keeps partial and malformed new metadata fields isolated from usable models", async () => {
    const f = fixture();
    f.fetchCatalog.mockImplementation(async () => response({ ...catalog, future: { name: { localized: "Future" },
      api: "https://future.example/v1", models: {
        partial: { id: "partial", name: null, canonical_model_id: [], reasoning: "sometimes", tool_call: false,
          modalities: { input: null, output: ["text"] }, limit: { context: -1, output: 0 } },
      } } }));
    expect((await f.read()).catalog).toMatchObject({ status: "declared", metadata: { displayName: "GPT-5.4 Pro" } });
    f.values.set("TAKI_PROVIDER_BASE_URL", "https://future.example/v1");
    f.values.set("TAKI_PROVIDER_MODEL", "partial");
    expect(ModelCapabilitiesResultSchema.parse(await f.read()).catalog).toMatchObject({
      status: "declared", toolCalling: false, imageInput: null, metadata: { displayName: null, providerName: null,
        canonicalModelId: null, reasoning: null, inputModalities: null, outputModalities: ["text"], contextLimit: null, outputLimit: 0 },
    });
    expect(f.fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("reads effective env precedence and sends no secrets or configured endpoint to the public catalog", async () => {
    const f = fixture({ env: {
      TAKI_PROVIDER_MODEL: "text-only", TAKI_PROVIDER_API_KEY: "sk-private-key",
      TAKI_PROVIDER_BASE_URL: "https://api.openai.com/v1",
    } });
    const resolve = vi.spyOn(f.source, "resolve");
    const env = vi.spyOn(f.source, "env");
    const result = await f.read();
    expect(result.configured.model).toBe("text-only");
    expect(resolve.mock.calls.map(([key]) => key)).toEqual(["TAKI_PROVIDER_BASE_URL", "TAKI_PROVIDER_MODEL"]);
    expect(env).not.toHaveBeenCalled();
    const [url, options] = f.fetchCatalog.mock.calls[0]!;
    expect(url).toBe("https://models.dev/api.json");
    expect(options).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
    expect(options?.headers).toBeUndefined();
    expect(JSON.stringify([f.fetchCatalog.mock.calls, result])).not.toMatch(/sk-private-key|api.openai.com/);
  });

  it("returns one captured identity when configuration changes during lookup, then the new identity", async () => {
    const f = fixture();
    let finish!: (value: Response) => void;
    f.fetchCatalog.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const before = f.read();
    f.values.set("TAKI_PROVIDER_MODEL", "text-only");
    f.values.set("TAKI_PROVIDER_BASE_URL", "https://private-relay.example/v1");
    finish(response());
    const previous = await before;
    const next = await f.read();
    expect(previous.configured.model).toBe("gpt-5.4-pro");
    expect(next.configured.model).toBe("text-only");
    expect(next.configured.identity).not.toBe(previous.configured.identity);
    expect(next.catalog).toEqual({ status: "unknown", reason: "endpoint" });
    expect(f.fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("skips catalog traffic when the model is not configured", async () => {
    const f = fixture({ model: "" });
    expect((await f.read()).catalog).toEqual({ status: "unknown", reason: "unconfigured" });
    expect(f.fetchCatalog).not.toHaveBeenCalled();
  });
});

describe("bounded catalog demand cache", () => {
  it("shares pending reads and refreshes only on demand after TTL", async () => {
    let now = 100;
    let finish!: (value: Response) => void;
    const fetchCatalog = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish = resolve; }));
    const read = createModelCatalogCache(fetchCatalog, () => now);
    const first = read();
    const second = read();
    finish(response());
    expect(await first).toEqual(await second);
    await read();
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    now += 60 * 60 * 1_000;
    const expired = read();
    finish(response());
    await expired;
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "schema", "http", "oversize"])("returns unavailable for %s without a retry queue", async (failure) => {
    let now = 100;
    const fetchCatalog = vi.fn<typeof fetch>(async () => {
      if (failure === "network") throw new Error("private diagnostic");
      if (failure === "schema") return response({ openai: { models: { invalid: { tool_call: null } } } });
      if (failure === "http") return new Response("not found", { status: 503 });
      return new Response(new Uint8Array(16 * 1024 * 1024 + 1));
    });
    const f = fixture();
    const cache = createModelCatalogCache(fetchCatalog, () => now);
    const read = createModelCapabilitiesReader(f.source, cache);
    expect((await read()).catalog).toEqual({ status: "unavailable" });
    expect((await read()).catalog).toEqual({ status: "unavailable" });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    now += 60_000;
    await read();
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it("applies the timeout signal to the only request", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchCatalog = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }));
    const read = createModelCatalogCache(fetchCatalog);
    const pending = read();
    controller.abort();
    expect(await pending).toBeNull();
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });
});
