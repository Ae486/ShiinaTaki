/**
 * INPUT:  a perception.card / pause-state snapshot + the local clock.
 * OUTPUT: pure view models — pauseLabel / samplingRows / activityRows — and midnightAfter (the "pause until tomorrow"
 *         deadline; the timezone computation is the CLIENT's business, per the protocol contract).
 * POS:    ui/windows/home/pages/perception — the node-testable core of the perception page (no DOM, no socket).
 */

import type { PerceptionActivityEntry, PerceptionCard, PerceptionPauseState } from "@taki/shared";
import type { LabeledRow } from "../../page-card.tsx";

export function pauseLabel(state: PerceptionPauseState): string {
  if (!state.paused) return "未启用隐私暂停";
  if (state.until === null) return "已暂停，需手动恢复";
  return `已暂停至 ${new Date(state.until).toLocaleString()}`;
}

export function samplingRows(card: PerceptionCard): LabeledRow[] {
  return [
    { label: "前台活动采样调度", value: card.samplingStatus.foreground ? "已安排" : "未安排" },
    { label: "环境截屏采样调度", value: card.samplingStatus.ambientScreen ? "已安排" : "未安排" },
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
  const current = card.current ? [{ id: activityIdentity(card.current), label: "最新采样", value: activityLine(card.current) }] : [];
  return [...current, ...card.recent.map((entry, index) => ({ id: activityIdentity(entry), label: `最近 ${index + 1}`, value: activityLine(entry) }))];
}

function activityIdentity(entry: PerceptionActivityEntry): string {
  return JSON.stringify([entry.startedAt, entry.processName, entry.windowTitle, entry.idle]);
}

/** Local midnight strictly after `now` — the epoch-ms deadline the "暂停到明天" shortcut sends. */
export function midnightAfter(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime();
}
