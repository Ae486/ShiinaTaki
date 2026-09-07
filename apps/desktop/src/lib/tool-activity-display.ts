/**
 * INPUT:  captured tool labels and truthful activity phases/outcomes
 * OUTPUT: shared Chinese Chat/Pet labels and whether a confirmed live phase may show a busy indicator
 * POS:    ui/lib — presentation vocabulary only; canonical tool routing keys never become visible fallbacks
 */
import { getKnownToolDisplayName, getValidToolDisplayName, type ChatActivityToolStatus } from "@taki/shared";

export function activityToolLabel(toolName: string, displayName?: string): string {
  return getValidToolDisplayName(displayName) ?? getKnownToolDisplayName(toolName) ?? "工具调用";
}

export function activityToolStatus(status: ChatActivityToolStatus, stale = false): { label: string; busy: boolean; tone: string } {
  if (status.phase === "settled") {
    const labels = { completed: "已完成", failed: "失败", cancelled: "已取消", outcome_unknown: "结果未确认" };
    const tones = { completed: "text-ok", failed: "text-danger", cancelled: "text-text-secondary", outcome_unknown: "text-warn" };
    return { label: labels[status.outcome], busy: false, tone: tones[status.outcome] };
  }
  if (stale) return { label: "状态待恢复", busy: false, tone: "text-text-secondary" };
  const labels = { received: "等待处理", processing: "处理中", approval: "等待确认", executing: "执行中" };
  return { label: labels[status.phase], busy: status.phase === "processing" || status.phase === "executing",
    tone: status.phase === "approval" ? "text-warn" : "text-text-secondary" };
}
