/**
 * INPUT:  closed observability wire values, connection states, and recorded display timestamps
 * OUTPUT: Chinese system labels and filter options; unknown system values never expose raw identifiers
 * POS:    ui/monitor — wire vocabulary delegates to Shared; actual provider/model/tool names bypass this mapper
 */
import { RunInitiatorSchema, RunStateSchema, observabilityLabel } from "@taki/shared";
import type { MonitorMode, RunInitiator, RunMonitorSummary, RunState } from "@taki/shared";

/** Wire values the shared map does not cover yet; checked before it (D68 absorbs these). */
const SUPPLEMENT: Record<string, string> = {
  host: "宿主调用",
  mcp: "MCP 调用",
};

export function wireLabel(value: string): string {
  const label = SUPPLEMENT[value] ?? observabilityLabel(value);
  return label === value ? "未知" : label;
}

export const INITIATOR_OPTIONS: ReadonlyArray<readonly [RunInitiator, string]> =
  RunInitiatorSchema.options.map((value) => [value, wireLabel(value)] as const);
export const STATE_OPTIONS: ReadonlyArray<readonly [RunState, string]> =
  RunStateSchema.options.map((value) => [value, wireLabel(value)] as const);

export const RUN_GROUP_LABEL = "运行";
export const ATTEMPT_GROUP_LABEL = "尝试";

export function attemptGroupLabel(ordinal: number): string {
  return `${ATTEMPT_GROUP_LABEL} ${ordinal}`;
}

const CONNECTION_KINDS: Record<string, string> = {
  connecting: "连接中",
  reconnecting: "重连中",
  connected: "已连接",
  "pairing-required": "待配对",
  disconnected: "已断开",
  error: "连接错误",
};

export function connectionKindLabel(kind: string): string {
  return CONNECTION_KINDS[kind] ?? "连接状态未知";
}

const MODE_LABELS: Record<MonitorMode, string> = { DISABLED: "已关闭", FEEDBACK_ONLY: "仅反馈", FULL_LOCAL: "本地详情" };
export function monitorModeLabel(mode: MonitorMode): string { return MODE_LABELS[mode]; }

export function formatRunTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    : "时间未提供";
}

export function runMetricsLabel(run: RunMonitorSummary): string {
  const facts = [`${run.modelRequestCount} 次请求`, `${run.toolCallCount} 次工具调用`, `${run.toolResultCount} 条工具结果`];
  if (run.failureCount > 0) facts.push(`异常 ${run.failureCount}`);
  if (run.retryCount > 0) facts.push(`重试 ${run.retryCount}`);
  facts.push(run.usage.totalTokens !== undefined
    ? `${run.usage.totalTokens.toLocaleString("zh-CN")} 令牌（${wireLabel(run.usage.quality ?? "unknown")}）`
    : "用量总数未知");
  return facts.join(" · ");
}
