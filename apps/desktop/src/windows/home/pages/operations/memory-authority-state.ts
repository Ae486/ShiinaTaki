/**
 * INPUT:  a schema-validated MemoryAuthorityStatus (and the operations it embeds) from memory.authority.status.
 * OUTPUT: pure view models for the Memory authority card — headline, setup line, per-Bank rows, Pending rows and the
 *         active-operation rows — plus the app-error reader for MEMORY_OPERATION_REFUSED rejections.
 * POS:    ui/windows/home/pages/operations — node-testable; no DOM, no socket. Unknown stays "unknown", never "0".
 */

import { ErrorCodeSchema, type MemoryAuthorityStatus, type MemoryOperation, type MemoryReplicaRunKind } from "@taki/shared";

export interface BankRow {
  bankId: string;
  label: string;
  lastSuccess: string;
  lastAttempt: string;
  nextDue: string;
  error: string;
  nextAction: string;
  /** Set only when the Bank reports explicit_retry_required: the Retry action submits this kind. */
  retryKind: MemoryReplicaRunKind | null;
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
const UNAVAILABLE_LABEL: Record<NonNullable<MemoryAuthorityStatus["runtime"]["unavailableReason"]>, string> = {
  authority_mismatch: "运行时与权威标记不一致", connection_unavailable: "连接不可用", stopped: "运行时已停止", not_installed: "运行时未安装",
};
const STATE_LABEL: Record<MemoryOperation["state"], string> = {
  admitted: "已受理（未认领）", running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消", outcome_unknown: "结果未知（Core 重启）",
};
const KIND_LABEL: Record<MemoryOperation["kind"], string> = { "setup.validate": "校验连接", "setup.apply": "应用配置", "replica.sync": "同步副本", tidy: "整理记忆", "index.rebuild": "更新记忆检索" };
const UNKNOWN = "未知";

export function memoryAuthorityView(status: MemoryAuthorityStatus): MemoryAuthorityView {
  const hindsight = status.authority.mode === "hindsight" && status.runtime.available;
  return {
    headline: MODE_LABEL[status.authority.mode],
    runtimeLine: status.runtime.available ? "运行时可用" : `运行时不可用：${UNAVAILABLE_LABEL[status.runtime.unavailableReason ?? "connection_unavailable"]}`,
    setupLine: `${status.setup.phase}${status.setup.latestError ? ` · ${status.setup.latestError.code}` : ""}`,
    hindsight,
    banks: (status.replica ?? []).map(bankRow),
    pending: (status.pending ?? []).map((entry) => ({ bankId: entry.bankId, pending: entry.summary.pendingCount,
      failed: entry.summary.failedCount, unknown: entry.summary.unknownCount, parentWrites: entry.parentWritesPending })),
    active: status.operations.active.map((operation) => activeRow(operation, status.replica ?? [])),
  };
}

function bankRow(bank: NonNullable<MemoryAuthorityStatus["replica"]>[number]): BankRow {
  const explicit = bank.nextAction === "explicit_retry_required";
  return {
    bankId: bank.bankId,
    label: bank.scope === "global" ? "Global" : `Character · ${bank.characterId}`,
    lastSuccess: bank.lastSuccessAt ?? UNKNOWN,
    lastAttempt: bank.lastAttemptAt ?? UNKNOWN,
    nextDue: bank.run ? "执行中" : bank.pendingManualKind ? `手动 ${bank.pendingManualKind} 待认领` : bank.retryDueAt ?? bank.nextDueAt ?? (bank.automatic ? UNKNOWN : "手动模式"),
    error: bank.errorCode ?? "无",
    nextAction: bank.nextAction === null ? "无" : explicit ? "需要显式重试" : "已排定自动重试",
    retryKind: explicit ? bank.retryKind ?? "incremental" : null,
  };
}

function activeRow(operation: MemoryOperation, banks: NonNullable<MemoryAuthorityStatus["replica"]>): ActiveOperationRow {
  const request = operation.request;
  const bank = request.kind === "replica.sync" ? banks.find((entry) => entry.bankId === request.bankId) : undefined;
  const name = bank ? (bank.scope === "global" ? "共享记忆" : `角色记忆 · ${bank.characterId}`) : "记忆库";
  const target = request.kind === "replica.sync" ? ` · ${name}（${request.syncKind === "full" ? "完整对账" : "增量同步"}）` : "";
  return {
    operationId: operation.operationId,
    label: `${KIND_LABEL[operation.kind]}${target} · ${STATE_LABEL[operation.state]}`,
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
