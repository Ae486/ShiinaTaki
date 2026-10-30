/**
 * INPUT: one shared source page or source chunk, bound to the retained summary.
 * OUTPUT: recorded-original browsing with local missing-source explanations.
 * POS: Home QQ detail subview; paging, expiry and selection belong to QQMM.
 */

import type { ManagementController, ManagementState, SummarySource } from "@qqmm/management-client";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { QqmmDetailText } from "./qqmm-detail-text.tsx";
import { sourceLabel, sourceProvenance } from "./qqmm-summary-labels.ts";

type SourcesProps = { state: ManagementState; controller: ManagementController };

export function QqmmSources({ state, controller }: SourcesProps) {
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="mr-auto text-sm font-medium text-text-strong">来源消息</h3>
      {state.detailMode === "source" && <ActionButton disabled={state.sourceLoading} onClick={() => controller.backToSources()}>返回来源列表</ActionButton>}
      <ActionButton disabled={state.sourceLoading} onClick={() => void controller.returnToSummary()}>返回摘要</ActionButton>
    </div>
    {state.sourceLoading && <p role="status" className="text-xs text-text-secondary">正在读取来源…</p>}
    {state.sourceError && <FeedbackLine tone="warn">{state.sourceError}</FeedbackLine>}
    {state.detailMode === "sources" ? <SourceList state={state} controller={controller} /> : <SourceBody state={state} controller={controller} />}
  </>;
}

function SourceList({ state, controller }: SourcesProps) {
  const page = state.sourcePage;
  if (!page) return null;
  return <>
    <p className="text-xs text-text-secondary">原始消息 {page.sourceCount} 条{page.unavailableCount > 0 && ` · ${page.unavailableCount} 条原文不可用`}</p>
    {page.sources.length === 0 && <p className="text-sm text-text-secondary">当前页没有可展示的来源。</p>}
    <ul aria-label="来源消息" className="min-h-0 divide-y divide-border overflow-y-auto rounded-lg border border-border">
      {page.sources.map((source) => <SourceRow key={source.sourceKey} source={source} state={state} controller={controller} />)}
    </ul>
    <div className="flex justify-end gap-2">
      <ActionButton disabled={state.sourceLoading} onClick={() => void controller.openSources()}>回到来源开头</ActionButton>
      {page.nextCursor !== undefined && <ActionButton disabled={state.sourceLoading} onClick={() => void controller.loadMoreSources()}>下一页来源</ActionButton>}
    </div>
  </>;
}

function SourceRow({ source, state, controller }: SourcesProps & { source: SummarySource }) {
  return <li><button type="button" disabled={state.sourceLoading} onClick={() => void controller.openSource(source.sourceKey)} className="grid w-full gap-1 p-3 text-left hover:bg-surface-muted">
    <span className="text-xs text-text-secondary">{sourceLabel(source)}</span>
    <span className="text-xs text-text-faint">{sourceProvenance(source)}</span>
    {source.preview !== null && <span className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-text-body [overflow-wrap:anywhere]">{source.preview}</span>}
  </button></li>;
}

function SourceBody({ state, controller }: SourcesProps) {
  const source = state.sourceDetail;
  if (!source) return null;
  return <>
    <p className="text-xs text-text-secondary">{sourceLabel(source.source)}</p>
    <p className="text-xs text-text-secondary">{sourceProvenance(source.source)}</p>
    {source.text !== null && <QqmmDetailText chunk={{ ...source, text: source.text }} busy={state.sourceLoading} next={() => controller.loadSourceMore()} />}
  </>;
}
