import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CoWatchingStartSchema, CoWatchingPlanSchema, CoWatchingChangedSchema } from "./co-watching-schema.ts";

describe("explicit Co-Watching contracts", () => {
  it("requires bounded operator acceptance without caller-provided authority", () => {
    const input = { characterId: "taki", requestId: randomUUID(), sourceRef: randomUUID(), analysisId: randomUUID(), lifetimeMinutes: 120 };
    expect(CoWatchingStartSchema.safeParse(input).success).toBe(true);
    for (const candidate of [{ ...input, lifetimeMinutes: 0 }, { ...input, lifetimeMinutes: 721 }, { ...input, authorized: true }]) {
      expect(CoWatchingStartSchema.safeParse(candidate).success).toBe(false);
    }
  });
  it("rejects duplicate candidate identities and unversioned change hints", () => {
    const candidate = { candidateRef: "one", momentId: "first", text: "Response" };
    expect(CoWatchingPlanSchema.safeParse({ revision: randomUUID(), candidates: [candidate, candidate] }).success).toBe(false);
    expect(CoWatchingChangedSchema.safeParse({ characterId: "taki" }).success).toBe(false);
  });
});
