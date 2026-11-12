import { describe, expect, it } from "vitest";
import { InitiativeIntentionPlanSchema, InitiativeIntentionSchema } from "./initiative-intention-schema.ts";

const plan = { purpose: "Consider asking how the interview went.", notBefore: "2026-09-28T12:00:00.000Z",
  expiresAt: "2026-09-28T13:00:00.000Z", reportedEventTime: null };
const active = { ...plan, intentionId: "intention", characterId: "taki", sourceKey: "a".repeat(64),
  source: { kind: "primary_timeline", characterId: "taki", timelineId: "source", timelineSeq: 1,
    digest: "b".repeat(64), runId: "primary", attemptId: "attempt", toolCallId: "call" },
  state: "active", canonicalRunKey: null, runId: null, disposition: null,
  createdAt: "2026-09-28T11:00:00.000Z", terminalAt: null };

describe("strict finite Intention contracts", () => {
  it("rejects ambiguous timing, empty windows, absent nulls and model-selected authority", () => {
    expect(InitiativeIntentionPlanSchema.safeParse(plan).success).toBe(true);
    for (const invalid of [{ ...plan, notBefore: "tomorrow" }, { ...plan, expiresAt: plan.notBefore },
      { ...plan, reportedEventTime: undefined }, { ...plan, characterId: "other" }]) {
      expect(InitiativeIntentionPlanSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("requires an exact claim key before a Run can be attached and prevents active linked state", () => {
    expect(InitiativeIntentionSchema.safeParse(active).success).toBe(true);
    expect(InitiativeIntentionSchema.safeParse({ ...active, state: "claimed" }).success).toBe(false);
    expect(InitiativeIntentionSchema.safeParse({ ...active, canonicalRunKey: "key" }).success).toBe(false);
    expect(InitiativeIntentionSchema.safeParse({ ...active, state: "claimed", canonicalRunKey: "key", runId: "heartbeat" }).success).toBe(true);
    expect(InitiativeIntentionSchema.safeParse({ ...active, characterId: "other" }).success).toBe(false);
  });

  it("requires terminal plans to discard prospective content while preserving minimal disposition and source identity", () => {
    const terminal = { ...active, state: "terminal", disposition: "expired", terminalAt: plan.expiresAt,
      purpose: null, reportedEventTime: null };
    expect(InitiativeIntentionSchema.safeParse(terminal).success).toBe(true);
    expect(InitiativeIntentionSchema.safeParse({ ...terminal, purpose: plan.purpose }).success).toBe(false);
    expect(InitiativeIntentionSchema.safeParse({ ...terminal, reportedEventTime: plan.notBefore }).success).toBe(false);
    expect(InitiativeIntentionSchema.safeParse({ ...terminal, disposition: null }).success).toBe(false);
  });
});
