/**
 * INPUT:  safe measurable ledger records, selection/fold actions, and older-history availability
 * OUTPUT: DSH-density two-column execution grid with bounded measured rows and deliberate live following
 * POS:    ui/monitor — DSH TrajectoryTable adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { useImperativeHandle, type CSSProperties, type RefObject } from "react";
import type { LedgerItem } from "./trajectory-layout.ts";
import { recordContains, type TrajectoryRecord } from "./trajectory-records.ts";
import { formatDuration } from "./trajectory-timing.ts";
import { useTrajectoryFollow, type LedgerHandle, type LedgerHistory } from "./use-trajectory-follow.ts";
import css from "./trajectory-table.module.css";

interface LedgerActions {
  select(record: TrajectoryRecord): void;
  toggleAttempt(key: string): void;
  toggleRequest(key: string): void;
  resume(): void;
}
interface LedgerProps {
  items: readonly LedgerItem[];
  selection: { rowKey?: string; focusKeys: ReadonlySet<string> | null };
  history: LedgerHistory;
  inspecting: boolean;
  active: boolean;
  actions: LedgerActions;
  handle: RefObject<LedgerHandle | null>;
}

export function TrajectoryLedger(props: LedgerProps) {
  const follow = useTrajectoryFollow({ items: props.items, history: props.history,
    suspended: props.inspecting || props.selection.focusKeys !== null, active: props.active });
  useImperativeHandle(props.handle, () => ({ holdAnchor: follow.holdAnchor, focusRecord: follow.focusRecord, resume: follow.resume }));
  const items = follow.enabled
    ? follow.virtualizer.getVirtualItems().map((virtual) => ({ index: virtual.index, top: virtual.start - (props.history.hasOlder ? 30 : 0) }))
    : props.items.map((_, index) => ({ index, top: undefined }));
  return <div className={css.root} role="grid" aria-label="执行轨迹" aria-colcount={2} aria-rowcount={props.items.length + 1}>
    <div className={css.header} role="row"><span role="columnheader">事件</span><span role="columnheader">内容与结果</span></div>
    {!follow.ready && <div className={css.loading} role="status">正在定位最新记录…</div>}
    <div className={css.pane} ref={follow.scrollRef} onScroll={follow.onScroll} tabIndex={0} aria-label="轨迹记录滚动区域" data-trajectory-scroll="">
      {props.history.hasOlder && <button type="button" className={css.history} disabled={props.history.loading} onClick={follow.loadOlder}>
        {props.history.loading ? "正在载入更早记录…" : "载入更早记录"}
      </button>}
      <div className={css.body} data-ready={follow.ready} data-virtual={follow.enabled}
        style={follow.enabled ? { height: follow.virtualizer.getTotalSize() } : undefined}>
        {items.map(({ index, top }) => <LedgerRow key={props.items[index]!.key} item={props.items[index]!} index={index}
          selection={props.selection} actions={props.actions}
          placement={{ style: top === undefined ? undefined : { transform: `translateY(${top}px)` },
            measure: follow.enabled ? follow.virtualizer.measureElement : undefined }} />)}
      </div>
      {props.items.length === 0 && <div className={css.empty}>已载入记录中没有匹配项。</div>}
    </div>
    {!follow.following && <button className={css.resume} type="button" onClick={props.actions.resume}>已暂停跟随 · 回到最新</button>}
  </div>;
}

function LedgerRow({ item, index, selection, actions, placement }: {
  item: LedgerItem; index: number;
  selection: { rowKey?: string; focusKeys: ReadonlySet<string> | null };
  actions: LedgerActions;
  placement: { style?: CSSProperties; measure?: (node: HTMLDivElement | null) => void };
}) {
  if (item.type === "attempt") return <div className={css.attempt} role="row" aria-rowindex={index + 2}
    ref={placement.measure} data-index={index} style={placement.style} data-ledger-key={item.key}>
    <button type="button" role="gridcell" aria-expanded={!item.collapsed} onClick={() => actions.toggleAttempt(item.groupKey)}>
      <span aria-hidden="true">{item.collapsed ? "▸" : "▾"}</span>{item.label}
    </button><span role="gridcell">{item.count} 项</span>
  </div>;
  const record = item.record;
  const selected = recordContains(record, selection.rowKey);
  const select = (event: { currentTarget: HTMLElement }) => {
    if (!document.getSelection()?.toString()) {
      event.currentTarget.focus({ preventScroll: true });
      actions.select(record);
    }
  };
  return <div className={css.row} role="row" tabIndex={0} aria-rowindex={index + 2} aria-selected={selected}
    aria-label={`查看${record.name}详情`} ref={placement.measure} data-index={index} style={placement.style}
    data-record-key={record.key} data-ledger-key={item.key} data-selected={selected} data-error={record.error}
    data-child={record.requestKey !== undefined && record.requestKey !== record.key}
    data-timeline-focus={selection.focusKeys && !selection.focusKeys.has(record.key) ? "outside" : undefined}
    onClick={select} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); actions.select(record); } }}>
    <div role="gridcell" className={css.event}>
      {item.requestChildren > 0 && <button type="button" className={css.fold} aria-expanded={!item.collapsed}
        aria-label={item.collapsed ? "展开请求中的工具" : "收起请求中的工具"}
        onClick={(event) => { event.stopPropagation(); actions.toggleRequest(record.key); }}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d={item.collapsed ? "M4 2l4 4-4 4" : "M2 4l4 4 4-4"} /></svg>
      </button>}
      <span className={css.kind} data-kind={record.row.kind} data-error={record.error}>{record.row.categoryLabel}</span>
    </div>
    <RecordContent record={record} />
  </div>;
}

function RecordContent({ record }: { record: TrajectoryRecord }) {
  const usage = record.usage;
  const metrics = usage ? `输入 ${usage.inputTokens ?? "未知"} · 输出 ${usage.outputTokens ?? "未知"}` : undefined;
  return <div role="gridcell" className={css.content}>
    <span className={css.name} title={record.name}>{record.name}</span>
    <span className={css.summary}>{record.row.summary ?? record.row.errorReason ?? metrics}</span>
    <span className={css.state}>{record.row.outcome ?? record.row.status}</span>
    {record.timing.durationMs !== undefined && <span className={css.metric}
      title={`${record.row.kind === "tool" ? "处理耗时（含审批等待）" : "响应耗时"}：${formatDuration(record.timing.durationMs)}`}>
      {formatDuration(record.timing.durationMs)}
    </span>}
  </div>;
}
