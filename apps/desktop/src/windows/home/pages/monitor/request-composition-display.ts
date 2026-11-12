/**
 * INPUT: Core's exclusive raw category estimates and captured latest-request facts.
 * OUTPUT: fixed presentation groups and honest input occupancy labels, never provider-total repartition.
 * POS: ui/monitor — display-only mapping; source attribution, measurement and window authority remain in Core.
 */
import type { LatestPrimaryRequestSnapshot, RequestComposition } from "@taki/shared";

type Category = keyof RequestComposition["categories"];
export type CompositionDisplayGroup = { key: Category; label: string; categories: readonly Category[] };
export const COMPOSITION_DISPLAY_GROUPS: readonly CompositionDisplayGroup[] = [
  { key: "instructions", label: "指令", categories: ["instructions"] },
  { key: "persona", label: "角色设定", categories: ["persona"] },
  { key: "injected_memory", label: "注入记忆", categories: ["injected_memory"] },
  { key: "runtime_context", label: "运行上下文", categories: ["runtime_context"] },
  { key: "summary", label: "摘要", categories: ["summary"] },
  { key: "conversation", label: "对话", categories: ["conversation"] },
  { key: "tool_definitions", label: "工具定义", categories: ["tool_definitions"] },
  { key: "tool_interactions", label: "工具交互", categories: ["tool_interactions"] },
  { key: "other", label: "其他", categories: ["other"] },
];

export function compositionDisplayRows(composition: RequestComposition, groups = COMPOSITION_DISPLAY_GROUPS) {
  return groups.map((group) => {
    const units = group.categories.reduce((sum, category) => sum + composition.categories[category], 0);
    const ratio = composition.totalUnits > 0 ? units / composition.totalUnits : null;
    return { ...group, units, ratio };
  });
}

export function requestOccupancy(request: LatestPrimaryRequestSnapshot["request"]) {
  if (!request) return { value: "--", ratio: null, basis: "输入用量与窗口未知", estimated: false };
  if (request.inputTokens !== null) {
    const ratio = request.window ? request.inputTokens / request.window.effectiveRealTokens : null;
    return { value: `${formatCount(request.inputTokens)} / ${request.window ? formatCount(request.window.effectiveRealTokens) : "--"}`,
      ratio, basis: request.window ? "上游报告输入 / 有效窗口 · tokens" : "上游报告输入 · 有效窗口未知", estimated: false };
  }
  if (request.composition && request.window) {
    return { value: `${formatCount(request.composition.totalUnits)} / ${formatCount(request.window.estimatorWindowUnits)}`,
      ratio: request.composition.totalUnits / request.window.estimatorWindowUnits,
      basis: "估算输入 / 估算窗口 · 单位", estimated: true };
  }
  return { value: "--", ratio: null, basis: "上游输入用量未知", estimated: false };
}

export function formatCount(value: number): string { return value.toLocaleString("zh-CN"); }
export function formatPercent(value: number | null): string { return value === null ? "--" : `${(value * 100).toFixed(1)}%`; }

export function latestRequestStatus(snapshot: LatestPrimaryRequestSnapshot | null): string {
  if (!snapshot) return "当前 Core 未提供请求组成";
  if (snapshot.status === "empty") return "暂无已完成的主对话请求";
  switch (snapshot.reason) {
    case "measurement-missing": return "该请求的组成或窗口未记录";
    case "usage-missing": return "上游输入用量未知 · 占用仅供估算";
    case "data-inconsistent": return "请求统计数据不一致";
    case "scan-exhausted": return "请求统计读取范围不足";
    case "read-failed": return "请求统计读取失败";
    case "monitor-disabled": return "运行监视未启用";
    default: return "";
  }
}
