/**
 * INPUT: captured summary facts and recorded-source metadata from QQMM.
 * OUTPUT: readable stage, source provenance and coverage labels.
 * POS: Home QQ history presentation; no current configuration or opaque keys.
 */

import type { HistorySummary, SummarySource } from "@qqmm/management-client";
import { formatDate } from "./qqmm-labels.ts";

export function summaryStatus(summary: HistorySummary): string {
  const labels = { queued: "待生成", running: "正在生成", completed: "已完成", failed: "生成失败" };
  const stage = labels[summary.status];
  return summary.timeBasis === "observed_time" ? `记录时${stage}` : stage;
}

export function summaryNotes(summary: HistorySummary): string[] {
  const notes = [`原始消息 ${summary.sourceCount} 条`, `${formatDate(summary.sourceFrom)} 至 ${formatDate(summary.sourceTo)}`];
  if (summary.context === "automatic_retry") notes.push("自动重试");
  if (summary.context === "recovery") notes.push("重启后恢复");
  if (summary.context === "existing_state") notes.push("补录的历史状态");
  if (summary.timeBasis === "observed_time") notes.push("原阶段时间不可用，显示记录时间");
  if (summary.containsRecalled) notes.push("当时包含已撤回消息");
  if (summary.failureCount) notes.push(`已记录 ${summary.failureCount} 次失败`);
  if (summary.failureReason) notes.push(summary.failureReason);
  return notes;
}

export function sourceLabel(source: SummarySource): string {
  const sender = source.senderName || source.senderUin || (source.direction === "out" ? "自己" : "发送者未知");
  return `${source.timestamp === null ? "时间未知" : formatDate(source.timestamp)} · ${sender}${source.recalled === true ? " · 已撤回" : ""}`;
}

export function sourceProvenance(source: SummarySource): string {
  if (source.availability === "unavailable") return source.reason === "source_membership_unavailable"
    ? "来源关联已不可用，无法读取原文。" : "未保留这条来源的原文。";
  return source.snapshotStatus === "legacy_available" ? "历史可用原文（非到达时快照）" : "当时记录的原文";
}
