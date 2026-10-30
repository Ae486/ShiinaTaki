/**
 * INPUT: the shared controller's retained detail and source navigation state.
 * OUTPUT: accessible saved summary/tool parts, recorded sources and bounded literal text.
 * POS: Home QQ messages — existing modal lifecycle; no body cache or polling.
 */

import { useCallback } from "react";
import type { ManagementController, ManagementState } from "@qqmm/management-client";
import { Dialog } from "@/components/ui/dialog.js";
import { ActionButton } from "../../action-button.tsx";
import { formatDate, recordContext } from "./qqmm-labels.ts";
import { QqmmDetailText } from "./qqmm-detail-text.tsx";
import { QqmmSources } from "./qqmm-sources.tsx";
import { summaryNotes, summaryStatus } from "./qqmm-summary-labels.ts";
import { toolNotes, toolOperation, toolOutcome } from "./qqmm-tool-labels.ts";
import { QqmmRetry } from "./qqmm-retry.tsx";

type DetailProps = { state: ManagementState | null; controller: ManagementController };

export function QqmmDetail({ state, controller }: DetailProps) {
  const close = useCallback(() => controller.closeDetail(), [controller]);
  const detail = state?.detail;
  return <Dialog open={detail != null || state?.detailLoading === true} onClose={close} ariaLabel="日志详情" size="lg">
    {state?.detailLoading && !detail && <div aria-busy="true" className="flex flex-col gap-3">
      <h2 className="pr-7 text-sm font-semibold text-text-strong">日志详情</h2>
      <p role="status" className="text-xs text-text-secondary">正在读取内容…</p>
    </div>}
    {state && detail && <div className="flex max-h-[75vh] flex-col gap-3" aria-busy={state.detailLoading || state.sourceLoading}>
      <h2 className="pr-7 text-sm font-semibold text-text-strong">{detail.record.kind === "summary" ? "摘要详情" : detail.record.kind === "tool_result" ? "工具结果详情" : "日志详情"}</h2>
      <p className="text-xs text-text-secondary">{formatDate(detail.record.occurredAt)} · {recordContext(detail.record)}</p>
      {detail.record.summary && <p className="text-xs text-text-secondary">{summaryStatus(detail.record.summary)} · {summaryNotes(detail.record.summary).join(" · ")}</p>}
      {detail.record.toolResult && <div className="shrink-0 text-xs text-text-secondary"><p>{toolOperation(detail.record.toolResult)} · {toolOutcome(detail.record.toolResult)}</p>{toolNotes(detail.record.toolResult).map((note) => <p key={note}>{note}</p>)}</div>}
      {state.detailMode === "record" ? <RecordBody state={state} controller={controller} /> : <QqmmSources state={state} controller={controller} />}
      {detail.record.kind === "summary" && <QqmmRetry state={state} controller={controller} />}
    </div>}
  </Dialog>;
}

function RecordBody({ state, controller }: { state: ManagementState; controller: ManagementController }) {
  const detail = state.detail;
  if (!detail) return null;
  const section = detail.section;
  const title = section?.title ?? (section?.type === "dimension" ? "摘要分项" : section?.type === "overview" ? "摘要正文" : "记录内容");
  return <>
    {detail.record.snapshotStatus === "legacy_available" && <p className="text-xs text-text-secondary">这条历史记录展示的是目前可用内容。</p>}
    {section && <h3 className="max-h-24 shrink-0 overflow-y-auto whitespace-pre-wrap break-words text-sm font-medium text-text-strong [overflow-wrap:anywhere]">{title}</h3>}
    {state.detailLoading && <p role="status" className="text-xs text-text-secondary">正在读取内容…</p>}
    <QqmmDetailText key={`${detail.record.recordId}:${section?.part ?? 0}`} chunk={detail} busy={state.detailLoading} next={() => controller.loadDetailMore()} />
    <div className="flex flex-wrap justify-end gap-2">
      {detail.record.kind === "summary" && <ActionButton disabled={state.detailLoading} onClick={() => void controller.openSources()}>查看来源消息</ActionButton>}
      {((section?.part ?? 0) > 0 || detail.offset > 0) && <ActionButton disabled={state.detailLoading} onClick={() => void controller.returnToSummary()}>{detail.record.kind === "summary" ? "返回摘要" : detail.record.kind === "tool_result" ? "返回结果开头" : "回到开头"}</ActionButton>}
      {section?.nextPart !== undefined && <ActionButton disabled={state.detailLoading} onClick={() => void controller.loadNextDetailPart()}>{detail.record.kind === "tool_result" ? "下一部分" : "下一项"}</ActionButton>}
    </div>
  </>;
}
