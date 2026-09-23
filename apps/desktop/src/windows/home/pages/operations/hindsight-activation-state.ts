/**
 * INPUT:  a schema-validated MemoryActivationStatus from memory.activation.status plus the card's disposable read/action state
 * OUTPUT: HindsightActivationState and pure presentation — headline, guidance, facts, Bank prerequisites, blocking lines, diagnostics
 * POS:    ui/windows/home/pages/operations — node-testable; every value is a Core read, unknown stays 未知, ids and hashes only in diagnostics
 */
import { MEMORY_OPERATION_TERMINAL_STATES, type HindsightSetupPhase, type MemoryActivationStatus, type MemoryHindsightPhase,
  type MemoryHindsightProgress, type MemoryOperation } from "@taki/shared";
import { MEMORY_OPERATION_KIND_LABEL, MEMORY_OPERATION_STATE_LABEL, MEMORY_RUNTIME_UNAVAILABLE_LABEL } from "./memory-authority-state.ts";
import type { MemoryOperationsFeedback } from "./memory-operations-controller.ts";
import type { LabeledRow } from "../../page-card.tsx";

export interface HindsightActivationState {
  status: MemoryActivationStatus | null;
  /** True while no client is bound or a read is in flight; a stale last frame stays on screen with its actions locked. */
  loading: boolean;
  error: string | null;
  busyKey: string | null;
  feedback: MemoryOperationsFeedback | null;
}

export function initialActivationState(): HindsightActivationState {
  return { status: null, loading: true, error: null, busyKey: null, feedback: null };
}

const AUTHORITY_LABEL: Record<MemoryActivationStatus["authority"]["mode"], string> = {
  "legacy-markdown": "Legacy Markdown", "canonical-local": "本地记忆（Canonical Local）", hindsight: "Hindsight",
};
export const SETUP_PHASE_LABEL: Record<HindsightSetupPhase, string> = {
  disabled: "已停用", unconfigured: "未填写连接参数", "ready-to-validate": "待校验连接", validating: "正在校验连接", compatible: "连接已校验，待应用配置",
  "validating-templates": "正在校验模板", "initializing-banks": "正在创建 Bank", "applying-templates": "正在应用模板",
  "waiting-template-operations": "等待模板操作完成", configured: "已完成", failed: "配置失败",
};
const SETUP_GUIDANCE: Record<HindsightSetupPhase, string> = {
  disabled: "Hindsight 已在设置中停用；请先在设置（高级）中启用并填写连接参数。",
  unconfigured: "请先在设置（高级）中填写 Hindsight 连接参数。",
  "ready-to-validate": "连接参数已填写，请先校验连接。",
  validating: "配置进行中，请等待 Core 完成。", compatible: "连接已校验，请应用配置以创建并校验 Bank。",
  "validating-templates": "配置进行中，请等待 Core 完成。", "initializing-banks": "配置进行中，请等待 Core 完成。",
  "applying-templates": "配置进行中，请等待 Core 完成。", "waiting-template-operations": "配置进行中，请等待 Core 完成。",
  configured: "连接配置已完成。", failed: "上次配置失败，可重新校验连接或应用配置。",
};
export const ACTIVATION_PHASE_LABEL: Record<MemoryHindsightPhase, string> = {
  reserved: "已受理，等待开始", draining: "暂停本地写入", capturing: "捕获本地记忆", preparing: "准备 Bank", importing: "导入到 Hindsight",
  verifying: "校验导入结果", ready: "准备就绪", committing: "提交切换", binding: "连接 Hindsight 运行时", completed: "已完成",
};
const RUN_PHASE_LABEL: Record<NonNullable<MemoryActivationStatus["run"]>["phase"], string> = {
  importing: "导入中", "replica-verified": "副本已校验", ready: "准备就绪", activated: "已提交", failed: "失败",
};
const RUN_STATUS_LABEL: Record<NonNullable<MemoryActivationStatus["run"]>["status"], string> = {
  running: "进行中", ready: "就绪", completed: "已完成", failed: "失败",
};
const BLOCKING_LABEL: Partial<Record<MemoryActivationStatus["prerequisites"]["blocking"][number]["code"], string>> = {
  HINDSIGHT_TEMPLATE_NOT_VERIFIED: "缺少已校验的 Hindsight Bank", HINDSIGHT_BANKS_INCOMPLETE: "Hindsight 配置多出的 Bank（本地没有对应 Bank）",
};
const NONE = "无";

export function openOperation(status: MemoryActivationStatus): MemoryOperation | null {
  const operation = status.operation;
  return operation && !MEMORY_OPERATION_TERMINAL_STATES.includes(operation.state) ? operation : null;
}

export function activationProgress(status: MemoryActivationStatus): MemoryHindsightProgress | null {
  const producer = openOperation(status)?.producer;
  return producer?.kind === "hindsight" ? producer.progress : null;
}

export function activationHeadline(status: MemoryActivationStatus): string {
  const { authority, runtime, run, operation, setup } = status;
  if (authority.mode === "hindsight") return runtime.available ? "Hindsight 已启用" : "Hindsight 权威已提交，运行时不可用";
  if (authority.mode === "legacy-markdown") return "需要先启用本地记忆";
  if (operation?.state === "admitted") return "操作已受理，等待开始";
  if (operation?.state === "running") return `正在${MEMORY_OPERATION_KIND_LABEL[operation.kind]}`;
  if (operation?.state === "outcome_unknown") return "操作结果未知";
  if (run && run.receipt === null) return status.actions.resume ? "启用未完成，可继续" : "启用未完成";
  if (operation?.state === "failed") return "启用失败";
  if (operation?.state === "cancelled") return "操作已取消";
  if (!setup.configured) return "先完成 Hindsight 连接配置";
  if (status.prerequisites.blocking.length > 0) return "Bank 前置条件未满足";
  return status.actions.activate ? "可以启用 Hindsight" : "等待 Core 提供下一步";
}

