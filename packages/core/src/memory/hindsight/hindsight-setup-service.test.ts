import { afterEach, describe, expect, it, vi } from "vitest";
import type { HindsightCompatibilityProjection, HindsightConnectionProjection } from "@taki/shared";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createConfigSource } from "../../config/config-source.ts";
import { resolveHindsightConfig } from "../../config/hindsight-config.ts";
import type { HindsightClient } from "./hindsight-client.ts";
import { hindsightConnectionFingerprint } from "./hindsight-compatibility-service.ts";
import { createHindsightSetupService } from "./hindsight-setup-service.ts";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { loadTakiBankTemplate } from "./taki-bank-template-v1.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

const support = { state: "supported" as const, reason: "all_contracts_available" as const };
const versioned = { version: "1.0.0", support };
const compatibility: HindsightCompatibilityProjection = {
  baseApiVersion: "0.9.0", compatibilityVersion: "1.0.0", compatibilityBuild: "taki-memory-hindsight-0.9.0-batch0-v2",
  providerLineage: "11111111-1111-4111-8111-111111111111", databaseDialect: "postgresql", storageMode: "sql_rows", support,
  journalVersion: 1, snapshotVersion: 1,
  contracts: { changeJournal: versioned, conditionalMutation: versioned, logicalSnapshot: versioned, additiveObservationInstructions: versioned, controlledLayerProjection: versioned },
};

