import { describe, expect, it, vi } from "vitest";
import { HINDSIGHT_CURRENT_STATE_BUILD, HINDSIGHT_NATIVE_RESULT_BUILD, type HindsightConnectionProjection } from "@taki/shared";
import type { HindsightClient } from "./hindsight-client.ts";
import { createHindsightCompatibilityService } from "./hindsight-compatibility-service.ts";
import { HindsightCompatibilityWireSchema } from "./hindsight-contracts.ts";

const connection: HindsightConnectionProjection = {
  enabled: true, deploymentMode: "existing-instance", endpoint: "http://localhost:8888",
  apiKeySecretRef: "memory.hindsight.connection.api-key", requestTimeoutMs: 1000, setupTimeoutMs: 5000,
  desiredTemplateRevision: "taki-bank-v1",
  model: { defaultProvider: null, defaultModel: null, retainModel: null, reflectModel: null, consolidationModel: null, embeddingProvider: null, embeddingModel: null, rerankerProvider: null, rerankerModel: null },
};
const support = { state: "supported" as const, reason: "all_contracts_available" as const };
const contract = { version: "1.0.0", support };
const manifest = {
  base_api_version: "0.9.0", compatibility_version: "1.0.0",
  source_identity: { upstream_commit: "abc", compatibility_build: "taki-memory-hindsight-0.9.0-batch0-v2" },
  provider: { lineage: "11111111-1111-4111-8111-111111111111", database_dialect: "postgresql" as const, storage_mode: "sql_rows" as const },
  support, journal: { schema_version: 1, retention_mode: "operator_managed_cursor_floor" as const, cursor_reset_supported: true },
  snapshot: { schema_version: 1, default_page_size: 1, max_page_size: 2, default_ttl_seconds: 1, max_ttl_seconds: 2 },
  contracts: { change_journal: contract, conditional_mutation: contract, logical_snapshot: contract, additive_observation_instructions: contract, controlled_layer_projection: contract },
};

function fake(overrides: Partial<HindsightClient> = {}): HindsightClient {
  return {
    health: vi.fn(async () => ({ status: "healthy" as const, database: "connected" as const })),
    version: vi.fn(async () => ({ apiVersion: "0.9.0" })),
    compatibility: vi.fn(async () => manifest),
    createOrUpdateBank: vi.fn(), importTemplate: vi.fn(), exportTemplate: vi.fn(), bankLlmHealth: vi.fn(), operationStatus: vi.fn(),
    ...overrides,
  };
}

describe("Hindsight compatibility service", () => {
  it("checks health, version, then authenticated compatibility in order", async () => {
    const order: string[] = [];
    const client = fake({
      health: async () => { order.push("health"); return { status: "healthy", database: "connected" }; },
      version: async () => { order.push("version"); return { apiVersion: "0.9.0" }; },
      compatibility: async () => { order.push("compatibility"); return manifest; },
    });
    const result = await createHindsightCompatibilityService().validate({ connection, secretMarker: "marker", client });
    expect(order).toEqual(["health", "version", "compatibility"]);
    expect(result.compatibility.providerLineage).toBe(manifest.provider.lineage);
  });

  it("rejects wrong version and incompatible database before setup", async () => {
    await expect(createHindsightCompatibilityService().validate({ connection, secretMarker: "m", client: fake({ version: async () => ({ apiVersion: "1.0.0" }) }) })).rejects.toMatchObject({ code: "HINDSIGHT_VERSION_UNSUPPORTED" });
    await expect(createHindsightCompatibilityService().validate({ connection, secretMarker: "m", client: fake({ compatibility: async () => ({ ...manifest, provider: { ...manifest.provider, database_dialect: "oracle" } }) }) })).rejects.toMatchObject({ code: "HINDSIGHT_DATABASE_UNSUPPORTED" });
  });

  it("changes fingerprint on safe secret rotation marker", async () => {
    const service = createHindsightCompatibilityService();
    const first = await service.validate({ connection, secretMarker: "a", client: fake() });
    const second = await service.validate({ connection, secretMarker: "b", client: fake() });
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("negotiates cutover independently without changing an existing G1 settings identity", async () => {
    const service = createHindsightCompatibilityService();
    const native = { ...manifest, source_identity: { ...manifest.source_identity, compatibility_build: HINDSIGHT_NATIVE_RESULT_BUILD },
      contracts: { ...manifest.contracts, native_results: contract } };
    const before = await service.validate({ connection, secretMarker: "same", client: fake({ compatibility: async () => native }) });
    const incomplete = { state: "unsupported" as const, reason: "cutover_verification_schema_unavailable" as const };
    const wire = HindsightCompatibilityWireSchema.parse({ ...native,
      source_identity: { ...native.source_identity, compatibility_build: HINDSIGHT_CURRENT_STATE_BUILD },
      contracts: { ...native.contracts, current_state_transfer: contract,
        cutover_verification: { version: "1.0.0", support: incomplete } } });
    const after = await service.validate({ connection, secretMarker: "same", client: fake({ compatibility: async () => wire }) });
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.compatibility.contracts.nativeResults).toEqual(contract);
    expect(after.compatibility.contracts.currentStateTransfer).toEqual(contract);
    expect(after.compatibility.contracts.cutoverVerification?.support).toEqual(incomplete);
  });

  it("does not infer cutover support from an admitted build or accept an unknown future build", async () => {
    const service = createHindsightCompatibilityService();
    const result = await service.validate({ connection, secretMarker: "m", client: fake({ compatibility: async () => ({ ...manifest,
      source_identity: { ...manifest.source_identity, compatibility_build: HINDSIGHT_CURRENT_STATE_BUILD } }) }) });
    expect(result.compatibility.contracts.currentStateTransfer).toBeUndefined();
    expect(result.compatibility.contracts.cutoverVerification).toBeUndefined();
    await expect(service.validate({ connection, secretMarker: "m", client: fake({ compatibility: async () => ({ ...manifest,
      source_identity: { ...manifest.source_identity, compatibility_build: `${HINDSIGHT_CURRENT_STATE_BUILD}-unknown` } }) }) }))
      .rejects.toMatchObject({ code: "HINDSIGHT_EXTENSION_UNSUPPORTED" });
  });
});
