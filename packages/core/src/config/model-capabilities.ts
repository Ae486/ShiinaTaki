/**
 * INPUT:  non-secret effective MAIN identity and the fixed public models.dev catalog.
 * OUTPUT: createModelCapabilitiesReader(source) — safe catalog names, canonical identity, logos and declarations.
 * POS:    Core config — settings-demand metadata only; no endpoint probe, model call or runtime capability gate.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelCapabilitiesResult } from "@taki/shared";
import type { ConfigSource } from "./config-source.ts";

const CATALOG_URL = "https://models.dev/api.json";
const CATALOG_TIMEOUT_MS = 5_000;
const CATALOG_TTL_MS = 60 * 60 * 1_000;
const FAILURE_TTL_MS = 60 * 1_000;
const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

const OptionalNameSchema = z.string().min(1).nullish().catch(null);
const OptionalLimitSchema = z.number().int().nonnegative().nullish().catch(null);
const ModelSchema = z.object({
  id: z.string(),
  name: OptionalNameSchema,
  canonical_model_id: OptionalNameSchema,
  reasoning: z.boolean().nullish().catch(null),
  tool_call: z.boolean().optional(),
  modalities: z.object({
    input: z.array(z.string()).nullish().catch(null),
    output: z.array(z.string()).nullish().catch(null),
  }).nullish().catch(null),
  limit: z.object({ context: OptionalLimitSchema, output: OptionalLimitSchema }).nullish().catch(null),
  last_updated: z.string().optional(),
});
const CatalogSchema = z.record(z.string(), z.object({
  name: OptionalNameSchema,
  api: z.string().optional(),
  models: z.record(z.string(), ModelSchema),
}));
type Catalog = z.infer<typeof CatalogSchema>;
type CatalogRead = { catalog: Catalog; fetchedAt: string } | null;

/** OpenAI omits api in the public projection; this is its documented Chat Completions base URL. */
const OFFICIAL_ENDPOINTS: Readonly<Record<string, string>> = {
  "https://api.openai.com/v1": "openai",
};

function endpointIdentity(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/$/, "");
  } catch { return null; }
}

async function readBoundedCatalog(response: Response): Promise<Catalog> {
  if (!response.ok || !response.body) throw new Error("catalog unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let json = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CATALOG_BYTES) throw new Error("catalog too large");
      json += decoder.decode(chunk.value, { stream: true });
    }
    return CatalogSchema.parse(JSON.parse(json + decoder.decode()));
  } finally { await reader.cancel(); }
}

export function createModelCatalogCache(fetchCatalog: typeof fetch = fetch, now: () => number = Date.now) {
  let cached: CatalogRead = null;
  let expiresAt = 0;
  let pending: Promise<CatalogRead> | null = null;
  return async (): Promise<CatalogRead> => {
    if (now() < expiresAt) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetchCatalog(CATALOG_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS), redirect: "error" });
        cached = { catalog: await readBoundedCatalog(response), fetchedAt: new Date(now()).toISOString() };
      } catch { cached = null; }
      expiresAt = now() + (cached ? CATALOG_TTL_MS : FAILURE_TTL_MS);
      return cached;
    })();
    try { return await pending; }
    finally { pending = null; }
  };
}

const readSharedCatalog = createModelCatalogCache();

function configuredIdentity(source: ConfigSource, active?: () => { baseUrl: string; modelId: string } | undefined) {
  const binding = active?.();
  const base = active ? binding?.baseUrl : source.resolve("TAKI_PROVIDER_BASE_URL")?.value;
  const model = active ? binding?.modelId : source.resolve("TAKI_PROVIDER_MODEL")?.value;
  const baseURL = typeof base === "string" ? base : "";
  const modelId = typeof model === "string" && model.length > 0 ? model : null;
  return {
    baseURL,
    configured: { model: modelId, identity: createHash("sha256").update(JSON.stringify([baseURL, modelId])).digest("hex") },
  };
}

function declaredCapabilities(read: NonNullable<CatalogRead>, target: ReturnType<typeof configuredIdentity>): ModelCapabilitiesResult["catalog"] {
  const endpoint = endpointIdentity(target.baseURL);
  if (!endpoint) return { status: "unknown", reason: "endpoint" };
  const providerId = OFFICIAL_ENDPOINTS[endpoint] ?? Object.keys(read.catalog).find((id) => {
    const api = read.catalog[id]?.api;
    return api !== undefined && endpointIdentity(api) === endpoint;
  });
  if (!providerId) return { status: "unknown", reason: "endpoint" };
  const provider = read.catalog[providerId];
  const model = target.configured.model === null ? undefined : provider?.models[target.configured.model];
  if (!model || model.id !== target.configured.model) return { status: "unknown", reason: "model" };
  return {
    status: "declared", source: "models.dev", provider: providerId, model: model.id,
    fetchedAt: read.fetchedAt, lastUpdated: model.last_updated ?? null,
    toolCalling: model.tool_call ?? null,
    imageInput: model.modalities?.input == null ? null : model.modalities.input.includes("image"),
    metadata: {
      displayName: model.name ?? null,
      providerName: provider?.name ?? null,
      canonicalModelId: model.canonical_model_id ?? null,
      logoUrl: `https://models.dev/logos/${encodeURIComponent(providerId)}.svg`,
      reasoning: model.reasoning ?? null,
      inputModalities: model.modalities?.input ?? null,
      outputModalities: model.modalities?.output ?? null,
      contextLimit: model.limit?.context ?? null,
      outputLimit: model.limit?.output ?? null,
    },
  };
}

export function createModelCapabilitiesReader(source: ConfigSource, readCatalog = readSharedCatalog,
  active?: () => { baseUrl: string; modelId: string } | undefined) {
  return async (): Promise<ModelCapabilitiesResult> => {
    const target = configuredIdentity(source, active);
    const read = target.configured.model && target.baseURL ? await readCatalog() : null;
    return {
      configured: target.configured, apply: active ? "live" : "restart",
      adapter: { kind: "openai-compatible", toolCalling: true, imageInput: true, nativeWebSearch: false },
      catalog: !target.configured.model || !target.baseURL
        ? { status: "unknown", reason: "unconfigured" }
        : read ? declaredCapabilities(read, target) : { status: "unavailable" },
    };
  };
}
