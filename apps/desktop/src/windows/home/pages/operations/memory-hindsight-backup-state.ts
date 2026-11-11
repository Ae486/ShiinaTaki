/**
 * INPUT:  a schema-validated MemoryAuthorityStatus: the `hindsight.backup` section (last verified, newest sealed, staged
 *         captures), replica / Bank error codes and the backup.* rows in `operations.active` / `operations.recent`
 * OUTPUT: hindsightBackupView() — state and per-Bank missing-interval rows, in-flight / failure / rollback lines, the
 *         newest route-b staged capture, diagnostics and the 创建备份 / 校验备份 (newest sealed backup) descriptors; backupAdmitAction() — the 导入备份
 *         request for an operator-typed inbox file name (Shared inbox schema)
 * POS:    ui/windows/home/pages/operations — node-testable projection for the memory authority card; Core decides every
 *         outcome, the only client rule is disabling while a backup operation is open; ids and codes only in diagnostics
 */
import { HindsightBackupInboxFileSchema, MemoryBackupErrorCodeSchema, type MemoryAuthorityStatus, type MemoryBackupErrorCode,
  type MemoryBackupProducerRef, type MemoryHindsightStatusSection, type MemoryOperation, type MemoryOperationRequest } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";
import { bankScopeLabel, MEMORY_OPERATION_KIND_LABEL, MEMORY_OPERATION_STATE_LABEL } from "./memory-authority-state.ts";

export interface BackupAction { key: string; label: string; request: MemoryOperationRequest }
/** A route-b capture Core lists as staged under the current epoch, still awaiting its native ZIP. */
export interface StagedCapture { backupId: string; expectedEpochId: string }

export interface HindsightBackupView {
  rows: LabeledRow[];
  intervals: LabeledRow[];
  rollback: string | null;
  inFlight: string | null;
  failure: string | null;
  staged: StagedCapture | null;
  /** A backup operation is admitted or running: every backup action waits for it. */
  pending: boolean;
  actions: BackupAction[];
  diagnostics: LabeledRow[];
}

type BackupSection = MemoryHindsightStatusSection["backup"];

export const BACKUP_ERROR_LABEL: Record<MemoryBackupErrorCode, string> = {
  HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE: "原生备份接口不可用，可改用手动导出原生数据",
  HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT: "等待已有记忆处理结束已超时，本次未创建备份；请稍后再次点击“创建备份”",
  HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED: "Core 数据复制失败",
  HINDSIGHT_BACKUP_NATIVE_FAILED: "原生快照失败",
  HINDSIGHT_BACKUP_PAIR_MISMATCH: "Core 与原生快照不一致",
  HINDSIGHT_BACKUP_PROOF_MISSING: "原生备份缺少校验证明",
  HINDSIGHT_BACKUP_ARTIFACT_INVALID: "备份文件无效或已被改动",
  HINDSIGHT_BACKUP_STORAGE_FAILED: "备份写入存储失败",
  HINDSIGHT_BACKUP_TARGET_NOT_ISOLATED: "恢复目标未隔离",
  HINDSIGHT_BACKUP_NATIVE_INCOMPATIBLE: "原生版本不兼容",
  HINDSIGHT_BACKUP_READBACK_MISMATCH: "回读结果不一致",
  HINDSIGHT_BACKUP_CREDENTIAL_MISSING: "缺少备份所需的凭据",
  HINDSIGHT_BACKUP_INTERNAL_ERROR: "内部错误",
  HINDSIGHT_BACKUP_TEMPLATE_UNPROVEN: "无法完整核实模板、用户版本和资源所有权记录",
  HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED: "仍有未发布的模板变更，请先处理原模板计划",
  HINDSIGHT_BACKUP_TEMPLATE_OBSERVATION_REQUIRED: "缺少原生模板配置观测，无法确认备份一致性",
  MEMORY_AUTHORITY_MISMATCH: "记忆权威已变更",
  MEMORY_RUNTIME_UNAVAILABLE: "Hindsight 运行时不可用",
};
const PHASE_LABEL: Record<MemoryBackupProducerRef["phase"], string> = {
  reserved: "已预留", quiescing: "暂停新写入，限时等待已有记忆处理结束", "capturing-core": "复制 Core 数据", "capturing-native": "生成原生快照",
  verifying: "校验中", sealing: "封存中", completed: "已完成",
};
export const ROLLBACK_WARNING = "检测到 Hindsight 数据回退：原生实例落后于 Core 已确认的进度。副本不会自动重建，请从已校验的备份恢复。";
const ROLLBACK = "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED";
const UNKNOWN = "未知";
const AGE_UNITS = [[86_400, "天"], [3_600, "小时"], [60, "分钟"]] as const;
const isBackup = (operation: MemoryOperation) => operation.kind.startsWith("backup.");
const isOpen = (operation: MemoryOperation) => operation.terminalAt === null;

