/**
 * INPUT: immutable, validated tool-result metadata from the shared client.
 * OUTPUT: Chinese operation, effective scope, outcome and occurrence-count labels.
 * POS: Home QQ messages presentation; no source lookup or delivery inference.
 */
import type { HistoryToolResult } from "@qqmm/management-client";

export function toolOperation(result: HistoryToolResult): string {
  return { status: "查看监控状态", feed: "获取会话动态", read: "读取会话内容", mark_read: "标记本地已读" }[result.operation];
}

export function toolOutcome(result: HistoryToolResult): string {
  if (result.outcome === "error") return "执行失败";
  if (result.operation === "mark_read") return result.outcome === "empty" ? "本次无需标记" : "已完成本地标记";
  return result.outcome === "empty" ? "无返回条目" : "已生成结果";
}

export function toolNotes(result: HistoryToolResult): readonly string[] {
  const scopes = { unread: "未读范围", recent: "最近内容", after_cursor: "从指定位置继续", reference: "指定内容" };
  const targets = { conversation: "指定会话", summary: "指定摘要", finding: "指定摘要分项", message: "指定消息及上下文" };
  const views = { auto: "自动选择内容", summaries: "摘要", messages: "消息", both: "消息与摘要" };
  const progress = { feed_advanced: "动态读取进度已推进", read_advanced: "本地会话已读进度已推进", unchanged: "读取进度未改变" };
  const effective = [result.scope && scopes[result.scope], result.referenceTarget && targets[result.referenceTarget], result.view && views[result.view]].filter(Boolean).join(" · ");
  return [
    effective || (result.outcome === "error" ? "未确定有效读取范围" : result.operation === "status" ? "监控服务状态" : result.operation === "feed" ? "会话动态" : "本地已读标记"),
    `涉及 ${result.conversationCount} 个会话 · 返回条目 ${result.itemCount} 项`,
    `返回次数：消息 ${result.messageCount} · 摘要 ${result.summaryCount} · 分项 ${result.findingCount} · 缺口 ${result.gapCount}`,
    progress[result.progress],
    ...(result.hasMore === null ? [] : [result.hasMore ? "本次结果之后还有内容" : "本次读取已到末尾"]),
    "本次生成的工具返回内容",
  ];
}
