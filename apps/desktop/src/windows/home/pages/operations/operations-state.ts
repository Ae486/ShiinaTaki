/**
 * INPUT:  memory.tidy success/failure details, memory.status / media.usage results and destructive-clear events.
 * OUTPUT: pure view models — tidyDefectRows / statusRows / formatBytes — and the media.clear confirm state machine
 *         (clearPhaseAfter), which is what keeps a single click from purging attachments.
 * POS:    ui/windows/home/pages/operations — the node-testable core of the operations page (no DOM, no socket).
 */

import type { MemoryErrorCode, MemoryStatusResult, MemoryTidyFailureDetails, MemoryTidyIssue, MemoryTidyResult } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";

const DEFECT_LABELS: Record<keyof MemoryTidyResult["defects"], string> = {
  missingDisclosure: "缺披露语",
  overBudget: "超预算",
  stale: "长期未召回",
  nearDuplicate: "近重复",
  misfiled: "归档错层",
};

export function tidyDefectRows(result: Pick<MemoryTidyResult, "defects">): LabeledRow[] {
  return (Object.keys(DEFECT_LABELS) as (keyof typeof DEFECT_LABELS)[]).map((key) => ({
    label: DEFECT_LABELS[key],
    value: String(result.defects[key]),
  }));
}

const TIDY_REASON_LABELS: Record<MemoryTidyFailureDetails["reason"], string> = {
  "tool-errors": "仍有整理操作未能完成。",
  "execution-failed": "整理执行失败，未能完成本次任务。",
  "review-stale": "整理依据已发生变化，未能确认完成。",
  unfinished: "整理流程未完成最终确认。",
};
const TIDY_TOOL_LABELS: Record<MemoryTidyIssue["toolName"], string> = {
  memory_reinforce: "强化记忆", memory_archive_supersede: "归档或替换记忆", memory_set_disclosure: "调整披露语",
  memory_refile: "调整记忆归属", block_rethink: "更新记忆卡片", memory_finish_edits: "确认整理完成", unknown: "整理操作",
};
const TIDY_ERROR_LABELS: Record<MemoryErrorCode, string> = {
  MEMORY_INVALID_REQUEST: "操作内容无效", MEMORY_NOT_FOUND: "目标记忆不存在", MEMORY_REQUEST_ID_CONFLICT: "操作标识发生冲突",
  MEMORY_REVISION_MISMATCH: "记忆版本已变化", MEMORY_CAPABILITY_UNSUPPORTED: "当前存储不支持此操作",
  MEMORY_AUTHORITY_MISMATCH: "记忆存储已切换", MEMORY_OPERATION_CANCELLED: "操作已取消", MEMORY_OUTCOME_UNKNOWN: "操作结果尚未确认",
  MEMORY_PROVIDER_UNAVAILABLE: "记忆服务暂不可用", MEMORY_INTEGRITY_ERROR: "记忆完整性校验失败", MEMORY_INTERNAL_ERROR: "内部处理失败",
};

export function tidyFailureView(failure: MemoryTidyFailureDetails) {
  return {
    headline: failure.status === "partial"
      ? `部分完成：已保留 ${failure.edits} 处改动 / 已执行 ${failure.steps} 步；本次整理未完成。`
      : `整理失败：未提交改动 / 已执行 ${failure.steps} 步。`,
    reason: TIDY_REASON_LABELS[failure.reason],
    issueSummary: `未解决工具操作：${failure.issueCount} 项${failure.issueCount > failure.issues.length ? `（显示 ${failure.issues.length} 项）` : ""}`,
    issues: failure.issues.map((issue, index) => ({
      id: String(index), label: TIDY_TOOL_LABELS[issue.toolName], value: TIDY_ERROR_LABELS[issue.code],
    })),
  };
}

/** The memory.status card, flattened for rendering. Counts only — the schema itself carries no memory content. */
export function statusRows(status: MemoryStatusResult): LabeledRow[] {
  const slots = status.windowSlots.map((slot) => ({
    label: `窗口校准 · ${slot.slot}`,
    value: `${slot.effectiveWindow} tokens（系数 ${slot.factor.toFixed(2)}）`,
  }));
  return [
    ...slots,
    {
      label: "对话摘要",
      value: status.summary ? `已覆盖到 seq ${status.summary.throughSeq}（${status.summary.textChars} 字）` : "尚未压缩",
    },
    { label: "情节记忆水位", value: `seq ${status.auto.lastEpisodicSeq}` },
    { label: "记忆落盘水位", value: `seq ${status.auto.lastFlushSeq}` },
    { label: "上次整理", value: status.auto.lastTidyAt ?? "从未" },
  ];
}

const UNITS = ["B", "KB", "MB", "GB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}

/** idle → confirming → clearing → idle. A purge can ONLY be issued from `confirming` (destructive-action guard). */
export type ClearPhase = "idle" | "confirming" | "clearing";
export type ClearEvent = "request" | "cancel" | "confirm" | "settled";

export function clearPhaseAfter(phase: ClearPhase, event: ClearEvent): ClearPhase {
  if (event === "settled") return "idle";
  if (event === "cancel") return phase === "clearing" ? phase : "idle";
  if (event === "request") return phase === "idle" ? "confirming" : phase;
  return phase === "confirming" ? "clearing" : phase; // confirm outside the confirm step is a no-op, never a purge
}
