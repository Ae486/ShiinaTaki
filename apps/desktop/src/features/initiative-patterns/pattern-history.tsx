/**
 * INPUT: Core immutable history and current Pattern with explicit rollback-as-proposal action.
 * OUTPUT: readable revision history, accepted/candidate provenance and review-required rollback.
 * POS: Desktop history presentation; historical IDs and counters remain callback bindings only.
 */
import type { InteractionPatternHistoryResult, InteractionPatternView } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { PatternDefinitionView } from "./pattern-definition-view.tsx";
import { describeOrigin, readablePatternDate } from "./pattern-labels.ts";

export function PatternHistory(props: {
  pattern: InteractionPatternView;
  history: InteractionPatternHistoryResult;
  disabled: boolean;
  rollback(revisionId: string): void;
  loadMore(): void;
}) {
  return <section className="space-y-3">
    <h3 className="text-sm font-semibold">修改历史</h3>
    {props.history.revisions.length === 0 && <p className="text-xs text-text-secondary">暂无历史内容。</p>}
    {props.history.revisions.map((revision) => <details key={revision.revisionId} className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm">{revision.definition.title} · {revision.acceptedAt ? "已确认" : "未确认"} · {readablePatternDate(revision.createdAt, "未知")}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-text-secondary">来源：{describeOrigin(revision.origin)}</p>
        <PatternDefinitionView definition={revision.definition} />
        {revision.acceptedAt && props.pattern.state !== "retired" && <ActionButton disabled={props.disabled} onClick={() => props.rollback(revision.revisionId)}>以此内容创建新提案</ActionButton>}
      </div>
    </details>)}
    {props.history.nextBefore !== null && <ActionButton disabled={props.disabled} onClick={props.loadMore}>加载更早修改</ActionButton>}
  </section>;
}
