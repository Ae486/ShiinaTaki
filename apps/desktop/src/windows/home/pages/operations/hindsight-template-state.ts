/**
 * INPUT:  Shared template facts and explicit operator choices
 * OUTPUT: safe labels, editable intent and distinct publication/runtime/derived presentation
 * POS:    ui/operations — no recovery or ownership inference from Native effective values
 */
import type { MemoryAuthorityStatus, MemoryOperation, MemoryTemplateStatus, MemoryTemplatePreviewParams,
  MemoryTemplateUserChoices, MemoryTemplateErrorCode, MemoryTemplateDerivedObservation } from "@taki/shared";
import { RpcDeadlineExceededError } from "@/lib/rpc-deadline.js";
import { memoryOperationAppError } from "./memory-authority-state.ts";
import type { MemoryOperationsFeedback } from "./memory-operations-controller.ts";

export interface TemplateFrame { template: MemoryTemplateStatus; authority: MemoryAuthorityStatus; original: MemoryOperation | null }
export const EMPTY_TEMPLATE_CHOICES: MemoryTemplateUserChoices = { config: [], labels: [], models: [], directives: [] };
export const TEMPLATE_ERROR_LABEL: Record<MemoryTemplateErrorCode, string> = {
  MEMORY_TEMPLATE_UNSUPPORTED: "此连接暂不支持模板管理；现有记忆功能保持独立。",
  MEMORY_TEMPLATE_PREVIEW_EXPIRED: "预览已过期，请重新预览。", MEMORY_TEMPLATE_CONFLICT: "配置或资源发生冲突，请核对后重新预览。",
  MEMORY_TEMPLATE_HOLD: "模板变更尚未完成，请观察或恢复原计划。", MEMORY_TEMPLATE_PLAN_NOT_FOUND: "未找到原计划，请刷新 Core 状态。",
  MEMORY_TEMPLATE_LEASE_LOST: "原计划仍由其他执行者处理或租约已失效，请刷新状态。",
  MEMORY_TEMPLATE_IDENTITY_CHANGED: "连接、Bank 或配置身份已变化，请刷新并重新预览。",
  MEMORY_TEMPLATE_OUTCOME_UNKNOWN: "操作结果未知，请观察原计划，不要重复应用。",
  MEMORY_TEMPLATE_NATIVE_REFUSED: "Native 拒绝了请求，请检查配置后重新预览。",
  MEMORY_TEMPLATE_BINDING_UNAVAILABLE: "配置已发布，但运行时尚未恢复；请使用原计划恢复。",
  MEMORY_TEMPLATE_EVIDENCE_INVALID: "无法验证模板结果，当前状态未知。", MEMORY_TEMPLATE_QUARANTINED: "原计划已隔离，不能继续应用或恢复。",
  MEMORY_TEMPLATE_TOO_LARGE: "模板或预览超出支持范围，请缩小本次修改。", MEMORY_TEMPLATE_ALREADY_BOUND: "该计划已完成运行时绑定。",
};
export const TEMPLATE_PHASE_LABEL = { admitted: "已受理", quiescing: "暂停相关记忆工作", applying: "应用各 Bank",
  verifying: "核对结果", publishing: "发布选择", rebinding: "恢复运行时", settled: "本次执行已结束" } as const;
export const TEMPLATE_CHILD_LABEL = { unknown: "未知", pending: "待处理", processing: "处理中", completed: "已生成", superseded: "已被后续修改替代", failed: "生成失败" } as const;

export function templateFailure(cause: unknown): string {
  if (cause instanceof RpcDeadlineExceededError) return cause.outcomeUnknown
    ? "提交超时，结果未知。正在读取原计划；系统不会自动重提。" : "读取超时，请重试。";
  const { reason, code } = memoryOperationAppError(cause);
  const message = reason ?? code;
  return Object.entries(TEMPLATE_ERROR_LABEL).find(([key]) => key === message)?.[1] ?? "请求未完成，请刷新 Core 状态后重试。";
}
export function templateFeedback(cause: unknown): MemoryOperationsFeedback { return { tone: "warn", message: templateFailure(cause) }; }

export function templateDraft(frame: TemplateFrame, bankId: string | null): MemoryTemplatePreviewParams {
  const { template } = frame;
  const revision = (scope: "global" | "character") => template.catalogs.find((item) => item.scope === scope)?.revision ?? "";
  return { target: bankId ? { kind: "bank", bankId, templateRevision: template.bank?.selected?.templateRevision ?? revision(template.bank?.scope ?? "global"), userChoices: null }
    : { kind: "defaults", globalTemplateRevision: template.defaults?.globalTemplateRevision ?? revision("global"),
      characterTemplateRevision: template.defaults?.characterTemplateRevision ?? revision("character") },
  enrollment: "fresh", directives: [], refresh: [] };
}
export function templateUserChoices(frame: TemplateFrame | null, draft: MemoryTemplatePreviewParams | null): MemoryTemplateUserChoices {
  const explicit = draft?.target.kind === "bank" ? draft.target.userChoices : null;
  const saved = frame?.template.bank?.latestUser;
  return explicit ?? (saved ? { config: saved.config, labels: saved.labels, models: saved.models, directives: saved.directives } : EMPTY_TEMPLATE_CHOICES);
}
export function templateFrameIdentity(frame: TemplateFrame): string {
  const { bank, defaults } = frame.template;
  const { authority, setup, hindsight, replica } = frame.authority;
  // Observe only identity-bearing Core facts. Cursor, job and timestamp progress must not erase consent.
  const banks = setup.banks.map((entry) => [entry.externalBankId, entry.scope, entry.canonicalIdentity,
    entry.templateRevision, entry.templateDigest]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const generations = replica?.map((entry) => [entry.bankId, entry.checkpoint?.providerLineageId,
    entry.checkpoint?.bankGeneration]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return JSON.stringify([authority, setup.revision, setup.configFingerprint, setup.compatibility, banks, generations,
    hindsight?.connection.config, hindsight?.connection.drift, defaults, bank?.target,
    bank?.selected?.revision, bank?.latestUser?.revision, frame.template.plan?.planId]);
}
export function derivedNotice(value: MemoryTemplateDerivedObservation): string {
  if (value.state === "observed") return `本次读取：${TEMPLATE_CHILD_LABEL[value.result.state]}（${value.observedAt}）`;
  if (value.state === "stale") return value.reason === "quarantined" ? "原计划已隔离，当前生成状态不可用。" : "身份已变化，本次结果已丢弃。";
  return "当前生成状态读取失败或尚无结果；上次记录不能代替本次结果。";
}
