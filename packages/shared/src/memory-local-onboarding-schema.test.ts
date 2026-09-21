import { describe, expect, it } from "vitest";
import {
  MEMORY_ONBOARDING_METHODS, MemoryLocalProgressSchema, MemoryOnboardingChangedSchema,
  MemoryOnboardingExcludeParamsSchema, MemoryOnboardingExceptionsParamsSchema,
  MemoryOnboardingPreviewParamsSchema, MemoryOnboardingStatusSchema, MemoryOperationRequestSchema,
  MemoryOperationSchema,
} from "./index.ts";

const at = "2026-09-20T00:00:00.000Z";
const progress = { phase: "snapshot", sourceCount: null, resolvedCount: null, blockingCount: null } as const;
const operation = {
  operationId: "11111111-1111-4111-8111-111111111111", kind: "local.onboard.prepare", state: "running",
  reason: null, authorityEpochId: null, request: { kind: "local.onboard.prepare", source: { mode: "new", previewId: "preview" } },
  producer: { kind: "local", runId: "run", previewId: "preview", snapshotId: null, activationTransactionId: null, progress },
  result: null, errorCode: null, createdAt: at, updatedAt: at, terminalAt: null,
} as const;

describe("Local onboarding public contracts", () => {
  it("reserves a durable producer before snapshot progress or terminal result exists", () => {
    expect(MemoryOperationSchema.parse(operation)).toEqual(operation);
    expect(MemoryLocalProgressSchema.parse(progress).sourceCount).toBeNull();
    expect(MemoryOperationSchema.safeParse({ ...operation, result: { kind: "local", runId: "run", outcome: "ready", epochId: "epoch", runtimeAvailable: false } }).success).toBe(false);
  });

  it("keeps new/resume/retry commands strict and rejects caller authority", () => {
    for (const source of [{ mode: "new", previewId: "p", replaceRunId: "r" }, { mode: "resume", runId: "r" }, { mode: "retry", operationId: operation.operationId }]) {
      expect(MemoryOperationRequestSchema.safeParse({ kind: "local.onboard.prepare", source }).success).toBe(true);
    }
    expect(MemoryOperationRequestSchema.safeParse({ kind: "local.onboard.activate", runId: "r" }).success).toBe(true);
    expect(MemoryOperationRequestSchema.safeParse({ ...operation.request, workspaceRoot: "arbitrary" }).success).toBe(false);
    expect(MemoryOnboardingPreviewParamsSchema.safeParse({ workspaceRoot: "arbitrary" }).success).toBe(false);
    expect(MemoryOnboardingExcludeParamsSchema.safeParse({ runId: "r", sourceId: "s", reason: "unsupported", actor: "forged" }).success).toBe(false);
    expect(MemoryOnboardingExceptionsParamsSchema.safeParse({ runId: "r", limit: 101 }).success).toBe(false);
  });

  it("preserves unknown and committed-but-unavailable outcomes without fabricated usability", () => {
    expect(MemoryOperationSchema.safeParse({ ...operation, state: "outcome_unknown", reason: "commitment_unknown", terminalAt: at }).success).toBe(true);
    const status = {
      authority: { mode: "canonical-local", epochId: "e" }, runtime: { available: false, unavailableReason: "not_installed" },
      run: null, operation: null, custody: { openGroups: 0, recoverableGroups: 0 }, observedAt: at,
      actions: { preview: false, prepare: false, resume: false, replace: false, activate: false, recoverBinding: true,
        reconcileSources: false, cancelOperationId: null, retryOperationId: null },
    };
    expect(MemoryOnboardingStatusSchema.safeParse(status).success).toBe(true);
    expect(MemoryOnboardingStatusSchema.safeParse({ ...status, runtime: { available: true, unavailableReason: "not_installed" } }).success).toBe(false);
  });

  it("rejects producer/result identity mismatch and keeps pushes body-free", () => {
    expect(MemoryOperationSchema.safeParse({ ...operation, producer: { kind: "replica", bankId: "b", admittedAt: at } }).success).toBe(false);
    expect(MemoryOnboardingChangedSchema.parse({ reason: "candidate" })).toEqual({ reason: "candidate" });
    expect(MemoryOnboardingChangedSchema.safeParse({ reason: "producer", content: "private" }).success).toBe(false);
    expect(MEMORY_ONBOARDING_METHODS.subscribe).toBe("memory.onboarding.subscribe");
  });
});
