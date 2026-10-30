import { describe, expect, it } from "vitest";
import { z } from "zod";
import { InteractionPatternDefinitionSchema } from "./interaction-pattern-schema.ts";
import { InteractionPatternProposeParamsSchema, InteractionPatternConfirmParamsSchema } from "./interaction-pattern-protocol.ts";

const definition = {
  title: "Evening reflection", purpose: "Consider a short check-in.",
  conditions: { all: [{ kind: "local_time_window", start: "20:00", end: "21:00", daysOfWeek: [1, 3, 5] }] },
  contextSelectors: ["memory_character"], allowedOutcomes: ["silent", "speak"],
  timing: { minimumGapMinutes: 60, chance: 0.5 }, lifetime: { startsAt: null, expiresAt: null },
};

describe("Interaction Pattern strict contracts", () => {
  it("round-trips supported finite data and preserves silence", () => {
    expect(InteractionPatternDefinitionSchema.parse(definition)).toEqual(definition);
    const value = { ...definition, conditions: { all: [
      { kind: "application_in_set", applications: ["Editor", "Browser"] },
      { kind: "activity_dwell_at_least", minutes: 45 }, { kind: "known_idle_state", state: "active" },
      { kind: "presence_present" }, { kind: "intention_due" }, { kind: "completion_of", runId: "result", label: "Research" },
    ] } };
    expect(InteractionPatternDefinitionSchema.parse(value)).toEqual(value);
  });

  it.each([
    { ...definition, script: "startModel()" },
    { ...definition, allowedOutcomes: ["speak"] },
    { ...definition, allowedOutcomes: ["silent", "silent"] },
    { ...definition, contextSelectors: ["all_memory"] },
    { ...definition, contextSelectors: ["presence", "presence"] },
    { ...definition, conditions: { all: [] } },
    { ...definition, conditions: { all: Array.from({ length: 9 }, () => ({ kind: "presence_present" })) } },
    { ...definition, conditions: { all: [{ kind: "stress_at_least", threshold: 3 }] } },
    { ...definition, conditions: { all: [{ kind: "presence_present", expression: "connected || visible" }] } },
    { ...definition, timing: { minimumGapMinutes: -1, chance: 1 } },
    { ...definition, timing: { minimumGapMinutes: 0, chance: 1.001 } },
    { ...definition, lifetime: { startsAt: "2026-09-28T00:00:00Z", expiresAt: "2026-09-27T00:00:00Z" } },
    { ...definition, conditions: { all: [{ kind: "local_time_window", start: "20:00", end: "20:00", daysOfWeek: [1] }] } },
    { ...definition, conditions: { all: [{ kind: "local_time_window", start: "25:00", end: "20:00", daysOfWeek: [1] }] } },
    { ...definition, conditions: { all: [{ kind: "local_time_window", start: "19:00", end: "20:00", daysOfWeek: [1, 1] }] } },
    { ...definition, conditions: { all: [{ kind: "application_in_set", applications: ["Editor", "editor"] }] } },
  ])("refuses unsupported, unbounded or contradictory data %#", (value) => {
    expect(InteractionPatternDefinitionSchema.safeParse(value).success).toBe(false);
  });

  it("requires explicit nullable fields and rejects model-authored provenance or reviewer claims", () => {
    const input = { characterId: "taki", commandId: "command", patternId: null, expectedVersion: 0, definition };
    expect(InteractionPatternProposeParamsSchema.safeParse(input).success).toBe(true);
    expect(InteractionPatternProposeParamsSchema.safeParse({ ...input, actor: { kind: "operator" } }).success).toBe(false);
    expect(InteractionPatternConfirmParamsSchema.safeParse({ characterId: "taki", patternId: "pattern", commandId: "c",
      expectedVersion: 1, candidateRevisionId: "r", reviewedBy: "user" }).success).toBe(false);
    const schema = z.toJSONSchema(InteractionPatternProposeParamsSchema, { io: "input" });
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(Object.keys(schema.properties ?? {}));
  });
});
