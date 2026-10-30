import { describe, expect, it } from "vitest";
import { InteractionPatternDefinitionSchema, type InteractionPatternView } from "@taki/shared";
import type { InitiativeWakeSnapshot } from "./wake-contract.ts";
import { deterministicChance, matchWakePatterns } from "./wake-matcher.ts";
import { inQuietHours, matchClockWindow } from "./wake-clock.ts";

const now = Date.parse("2026-09-28T12:00:00.000Z");
function snapshot(): InitiativeWakeSnapshot {
  return { enabled: true, targetId: "taki", targetReady: true, policyRevision: "one", timezone: "UTC", timezoneRevision: 1,
    primaryVersion: 0, privacyPaused: false, presence: "present", presenceReturn: null, completions: [], intentions: [],
    foreground: { occurrenceKey: "accepted-stretch", application: "Editor", meaningful: true, startedAt: now - 1_800_000,
      observedAt: now, idleSeconds: 0, observationEpoch: 1, hostId: "host", connectionGeneration: 2, catalogGeneration: 3 } };
}
function pattern(all: Parameters<typeof InteractionPatternDefinitionSchema.parse>[0]): InteractionPatternView {
  const definition = InteractionPatternDefinitionSchema.parse({ title: "A useful habit", purpose: "Check in when the configured condition is true",
    conditions: { all }, contextSelectors: [], allowedOutcomes: ["silent", "speak"],
    timing: { minimumGapMinutes: 0, chance: 1 }, lifetime: { startsAt: null, expiresAt: null } });
  return { patternId: "pattern", characterId: "taki", state: "active", version: 2,
    effectiveRevision: { revisionId: "revision", baseVersion: 1, definition,
      origin: { kind: "user", description: "Explicitly reviewed" }, changes: [], createdAt: new Date(now - 1000).toISOString(), acceptedAt: new Date(now - 500).toISOString() },
    candidateRevision: null, createdAt: new Date(now - 1000).toISOString(), updatedAt: new Date(now - 500).toISOString() };
}