export function activationGuidance(status: MemoryActivationStatus): string {
  const { authority, runtime, run, operation, setup } = status;
  if (authority.mode === "hindsight") {
    return runtime.available ? "Hindsight 记忆运行时可用。" : "权威已切换到 Hindsight。恢复运行时将使用已提交的同一份记录，不会重新导入，也不会退回本地记忆。";
  }
  if (authority.mode === "legacy-markdown") return "请先通过“本地记忆引导”启用本地记忆，再从本地记忆切换到 Hindsight。";
  if (operation?.state === "outcome_unknown") return "执行结果尚未确认。请读取最新状态，并使用 Core 提供的恢复操作。";
  if (operation?.state === "running") return "Core 会继续执行，关闭页面不会中断。执行期间本地记忆只读；开始执行后不支持取消。";
  if (operation?.state === "admitted") return "操作已受理，尚未开始执行；开始前可以取消。";
  if (run && run.receipt === null) return "上次启用未完成。继续时 Core 会复用已保存的证据，不会重复导入。";
  if (!setup.configured) return SETUP_GUIDANCE[setup.phase];
  if (status.prerequisites.blocking.length > 0) {
    const missing = status.prerequisites.blocking.some((item) => item.code === "HINDSIGHT_TEMPLATE_NOT_VERIFIED");
    return `每个本地 Bank 都需要一个已校验的 Hindsight Bank；多出的 Hindsight 配置同样会阻止启用。${missing ? "请应用配置，为缺少的 Bank 创建并校验。" : ""}`;
  }
  return "启用会先暂停本地写入并导入全部本地记忆，完成后把记忆权威切换到 Hindsight；提交前本地记忆保持可用。";
}

export function activationFacts(status: MemoryActivationStatus): LabeledRow[] {
  const progress = activationProgress(status);
  const { run, operation, custody } = status;
  const runtime = status.runtime.available ? "可用" : `不可用：${MEMORY_RUNTIME_UNAVAILABLE_LABEL[status.runtime.unavailableReason ?? "connection_unavailable"]}`;
  const custodyOpen = custody.openGroups + custody.unconsumedWitnesses + custody.pendingSpans > 0;
  return [
    { label: "当前权威", value: AUTHORITY_LABEL[status.authority.mode] }, { label: "当前运行时", value: runtime },
    { label: "连接配置", value: SETUP_PHASE_LABEL[status.setup.phase] },
    ...(progress ? [{ label: "启用阶段", value: ACTIVATION_PHASE_LABEL[progress.phase] },
      { label: "Bank 进度", value: `已准备 ${progress.preparedBankCount} / 已导入 ${progress.importedBankCount} / 已校验 ${progress.verifiedBankCount} / 共 ${progress.bankCount}` },
      ...(progress.carriedWitnessCount > 0 ? [{ label: "携带的写入见证", value: String(progress.carriedWitnessCount) }] : [])] : []),
    ...(run && !progress ? [{ label: "启用记录", value: `${RUN_PHASE_LABEL[run.phase]} · ${RUN_STATUS_LABEL[run.status]}` }] : []),
    ...(operation ? [{ label: "最近操作", value: `${MEMORY_OPERATION_KIND_LABEL[operation.kind]} · ${MEMORY_OPERATION_STATE_LABEL[operation.state]}` }] : []),
    ...(custodyOpen ? [{ label: "未完成的本地写入", value: `${custody.openGroups} 个来源组 / ${custody.unconsumedWitnesses} 条未消费见证 / ${custody.pendingSpans} 段未完成写入` }] : []),
  ];
}

function scopeLabel(bank: { scope: "global" | "character"; characterId: string | null }): string {
  return bank.scope === "global" ? "Global" : `Character · ${bank.characterId ?? "未知"}`;
}

export function activationBankRows(status: MemoryActivationStatus): LabeledRow[] {
  return status.prerequisites.banks.map((bank) => ({
    label: scopeLabel(bank), value: bank.verified ? "已校验" : bank.nativeBankId === null ? "未配置 Hindsight Bank" : "已配置，未校验",
  }));
}

export function activationBlockingLines(status: MemoryActivationStatus): string[] {
  return status.prerequisites.blocking.map((item) => `${scopeLabel(item)}：${BLOCKING_LABEL[item.code] ?? item.code}`);
}

export function activationDiagnostics(status: MemoryActivationStatus): LabeledRow[] {
  const { run, operation } = status;
  const producer = operation?.producer?.kind === "hindsight" ? operation.producer : null;
  return [
    { label: "读取时间", value: status.observedAt }, { label: "Epoch", value: status.authority.epochId ?? NONE },
    { label: "配置版本", value: String(status.setup.revision) }, { label: "Run", value: run?.runId ?? NONE },
    { label: "租约", value: run ? `${run.lease.active ? "持有中" : "已释放"} · fence ${run.lease.fence}` : NONE },
    { label: "提交回执", value: run?.receipt ? `${run.receipt.transactionId} · ${run.receipt.epochId} · ${run.receipt.committedAt}` : NONE },
    { label: "Hindsight Bank", value: status.prerequisites.banks.map((bank) => bank.nativeBankId ?? NONE).join(" / ") || NONE },
    { label: "配置指纹", value: producer?.configFingerprint ?? NONE },
    { label: "操作", value: operation?.operationId ?? NONE }, { label: "结果", value: operation?.result?.kind === "hindsight" ? operation.result.outcome : NONE },
    { label: "原因", value: operation?.reason ?? NONE }, { label: "错误", value: operation?.errorCode ?? NONE },
  ];
}
