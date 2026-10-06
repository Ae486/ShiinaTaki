/**
 * INPUT: schema-validated Core transition previews, action reasons and progress.
 * OUTPUT: explicit confirmation requests and truthful Chinese display facts.
 * POS: ui/operations — pure formatting only; Core owns permissions, commit and queue outcomes.
 */
import { MemoryTransitionRequestSchema, MemoryTransitionActionReasonSchema,
  type MemoryTransitionActionReason, type MemoryTransitionPreview, type MemoryTransitionRead, type MemoryTransitionOverview } from "@taki/shared";
import { RpcDeadlineExceededError } from "@/lib/rpc-deadline.js";
import { memoryOperationAppError } from "./memory-authority-state.ts";

export const TRANSITION_REASON: Record<MemoryTransitionActionReason, string> = {
  "wrong-provider": "当前记忆模式不适用此动作。",
  configuration: "连接配置或 Bank 校验已变更，请先检查配置并重新校验。",
  baseline: "没有可验证的共同基线，暂时无法重复切换。请检查初始化与历史转换记录。",
  capability: "Hindsight 未提供所需转换能力，请检查服务版本与兼容扩展。",
  "foreign-branch": "旧 Hindsight 已被隔离，不能自动合并或切回旧分支。",
  quarantined: "此操作属于已隔离的旧权威，只能查看历史。",
  busy: "有互斥工作正在进行，请等待并刷新状态。",
  stale: "预览或原操作身份已变化，请刷新后重新预览。",
  "lease-active": "原执行权尚未到期，请稍后刷新；不要重复提交。",
  settled: "该操作已结束，无需恢复。",
  unavailable: "当前服务或运行时不可用，请检查连接并刷新状态。",
  unknown: "操作结果尚未确定，请读取原操作状态。",
};
export const TRANSITION_PHASE = { admitted: "已受理", draining: "等待写入收束", fenced: "核对最终源状态",
  proven: "完整性证明已就绪", committed: "权威已提交", binding: "恢复目标运行时", settling: "处理已受理意图", terminal: "执行已结束" };
export const TRANSITION_NATIVE_PHASE: Record<NonNullable<MemoryTransitionRead["progress"]["banks"][number]["nativePhase"]>, string> = {
  draining: "等待写入收束", fenced: "写入已封锁", proven: "最终证明已就绪", retired: "旧权威已退役",
  active: "目标权威已激活", aborted: "转换已中止", quarantined: "旧权威已隔离",
};

/** Context refines wording only; the Core action remains the sole permission gate. */
export function transitionActionReason(action: MemoryTransitionOverview["actions"][number], provider: MemoryTransitionOverview["provider"]) {
  if (!action.reason) return null;
  if (action.reason !== "wrong-provider") return TRANSITION_REASON[action.reason];
  if (provider === null) return "尚未启用记忆权威，请使用下方启用流程。";
  if (provider === "local" && action.kind !== "transition.reenter-hindsight") return "当前已使用 Local，无需再次返回或紧急接管。";
  if (provider === "hindsight" && action.kind === "transition.reenter-hindsight") return "当前已使用 Hindsight，无需重新进入。";
  return TRANSITION_REASON[action.reason];
}

export function transitionRequest(preview: MemoryTransitionPreview, requestId: string) {
  if (!preview.expected || preview.kind === "transition.emergency-local" && preview.takeover !== "eligible") return null;
  return MemoryTransitionRequestSchema.parse({ kind: preview.kind, requestId, previewId: preview.previewId,
    previewHash: preview.previewHash, expected: preview.expected,
    confirmation: preview.kind === "transition.emergency-local" ? "emergency-takeover" : "healthy-switch",
    ...(preview.recovery ? { recovery: preview.recovery } : {}) });
}
export function transitionError(cause: unknown): string {
  if (cause instanceof RpcDeadlineExceededError) return cause.outcomeUnknown
    ? "提交超时，结果未知。Core 可能仍在执行；请刷新原操作状态，系统不会自动重提。"
    : "读取超时，请重试读取。此次读取没有发起转换。";
  const error = memoryOperationAppError(cause);
  if (error.code === "FORBIDDEN") return "当前连接没有操作员权限。";
  const reason = MemoryTransitionActionReasonSchema.safeParse(error.reason);
  if (reason.success) return TRANSITION_REASON[reason.data];
  const mapped: Record<string, MemoryTransitionActionReason> = { MEMORY_TRANSITION_STALE: "stale", MEMORY_OPERATION_BUSY: "busy",
    MEMORY_TRANSITION_CONFLICT: "busy", MEMORY_TRANSITION_UNAVAILABLE: "unavailable", MEMORY_TRANSITION_LEASE_LOST: "lease-active" };
  return TRANSITION_REASON[mapped[error.reason ?? ""] ?? "unavailable"];
}
export function transitionMutationFeedback(cause: unknown) {
  const { code } = memoryOperationAppError(cause);
  return { tone: "warn" as const, message: cause instanceof RpcDeadlineExceededError || code !== null ? transitionError(cause)
    : "提交结果未知，连接可能已中断。请刷新原操作状态；系统不会自动重新提交。" };
}
export function transitionProgressRows(status: MemoryTransitionRead, currentAuthority: boolean) {
  const { transition, progress } = status;
  return [
    { label: "实际阶段", value: progress.phase ? TRANSITION_PHASE[progress.phase] : "尚未开始执行" },
    { label: "权威提交", value: transition.receipt ? "已提交目标权威" : "尚未提交目标权威" },
    { label: "运行时", value: !currentAuthority ? "历史权威已被后续切换替代" : progress.runtime === "ready" ? "目标可用" : progress.runtime === "source" ? "原运行时可用" : "不可用，请查看恢复条件" },
    { label: "已受理意图", value: `${progress.queue.admitted} 条；已结算 ${progress.queue.settled} 条；结果未知 ${progress.queue.unknown} 条` },
    { label: "原生释放", value: transition.intent.request.kind === "transition.emergency-local" ? "离线隔离，无需等待旧服务释放"
      : progress.nativeReleasePending ? "仍有原服务收尾义务" : "无待释放义务" },
  ];
}
