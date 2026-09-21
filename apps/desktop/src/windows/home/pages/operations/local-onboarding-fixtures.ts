/**
 * INPUT:  explicit onboarding test overrides
 * OUTPUT: Shared-schema-validated status, run, operation and preview fixtures
 * POS:    ui/windows/home/pages/operations — test support only; never imported by the production flow
 */
import { MemoryOnboardingStatusSchema, MemoryOperationSchema, MemoryOnboardingPreviewResultSchema,
  type MemoryOnboardingStatus, type MemoryOnboardingRun, type MemoryOperation } from "@taki/shared";

export const ONBOARDING_AT = "2026-09-21T00:00:00.000Z";
export const ONBOARDING_OPERATION_ID = "22222222-2222-4222-8222-222222222222";

export function onboardingRun(patch: Partial<MemoryOnboardingRun> = {}): MemoryOnboardingRun {
  return { runId: "run-local-1", snapshotId: "snapshot-local-1", epochId: "epoch-local-1", status: "ready",
    supersededByRunId: null, progress: { phase: "ready", sourceCount: 2, resolvedCount: 2, blockingCount: 0 }, receipt: null, ...patch };
}

export function onboardingStatus(patch: Partial<MemoryOnboardingStatus> = {}): MemoryOnboardingStatus {
  return MemoryOnboardingStatusSchema.parse({ authority: { mode: "legacy-markdown", epochId: null },
    runtime: { available: true, unavailableReason: null }, run: null, operation: null,
    custody: { openGroups: 0, recoverableGroups: 0 }, observedAt: ONBOARDING_AT,
    actions: { preview: true, prepare: true, resume: false, replace: false, activate: false, recoverBinding: false,
      reconcileSources: false, cancelOperationId: null, retryOperationId: null }, ...patch });
}

export function onboardingOperation(patch: Partial<MemoryOperation> = {}): MemoryOperation {
  return MemoryOperationSchema.parse({ operationId: ONBOARDING_OPERATION_ID, kind: "local.onboard.prepare", state: "admitted",
    reason: null, authorityEpochId: null, request: { kind: "local.onboard.prepare", source: { mode: "new", previewId: "preview-1" } },
    producer: { kind: "local", runId: "run-local-1", previewId: "preview-1", snapshotId: null, activationTransactionId: null,
      progress: { phase: "reserved", sourceCount: null, resolvedCount: null, blockingCount: null } },
    result: null, errorCode: null, createdAt: ONBOARDING_AT, updatedAt: ONBOARDING_AT, terminalAt: null, ...patch });
}

export function onboardingPreview(sourceCount = 2) {
  return MemoryOnboardingPreviewResultSchema.parse({ reportId: "preview-1", sourceCount,
    exceptional: 0, plannedZero: 0, plannedOne: sourceCount, plannedMany: 0 });
}
