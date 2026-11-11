import { describe, expect, it } from "vitest";
import { loadHindsightPolicyReviewConfig } from "../../config/hindsight-policy-config.ts";
import { APPLICATION_TEST_SCOPE } from "../../testing/hindsight-application-fixtures.ts";
import { reconcilePolicySchedule, requirePolicyOccurrence } from "./hindsight-policy-schedule-state.ts";

// Failure modes: DST/zone changes shift wall time; process restarts reset interval anchors;
// missed slots multiply work or config/reconnect erases the original pending occurrence.
const scope = { ...APPLICATION_TEST_SCOPE, authorityEpochId: "epoch" };
const config = loadHindsightPolicyReviewConfig({});
const state = (at: string, timezone = "UTC") => reconcilePolicySchedule({ scope, config, timezone, at, startup: true });

describe("policy calendar progress", () => {
  it("keeps 03:00 local across spring and fall DST", () => {
    const spring = state("2026-03-07T09:00:00.000Z", "America/New_York");
    expect(spring.nextDueAt).toBe("2026-03-08T07:00:00.000Z");
    const fall = state("2026-10-31T09:00:00.000Z", "America/New_York");
    expect(fall.nextDueAt).toBe("2026-11-01T08:00:00.000Z");
  });
  it("coalesces missed slots once and preserves them when timezone/config changes", () => {
    const previous = state("2026-09-01T08:00:00.000Z");
    const caught = reconcilePolicySchedule({ scope, previous, config, timezone: "UTC", at: "2026-09-10T08:00:00.000Z", startup: true });
    expect(caught.pending).toMatchObject({ at: "2026-09-02T03:00:00.000Z", reason: "catch-up" });
    expect(caught.nextDueAt).toBe("2026-09-11T03:00:00.000Z");
    requirePolicyOccurrence(caught, { at: "2026-09-10T08:00:00.000Z", reason: "threshold" });
    const changed = reconcilePolicySchedule({ scope, previous: caught, config: { ...config, time: "04:30" }, timezone: "Asia/Shanghai",
      at: "2026-09-10T08:01:00.000Z", startup: true });
    expect(changed.pending).toEqual(caught.pending);
    expect(changed.catchUpOccurrenceId).toBe(caught.pending?.id);
    expect(changed.nextDueAt).toBe("2026-09-10T20:30:00.000Z");
  });
  it("uses a persisted elapsed interval anchor, including after timezone change", () => {
    const settings = { ...config, mode: "interval" as const };
    const first = reconcilePolicySchedule({ scope, config: settings, timezone: "UTC", at: "2026-09-01T08:17:00.000Z", startup: true });
    expect(first.nextDueAt).toBe("2026-09-02T08:17:00.000Z");
    const next = reconcilePolicySchedule({ scope, previous: first, config: settings, timezone: "Asia/Shanghai",
      at: "2026-09-05T09:00:00.000Z", startup: true });
    expect(next.anchorAt).toBe(first.anchorAt);
    expect(next.nextDueAt).toBe("2026-09-06T08:17:00.000Z");
    expect(next.pending?.at).toBe(first.nextDueAt);
  });
});
