/**
 * INPUT:  memory.tidy / memory.status / media.usage results + the destructive-clear interaction events.
 * OUTPUT: pure view models — tidyDefectRows / statusRows / formatBytes — and the media.clear confirm state machine
 *         (clearPhaseAfter), which is what keeps a single click from purging attachments.
 * POS:    ui/windows/home/pages/operations — the node-testable core of the operations page (no DOM, no socket).
 */

import type { MemoryStatusResult, MemoryTidyResult } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";

const DEFECT_LABELS: Record<keyof MemoryTidyResult["defects"], string> = {
  missingDisclosure: "缺披露语",
  overBudget: "超预算",
  stale: "长期未召回",
  nearDuplicate: "近重复",
  misfiled: "归档错层",
};

export function tidyDefectRows(result: MemoryTidyResult): LabeledRow[] {
  return (Object.keys(DEFECT_LABELS) as (keyof typeof DEFECT_LABELS)[]).map((key) => ({
    label: DEFECT_LABELS[key],
    value: String(result.defects[key]),
  }));
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
