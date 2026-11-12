/**
 * INPUT:  a schema-validated MemoryAuthorityStatus (and the operations it embeds) from memory.authority.status.
 * OUTPUT: pure view models for the Memory authority card — headline, setup line, per-Bank replica/review rows, Pending rows and the
 *         active-operation rows — plus the Bank scope / operation-kind labels and the app-error reader for MEMORY_OPERATION_REFUSED rejections.
 * POS:    ui/windows/home/pages/operations — node-testable; no DOM, no socket. Unknown stays "unknown", never "0".
 */

import { ErrorCodeSchema, type MemoryAuthorityStatus, type MemoryOperation, type MemoryReplicaRunKind, type MemoryReplicaScheduleConfig } from "@taki/shared";
import { memoryPolicyReviewView, type MemoryPolicyReviewView } from "./memory-policy-review-state.ts";

export interface BankRow {
  bankId: string;
  label: string;
  state: string;
  lastSuccess: string;
  lastAttempt: string;
  nextDue: string;
  error: string;
  nextAction: string;
  /** Set only when the Bank reports explicit_retry_required: the Retry action submits this kind. */
  retryKind: MemoryReplicaRunKind | null;
  schedule: MemoryReplicaScheduleConfig | null;
  review: MemoryPolicyReviewView;
}

export interface PendingRow { bankId: string; pending: number; failed: number; unknown: number; parentWrites: number }

export interface ActiveOperationRow {
  operationId: string;
  label: string;
  state: MemoryOperation["state"];
  /** Cancel is offered only for an admitted (unclaimed) replica.sync; nothing else may be cancelled in Stage 1. */
  cancellable: boolean;
}

export interface MemoryAuthorityView {
  headline: string;
  runtimeLine: string;
  setupLine: string;
  hindsight: boolean;
  banks: BankRow[];
  pending: PendingRow[];
  active: ActiveOperationRow[];
}

const MODE_LABEL: Record<MemoryAuthorityStatus["authority"]["mode"], string> = {
  "legacy-markdown": "Legacy Markdown", "canonical-local": "Local（canonical）", hindsight: "Hindsight",
};
export const MEMORY_RUNTIME_UNAVAILABLE_LABEL: Record<NonNullable<MemoryAuthorityStatus["runtime"]["unavailableReason"]>, string> = {
  authority_mismatch: "运行时与权威标记不一致", connection_unavailable: "连接不可用", stopped: "运行时已停止", not_installed: "运行时未安装",
  connection_disabled: "Hindsight 连接已关闭", config_changed: "连接配置已变更，需要重新校验",
  template_hold: "模板变更尚未完成，需要恢复原操作",
  authority_invalid: "权威证据校验失败，记忆已停用；请检查原操作或使用已校验的备份恢复",
  evidence_invalid: "本地记忆证据校验失败，需要检查证据并选择相应的校验或恢复操作",
};
export const MEMORY_OPERATION_STATE_LABEL: Record<MemoryOperation["state"], string> = {
  admitted: "已受理（未认领）", running: "执行中", waiting: "已受理，等待 Hindsight 处理", completed: "已完成", failed: "失败", cancelled: "已取消", outcome_unknown: "结果未知",
};
export const MEMORY_OPERATION_KIND_LABEL: Record<MemoryOperation["kind"], string> = {
  tidy: "整理记忆", "index.rebuild": "更新记忆检索",
  "setup.validate": "校验连接", "setup.apply": "应用配置", "replica.sync": "同步副本",
  "local.onboard.prepare": "准备本地记忆", "local.onboard.activate": "启用 / 恢复本地记忆", "hindsight.activate": "启用 Hindsight",
  "bank.provision": "创建 Bank", "connection.revalidate": "重新校验连接",
  "backup.capture": "创建备份", "backup.admit": "导入备份", "backup.verify": "校验备份",
  "template.apply": "应用模板", "template.recover": "恢复模板操作",
  "candidate.prepare": "准备隔离候选", "candidate.inspect": "检查隔离候选", "candidate.resume": "继续候选操作",
  "transition.return-local": "返回 Local", "transition.reenter-hindsight": "重新进入 Hindsight", "transition.emergency-local": "紧急接管至 Local",
};
const UNKNOWN = "未知";

export function memoryAuthorityView(status: MemoryAuthorityStatus): MemoryAuthorityView {
  const hindsight = status.authority.mode === "hindsight" && status.runtime.available;
  return {
    headline: MODE_LABEL[status.authority.mode],
    runtimeLine: status.runtime.available ? "运行时可用" : `运行时不可用：${MEMORY_RUNTIME_UNAVAILABLE_LABEL[status.runtime.unavailableReason ?? "connection_unavailable"]}`,
    setupLine: `${status.setup.phase}${status.setup.latestError ? ` · ${status.setup.latestError.code}` : ""}`,
    hindsight,
    banks: authorityBanks(status),
    pending: (status.pending ?? []).map((entry) => ({ bankId: entry.bankId, pending: entry.summary.pendingCount,
      failed: entry.summary.failedCount, unknown: entry.summary.unknownCount, parentWrites: entry.parentWritesPending })),
    active: status.operations.active.map((operation) => activeRow(operation, status)),
  };
}

