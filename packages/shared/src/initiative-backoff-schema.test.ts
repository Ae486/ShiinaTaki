import { describe, expect, it } from "vitest";
import { INITIATIVE_BACKOFF_METHODS, InitiativeBackoffChangedSchema, InitiativeBackoffReadParamsSchema,
  InitiativeBackoffResetParamsSchema, InitiativeBackoffStatusSchema } from "./initiative-backoff-schema.ts";

const status = { stage: "normal", qualifiedWeakCount: 0, spacingMultiplier: 1, dailyJudgments: 0,
  nextEligibleAt: null, refusal: null, lastResetAt: null, lastResetReason: null,
  windowSince: "2026-09-21T12:00:00.000Z", observedAt: "2026-09-28T12:00:00.000Z" };
describe("semantic backoff status", () => {
  it("keeps read, reset and data-free invalidation separate from the legacy policy contract", () => {
    expect(INITIATIVE_BACKOFF_METHODS).toEqual({ read: "observability.initiative-backoff",
      reset: "initiative.backoff.reset", changed: "observability.initiative-backoff-changed" });
    for (const schema of [InitiativeBackoffReadParamsSchema, InitiativeBackoffResetParamsSchema, InitiativeBackoffChangedSchema]) {
      expect(schema.parse({ characterId: "taki" })).toEqual({ characterId: "taki" });
      for (const payload of [{}, { characterId: "" }, { characterId: "x".repeat(201) },
        { characterId: "taki", text: "private" }, { characterId: "taki", status }]) {
        expect(schema.safeParse(payload).success).toBe(false);
      }
    }
  });
  it("round-trips actual bounded evidence and rejects content/identity/measurement invention", () => {
    expect(InitiativeBackoffStatusSchema.parse(status)).toEqual(status);
    for (const patch of [{ characterId: "taki" }, { text: "Private content" }, { qualifiedWeakCount: -1 },
      { dailyJudgments: Number.MAX_SAFE_INTEGER + 1 }, { spacingMultiplier: 8 }, { stage: "angry" }]) {
      expect(InitiativeBackoffStatusSchema.safeParse({ ...status, ...patch }).success).toBe(false);
    }
    expect(InitiativeBackoffResetParamsSchema.safeParse({ characterId: "taki", refundQuota: true }).success).toBe(false);
    expect(InitiativeBackoffResetParamsSchema.parse({ characterId: "taki" })).toEqual({ characterId: "taki" });
  });
});
