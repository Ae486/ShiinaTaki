import { describe, expect, it } from "vitest";
import { formatRelativeAge, renderCurrentTime, renderDayDate, renderWallClock } from "./time-context.ts";

// Synthetic clocks only — no Date.now(), no OS/provider deps. Timezone-portable: we assert format shape and internal
// consistency, never a specific offset (the runtime's local tz is the source of truth per invariant 8).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("renderDayDate", () => {
  it("renders a weekday + local YYYY-MM-DD day line", () => {
    // Noon local avoids any tz-boundary date flip for the format-shape assertion.
    const at = new Date(2026, 6, 20, 12, 0, 0); // Mon 2026-07-20 local
    expect(renderDayDate(at)).toMatch(/^Today is [A-Z][a-z]+, \d{4}-\d{2}-\d{2}\.$/);
    expect(renderDayDate(at)).toBe("Today is Monday, 2026-07-20.");
  });

  it("is byte-stable across two times in the SAME local calendar day (cache-shape)", () => {
    const morning = new Date(2026, 6, 20, 8, 3, 0);
    const night = new Date(2026, 6, 20, 23, 59, 0);
    expect(renderDayDate(morning)).toBe(renderDayDate(night));
  });

  it("accepts an epoch-ms clock and a Date interchangeably", () => {
    const at = new Date(2026, 6, 20, 12, 0, 0);
    expect(renderDayDate(at.getTime())).toBe(renderDayDate(at));
  });
});

describe("renderCurrentTime", () => {
  it("renders minute granularity, zero-padded (never seconds)", () => {
    const at = new Date(2026, 6, 20, 9, 5, 47); // 47s must not appear
    expect(renderCurrentTime(at)).toBe("Current local time: 09:05.");
  });

  it("is byte-stable within the same minute (seconds vary → line unchanged)", () => {
    const a = new Date(2026, 6, 20, 23, 40, 1);
    const b = new Date(2026, 6, 20, 23, 40, 58);
    expect(renderCurrentTime(a)).toBe(renderCurrentTime(b));
    expect(renderCurrentTime(a)).toBe("Current local time: 23:40.");
  });
});

describe("formatRelativeAge boundaries", () => {
  const now = new Date(2026, 6, 20, 12, 0, 0).getTime();
  const iso = (ms: number) => new Date(now - ms).toISOString();

  it("degrades a future or unparseable timestamp to 'just now'", () => {
    expect(formatRelativeAge(new Date(now + DAY).toISOString(), now)).toBe("just now");
    expect(formatRelativeAge("not-a-date", now)).toBe("just now");
  });

  it("renders sub-minute as 'just now'", () => {
    expect(formatRelativeAge(iso(59_000), now)).toBe("just now");
  });

  it("renders minute boundaries (singular/plural)", () => {
    expect(formatRelativeAge(iso(MINUTE), now)).toBe("1 minute ago");
    expect(formatRelativeAge(iso(59 * MINUTE), now)).toBe("59 minutes ago");
  });

  it("renders hour boundaries", () => {
    expect(formatRelativeAge(iso(HOUR), now)).toBe("1 hour ago");
    expect(formatRelativeAge(iso(23 * HOUR), now)).toBe("23 hours ago");
  });

  it("renders day boundaries", () => {
    expect(formatRelativeAge(iso(DAY), now)).toBe("1 day ago");
    expect(formatRelativeAge(iso(29 * DAY), now)).toBe("29 days ago");
  });

  it("renders month boundaries at the 30-day cutover", () => {
    expect(formatRelativeAge(iso(30 * DAY), now)).toBe("1 month ago");
    expect(formatRelativeAge(iso(90 * DAY), now)).toBe("3 months ago");
  });
});

describe("renderWallClock (T4-reserved)", () => {
  it("renders a full weekday + date + minute one-liner", () => {
    const at = new Date(2026, 6, 20, 23, 40, 12);
    expect(renderWallClock(at)).toBe("Monday, 2026-07-20 23:40");
  });
});
