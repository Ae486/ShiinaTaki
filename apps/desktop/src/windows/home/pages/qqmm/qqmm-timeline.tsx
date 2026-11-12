/**
 * INPUT: shared chronological bounded records and controller actions.
 * OUTPUT: compact readable rows, accessible details, follow-latest and scroll-anchor preservation.
 * POS: Home QQ messages — DOM presentation only; never retains another body cache.
 */

import { useLayoutEffect, useRef, type UIEvent } from "react";
import type { HistoryRecord, ManagementController, ManagementState } from "@qqmm/management-client";
import { EmptyState } from "@/components/ui/empty-state.js";
import { ActionButton } from "../../action-button.tsx";
import { formatTime, recordContext, SEVERITY_LABELS, SEVERITY_TONES } from "./qqmm-labels.ts";
import { summaryStatus } from "./qqmm-summary-labels.ts";
import { toolOutcome } from "./qqmm-tool-labels.ts";

type TimelineProps = { state: ManagementState; controller: ManagementController };
interface ScrollAnchor { element: Element; top: number; }

/** Retain an actual row element, not a copied record or protocol identifier. */
export function captureScrollAnchor(container: HTMLElement): ScrollAnchor | null {
  const top = container.getBoundingClientRect().top;
  const element = Array.from(container.querySelectorAll("[data-qqmm-row]")).find((row) => row.getBoundingClientRect().bottom > top);
  return element ? { element, top: element.getBoundingClientRect().top } : null;
}

export function restoreScrollAnchor(container: HTMLElement, anchor: ScrollAnchor | null): void {
  if (anchor?.element.isConnected) container.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
}

function useTimelineScroll({ state, controller }: TimelineProps) {
  const container = useRef<HTMLDivElement>(null);
  const anchor = useRef<ScrollAnchor | null>(null);
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    if (state.followLatest) node.scrollTop = node.scrollHeight;
    else restoreScrollAnchor(node, anchor.current);
    if (!state.loadingOlder) anchor.current = null;
  }, [state.records, state.followLatest, state.loadingOlder]);
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (state.followLatest && node.scrollHeight - node.scrollTop - node.clientHeight > 48) controller.setFollowLatest(false);
  };
  const loadOlder = () => {
    controller.setFollowLatest(false);
    anchor.current = container.current ? captureScrollAnchor(container.current) : null;
    void controller.loadOlder();
  };
  return { container, onScroll, loadOlder };
}

export function QqmmTimeline({ state, controller }: TimelineProps) {
  const scroll = useTimelineScroll({ state, controller });
  return <>
    <TimelineToolbar state={state} controller={controller} />
    <div ref={scroll.container} onScroll={scroll.onScroll} tabIndex={0} aria-label="日志列表" aria-busy={state.loading || state.loadingOlder} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface px-6">
      {state.hasOlder && <div className="flex justify-center py-3"><ActionButton disabled={state.loadingOlder} busy={state.loadingOlder} onClick={scroll.loadOlder}>加载更早记录</ActionButton></div>}
      {state.records.length === 0 && <TimelineEmpty state={state} controller={controller} />}
      <ol className="divide-y divide-border-subtle">
        {state.records.map((record) => <QqmmRow key={record.recordId} record={record} controller={controller} />)}
      </ol>
    </div>
  </>;
}

function TimelineEmpty({ state, controller }: TimelineProps) {
  if (state.loading) return <EmptyState title="正在读取日志…" />;
  if (state.paused) return <EmptyState title="显示已暂停" hint="采集和日志记录仍会继续，到期内容仍会删除。" />;
  const filtered = Object.values(state.filters).some((value) => value !== undefined && value !== "");
  return <EmptyState
    title={filtered ? "暂无符合条件的日志" : "当前视图暂无日志"}
    hint={filtered ? "可清除筛选后重新查询。到期内容不会再显示。" : "保留期内的记录会在此显示；清空视图不会删除已保存日志。"}
    action={filtered && <ActionButton onClick={() => controller.setFilters({})}>清除筛选</ActionButton>}
  />;
}

function TimelineToolbar({ state, controller }: TimelineProps) {
  const ready = state.connection === "connected" && state.monitor?.historyState === "ready";
  return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-2">
    <p className="text-xs text-text-secondary">已显示 {state.records.length} 条{state.pendingCount > 0 && ` · 待显示 ${state.pendingCount >= 10000 ? "10000+" : state.pendingCount} 条`}</p>
    <div className="flex gap-1">
      <ActionButton tone="ghost" disabled={!ready} onClick={() => controller.pause(!state.paused)}>{state.paused ? "继续显示" : "暂停显示"}</ActionButton>
      <ActionButton tone="ghost" disabled={!ready} onClick={() => controller.clearView()}>清空当前视图</ActionButton>
      <ActionButton tone="link" disabled={!ready || (state.followLatest && !state.paused)} onClick={() => { if (state.paused) controller.pause(false); controller.setFollowLatest(true); }}>回到最新</ActionButton>
    </div>
  </div>;
}

function QqmmRow({ record, controller }: { record: HistoryRecord; controller: ManagementController }) {
  return <li data-qqmm-row className="py-2.5">
    <button type="button" onClick={() => void controller.openDetail(record)} className="grid w-full gap-1 rounded-md text-left hover:bg-surface-muted @lg:grid-cols-[7.5rem_1fr] @lg:gap-3">
      <time dateTime={new Date(record.occurredAt).toISOString()} className="pt-0.5 font-mono text-[11px] tabular-nums text-text-faint">{formatTime(record.occurredAt)}</time>
      <span className="min-w-0">
        <span className="mb-0.5 flex flex-wrap items-center gap-2 text-xs"><span className={SEVERITY_TONES[record.severity]}>{record.summary ? summaryStatus(record.summary) : record.toolResult ? toolOutcome(record.toolResult) : SEVERITY_LABELS[record.severity]}</span><span className="text-text-secondary">{recordContext(record)}</span><span className="ml-auto text-[11px] text-text-faint">查看详情</span></span>
        {record.summary && <span className="mb-1 block text-xs text-text-faint">原始消息 {record.summary.sourceCount} 条</span>}
        {record.toolResult && <span className="mb-1 block text-xs text-text-faint">工具结果 · 返回条目 {record.toolResult.itemCount} 项</span>}
        <span className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body [overflow-wrap:anywhere]">{record.preview}</span>
      </span>
    </button>
  </li>;
}
