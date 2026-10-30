/**
 * INPUT:  an injected clock value, optional explicit User Timezone and ISO createdAt for age formatting
 * OUTPUT: pure renderers — renderDayDate / renderCurrentTime (prompt lines), formatRelativeAge (memory age),
 *         renderWallClock and startOfUserDay (an absolute boundary in an explicitly supplied IANA zone)
 * POS:    core/time — pure prompt rendering; legacy callers retain local time, User Timezone callers pass authority
 */

// Weekday in the runtime's local timezone; a module-level formatter avoids re-allocating it per call.
const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "long" });

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// A "month" for age display is a flat 30 days — coarse on purpose (this is a companion's sense of time, not accounting).
const MONTH_MS = 30 * DAY_MS;

function toDate(at: number | Date): Date {
  return typeof at === "number" ? new Date(at) : at;
}

// Local YYYY-MM-DD (getFullYear/Month/Date are LOCAL, matching the local-timezone weekday) — never UTC, so the
// date line agrees with the user's wall calendar.
function localYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The STABLE-prefix day line: byte-identical for a whole calendar day, so it never churns the prompt cache. */
export function renderDayDate(at: number | Date, timezone?: string): string {
  const date = toDate(at);
  if (timezone) { const parts = userClock(date, timezone); return `Today is ${parts.weekday}, ${parts.ymd}.`; }
  return `Today is ${WEEKDAY_FORMAT.format(date)}, ${localYmd(date)}.`;
}

/** The TAIL time line: minute granularity (never seconds), so within-minute recomposition stays byte-stable. */
export function renderCurrentTime(at: number | Date, timezone?: string): string {
  const date = toDate(at);
  if (timezone) return `Current local time: ${userClock(date, timezone).hm}.`;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `Current local time: ${hours}:${minutes}.`;
}

/**
 * Memory-age label computed by CODE (models miscompute date arithmetic). A future or unparseable timestamp degrades
 * to "just now" — never a negative count or NaN. Boundaries: <1min just now, <1h minutes, <1d hours, <30d days, else months.
 */
export function formatRelativeAge(fromIso: string, nowMs: number): string {
  const fromMs = Date.parse(fromIso);
  if (Number.isNaN(fromMs)) return "just now";
  const diff = nowMs - fromMs;
  if (diff < MINUTE_MS) return "just now"; // also covers a future timestamp (diff <= 0)
  if (diff < HOUR_MS) return plural(Math.floor(diff / MINUTE_MS), "minute");
  if (diff < DAY_MS) return plural(Math.floor(diff / HOUR_MS), "hour");
  if (diff < MONTH_MS) return plural(Math.floor(diff / DAY_MS), "day");
  return plural(Math.floor(diff / MONTH_MS), "month");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * Full weekday + date + time; an explicit zone keeps headless Core process-local time out of User Timezone prompts.
 */
export function renderWallClock(at: number | Date, timezone?: string): string {
  const date = toDate(at);
  if (timezone) { const parts = userClock(date, timezone); return `${parts.weekday}, ${parts.ymd} ${parts.hm}`; }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${WEEKDAY_FORMAT.format(date)}, ${localYmd(date)} ${hours}:${minutes}`;
}

function userClock(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", year: "numeric",
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { weekday: value("weekday"), ymd: `${value("year")}-${value("month")}-${value("day")}`,
    hm: `${value("hour")}:${value("minute")}` };
}

/** Find the day's first actual instant, including DST gaps at midnight and repeated hours. */
export function startOfUserDay(at: number | Date, timezone: string): string {
  const instant = toDate(at).getTime();
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const day = format.format(instant);
  // A civil day can exceed 24 hours. Search the preceding 48-hour bound instead of subtracting a fixed offset.
  let lower = instant - 2 * DAY_MS;
  let upper = instant;
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (format.format(middle) === day) upper = middle;
    else lower = middle;
  }
  return new Date(upper).toISOString();
}
