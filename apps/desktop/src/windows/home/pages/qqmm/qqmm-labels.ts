/**
 * INPUT: semantic QQMM records, monitor status and epoch timestamps.
 * OUTPUT: concise Chinese presentation labels without protocol or transport identifiers.
 * POS: Home QQ messages — presentation only; authored message text is never rewritten.
 */

import type { Conversation, HistoryRecord, MonitorSnapshot, Severity } from "@qqmm/management-client";
import { toolOperation } from "./qqmm-tool-labels.ts";

export const SEVERITY_LABELS: Record<Severity, string> = { info: "信息", warn: "警告", error: "错误" };
export const SEVERITY_TONES: Record<Severity, string> = { info: "text-text-secondary", warn: "text-warn-strong", error: "text-danger-strong" };

export function formatTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
}

export function formatDate(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);
}

export function conversationLabel(record: Pick<HistoryRecord, "conversationName" | "conversationType" | "conversationId">): string {
  if (record.conversationName) return record.conversationName;
  const fallback = record.conversationType === "group" ? "未命名群聊" : "未命名私聊";
  return record.conversationId ? `${fallback}（${record.conversationId}）` : fallback;
}

export function conversationChoiceLabel(conversation: Conversation, choices: readonly Conversation[]): string {
  const kind = conversation.conversationType === "group" ? "群聊" : "私聊";
  const duplicate = conversation.conversationName && choices.some((item) => item.conversationRef !== conversation.conversationRef
    && item.conversationType === conversation.conversationType && item.conversationName === conversation.conversationName);
  // QQ numbers identify a real conversation; opaque storage references never become labels.
  return `${kind} · ${conversationLabel(conversation)}${duplicate ? `（${conversation.conversationId}）` : ""}`;
}

export function recordContext(record: HistoryRecord): string {
  if (record.kind === "runtime") return "运行记录";
  if (record.kind === "summary") return `${conversationLabel(record)} · 摘要`;
  if (record.toolResult) {
    const scope = record.conversationType ? conversationLabel(record) : record.toolResult.conversationCount > 1 ? `涉及 ${record.toolResult.conversationCount} 个会话` : "监控服务";
    return `${scope} · ${toolOperation(record.toolResult)}`;
  }
  return `${conversationLabel(record)} · ${record.senderName || (record.direction === "out" ? "自己" : "未命名成员")}`;
}

export function captureLabel(monitor: MonitorSnapshot): string {
  const labels: Record<string, string> = {
    running: "正在采集", active: "正在采集", stopped: "采集已停止", starting: "正在启动采集", stopping: "正在停止采集",
    failed: "采集异常", dormant: "等待采集连接", connecting: "正在连接采集端", verifying: "正在确认采集账号",
    login_required: "采集账号需要登录", restarting: "正在重启采集", blocked: "采集需要处理", closing: "正在关闭采集", closed: "采集已关闭",
  };
  return labels[monitor.captureState] ?? "采集状态待确认";
}

export function toLocalInput(value: number | undefined): string {
  if (value === undefined) return "";
  const date = new Date(value);
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
