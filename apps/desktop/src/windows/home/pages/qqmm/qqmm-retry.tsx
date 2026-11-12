/**
 * INPUT: selected retained summary and the shared provider-checked retry view.
 * OUTPUT: explicit retry admission and durable attempt/wait/outcome presentation.
 * POS: Home QQ detail footer; captured failure alone never enables a mutation.
 */
import { useEffect } from "react";
import type { ManagementController, ManagementState } from "@qqmm/management-client";
import { ActionButton } from "../../action-button.tsx";
import { retryLines, retryReason } from "./qqmm-management-labels.ts";

type RetryProps = { state: ManagementState; controller: ManagementController };
export function QqmmRetry({ state, controller }: RetryProps) {
  const record = state.detail?.record;
  const summaryId = record?.kind === "summary" ? record.recordId : null;
  useEffect(() => { if (summaryId !== null) void controller.inspectRetry(); }, [controller, summaryId]);
  if (!summaryId) return null;
  const retry = state.retry;
  const disabled = state.connection !== "connected" || retry.loading || retry.status === "requesting" || retry.status === "outcome_unknown";
  return <section aria-label="摘要重试" className="grid shrink-0 gap-2 border-t border-border pt-3 text-xs text-text-secondary">
    {retry.loading && <p role="status">正在检查重试条件…</p>}
    {retry.request ? retryLines(retry.request).map((line) => <p key={line}>{line}</p>) : retry.eligibility && <p>{retryReason(retry.eligibility.reason) || "可按原始消息和摘要要求重新尝试。"}</p>}
    {!retry.request && retry.eligibility?.waitingReason && <p>{retryReason(retry.eligibility.waitingReason)}</p>}
    {retry.message && <p role="status">{retry.message}</p>}
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={disabled} busy={retry.loading} onClick={() => void controller.inspectRetry()}>检查重试条件</ActionButton>
      {retry.eligibility?.eligible && <ActionButton tone="accent" disabled={disabled} busy={retry.status === "requesting"} onClick={() => void controller.requestRetry()}>重新生成这份摘要</ActionButton>}
    </div>
  </section>;
}
