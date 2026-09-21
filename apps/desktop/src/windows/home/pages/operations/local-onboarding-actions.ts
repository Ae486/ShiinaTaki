/**
 * INPUT:  current server-derived actions, discovered run and an explicitly requested preview
 * OUTPUT: allowed action labels and exact durable Local operation requests
 * POS:    ui/windows/home/pages/operations — presentation routing only; Core revalidates all admission proofs
 */
import type { MemoryOnboardingPreviewResult, MemoryOnboardingStatus, MemoryOperationRequest } from "@taki/shared";

export const ONBOARDING_ACTION_LABEL = {
  preview: "预览本地来源", prepare: "准备本地记忆", replace: "按新预览重新准备", resume: "继续准备",
  retry: "恢复未完成操作", activate: "启用本地记忆", recoverBinding: "恢复本地运行时",
  reconcileSources: "恢复未完成来源", cancel: "取消待开始操作",
} as const;
export type OnboardingAction = keyof typeof ONBOARDING_ACTION_LABEL;

export function onboardingActionAllowed(status: MemoryOnboardingStatus, action: OnboardingAction): boolean {
  if (action === "cancel") return status.actions.cancelOperationId !== null;
  if (action === "retry") return status.actions.retryOperationId !== null;
  return status.actions[action];
}

export function onboardingRequest(input: {
  action: OnboardingAction; status: MemoryOnboardingStatus; preview: MemoryOnboardingPreviewResult | null;
}): MemoryOperationRequest | null {
  const { action, status, preview } = input;
  if (!onboardingActionAllowed(status, action)) return null;
  if (action === "prepare" || action === "replace") {
    if (!preview || (action === "replace" && !status.run)) return null;
    return { kind: "local.onboard.prepare", source: { mode: "new", previewId: preview.reportId,
      ...(action === "replace" && status.run ? { replaceRunId: status.run.runId } : {}) } };
  }
  if (action === "retry" && status.actions.retryOperationId) {
    return { kind: "local.onboard.prepare", source: { mode: "retry", operationId: status.actions.retryOperationId } };
  }
  if (!status.run) return null;
  if (action === "resume" || (action === "reconcileSources" && status.authority.mode === "legacy-markdown")) {
    return { kind: "local.onboard.prepare", source: { mode: "resume", runId: status.run.runId } };
  }
  if (action === "activate" || action === "recoverBinding" || action === "reconcileSources") {
    return { kind: "local.onboard.activate", runId: status.run.runId };
  }
  return null;
}
