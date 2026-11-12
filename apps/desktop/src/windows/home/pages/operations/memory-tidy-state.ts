/**
 * INPUT: a Core-owned tidy operation and its bounded progress or final outcome.
 * OUTPUT: readable progress, result, and recovery guidance for the Operations tidy card.
 * POS: Home Operations presentation; it never derives execution success from transport state.
 */
import type { MemoryOperation, MemoryTidyOutcome, MemoryTidyProgress } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";
import { tidyFailureView } from "./operations-state.ts";

export interface MemoryTidyView {
  pending: boolean;
  tone: "ok" | "warn" | "danger";
  headline: string;
  detail: string | null;
  nextAction: string | null;
  buttonLabel: string;
  progress: LabeledRow[];
  issues: LabeledRow[];
  outcome: MemoryTidyOutcome | null;
}

export function memoryTidyView(operation: MemoryOperation): MemoryTidyView {
  const progress = operation.producer?.kind === "tidy" ? operation.producer.progress : null;
  const outcome = operation.result?.kind === "tidy" ? operation.result.outcome : null;
  const pending = operation.terminalAt === null;
  const base: MemoryTidyView = { pending, tone: "ok", headline: "正在整理记忆", detail: null,
    nextAction: null, buttonLabel: "立即整理", progress: progressRows(progress, outcome), issues: [], outcome };
  if (pending) return { ...base, headline: operation.state === "admitted" ? "整理已受理，正在处理中。" : "正在整理记忆。",
    progress: operation.state === "admitted" ? [] : base.progress,
    detail: "关闭页面不会中断整理；再次打开可查看已更新的进度。" };
  if (operation.state === "outcome_unknown") return { ...base, tone: "warn", headline: "整理已中断，完整结果尚未确认。",
    progress: hasProgress(progress) ? base.progress : [],
    detail: hasProgress(progress) ? "上方数量是中断前已确认的进度，不能代表整轮完成。已保存的改动仍会保留。"
      : "尚未取得可确认的执行进度，不能确定本次完成了多少工作。已保存的改动仍会保留。",
    nextAction: "可以重新整理；系统会检查当前记忆，不会重放中断前的工具调用。", buttonLabel: "重新整理" };
  if (outcome) return outcomeView(base, outcome);
  return { ...base, tone: "warn", headline: operation.state === "cancelled" ? "整理已取消。" : "整理未能完成。",
    detail: "当前没有完整的整理结果，已保存的改动仍会保留。",
    nextAction: "请先刷新状态；确认没有正在执行的整理后，可以重新整理。", buttonLabel: "重新整理" };
}

function hasProgress(progress: MemoryTidyProgress | null): boolean {
  return progress !== null && (progress.edits > 0 || progress.steps > 0 || progress.reviewed > 0 || progress.remaining !== null);
}

function outcomeView(base: MemoryTidyView, outcome: MemoryTidyOutcome): MemoryTidyView {
  const extra = [outcome.recoveredIssues ? `已纠正 ${outcome.recoveredIssues} 次调用` : null,
    outcome.skippedIssues ? `另有 ${outcome.skippedIssues} 项经检查无需执行` : null].filter(Boolean).join("；") || null;
  const completed = outcome.status === "clean" || outcome.status === "ran";
  const hasRemainingWork = outcome.nextAction === "continue" || (outcome.remaining ?? 0) > 0;
  if (completed) return { ...base,
    headline: outcome.status === "clean" ? "无需整理（未调用模型）"
      : `${hasRemainingWork ? "本轮整理完成" : "整理完成"}：已保存 ${outcome.edits} 处改动 / 已执行 ${outcome.steps} 步。`,
    detail: extra, nextAction: nextAction(outcome), buttonLabel: hasRemainingWork ? "继续整理" : "立即整理" };
  const failure = tidyFailureView({ ...outcome, kind: "memory-tidy", status: outcome.edits > 0 ? "partial" : "failed",
    reason: outcome.reason ?? "execution-failed", issues: outcome.issues ?? [], issueCount: outcome.issueCount ?? outcome.issues?.length ?? 0 });
  const reviewed = outcome.reviewed ?? 0;
  return { ...base, tone: outcome.edits > 0 || reviewed > 0 ? "warn" : "danger",
    headline: reviewed > 0 ? `部分完成：已检查 ${reviewed} 条记忆，已保留 ${outcome.edits} 处改动。` : failure.headline,
    detail: [failure.reason, outcome.issueCount ? failure.issueSummary : null, extra].filter(Boolean).join(" "), issues: failure.issues,
    nextAction: nextAction(outcome), buttonLabel: outcome.nextAction === "continue" ? "继续整理" : "重新整理" };
}

function progressRows(progress: MemoryTidyProgress | null, outcome: MemoryTidyOutcome | null): LabeledRow[] {
  if (!progress && !outcome) return [];
  const counts = outcome ?? progress;
  if (!counts) return [];
  return [
    { label: "已确认保存", value: `${counts.edits} 处改动` },
    { label: "已检查", value: counts.reviewed === undefined ? "未提供" : `${counts.reviewed} 条记忆` },
    { label: "待检查", value: counts.remaining === null || counts.remaining === undefined ? "尚未确定" : `${counts.remaining} 条记忆` },
    { label: "执行步数", value: String(counts.steps) },
  ];
}

function nextAction(outcome: MemoryTidyOutcome): string | null {
  if (outcome.reason === "input-too-large") return "请在设置中检查记忆整理输入预算与后台模型上下文容量，或检查过长的记忆内容，然后继续整理。";
  if (outcome.nextAction === "manual-retry") return "自动重试已暂停。请检查上方原因，处理后可手动重新整理；已保存的进度会保留。";
  if (outcome.nextAction === "check-settings") return "请在设置中检查后台模型配置与连接，然后重新整理。";
  if (outcome.retryAt) return `系统可在 ${new Date(outcome.retryAt).toLocaleString("zh-CN")} 后的后台维护中重试，也可手动重新整理。`;
  if (outcome.nextAction === "continue" || (outcome.remaining ?? 0) > 0) return "仍有记忆待检查，可以继续整理；已完成的检查进度会保留。";
  if (outcome.nextAction === "retry" || outcome.status === "partial" || outcome.status === "failed") {
    return "请重新整理；系统会从当前记忆状态继续检查，已保存的改动会保留。";
  }
  return null;
}
