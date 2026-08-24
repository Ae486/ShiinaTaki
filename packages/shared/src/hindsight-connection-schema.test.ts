import { describe, expect, it } from "vitest";
import {
  HINDSIGHT_API_VERSION,
  HINDSIGHT_COMPATIBILITY_BUILD,
  HINDSIGHT_COMPATIBILITY_VERSION,
  HindsightConnectionProjectionSchema,
  HindsightSetupErrorSchema,
} from "./hindsight-connection-schema.ts";

const base = {
  enabled: true,
  deploymentMode: "existing-instance",
  endpoint: "http://127.0.0.1:8888",
  apiKeySecretRef: "memory.hindsight.connection.api-key",
  requestTimeoutMs: 5_000,
  setupTimeoutMs: 60_000,
  desiredTemplateRevision: "taki-bank-v1",
  model: {
    defaultProvider: null, defaultModel: null, retainModel: null, reflectModel: null, consolidationModel: null,
    embeddingProvider: null, embeddingModel: null, rerankerProvider: null, rerankerModel: null,
  },
} as const;

describe("Hindsight connection contracts", () => {
  it("pins the admitted compatibility identity", () => {
    expect([HINDSIGHT_API_VERSION, HINDSIGHT_COMPATIBILITY_VERSION, HINDSIGHT_COMPATIBILITY_BUILD]).toEqual([
      "0.9.0", "1.0.0", "taki-memory-hindsight-0.9.0-batch0-v2",
    ]);
  });

  it("accepts loopback but rejects userinfo, query, fragment, and unsupported schemes", () => {
    expect(HindsightConnectionProjectionSchema.parse(base).endpoint).toBe(base.endpoint);
    for (const endpoint of ["ftp://host/x", "http://u:p@host", "http://host/?x=1", "http://host/#x"]) {
      expect(HindsightConnectionProjectionSchema.safeParse({ ...base, endpoint }).success).toBe(false);
    }
  });

  it("keeps diagnostics bounded and structurally secret-free", () => {
    expect(HindsightSetupErrorSchema.safeParse({ code: "HINDSIGHT_TIMEOUT", retryable: true, nextAction: "Retry setup." }).success).toBe(true);
    expect(HindsightSetupErrorSchema.safeParse({ code: "HINDSIGHT_TIMEOUT", retryable: true, nextAction: "Retry setup.", apiKey: "secret" }).success).toBe(false);
  });
});
