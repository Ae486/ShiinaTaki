import { describe, expect, it } from "vitest";
import { HindsightLlmHealthParamsSchema, HindsightManagedDeploymentReceiptSchema, HindsightSetupSnapshotSchema } from "./hindsight-setup-schema.ts";

const snapshot = {
  revision: 0,
  phase: "unconfigured",
  lastSuccessfulPhase: null,
  configFingerprint: null,
  attemptId: null,
  compatibility: null,
  banks: [],
  modelHealth: "not-run",
  latestError: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  updatedAt: "2026-08-21T00:00:00.000Z",
} as const;

describe("Hindsight setup contracts", () => {
  it("rejects a configured snapshot without verified Banks", () => {
    expect(HindsightSetupSnapshotSchema.safeParse({ ...snapshot, phase: "configured" }).success).toBe(false);
  });

  it("keeps a configured snapshot readable with post-activation non-verified Character rows", () => {
    const bank = (scope: "global" | "character", status: "verified" | "failed" | "pending", id: string) => ({
      scope, canonicalIdentity: scope === "global" ? "global" : `character:${id}`, externalBankId: `bank-${id}`,
      templateRevision: "taki-bank-v1", templateDigest: "a".repeat(64), status, operationIds: [], lastVerifiedAt: null,
      lastError: status === "failed" ? { code: "HINDSIGHT_TEMPLATE_INVALID", retryable: false, nextAction: "Repair." } : null });
    const support = { state: "supported", reason: "all_contracts_available" } as const;
    const contract = { version: "1", support };
    const compatibility = { baseApiVersion: "0.9.0", compatibilityVersion: "1", compatibilityBuild: "build", providerLineage: null,
      databaseDialect: "postgresql", storageMode: "sql_rows", support, journalVersion: 1, snapshotVersion: 1,
      contracts: { changeJournal: contract, conditionalMutation: contract, logicalSnapshot: contract,
        additiveObservationInstructions: contract, controlledLayerProjection: contract } } as const;
    const configured = (banks: ReturnType<typeof bank>[]) => HindsightSetupSnapshotSchema.safeParse({ ...snapshot, phase: "configured", banks, compatibility });
    expect(configured([bank("global", "verified", "g"), bank("character", "verified", "taki"),
      bank("character", "failed", "mika"), bank("character", "pending", "sayo")]).success).toBe(true);
    expect(configured([bank("global", "failed", "g"), bank("character", "verified", "taki")]).success).toBe(false);
    expect(configured([bank("global", "verified", "g"), bank("character", "failed", "mika")]).success).toBe(false);
  });

  it("accepts only declarative persistent managed receipts", () => {
    const receipt = {
      contractVersion: 1, helperId: "desktop-helper", deploymentId: "deployment-1", endpoint: "http://localhost:8888",
      status: "ready", storage: { kind: "embedded-pg0", persistent: true }, immutableHindsightIdentity: "instance-1",
      observedAt: "2026-08-21T00:00:00.000Z",
    } as const;
    expect(HindsightManagedDeploymentReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(HindsightManagedDeploymentReceiptSchema.safeParse({ ...receipt, command: "docker run" }).success).toBe(false);
    expect(HindsightManagedDeploymentReceiptSchema.safeParse({ ...receipt, storage: { ...receipt.storage, persistent: false } }).success).toBe(false);
  });

  it("requires explicit provider-call acknowledgement and current revision", () => {
    expect(HindsightLlmHealthParamsSchema.safeParse({ expectedRevision: 1, acknowledgeProviderCalls: true }).success).toBe(true);
    expect(HindsightLlmHealthParamsSchema.safeParse({ acknowledgeProviderCalls: true }).success).toBe(false);
  });
});
