/**
 * INPUT:  hand-built TimelineEntry rows with LOCAL-time createdAt values.
 * OUTPUT: assertions that consecutive same-day rows group together and a day boundary starts a new group.
 * POS:    unit test for date-group (T12). Pure, node-safe. LOCAL (no-Z) timestamps keep it timezone-deterministic.
 */

import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { groupByLocalDate } from "./date-group.ts";

function entry(seq: number, createdAt: string): TimelineEntry {
  return { seq, id: `id-${seq}`, characterId: "taki", role: "user", content: `m${seq}`, createdAt };
}

describe("groupByLocalDate", () => {
  it("returns no groups for an empty timeline", () => {
    expect(groupByLocalDate([])).toEqual([]);
  });

  it("keeps same-local-day entries in one group and splits on a day boundary", () => {
    const entries = [
      entry(1, "2026-07-15T09:00:00"),
      entry(2, "2026-07-15T23:30:00"),
      entry(3, "2026-08-20T01:00:00"),
    ];
    const groups = groupByLocalDate(entries);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-07-15", "2026-08-20"]);
    expect(groups[0]?.entries.map((e) => e.seq)).toEqual([1, 2]);
    expect(groups[1]?.entries.map((e) => e.seq)).toEqual([3]);
  });

  it("groups ISO-Z (UTC) timestamps by the LOCAL day they land on, not the UTC date", () => {
    // Built from local components, round-tripped through the ISO-Z form the timeline actually carries. 00:30 and
    // 23:30 local straddle midnight in UTC-offset terms (their UTC dates differ from the local one in any non-UTC
    // zone, east or west) — a getUTC*-based implementation would split them; the local rule keeps one group.
    const earlyMorning = new Date(2026, 6, 15, 0, 30);
    const lateEvening = new Date(2026, 6, 15, 23, 30);
    const groups = groupByLocalDate([entry(1, earlyMorning.toISOString()), entry(2, lateEvening.toISOString())]);
    expect(groups.map((g) => g.dateKey)).toEqual(["2026-07-15"]);
    expect(groups[0]?.entries.map((e) => e.seq)).toEqual([1, 2]);
  });
});
