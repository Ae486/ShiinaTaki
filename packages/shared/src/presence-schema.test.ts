import { describe, expect, it } from "vitest";
import { PresenceReportParamsSchema, PresenceReportResultSchema, PresenceSnapshotSchema } from "./presence-schema.ts";
import { TimelinePresentationReportParamsSchema } from "./timeline-presentation-report-schema.ts";

const presence = { sourceId: "source", sequence: 1, observedAgeMs: 0, surface: "phone", state: "active",
  visible: true, focused: true, lastInput: null };

describe("operator presence protocol", () => {
  it("accepts content-free phone input and ordinary Timeline identity", () => {
    expect(PresenceReportParamsSchema.parse({ ...presence, sequence: 2,
      lastInput: { sequence: 1, kind: "touch", ageMs: 25 } }).surface).toBe("phone");
    expect(TimelinePresentationReportParamsSchema.parse({ sourceId: "source", sequence: 3,
      observedAgeMs: 10, characterId: "taki", timelineSeq: 42, exposed: true }).timelineSeq).toBe(42);
  });

  it.each([
    { deviceId: "asserted-device" }, { observedAt: "2026-09-27T00:00:00Z" }, { keys: "private" },
    { observedAgeMs: -1 }, { observedAgeMs: 30_001 }, { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { sourceId: "x".repeat(101) }, { lastInput: { sequence: 1, kind: "keyboard", ageMs: -1 } },
    { lastInput: { sequence: 1, kind: "keyboard", ageMs: 1, text: "private" } },
  ])("rejects identity/content assertions and invalid bounds: %j", (patch) => {
    expect(PresenceReportParamsSchema.safeParse({ ...presence, ...patch }).success).toBe(false);
  });

  it("does not expose read acknowledgement or global absence", () => {
    expect(TimelinePresentationReportParamsSchema.safeParse({ sourceId: "source", sequence: 3,
      observedAgeMs: 0, characterId: "taki", timelineSeq: 42, exposed: true, read: true }).success).toBe(false);
    expect(PresenceSnapshotSchema.safeParse({ state: "absent", sourceCount: 0, deviceCount: 0,
      inputFreshSources: 0, nativePresence: "unknown", observedAt: "2026-09-27T00:00:00.000Z" }).success).toBe(false);
    expect(PresenceReportResultSchema.parse({ status: "refused", reason: "stale-input" }).status).toBe("refused");
    expect(PresenceReportResultSchema.parse({ status: "refused", reason: "rate-limited" }).status).toBe("refused");
  });

  it("accepts explicit input continuity while old clients remain compatible and unknown remains unknown", () => {
    expect(PresenceReportParamsSchema.parse(presence).inputContinuity).toBeUndefined();
    expect(PresenceReportParamsSchema.parse({ ...presence, inputContinuity: "tracked" }).inputContinuity).toBe("tracked");
    expect(PresenceReportParamsSchema.parse({ ...presence, inputContinuity: "suspended" }).inputContinuity).toBe("suspended");
    expect(PresenceReportParamsSchema.safeParse({ ...presence, inputContinuity: "present" }).success).toBe(false);
    expect(PresenceReportParamsSchema.safeParse({ ...presence, lastInput: { sequence: 1, kind: "keyboard", ageMs: 86_400_001 } }).success).toBe(false);
  });
});
