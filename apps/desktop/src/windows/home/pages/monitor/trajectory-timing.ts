/**
 * INPUT:  recorded semantic start/duration facts and local Overview range/viewport gestures
 * OUTPUT: a truthful three-lane time model, inclusive focus, anchored zoom, and clamped pan
 * POS:    ui/monitor — DSH timeline adaptation; see third-party-notices.md (DeepSeek MIT); never reads wall-clock time
 */
import type { TrajectoryRecord } from "./trajectory-records.ts";

export interface TimeRange { start: number; end: number }
export interface TimelineSpan extends TimeRange { record: TrajectoryRecord; lane: 0 | 1 | 2 }
export interface TimelineModel extends TimeRange { spans: readonly TimelineSpan[] }

export function projectTimeline(records: readonly TrajectoryRecord[]): TimelineModel | undefined {
  const spans: TimelineSpan[] = records.filter((record) => Number.isFinite(record.timing.start)).map((record) => ({
    record, start: record.timing.start, end: record.timing.end,
    lane: record.row.kind === "model" ? 1 : record.row.kind === "tool" ? 2 : 0,
  }));
  if (spans.length === 0) return undefined;
  return { start: Math.min(...spans.map((span) => span.start)), end: Math.max(...spans.map((span) => span.end)), spans };
}

export function orderedRange(left: number, right: number): TimeRange {
  return { start: Math.min(left, right), end: Math.max(left, right) };
}

export function focusedRecordKeys(model: TimelineModel | undefined, range: TimeRange | null): ReadonlySet<string> | null {
  if (!model || !range) return null;
  return new Set(model.spans.filter((span) => span.start <= range.end && span.end >= range.start).map((span) => span.record.key));
}

export function visibleDomain(model: TimeRange, viewport: TimeRange | null): TimeRange {
  const full = Math.max(1, model.end - model.start);
  if (!viewport) return { start: model.start, end: model.start + full };
  const duration = Math.max(1, Math.min(full, viewport.end - viewport.start));
  const start = Math.min(Math.max(viewport.start, model.start), model.start + full - duration);
  return { start, end: start + duration };
}

export function zoomTimeline(model: TimeRange, current: TimeRange, gesture: { fraction: number; delta: number }): TimeRange | null {
  const full = Math.max(1, model.end - model.start);
  const duration = Math.min(full, Math.max(Math.min(20, full), (current.end - current.start) * Math.exp(gesture.delta * 0.0015)));
  if (duration >= full * 0.999) return null;
  const fraction = clampFraction(gesture.fraction);
  const anchor = current.start + fraction * (current.end - current.start);
  const start = Math.min(Math.max(anchor - fraction * duration, model.start), model.start + full - duration);
  return { start, end: start + duration };
}

export function panTimeline(model: TimeRange, current: TimeRange, deltaFraction: number): TimeRange {
  const duration = current.end - current.start;
  const start = Math.min(Math.max(current.start - deltaFraction * duration, model.start), Math.max(model.start, model.end - duration));
  return { start, end: start + duration };
}

export function timeAt(domain: TimeRange, fraction: number): number {
  return domain.start + clampFraction(fraction) * (domain.end - domain.start);
}

export function clampFraction(value: number): number { return Math.min(1, Math.max(0, value)); }

export function formatDuration(value: number | undefined): string {
  return value === undefined ? "未提供" : `${Math.round(value).toLocaleString("zh-CN")} 毫秒`;
}

export function formatClock(value: number | string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString("zh-CN", { hour12: false, fractionalSecondDigits: 3 }) : "未提供";
}
