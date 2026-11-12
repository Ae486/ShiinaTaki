import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { initiativeFixture } from "../../testing/initiative-fixture.ts";
import { createWakePolicyRepo } from "./wake-policy-repo.ts";

// Freeze the actually shipped C3 decoder vocabulary. Importing today's superset would hide a wire break.
const C3Reason = z.enum([
  "disabled", "wake-disabled", "no-target", "no-pattern", "no-signal", "missing-source", "stale-source", "privacy-paused",
  "quiet-hours", "absence-unknown", "conditions-unmet", "duplicate", "chance", "pattern-cooldown",
  "model-cadence", "model-budget", "utterance-budget", "utterance-gap", "busy", "expired", "stale-policy",
  "context-unavailable", "admitted", "dispatch-refused", "source-error",
]);
const Instant = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const C3Status = z.strictObject({
  characterId: z.string().min(1).max(200), cursor: Instant,
  recent: z.array(z.strictObject({ reason: C3Reason, occurredAt: z.string().datetime({ offset: true }),
    matchedCount: z.number().int().min(0).max(4), source: z.enum(["none", "clock", "activity", "presence", "completion", "intention"]) })).max(100),
  counters: z.array(z.strictObject({ reason: C3Reason, count: Instant })).max(32), since: z.string().datetime({ offset: true }),
});
const databases: ReturnType<typeof initiativeFixture>["db"][] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe("C4 backoff on the existing C3 wake-policy wire", () => {
  it("preserves the shipped source decoder while retaining exact media diagnostics internally", () => {
    const { db } = initiativeFixture(); databases.push(db);
    const now = Date.parse("2026-10-17T12:00:00.000Z"); const repo = createWakePolicyRepo(db, () => now);
    repo.note("taki", { reason: "admitted", source: "media", matchedCount: 1, occurredAt: new Date(now).toISOString() });
    expect(C3Status.parse(repo.read("taki")).recent[0]?.source).toBe("activity");
    expect(db.prepare("SELECT source FROM initiative_wake_evaluations").get()?.source).toBe("media");
  });
  it("retains every diagnostic row and merges compatible counters without rewriting durable reasons", () => {
    const { db } = initiativeFixture(); databases.push(db);
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    const repo = createWakePolicyRepo(db, () => now);
    for (const reason of ["model-cadence", "backoff-spacing", "model-budget", "backoff-daily", "backoff-spacing"] as const) {
      repo.note("taki", { reason, source: "none", matchedCount: 0, occurredAt: new Date(now).toISOString() });
    }
    const stored = db.prepare("SELECT seq,reason FROM initiative_wake_evaluations ORDER BY seq DESC").all();
    const result = C3Status.parse(repo.read("taki"));
    expect(result.cursor).toBe(stored[0]?.seq);
    expect(result.recent.map((row) => row.reason)).toEqual([
      "model-cadence", "model-budget", "model-budget", "model-cadence", "model-cadence",
    ]);
    expect(result.counters).toHaveLength(2);
    expect(result.counters).toEqual(expect.arrayContaining([
      { reason: "model-cadence", count: 3 }, { reason: "model-budget", count: 2 },
    ]));
    const restarted = createWakePolicyRepo(db, () => now);
    expect(restarted.read("taki")).toEqual(result);
    expect(db.prepare("SELECT seq,reason FROM initiative_wake_evaluations ORDER BY seq DESC").all()).toEqual(stored);
    expect(stored.map((row) => row.reason)).toContain("backoff-spacing");
    expect(stored.map((row) => row.reason)).toContain("backoff-daily");
  });
});
