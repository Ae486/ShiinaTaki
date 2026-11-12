/**
 * INPUT: one coherently selected Pattern/history and its domain actions.
 * OUTPUT: current definition, candidate review, lifecycle controls and immutable history.
 * POS: Home management detail; refresh leaves the selected entity's reading subtree mounted.
 */
import type { ReactNode } from "react";
import type { InteractionPatternView } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { PageCard } from "../../page-card.tsx";
import { PatternCandidateCard } from "@/features/initiative-patterns/pattern-candidate-card.js";
import { PatternDefinitionView } from "@/features/initiative-patterns/pattern-definition-view.js";
import { PatternHistory } from "@/features/initiative-patterns/pattern-history.js";
import { PatternLifecycle } from "@/features/initiative-patterns/pattern-lifecycle.js";
import { PATTERN_STATES } from "@/features/initiative-patterns/pattern-labels.js";
import type { usePatterns } from "@/features/initiative-patterns/use-patterns.js";

export function PatternDetail({ patterns, policy, edit }: { patterns: ReturnType<typeof usePatterns>; policy: ReactNode; edit(pattern: InteractionPatternView): void }) {
  const detail = patterns.state.detail;
  const row = detail?.pattern;
  if (!detail) return <p className="text-xs text-text-secondary">选择一条互动规则查看详细内容。</p>;
  if (!row) return <FeedbackLine tone="warn">所选互动规则已不存在。请选择另一条规则。</FeedbackLine>;
  const disabled = !patterns.available || patterns.state.detailLoading || patterns.state.detailError !== null
    || patterns.state.requestedId !== patterns.state.selectedId;
  const feedback = patterns.state.feedback && <FeedbackLine tone={patterns.state.feedback.tone}>{patterns.state.feedback.message}</FeedbackLine>;
  return <PageCard title={PATTERN_STATES[row.state]}>
    <div className="space-y-4">
      {row.candidateRevision && <PatternCandidateCard pattern={row} available={!disabled} confirm={(reviewed) => patterns.controller.confirm(reviewed)} policy={policy} feedback={feedback} />}
      {row.effectiveRevision && <section className="space-y-3"><h3 className="text-sm font-semibold">已确认内容</h3>
        <PatternDefinitionView definition={row.effectiveRevision.definition} />
      </section>}
      <PatternLifecycle pattern={row} disabled={disabled} edit={() => edit(row)} changeState={(action) => patterns.controller.changeState(row, action)} />
      <PatternHistory pattern={row} history={detail.history} disabled={disabled} rollback={(revisionId) => void patterns.controller.rollback(row, revisionId)} loadMore={() => patterns.controller.loadMoreHistory()} />
    </div>
  </PageCard>;
}
