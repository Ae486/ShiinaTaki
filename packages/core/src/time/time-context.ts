/**
 * INPUT:  an injected clock value (epoch-ms or Date) + an ISO createdAt for age formatting
 * OUTPUT: pure renderers — renderDayDate / renderCurrentTime (prompt lines), formatRelativeAge (memory age),
 *         renderWallClock (RESERVED for T4 heartbeat, not wired here)
 * POS:    core/time — the SINGLE home for prompt-facing time rendering; pure, injected-clock, OS-neutral
 *         (standard Date/Intl in the runtime's LOCAL timezone); zero provider awareness. No Date.now() inside.
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
export function renderDayDate(at: number | Date): string {
  const date = toDate(at);
  return `Today is ${WEEKDAY_FORMAT.format(date)}, ${localYmd(date)}.`;
}

/** The TAIL time line: minute granularity (never seconds), so within-minute recomposition stays byte-stable. */
export function renderCurrentTime(at: number | Date): string {
  const date = toDate(at);
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
 * RESERVED for T4 (heartbeat/cron wall-clock injection) — a full weekday + date + time one-liner. Exported now so the
 * render shape is single-sourced here; NOT wired into any prompt in this task.
 */
export function renderWallClock(at: number | Date): string {
  const date = toDate(at);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${WEEKDAY_FORMAT.format(date)}, ${localYmd(date)} ${hours}:${minutes}`;
}
