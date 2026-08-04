/**
 * INPUT:  a perception.card / pause-state snapshot + the local clock.
 * OUTPUT: pure view models — pauseLabel / samplingRows / activityRows — and midnightAfter (the "pause until tomorrow"
 *         deadline; the timezone computation is the CLIENT's business, per the protocol contract).
 * POS:    ui/windows/home/pages/perception — the node-testable core of the perception page (no DOM, no socket).
 */

import type { PerceptionActivityEntry, PerceptionCard, PerceptionPauseState } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";

export function pauseLabel(state: PerceptionPauseState): string {
  if (!state.paused) return "观察进行中";
  if (state.until === null) return "已暂停，需手动恢复";
  return `已暂停至 ${new Date(state.until).toLocaleString()}`;
}

export function samplingRows(card: PerceptionCard): LabeledRow[] {
  return [
    { label: "前台活动采样", value: card.samplingStatus.foreground ? "进行中" : "未采样" },
    { label: "环境截屏采样", value: card.samplingStatus.ambientScreen ? "进行中" : "未采样" },
  ];
}

function minutes(durationMs: number): string {
  return `${Math.max(1, Math.round(durationMs / 60_000))} 分钟`;
}

function activityLine(entry: PerceptionActivityEntry): string {
  const title = entry.windowTitle.trim() === "" ? entry.processName : `${entry.processName} · ${entry.windowTitle}`;
  return entry.idle ? `${title}（空闲 ${minutes(entry.durationMs)}）` : `${title}（${minutes(entry.durationMs)}）`;
}

/** Newest first: the current stretch, then the recent ones the core already coalesced. */
export function activityRows(card: PerceptionCard): LabeledRow[] {
  const current = card.current ? [{ label: "当前", value: activityLine(card.current) }] : [];
  return [...current, ...card.recent.map((entry, index) => ({ label: `最近 ${index + 1}`, value: activityLine(entry) }))];
}

/** Local midnight strictly after `now` — the epoch-ms deadline the "暂停到明天" shortcut sends. */
export function midnightAfter(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime();
}
