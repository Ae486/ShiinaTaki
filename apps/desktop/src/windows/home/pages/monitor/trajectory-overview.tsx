/**
 * INPUT:  real timing spans, loaded-history state, and local record/range selections
 * OUTPUT: the fixed 50px three-lane DSH Overview with start markers, measured spans, zoom and pan
 * POS:    ui/monitor — DSH Timeline adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { useState, type CSSProperties } from "react";
import type { LedgerHistory } from "./use-trajectory-follow.ts";
import { useOverviewGestures } from "./use-overview-gestures.ts";
import { clampFraction, formatClock, formatDuration, type TimeRange, type TimelineModel, type TimelineSpan } from "./trajectory-timing.ts";
import css from "./trajectory-overview.module.css";

interface OverviewProps {
  model?: TimelineModel;
  active: boolean;
  selection: { range: TimeRange | null; recordKey?: string; matches: ReadonlySet<string>; focus: ReadonlySet<string> | null };
  actualDuration: boolean;
  history: LedgerHistory;
  actions: { changeRange(range: TimeRange | null): void; selectRecord(key: string): void };
}

export function TrajectoryOverview(props: OverviewProps) {
  const gesture = useOverviewGestures(props.model, props.actions, props.active);
  const [hovered, setHovered] = useState<string | undefined>();
  const activeRange = gesture.draft ?? props.selection.range;
  const hoveredSpan = props.model?.spans.find((span) => span.record.key === hovered);
  return <section className={css.root} aria-label="时间概览">
    <div className={css.plot}>
      <div className={css.labels} aria-hidden="true"><span>系统</span><span>模型</span><span>工具</span></div>
      <div className={css.track} ref={gesture.trackRef} tabIndex={0} data-panning={gesture.panning}
        aria-label="拖动选择时间范围，滚轮缩放，右键拖动平移，退出键清除范围"
        onPointerDown={gesture.onPointerDown} onPointerMove={gesture.onPointerMove} onPointerUp={gesture.onPointerUp}
        onPointerCancel={gesture.onPointerCancel} onLostPointerCapture={gesture.onLostPointerCapture}
        onKeyDown={gesture.onKeyDown} onContextMenu={(event) => event.preventDefault()} onPointerLeave={() => setHovered(undefined)}>
        {activeRange && <div className={css.selection} style={rangeStyle(activeRange, gesture.domain)} />}
        <div className={css.lanes} aria-hidden="true">
          {props.model?.spans.map((span) => <OverviewSpan key={span.record.key} span={span} domain={gesture.domain}
            display={{ actualDuration: props.actualDuration, selected: span.record.key === props.selection.recordKey,
              matches: props.selection.matches.has(span.record.key), focused: props.selection.focus?.has(span.record.key) }} onHover={setHovered} />)}
        </div>
        {!props.model && <span className={css.empty}>尚无时间记录</span>}
        {props.history.hasOlder && (!props.model || gesture.domain.start === props.model.start) && <button type="button"
          className={css.earlier} disabled={props.history.loading} aria-busy={props.history.loading} aria-label="载入更早记录，尚未载入部分的耗时未知"
          title="更早记录尚未载入" onPointerDown={(event) => event.stopPropagation()} onClick={() => void props.history.load()}>…</button>}
        {gesture.viewport && <button className={css.reset} type="button" aria-label="重置时间缩放"
          onPointerDown={(event) => event.stopPropagation()} onClick={gesture.resetViewport}>全程</button>}
      </div>
    </div>
    {props.active && hoveredSpan && !gesture.panning && !gesture.draft && <TimingTooltip key={hoveredSpan.record.key} span={hoveredSpan} />}
  </section>;
}

function OverviewSpan({ span, domain, display, onHover }: {
  span: TimelineSpan; domain: TimeRange;
  display: { actualDuration: boolean; selected: boolean; matches: boolean; focused?: boolean };
  onHover(key: string): void;
}) {
  const duration = domain.end - domain.start;
  const first = span.record.timing.firstOutputMs;
  const measured = span.record.timing.durationMs;
  const split = measured !== undefined && measured > 0 && first !== undefined && span.end > span.start;
  return <div className={css.span} data-span-key={span.record.key} data-kind={span.record.row.kind}
    data-error={span.record.error} data-current={display.selected} data-search-match={display.matches}
    data-focus={display.focused === false ? "outside" : undefined} data-marker={!display.actualDuration || span.end === span.start}
    data-first-output={split && display.actualDuration} onPointerEnter={() => onHover(span.record.key)}
    style={{ "--span-lane": span.lane, "--span-left": `${(span.start - domain.start) / duration * 100}%`,
      "--span-width": `${(span.end - span.start) / duration * 100}%`,
      ...(split ? { "--first-output": `${clampFraction(first / measured) * 100}%` } : {}) } as CSSProperties} />;
}

function rangeStyle(range: TimeRange, domain: TimeRange): CSSProperties {
  const duration = domain.end - domain.start;
  const left = clampFraction((range.start - domain.start) / duration);
  const right = clampFraction((range.end - domain.start) / duration);
  return { "--range-left": `${left * 100}%`, "--range-width": `${Math.max(0, right - left) * 100}%` } as CSSProperties;
}

function TimingTooltip({ span }: { span: TimelineSpan }) {
  const timing = span.record.timing;
  const labels = { request: "请求开始", processing: "开始处理", received: "收到调用", recorded: "记录时刻" };
  return <div className={css.tooltip} role="tooltip">
    <strong>{span.record.name}</strong>
    <span>{labels[timing.startKind]}：{formatClock(timing.start)}</span>
    <span>{span.record.row.kind === "tool" ? "处理耗时（含审批等待）" : "耗时"}：{formatDuration(timing.durationMs)}</span>
    {timing.firstOutputMs !== undefined && <span>首次输出耗时：{formatDuration(timing.firstOutputMs)}</span>}
  </div>;
}
