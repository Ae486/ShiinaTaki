/**
 * INPUT: an immutable displayed proposal, latest server state and explicit confirm/refresh/close actions.
 * OUTPUT: exact-revision review dialog with semantic differences and stale-review refusal.
 * POS: Pattern domain confirmation; closing is local only and grants no permission.
 */
import type { ReactNode } from "react";
import type { InteractionPatternView } from "@taki/shared";
import { Dialog } from "@/components/ui/dialog.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { PatternDefinitionView } from "./pattern-definition-view.tsx";
import { describeOrigin, readablePatternDate } from "./pattern-labels.ts";

type ReviewProps = {
  reviewed: InteractionPatternView;
  latest: InteractionPatternView | null;
  available: boolean;
  policy: ReactNode;
  actions: { close(): void; useLatest(): void; confirm(): void };
  feedback?: ReactNode;
};

export function PatternReview({ reviewed, latest, available, policy, actions, feedback }: ReviewProps) {
  const revision = reviewed.candidateRevision;
  if (!revision) return null;
  const changed = latest?.version !== reviewed.version || latest?.candidateRevision?.revisionId !== revision.revisionId;
  return <Dialog open onClose={actions.close} ariaLabel="确认互动提案" size="lg">
    <h2 className="pr-6 text-base font-semibold">确认互动提案</h2>
    <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-3">
      <p className="text-xs text-text-secondary">来源：{describeOrigin(revision.origin)} · 提案时间：{readablePatternDate(revision.createdAt, "未知")}</p>
      <PatternDefinitionView definition={revision.definition} previous={reviewed.effectiveRevision?.definition} />
      {policy}
      <p className="text-xs text-text-secondary">符合条件时仍会检查安静时段、忙碌状态、信息有效性与全局上限；允许说话也可能保持安静。</p>
      {changed && <FeedbackLine tone="warn">这份提案的当前状态已变化，不能确认旧内容。请重新阅读最新提案。</FeedbackLine>}
      {feedback}
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton onClick={actions.close}>暂不确认</ActionButton>
        {changed && latest?.candidateRevision && <ActionButton onClick={actions.useLatest}>查看更新后的提案</ActionButton>}
        <ActionButton tone="primary" disabled={!available || changed || latest?.state === "retired"} onClick={actions.confirm}>{reviewed.state === "paused" ? "确认这份修改（保持暂停）" : "确认这份提案并生效"}</ActionButton>
      </div>
    </div>
  </Dialog>;
}