function build(options: { failDryRunBank?: string; failApplyBank?: string; operationPending?: boolean; failValidate?: boolean } = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1").run();
  const configRepo = createConfigRepo(db);
  for (const [key, value] of Object.entries({ TAKI_HINDSIGHT_ENABLED: true, TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:8888" })) configRepo.upsert(key, value);
  const connection = resolveHindsightConfig(createConfigSource({ env: {}, repo: configRepo })).projection as HindsightConnectionProjection;
  const bindings = hindsightBankBindings("taki");
  const templates = new Map(bindings.map((binding) => [binding.externalBankId, loadTakiBankTemplate("taki-bank-v1", binding.scope).manifest]));
  const calls: string[] = [];
  let statusCalls = 0;
  const exportTemplate = vi.fn<HindsightClient["exportTemplate"]>(async (bankId) => {
    calls.push(`export:${bankId}`);
    return templates.get(bankId) ?? { version: "1" as const };
  });
  const operationStatus = vi.fn<HindsightClient["operationStatus"]>(async (_bankId, operationId) => {
    statusCalls += 1;
    return { operationId, status: options.operationPending && statusCalls % 2 === 1 ? "pending" as const : "completed" as const };
  });
  const bankLlmHealth = vi.fn<HindsightClient["bankLlmHealth"]>(async (bankId) => ({
    bankId, operations: [{ operation: "retain" as const, ok: true, status: "connected" as const, latencyMs: 1 }],
  }));
  const client: HindsightClient = {
    health: async () => ({ status: "healthy", database: "connected" }),
    version: async () => ({ apiVersion: "0.9.0" }),
    compatibility: async () => { throw new Error("unused"); },
    bankStats: async () => { throw new Error("unused"); },
    createOrUpdateBank: vi.fn(async (bankId) => { calls.push(`put:${bankId}`); return { bankId, name: null }; }),
    importTemplate: vi.fn(async ({ bankId, dryRun }) => {
      calls.push(`${dryRun ? "dry" : "apply"}:${bankId}`);
      if (dryRun && options.failDryRunBank === bankId) throw new Error("dry run failed");
      if (!dryRun && options.failApplyBank === bankId) throw new Error("apply failed");
      return { bank_id: bankId, config_applied: true, dry_run: dryRun, operation_ids: dryRun ? [] : [`op-${bankId}`] };
    }),
    exportTemplate,
    operationStatus,
    bankLlmHealth,
  };
  const service = createHindsightSetupService({
    config: () => ({ state: "ready", projection: connection }), secret: { resolve: () => "sentinel", marker: () => "marker" },
    client: () => client, compatibility: { validate: async () => {
      if (options.failValidate) throw new Error("private outage detail");
      return { fingerprint: hindsightConnectionFingerprint(connection, "marker"), compatibility };
    } },
    connectionRepo: createHindsightConnectionRepo(db), bankRepo: createHindsightBankSetupRepo(db),
    authorityMode: () => String(db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get()?.mode),
    now: () => "2026-08-21T00:00:00.000Z", attemptId: () => "attempt-1", wait: async () => undefined,
  });
  return { db, service, client, calls, bindings, options, connection };
}

async function validateAndSetup(harness: ReturnType<typeof build>) {
  const validated = await harness.service.validate({ expectedRevision: 0 });
  return harness.service.setup({ expectedRevision: validated.revision, characterId: "taki" });
}

describe("Hindsight setup service", () => {
  it("does not accept raw managed receipt JSON or require a helper for an existing instance", async () => {
    const h = build();
    const validated = await h.service.validate({ expectedRevision: 0 });
    const managedReceipt = { contractVersion: 1 as const, helperId: "operator-json", deploymentId: "not-producer-evidence",
      endpoint: "http://127.0.0.1:8888", status: "ready" as const,
      storage: { kind: "embedded-pg0" as const, persistent: true as const },
      immutableHindsightIdentity: "fake-native", observedAt: "2026-08-21T00:00:00.000Z" };
    await expect(h.service.setup({ expectedRevision: validated.revision, characterId: "taki", managedReceipt }))
      .rejects.toMatchObject({ code: "HINDSIGHT_ENDPOINT_REJECTED" });
    expect(h.calls).toEqual([]);
    expect((await h.service.setup({ expectedRevision: validated.revision, characterId: "taki" })).phase).toBe("configured");
  });

  it("keeps historical managed status readable while refusing a fresh setup without C2 producer evidence", async () => {
    const h = build();
    h.connection.deploymentMode = "managed-helper";
    const validated = await h.service.validate({ expectedRevision: 0 });
    expect(h.service.status()).toEqual(validated);
    await expect(h.service.setup({ expectedRevision: validated.revision, characterId: "taki" }))
      .rejects.toMatchObject({ code: "HINDSIGHT_ENDPOINT_REJECTED" });
    expect(h.service.status()).toEqual(validated);
    expect(h.calls).toEqual([]);
  });

  it("finishes every dry-run before mutation, waits operations, verifies templates, and preserves canonical-local", async () => {
    const h = build({ operationPending: true });
    const result = await validateAndSetup(h);
    const lastDry = Math.max(...h.calls.map((call, index) => call.startsWith("dry:") ? index : -1));
    const firstPut = h.calls.findIndex((call) => call.startsWith("put:"));
    expect(lastDry).toBeLessThan(firstPut);
    expect(result).toMatchObject({ phase: "configured", modelHealth: "not-run" });
    expect(result.banks).toHaveLength(2);
    expect(result.banks.every((bank) => bank.status === "verified")).toBe(true);
    expect(h.db.prepare("SELECT mode FROM memory_authority_selection WHERE singleton=1").get()?.mode).toBe("canonical-local");
    expect(h.client.bankLlmHealth).not.toHaveBeenCalled();
  });

  it("a dry-run failure performs zero mutation and persists a sanitized retryable failure", async () => {
    const failedId = hindsightBankBindings("taki")[1].externalBankId;
    const h = build({ failDryRunBank: failedId });
    const result = await validateAndSetup(h);
    expect(h.calls.some((call) => call.startsWith("put:") || call.startsWith("apply:"))).toBe(false);
    expect(result).toMatchObject({ phase: "failed", latestError: { code: "HINDSIGHT_RESPONSE_INVALID" } });
  });

  it("preserves a completed Bank and resumes only the failed Bank", async () => {
    const failedId = hindsightBankBindings("taki")[1].externalBankId;
    const h = build({ failApplyBank: failedId });
    const first = await validateAndSetup(h);
    expect(first.phase).toBe("failed");
    expect(first.banks.find((bank) => bank.scope === "global")?.status).toBe("verified");
    expect(first.banks.find((bank) => bank.scope === "character")?.status).toBe("failed");
    const globalPuts = h.calls.filter((call) => call === `put:${h.bindings[0].externalBankId}`).length;
    h.options.failApplyBank = undefined;
    const retried = await h.service.setup({ expectedRevision: first.revision, characterId: "taki" });
    expect(retried.phase).toBe("configured");
    expect(h.calls.filter((call) => call === `put:${h.bindings[0].externalBankId}`)).toHaveLength(globalPuts);
  });

  it("runs LLM health only through the explicit revision-checked action", async () => {
    const h = build();
    const setup = await validateAndSetup(h);
    const authorityBefore = h.db.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get();
    expect(h.client.bankLlmHealth).not.toHaveBeenCalled();
    expect(h.service.status().phase).toBe("configured");
    const result = await h.service.llmHealth({ expectedRevision: setup.revision, acknowledgeProviderCalls: true });
    expect(result.status).toBe("healthy");
    expect(h.client.bankLlmHealth).toHaveBeenCalledTimes(2);
    expect(h.service.status().modelHealth).toBe("healthy");
    expect(h.db.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get()).toEqual(authorityBefore);
  });

  it("fails closed when Memory Authority is not canonical-local", async () => {
    const h = build();
    h.db.prepare("UPDATE memory_authority_selection SET mode='legacy-markdown',active_epoch_id=NULL,verified_snapshot_id=NULL,activation_transaction_id=NULL WHERE singleton=1").run();
    await expect(h.service.validate({ expectedRevision: 0 })).rejects.toMatchObject({ code: "HINDSIGHT_STATE_CONFLICT" });
  });

  it("a failed validate withdraws compatibility evidence but keeps the fingerprint, so setup and llmHealth refuse until a fresh success", async () => {
    const h = build();
    const configured = await validateAndSetup(h);
    expect(configured.phase).toBe("configured");
    h.options.failValidate = true;
    const failed = await h.service.validate({ expectedRevision: configured.revision });
    expect(failed).toMatchObject({ phase: "failed", compatibility: null, configFingerprint: configured.configFingerprint, lastSuccessfulPhase: "configured" });
    expect(JSON.stringify(failed)).not.toContain("private outage detail");
    await expect(h.service.setup({ expectedRevision: failed.revision, characterId: "taki" })).rejects.toMatchObject({ code: "HINDSIGHT_EXTENSION_UNSUPPORTED" });
    await expect(h.service.llmHealth({ expectedRevision: failed.revision, acknowledgeProviderCalls: true })).rejects.toMatchObject({ code: "HINDSIGHT_LLM_HEALTH_UNAVAILABLE" });
    h.options.failValidate = false;
    const revalidated = await h.service.validate({ expectedRevision: failed.revision });
    expect(revalidated).toMatchObject({ phase: "compatible", compatibility: configured.compatibility });
    expect(revalidated.banks.every((bank) => bank.status === "verified")).toBe(true);
  });
});
