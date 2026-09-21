/**
 * INPUT:  validated Core onboarding evidence and disposable read/action state
 * OUTPUT: LocalOnboardingState plus truthful status, progress and refusal presentation
 * POS:    ui/windows/home/pages/operations — no persisted authority, inferred success or synthetic counts
 */
import type { MemoryLocalProgress, MemoryOnboardingExceptionsResult, MemoryOnboardingPreviewResult, MemoryOnboardingStatus } from "@taki/shared";
import { RpcDeadlineExceededError } from "@/lib/rpc-deadline.js";
import { memoryOperationAppError } from "./memory-authority-state.ts";

export interface OnboardingFeedback { tone: "ok" | "warn" | "danger"; message: string }
export interface LocalOnboardingState {
  status: MemoryOnboardingStatus | null;
  preview: MemoryOnboardingPreviewResult | null;
  exceptions: MemoryOnboardingExceptionsResult | null;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: string | null;
  exceptionsError: string | null;
  busyKey: string | null;
  feedback: OnboardingFeedback | null;
}

export function initialOnboardingState(): LocalOnboardingState {
  return { status: null, preview: null, exceptions: null, loading: true, refreshing: false, stale: true,
    error: null, exceptionsError: null, busyKey: null, feedback: null };
}

export const ONBOARDING_PHASE: Record<MemoryLocalProgress["phase"], string> = {
  reserved: "已受理，等待开始", snapshot: "保存原始证据", converting: "准备来源", verifying: "校验完整性",
  blocked: "来源异常待处理", ready: "准备就绪", reconciling: "恢复未完成来源", activating: "启用本地权威",
  binding: "连接本地运行时", completed: "已完成",
};

export function onboardingHeadline(status: MemoryOnboardingStatus): string {
  if (status.authority.mode === "canonical-local") return status.runtime.available ? "本地记忆已启用" : "本地权威已启用，运行时不可用";
  if (status.authority.mode === "hindsight") return "当前使用 Hindsight";
  const operation = status.operation;
  if (operation?.state === "admitted") return "操作已受理，等待开始";
  if (operation?.state === "running") return operation.kind === "local.onboard.activate" ? "正在启用本地记忆" : "正在准备本地记忆";
  if (operation?.state === "outcome_unknown") return "操作结果未知";
  if (status.run?.progress.phase === "blocked" || (status.run?.progress.blockingCount ?? 0) > 0) return "有来源需要处理";
  if (status.run?.status === "ready") return "准备就绪，等待启用";
  if (operation?.state === "failed" || status.run?.status === "failed") return "准备或启用失败";
  if (operation?.state === "cancelled") return "操作已取消";
  if (status.run) return "已有准备记录，可查看或恢复";
  return "开始使用本地记忆";
}

export function onboardingProgress(status: MemoryOnboardingStatus): MemoryLocalProgress | null {
  const operation = status.operation;
  if ((operation?.state === "running" || operation?.state === "admitted") && operation.producer?.kind === "local") return operation.producer.progress;
  return status.run?.progress ?? null;
}

export function onboardingError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function onboardingRefusal(cause: unknown): OnboardingFeedback {
  if (cause instanceof RpcDeadlineExceededError && cause.outcomeUnknown) {
    return { tone: "warn", message: "请求超时，操作结果未知。正在重新读取 Core 状态，请根据结果选择下一步。" };
  }
  const { code, reason } = memoryOperationAppError(cause);
  if (code) return { tone: "warn", message: `Core 拒绝了该操作：${reason ?? code}` };
  return { tone: "danger", message: onboardingError(cause) };
}
