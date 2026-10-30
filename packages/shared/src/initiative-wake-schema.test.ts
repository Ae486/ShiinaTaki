import { describe, expect, it } from "vitest";
import { InitiativeForegroundFactSchema, InitiativePresenceReturnSchema,
  InitiativeWakePolicyStatusSchema, InitiativeWakeReadParamsSchema } from "./initiative-wake-schema.ts";

describe("initiative wake source contracts", () => {
  it("preserves nullable idle and rejects inferred presence, malformed generations and stitched future dwell", () => {
    const fact = { occurrenceKey: "accepted", observedAt: 2000, startedAt: 1000, application: "Editor", meaningful: false,
      idleSeconds: null, observationEpoch: 1, hostId: "host", connectionGeneration: 1, catalogGeneration: 1 };
    expect(InitiativeForegroundFactSchema.parse(fact).idleSeconds).toBeNull();
    expect(InitiativeForegroundFactSchema.safeParse({ ...fact, present: true }).success).toBe(false);
    expect(InitiativeForegroundFactSchema.safeParse({ ...fact, observationEpoch: -1 }).success).toBe(false);
    expect(InitiativeForegroundFactSchema.safeParse({ ...fact, startedAt: 3000 }).success).toBe(false);
  });
  it("requires ordered actual input and known inactivity; reconnect-shaped reports are insufficient", () => {
    const fact = { occurrenceKey: "input", sourceKey: "source", sourceGeneration: 1,
      observedAt: 900_000, inputAt: 899_000, previousInputAt: 1000, knownInactiveSince: 30_000 };
    expect(InitiativePresenceReturnSchema.safeParse(fact).success).toBe(true);
    expect(InitiativePresenceReturnSchema.safeParse({ ...fact, knownInactiveSince: null }).success).toBe(false);
    expect(InitiativePresenceReturnSchema.safeParse({ ...fact, inputAt: 1_000_000 }).success).toBe(false);
    expect(InitiativePresenceReturnSchema.safeParse({ sourceKey: "source", observedAt: 900_000 }).success).toBe(false);
  });
  it("bounds Monitor projections and excludes injected content and client-supplied authority", () => {
    const entry = { reason: "no-signal", source: "none", occurredAt: "2026-09-28T12:00:00.000Z", matchedCount: 0 };
    const status = { characterId: "taki", cursor: 1, recent: [entry], counters: [], since: "2026-09-22T00:00:00.000Z" };
    expect(InitiativeWakePolicyStatusSchema.safeParse(status).success).toBe(true);
    expect(InitiativeWakePolicyStatusSchema.safeParse({ ...status, recent: Array.from({ length: 101 }, () => entry) }).success).toBe(false);
    expect(InitiativeWakePolicyStatusSchema.safeParse({ ...status, recent: [{ ...entry, windowTitle: "private" }] }).success).toBe(false);
    expect(InitiativeWakeReadParamsSchema.safeParse({ characterId: "taki", operatorDeviceId: "foreign" }).success).toBe(false);
  });
});