export function hindsightBackupView(status: MemoryAuthorityStatus): HindsightBackupView | null {
  const section = status.hindsight;
  if (!section) return null;
  const operations = backupOperations(status);
  const open = operations.find(isOpen) ?? null;
  const settled = operations.find((operation) => !isOpen(operation)) ?? null;
  return {
    rows: stateRows(section.backup),
    intervals: intervalRows(section),
    rollback: rollbackDetected(status, section) ? ROLLBACK_WARNING : null,
    inFlight: open && inFlightLine(open),
    failure: open || !settled ? null : failureLine(settled),
    staged: stagedCapture(section.backup, status.authority.epochId),
    pending: open !== null,
    actions: backupActions(operations, section.backup, status.authority.epochId),
    diagnostics: diagnosticRows(section.backup, settled),
  };
}

export function backupAdmitAction(staged: StagedCapture, fileName: string): BackupAction | null {
  const parsed = HindsightBackupInboxFileSchema.safeParse(fileName.trim());
  if (!parsed.success) return null;
  return { key: "backup:admit", label: MEMORY_OPERATION_KIND_LABEL["backup.admit"],
    request: { kind: "backup.admit", expectedEpochId: staged.expectedEpochId, backupId: staged.backupId, fileName: parsed.data } };
}

/** Newest first; an operation that moved from `active` to `recent` between reads is counted once. */
function backupOperations(status: MemoryAuthorityStatus): MemoryOperation[] {
  const byId = new Map([...status.operations.recent, ...status.operations.active].filter(isBackup).map((operation) => [operation.operationId, operation]));
  return [...byId.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function backupIdOf(operation: MemoryOperation): string | null {
  if (operation.result?.kind === "backup") return operation.result.backupId;
  return operation.producer?.kind === "backup" ? operation.producer.backupId : null;
}

function stagedCapture(backup: BackupSection, epochId: string | null): StagedCapture | null {
  const newest = backup?.staged[0];
  return newest && epochId !== null ? { backupId: newest.backupId, expectedEpochId: epochId } : null;
}

function stateRows(backup: BackupSection): LabeledRow[] {
  if (!backup) return [{ label: "备份状态", value: UNKNOWN }];
  const { lastVerified, ageSeconds, latest } = backup;
  const unverified: LabeledRow[] = latest && latest.verifiedAt === null ? [{ label: "最新备份", value: `${latest.createdAt}（未通过校验）` }] : [];
  if (!lastVerified) return [{ label: "备份状态", value: "尚无已校验的备份" }, ...unverified];
  return [
    { label: "备份状态", value: "已有已校验的备份" },
    { label: "上次备份", value: `${lastVerified.createdAt}（${ageLabel(ageSeconds)}）` },
    { label: "校验时间", value: lastVerified.verifiedAt },
    ...unverified,
  ];
}

function ageLabel(seconds: number | null): string {
  if (seconds === null) return UNKNOWN;
  const unit = AGE_UNITS.find(([size]) => seconds >= size);
  return unit ? `${Math.floor(seconds / unit[0])} ${unit[1]}前` : "不到 1 分钟前";
}

/** Intervals are keyed by native Bank id; the scope label replaces it wherever the lifecycle section maps it. */
function intervalRows(section: NonNullable<MemoryAuthorityStatus["hindsight"]>): LabeledRow[] {
  const scopes = new Map(section.banks.map((bank) => [bank.nativeBankId, bankScopeLabel(bank.scope, bank.characterId)]));
  return (section.backup?.missingInterval ?? []).map((bank) => ({
    label: `${scopes.get(bank.bankId) ?? `Bank ${bank.bankId}`} 未备份区间`,
    value: `游标 ${bank.fromNativeCursor ?? UNKNOWN} → ${bank.toReplicaCursor ?? UNKNOWN} · 未落定写入 ${bank.pendingCount ?? UNKNOWN} · 远端未同步写入未知`,
  }));
}

function rollbackDetected(status: MemoryAuthorityStatus, section: NonNullable<MemoryAuthorityStatus["hindsight"]>): boolean {
  return (status.replica ?? []).some((bank) => bank.errorCode === ROLLBACK) || section.banks.some((bank) => bank.errorCode === ROLLBACK);
}

function inFlightLine(operation: MemoryOperation): string {
  const phase = operation.producer?.kind === "backup" ? PHASE_LABEL[operation.producer.phase] : MEMORY_OPERATION_STATE_LABEL[operation.state];
  return `${MEMORY_OPERATION_KIND_LABEL[operation.kind]} · ${phase}`;
}

function failureLine(operation: MemoryOperation): string | null {
  const label = MEMORY_OPERATION_KIND_LABEL[operation.kind];
  if (operation.state === "outcome_unknown") return `${label}结果未知（Core 重启），未完成的备份不会列出`;
  if (operation.state !== "failed") return null;
  const code = MemoryBackupErrorCodeSchema.safeParse(operation.errorCode);
  if (code.success && code.data === "HINDSIGHT_BACKUP_NATIVE_FAILED" && operation.producer?.kind === "backup"
    && operation.producer.phase === "quiescing") return `${label}失败：备份等待被中断，本次未创建备份`;
  return `${label}失败：${code.success ? BACKUP_ERROR_LABEL[code.data] : "未分类错误（见备份诊断）"}`;
}

function backupActions(operations: MemoryOperation[], backup: BackupSection, epochId: string | null): BackupAction[] {
  if (epochId === null) return [];
  const capture = (key: string, label: string, route: "native-endpoint" | "operator-artifact"): BackupAction =>
    ({ key, label, request: { kind: "backup.capture", expectedEpochId: epochId, route } });
  const actions = [capture("backup:capture", MEMORY_OPERATION_KIND_LABEL["backup.capture"], "native-endpoint")];
  const lastCapture = operations.find((operation) => operation.kind === "backup.capture" && !isOpen(operation));
  if (lastCapture?.errorCode === "HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE") {
    actions.push(capture("backup:capture-operator", "创建备份（手动导出原生数据）", "operator-artifact"));
  }
  // The newest sealed backup, verified or not, so one whose verify failed can be verified again.
  const latest = backup?.latest;
  if (latest) actions.push({ key: "backup:verify", label: MEMORY_OPERATION_KIND_LABEL["backup.verify"], request: { kind: "backup.verify", backupId: latest.backupId } });
  return actions;
}

function diagnosticRows(backup: BackupSection, settled: MemoryOperation | null): LabeledRow[] {
  const rows: LabeledRow[] = [];
  if (backup?.lastVerified) rows.push({ label: "已校验备份", value: backup.lastVerified.backupId });
  if (backup?.latest && backup.latest.backupId !== backup.lastVerified?.backupId) rows.push({ label: "最新备份", value: backup.latest.backupId });
  if (settled) {
    const mismatch = settled.result?.kind === "backup" ? settled.result.mismatch : null;
    const detail = [settled.operationId, backupIdOf(settled), settled.errorCode, mismatch && `${mismatch.reason}${mismatch.bankId ? `@${mismatch.bankId}` : ""}`];
    rows.push({ label: "最近备份操作", value: detail.filter(Boolean).join(" · ") });
  }
  return rows;
}
