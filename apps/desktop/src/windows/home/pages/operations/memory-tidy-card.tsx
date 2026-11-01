/**
 * INPUT: the explicit tidy attempt's result, failure details, pending state and retry action.
 * OUTPUT: the Memory tidy card with retained partial-work counts and separate request/refresh diagnostics.
 * POS: Home Operations presentation only; closed Chinese labels never expose tool codes or memory identities.
 */
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert } from "../../page-chrome.tsx";
import { tidyDefectRows, tidyFailureView } from "./operations-state.ts";
import type { MemoryTidyState } from "./memory-tidy-controller.ts";

export interface MemoryTidyCardProps extends MemoryTidyState {
  connectionReady: boolean;
  runTidy(): Promise<void>;
}

export function MemoryTidyCard(props: MemoryTidyCardProps) {
  const failure = props.tidyFailure ? tidyFailureView(props.tidyFailure) : null;
  const result = props.tidyFailure ?? props.tidy;
  return (
    <PageCard title="记忆整理">
      <ActionButton tone="primary" busy={props.tidying} onClick={() => void props.runTidy()} disabled={!props.connectionReady || props.tidying}>
        立即整理
      </ActionButton>
      <div className="mt-3 flex flex-col gap-2">
        {props.error && <PageAlert>整理请求失败：{props.error}</PageAlert>}
        {failure && (
          <>
            <FeedbackLine tone={props.tidyFailure?.status === "partial" ? "warn" : "danger"}>{failure.headline}</FeedbackLine>
            <p className="text-xs text-text-body">{failure.reason}</p>
            <p className="text-xs text-text-secondary">{failure.issueSummary}</p>
            <LabeledRows rows={failure.issues} />
          </>
        )}
        {!failure && props.tidy && (
          <p className="text-xs text-text-body">
            {props.tidy.status === "clean" ? "无需整理（未调用模型）" : `已整理：${props.tidy.edits} 处改动 / ${props.tidy.steps} 步`}
          </p>
        )}
        {result && <><p className="text-xs text-text-secondary">检查时发现的问题</p><LabeledRows rows={tidyDefectRows(result)} /></>}
        {props.refreshError && <PageAlert>{props.refreshError}</PageAlert>}
      </div>
    </PageCard>
  );
}
