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
