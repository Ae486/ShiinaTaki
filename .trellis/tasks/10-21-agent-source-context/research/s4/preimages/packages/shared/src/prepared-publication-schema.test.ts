import { describe, expect, it } from "vitest";
import { PreparedPublicationAuthorizationScopeSchema, PreparedPublicationCandidateSchema,
  PreparedPublicationRequestSchema, PreparedPublicationSourceSchema } from "./prepared-publication-schema.ts";

describe("prepared publication internal contracts", () => {
  it("accepts only candidate reference and expected revision at the helper boundary", () => {
    const input = { candidateRef: "moment-1", expectedRevision: "revision-1" };
    expect(PreparedPublicationRequestSchema.parse(input)).toEqual(input);
    for (const forbidden of [{ text: "override" }, { deliveryClass: "class_a" }, { rootRunId: "other" }, { accepted: true }]) {
      expect(PreparedPublicationRequestSchema.safeParse({ ...input, ...forbidden }).success).toBe(false);
    }
  });

  it("keeps generic accepted sources free of business policy or caller-selected delivery authority", () => {
    const source = { sourceRef: "selected-source", acceptanceRef: "trusted-request", characterId: "taki",
      revision: "revision-1", expiresAt: "2026-10-11T06:00:00.000Z" };
    expect(PreparedPublicationSourceSchema.parse(source)).toEqual(source);
    for (const extra of [{ policy: "business_policy" }, { accepted: true }, { deliveryClass: "class_a" }]) {
      expect(PreparedPublicationSourceSchema.safeParse({ ...source, ...extra }).success).toBe(false);
    }
    const scope = { sourceRef: source.sourceRef, acceptanceRef: source.acceptanceRef,
      characterId: source.characterId, expiresAt: source.expiresAt, deliveryClass: "class_a" };
    expect(PreparedPublicationAuthorizationScopeSchema.parse(scope)).toEqual(scope);
    expect(PreparedPublicationAuthorizationScopeSchema.safeParse({ ...scope, deliveryClass: "class_b" }).success).toBe(false);
    expect(PreparedPublicationAuthorizationScopeSchema.safeParse({ ...scope, revision: "r2" }).success).toBe(false);
  });

  it("refuses missing revision, oversized or noncanonical text instead of rewriting exact output", () => {
    const candidate = { candidateRef: "moment-1", revision: "revision-1", expiresAt: "2026-10-11T06:00:00.000Z", text: "Exact text." };
    expect(PreparedPublicationCandidateSchema.parse(candidate)).toEqual(candidate);
    for (const change of [{ revision: "" }, { text: " padded " }, { text: " " }, { text: "x".repeat(8001) }]) {
      expect(PreparedPublicationCandidateSchema.safeParse({ ...candidate, ...change }).success).toBe(false);
    }
  });
});