describe("deterministic wake matching", () => {
  it("uses one data-only matcher for accepted dwell and a local reflection window", () => {
    const dwell = pattern([{ kind: "application_in_set", applications: ["editor"] }, { kind: "activity_dwell_at_least", minutes: 20 }]);
    const reflection = pattern([{ kind: "local_time_window", start: "11:00", end: "13:00", daysOfWeek: [1] }]);
    const matches = matchWakePatterns([dwell, { ...reflection, patternId: "reflection" }], snapshot(), now);
    expect(matches.candidates.map((match) => match.source).sort()).toEqual(["activity", "clock"]);
    expect(matches.candidates.every((match) => match.causeRunId === null)).toBe(true);
  });
  it.each([null, 180])("never treats nullable/idle native evidence as known active (%s)", (idleSeconds) => {
    const source = snapshot(); source.foreground!.idleSeconds = idleSeconds;
    expect(matchWakePatterns([pattern([{ kind: "known_idle_state", state: "active" }])], source, now).candidates).toEqual([]);
  });
  it("does not create activity from a first reconnect/resume sample, stale data or privacy release", () => {
    const rule = pattern([{ kind: "application_in_set", applications: ["Editor"] }]);
    const source = snapshot(); source.foreground!.meaningful = false;
    expect(matchWakePatterns([rule], source, now).reason).toBe("no-signal");
    source.foreground!.meaningful = true; source.foreground!.observedAt = now - 60_000;
    expect(matchWakePatterns([rule], source, now).reason).toBe("stale-source");
    source.foreground!.observedAt = now; source.privacyPaused = true;
    expect(matchWakePatterns([rule], source, now).reason).toBe("privacy-paused");
    source.privacyPaused = false; source.foreground = null;
    expect(matchWakePatterns([rule], source, now).reason).toBe("missing-source");
  });
  it("aggregate present is a filter, not a return event; genuine input after known inactivity is required", () => {
    const rule = pattern([{ kind: "presence_present" }]); const source = snapshot();
    expect(matchWakePatterns([rule], source, now).reason).toBe("no-signal");
    source.presenceReturn = { occurrenceKey: "input-2", sourceKey: "source", sourceGeneration: 1,
      observedAt: now, inputAt: now, previousInputAt: now - 900_000, knownInactiveSince: now - 650_000 };
    expect(matchWakePatterns([rule], source, now).candidates[0]?.source).toBe("presence");
    source.presenceReturn.knownInactiveSince = now - 590_000;
    expect(matchWakePatterns([rule], source, now).candidates).toEqual([]);
  });
  it("rejects primary/heartbeat/maintenance completion cascades and already-delivered Class A results", () => {
    const rule = pattern([{ kind: "completion_of", runId: "known", label: "Reviewed work" }]); const source = snapshot();
    for (const initiator of ["primary", "heartbeat", "flush"] as const) {
      source.completions = [{ runId: "known", characterId: "taki", completedAt: now, initiator, deliveredClassA: false, causeRunId: null }];
      expect(matchWakePatterns([rule], source, now).candidates).toEqual([]);
    }
    source.completions[0]!.initiator = "scheduled"; source.completions[0]!.deliveredClassA = true;
    expect(matchWakePatterns([rule], source, now).candidates).toEqual([]);
    source.completions[0]!.initiator = "subagent"; source.completions[0]!.deliveredClassA = false;
    expect(matchWakePatterns([rule], source, now).candidates[0]?.causeRunId).toBe("known");
  });
  it("keeps chance and candidate identity stable across sample renewal and respects every conjunct's expiry", () => {
    const rule = pattern([{ kind: "local_time_window", start: "11:00", end: "13:00", daysOfWeek: [1] },
      { kind: "application_in_set", applications: ["Editor"] }]);
    const source = snapshot(); const first = matchWakePatterns([rule], source, now).candidates[0]!;
    source.foreground!.observedAt += 10_000;
    const second = matchWakePatterns([rule], source, now + 10_000).candidates[0]!;
    expect(first.candidateId).toBe(second.candidateId); expect(first.sourceRevision).toBe(second.sourceRevision);
    expect(first.expiresAt).toBe(now + 60_000);
    expect(deterministicChance(first.candidateId)).toBe(deterministicChance(second.candidateId));
  });
});

describe("User Timezone clock windows", () => {
  it("attributes cross-midnight windows to the opening weekday and never catches up an old window", () => {
    const window = { kind: "local_time_window", start: "23:00", end: "01:00", daysOfWeek: [1] } as const;
    const at = Date.parse("2026-09-28T16:30:00Z");
    expect(matchClockWindow(at, "Asia/Shanghai", { ...window, daysOfWeek: [...window.daysOfWeek] })?.occurrenceKey).toContain("2026-09-28");
    expect(matchClockWindow(at + 3_600_000, "Asia/Shanghai", { ...window, daysOfWeek: [...window.daysOfWeek] })).toBeUndefined();
    expect(inQuietHours(at, "Asia/Shanghai", { quietStart: "23:00", quietEnd: "08:00" })).toBe(true);
  });
  it("uses one occurrence identity across the DST repeated hour", () => {
    const window = { kind: "local_time_window", start: "01:00", end: "02:00", daysOfWeek: [7] } as const;
    const first = matchClockWindow(Date.parse("2026-11-01T05:30:00Z"), "America/New_York", { ...window, daysOfWeek: [7] });
    const second = matchClockWindow(Date.parse("2026-11-01T06:30:00Z"), "America/New_York", { ...window, daysOfWeek: [7] });
    expect(first?.occurrenceKey).toBe(second?.occurrenceKey);
    expect(first?.expiresAt).toBe(Date.parse("2026-11-01T07:00:00Z"));
  });
});
