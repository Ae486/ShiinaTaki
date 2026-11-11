/**
 * INPUT:  labelled Core review facts and a persistent historical catch-up identity
 * OUTPUT: the Bank's policy review rows and an inline catch-up record that survives fresh reads
 * POS:    Home presentation — existing row/feedback primitives, no timers or local persistence
 */
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { LabeledRows } from "../../page-card.tsx";
import type { MemoryPolicyReviewView } from "./memory-policy-review-state.ts";

export function MemoryPolicyReviewBlock({ review }: { review: MemoryPolicyReviewView }) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs font-semibold text-text-strong">策略巡检</p>
      <LabeledRows rows={review.rows} />
      {review.catchUpOccurrenceId && (
        <div key={review.catchUpOccurrenceId} data-catch-up-occurrence={review.catchUpOccurrenceId}>
          <FeedbackLine tone="info">Core 已记录一次补跑；此记录会保留。当前进度以上方巡检状态为准。</FeedbackLine>
        </div>
      )}
    </div>
  );
}
