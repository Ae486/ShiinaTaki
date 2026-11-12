import { describe, expect, it } from "vitest";
import { ModelCapabilitiesResultSchema } from "./model-capability-schema.ts";

const result = {
  configured: { model: "deepseek-v4-flash", identity: "a".repeat(64) }, apply: "restart",
  adapter: { kind: "openai-compatible", toolCalling: true, imageInput: true, nativeWebSearch: false },
  catalog: { status: "declared", source: "models.dev", provider: "deepseek", model: "deepseek-v4-flash",
    fetchedAt: "2026-11-04T00:00:00Z", lastUpdated: null, toolCalling: true, imageInput: true },
};
const metadata = {
  displayName: "DeepSeek V4 Flash", providerName: "DeepSeek", canonicalModelId: "deepseek/deepseek-v4.1-flash-1017",
  logoUrl: "https://models.dev/logos/deepseek.svg", reasoning: true,
  inputModalities: ["text", "image"], outputModalities: ["text"], contextLimit: 1_000_000, outputLimit: 384_000,
};

describe("optional catalog model metadata protocol", () => {
  it("preserves old declared clients and fixtures without metadata", () => {
    expect(ModelCapabilitiesResultSchema.parse(result)).toEqual(result);
  });

  it("round-trips display/canonical facts independently of the configured ID", () => {
    const enriched = { ...result, catalog: { ...result.catalog, metadata } };
    expect(ModelCapabilitiesResultSchema.parse(JSON.parse(JSON.stringify(enriched)))).toEqual(enriched);
  });

  it("accepts null facts without inferring false, empty lists or model identity", () => {
    const absent = Object.fromEntries(Object.keys(metadata).map((key) => [key, null]));
    expect(ModelCapabilitiesResultSchema.parse({ ...result, catalog: { ...result.catalog, metadata: absent } }).catalog)
      .toMatchObject({ metadata: absent });
  });

  it.each(["https://other.example/logos/deepseek.svg", "http://models.dev/logos/deepseek.svg", "javascript:alert(1)",
    "https://models.dev/logos/deepseek.svg?token=private"]) ("rejects external or credential-bearing logo URLs: %s", (logoUrl) => {
    expect(ModelCapabilitiesResultSchema.safeParse({ ...result, catalog: { ...result.catalog, metadata: { ...metadata, logoUrl } } }).success)
      .toBe(false);
  });

  it("keeps unknown/custom endpoint and unavailable results free of declarations", () => {
    for (const catalog of [{ status: "unknown", reason: "endpoint" }, { status: "unavailable" }]) {
      expect(ModelCapabilitiesResultSchema.parse({ ...result, catalog })).toEqual({ ...result, catalog });
    }
  });
});
