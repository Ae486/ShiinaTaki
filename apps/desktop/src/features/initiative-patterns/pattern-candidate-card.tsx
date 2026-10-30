/**
 * INPUT: current candidate, shared action readiness and explicit confirm callback.
 * OUTPUT: compact candidate entry opening an immutable readable review with focus restoration.
 * POS: reusable Chat/management card; local review state survives ordinary invalidations.
 */
import { useCallback, useState, type ReactNode } from "react";
import type { InteractionPatternView } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { PatternReview } from "./pattern-review.tsx";
import { describeCondition } from "./pattern-labels.ts";

export function PatternCandidateCard(props: {
  pattern: InteractionPatternView;
  available: boolean;
  confirm(pattern: InteractionPatternView): Promise<boolean>;
  policy: ReactNode;
  feedback?: ReactNode;
}) {
  const [reviewed, setReviewed] = useState<InteractionPatternView | null>(null);
  const close = useCallback(() => setReviewed(null), []);
  const candidate = props.pattern.candidateRevision;
  if (!candidate) return null;
  const confirm = async () => { if (reviewed && await props.confirm(reviewed)) close(); };
  return <section className="space-y-2 rounded-xl border border-accent-border bg-surface p-4 shadow-card" aria-label="待确认的互动提案">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs text-accent-text">待确认的互动提案</p><h3 className="mt-1 text-sm font-semibold">{candidate.definition.title}</h3></div>
      <ActionButton disabled={!props.available} onClick={() => setReviewed(props.pattern)}>查看并确认</ActionButton>
    </div>
    <p className="whitespace-pre-wrap text-sm">{candidate.definition.purpose}</p>
    <p className="text-xs text-text-secondary">{candidate.definition.conditions.all.map(describeCondition).join("；")}</p>
    {reviewed && <PatternReview reviewed={reviewed} latest={props.pattern} available={props.available} policy={props.policy} feedback={props.feedback}
      actions={{ close, useLatest: () => setReviewed(props.pattern), confirm: () => void confirm() }} />}
  </section>;
}
