/**
 * INPUT: actual instant and explicit User Timezone with closed local clock bounds
 * OUTPUT: current civil-window occurrence and first real closing instant
 * POS: core/initiative/wake — pure DST-aware clock matching; no missed-window catch-up
 */
import type { InteractionPatternCondition } from "@taki/shared";
type ClockWindow = Extract<InteractionPatternCondition, { kind: "local_time_window" }>;
const formatters = new Map<string, Intl.DateTimeFormat>();
const closingInstants = new Map<string, { from: number; end: number }>();

function formatter(zone: string): Intl.DateTimeFormat {
  const cached = formatters.get(zone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (formatters.size >= 8) formatters.clear();
  formatters.set(zone, created); return created;
}

export function localClock(at: number, zone: string) {
  const parts = formatter(zone).formatToParts(at);
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === kind)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}
export function inQuietHours(at: number, zone: string, bounds: { quietStart: string; quietEnd: string }): boolean {
  const { quietStart: start, quietEnd: end } = bounds;
  if (start === end) return false;
  const time = localClock(at, zone).time;
  return start < end ? time >= start && time < end : time >= start || time < end;
}
function occurrence(at: number, zone: string, window: ClockWindow): string | undefined {
  const clock = localClock(at, zone);
  const crosses = window.start > window.end;
  if (crosses ? clock.time < window.start && clock.time >= window.end : clock.time < window.start || clock.time >= window.end) return;
  const date = new Date(`${clock.date}T12:00:00.000Z`);
  if (crosses && clock.time < window.end) date.setUTCDate(date.getUTCDate() - 1);
  if (!window.daysOfWeek.includes(date.getUTCDay() || 7)) return;
  return `${zone}:${date.toISOString().slice(0, 10)}:${window.start}:${window.end}`;
}
export function matchClockWindow(at: number, zone: string, window: ClockWindow) {
  const key = occurrence(at, zone, window);
  if (!key) return undefined;
  const cached = closingInstants.get(key);
  if (cached && cached.from <= at && cached.end > at) return { occurrenceKey: key, expiresAt: cached.end };
  // A repeated DST hour is the same civil occurrence, not permission for another judgment.
  // Minute stepping is bounded by the longest supported civil day and runs only for matched windows.
  let end = Math.floor(at / 60_000) * 60_000 + 60_000;
  for (let count = 0; count < 1_560 && occurrence(end, zone, window) === key; count += 1) end += 60_000;
  if (closingInstants.size >= 128) closingInstants.clear();
  closingInstants.set(key, { from: at, end });
  return { occurrenceKey: key, expiresAt: end };
}
