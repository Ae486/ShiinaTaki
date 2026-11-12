/**
 * INPUT: retained child result groups, linked parent synthesis and canonical delivery status
 * OUTPUT: separate child outcome, parent decision and actual delivery explanations
 * POS: ui/subagents — result inspection; recording and inference never imply publication
 */
import type { SubagentResultView } from "@taki/shared";
import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton.js";
import { COMPLETION_STATE, COMPLETION_REASON, PARENT_DECISION, RUN_STATE, deliveryLabel } from "./subagent-labels.ts";

const MarkdownView = lazy(() => import("@/windows/home/pages/chat/markdown-view.js").then((module) => ({ default: module.MarkdownView })));
function ResultText({ text }: { text: string }) {
  return <Suspense fallback={<Skeleton lines={2} />}><MarkdownView text={text} /></Suspense>;
}

export function SubagentResults({ results }: { results: SubagentResultView[] }) {
  return <section className="space-y-3" aria-label="子代理结果与主助手处理">
    <h3 className="text-sm font-semibold text-text-body">工作结果</h3>
    {results.length === 0 && <p className="text-xs text-text-secondary">这项工作还没有已结算的结果。</p>}
    {results.map((view) => <ResultCard key={view.result.completionId} view={view} />)}
  </section>;
}

function ResultCard({ view }: { view: SubagentResultView }) {
  const { result } = view;
  return <article className="space-y-3 rounded-xl border border-border bg-surface p-4">
    <div className="flex flex-wrap justify-between gap-2 text-xs">
      <h4 className="font-semibold text-text-strong">子代理 · {RUN_STATE[result.child.outcome] ?? "结果未知"}</h4>
      <span className="text-text-secondary">{result.child.currentness === "superseded" ? "已被后续修正替代" : "保留的工作结果"}</span>
    </div>
    {result.child.body ? <ResultText text={result.child.body} /> : <p className="text-xs text-text-secondary">此执行没有保留文本结论。</p>}
    <p className="text-xs text-text-secondary">{COMPLETION_STATE[result.completionState]}
      {result.completionReason ? ` · ${COMPLETION_REASON[result.completionReason]}` : ""}</p>
    {result.parent && <section className="space-y-2 border-t border-border pt-3" aria-label="关联的主助手处理">
      <h4 className="text-xs font-semibold text-text-strong">主助手 · {PARENT_DECISION[result.parent.decision]} · {RUN_STATE[result.parent.outcome] ?? "结果未知"}</h4>
      {result.parent.body && <ResultText text={result.parent.body} />}
      {result.parent.reason && <p className="text-xs text-text-secondary">{result.parent.reason}</p>}
    </section>}
    <p className="text-xs text-text-secondary">{deliveryLabel(view)}</p>
    {result.publication?.reason && <p className="text-xs text-text-secondary">{result.publication.reason}</p>}
    <details className="text-xs text-text-faint"><summary className="cursor-pointer">执行关联</summary>
      <p className="mt-1 break-all">子执行：{result.child.runId}</p>
      {result.parentRunId && <p className="break-all">主助手执行：{result.parentRunId}</p>}
    </details>
  </article>;
}