export function bankScopeLabel(scope: "global" | "character", characterId: string | null): string {
  return scope === "global" ? "Global" : `Character · ${characterId}`;
}

function authorityBanks(status: MemoryAuthorityStatus): BankRow[] {
  const reviews = new Map((status.review ?? []).map((review) => [review.bankId, review]));
  const banks: BankRow[] = (status.replica ?? []).map((bank) => ({ ...bankRow(bank), review: memoryPolicyReviewView(reviews.get(bank.bankId)) }));
  if (status.authority.mode !== "hindsight") return banks;
  for (const review of reviews.values()) {
    if (banks.some((bank) => bank.bankId === review.bankId)) continue;
    const scope = status.hindsight?.banks.find((bank) => bank.nativeBankId === review.bankId);
    banks.push({ bankId: review.bankId, label: scope ? bankScopeLabel(scope.scope, scope.characterId) : "记忆库（范围未知）",
      state: UNKNOWN, lastSuccess: UNKNOWN, lastAttempt: UNKNOWN, nextDue: UNKNOWN, error: UNKNOWN, nextAction: UNKNOWN, retryKind: null,
      schedule: null, review: memoryPolicyReviewView(review) });
  }
  return banks;
}

function bankRow(bank: NonNullable<MemoryAuthorityStatus["replica"]>[number]): Omit<BankRow, "review"> {
  const explicit = bank.nextAction === "explicit_retry_required";
  const waiting = bank.mode === "waiting";
  return {
    bankId: bank.bankId,
    label: bankScopeLabel(bank.scope, bank.characterId),
    state: waiting ? "已受理，等待 Hindsight 处理" : bank.mode === "running" ? "执行中" : bank.mode === "failed" ? "失败" : "空闲",
    lastSuccess: bank.lastSuccessAt ?? UNKNOWN,
    lastAttempt: bank.lastAttemptAt ?? UNKNOWN,
    nextDue: bank.run ? "执行中" : bank.pendingManualKind ? `手动 ${bank.pendingManualKind} 待认领` : bank.retryDueAt ?? bank.nextDueAt ?? (bank.automatic ? UNKNOWN : "手动模式"),
    error: bank.errorCode ?? "无",
    nextAction: waiting ? explicit ? "稍后手动同步以检查处理结果" : "已排定自动检查处理结果"
      : bank.nextAction === null ? "无" : explicit ? "需要显式重试" : "已排定自动重试",
    retryKind: explicit ? bank.retryKind ?? (bank.fullReconciliationState === "waiting" ? "full" : "incremental") : null,
    schedule: { automatic: bank.automatic, autoIntervalMs: bank.autoIntervalMs, fullReconciliationIntervalMs: bank.fullReconciliationIntervalMs },
  };
}

function activeRow(operation: MemoryOperation, status: MemoryAuthorityStatus): ActiveOperationRow {
  const request = operation.request;
  const replica = request.kind === "replica.sync" ? status.replica?.find((bank) => bank.bankId === request.bankId) : undefined;
  const bank = replica ?? (request.kind === "replica.sync" ? status.hindsight?.banks.find((bank) => bank.nativeBankId === request.bankId) : undefined);
  const name = bank ? bank.scope === "global" ? "共享记忆" : `角色记忆 · ${bank.characterId}` : "记忆库";
  const target = request.kind === "replica.sync" ? ` · ${name}（${request.syncKind === "full" ? "完整对账" : "增量同步"}）` : "";
  return {
    operationId: operation.operationId,
    label: `${MEMORY_OPERATION_KIND_LABEL[operation.kind]}${target} · ${MEMORY_OPERATION_STATE_LABEL[operation.state]}`,
    state: operation.state,
    cancellable: operation.kind === "replica.sync" && operation.state === "admitted",
  };
}

export function memoryOperationAppError(cause: unknown): { code: string | null; reason: string | null; activeOperationId: string | null } {
  const none = { code: null, reason: null, activeOperationId: null };
  if (typeof cause !== "object" || cause === null || !("data" in cause)) return none;
  const data = cause.data;
  if (typeof data !== "object" || data === null) return none;
  const record = data as Record<string, unknown>;
  const code = ErrorCodeSchema.safeParse(record.code);
  return { code: code.success ? code.data : null, reason: typeof record.reason === "string" ? record.reason : null,
    activeOperationId: typeof record.activeOperationId === "string" ? record.activeOperationId : null };
}
