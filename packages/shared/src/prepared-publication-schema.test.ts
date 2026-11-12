import { describe, expect, it } from "vitest";
import { PreparedPublicationAuthorizationScopeSchema, PreparedPublicationCandidateSchema,
  PreparedPublicationRequestSchema, PreparedPublicationSourceSchema, PreparedPublicationValiditySchema } from "./prepared-publication-schema.ts";

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
      revision: "revision-1", validity: { kind: "expires_at", expiresAt: "2026-10-11T06:00:00.000Z" } };
    expect(PreparedPublicationSourceSchema.parse(source)).toEqual(source);
    for (const extra of [{ policy: "business_policy" }, { accepted: true }, { deliveryClass: "class_a" }]) {
      expect(PreparedPublicationSourceSchema.safeParse({ ...source, ...extra }).success).toBe(false);
    }
    const scope = { sourceRef: source.sourceRef, acceptanceRef: source.acceptanceRef,
      characterId: source.characterId, validity: source.validity, deliveryClass: "class_a" };
    expect(PreparedPublicationAuthorizationScopeSchema.parse(scope)).toEqual(scope);
    expect(PreparedPublicationAuthorizationScopeSchema.safeParse({ ...scope, deliveryClass: "class_b" }).success).toBe(false);
    expect(PreparedPublicationAuthorizationScopeSchema.safeParse({ ...scope, revision: "r2" }).success).toBe(false);
  });

  it("requires explicit source validity and always finite candidate freshness", () => {
    expect(PreparedPublicationValiditySchema.parse({ kind: "until_cancelled" })).toEqual({ kind: "until_cancelled" });
    for (const validity of [undefined, null, {}, { kind: "expires_at" }, { kind: "expires_at", expiresAt: "invalid" },
      { kind: "until_cancelled", expiresAt: "2026-10-11T06:00:00.000Z" }]) {
      expect(PreparedPublicationValiditySchema.safeParse(validity).success).toBe(false);
    }
    for (const expiresAt of [undefined, null, "invalid", Infinity]) {
      expect(PreparedPublicationCandidateSchema.safeParse({ candidateRef: "one", revision: "r1", text: "Answer", expiresAt }).success).toBe(false);
    }
  });

  it("refuses missing revision, oversized or noncanonical text instead of rewriting exact output", () => {
    const candidate = { candidateRef: "moment-1", revision: "revision-1", expiresAt: "2026-10-11T06:00:00.000Z", text: "Exact text." };
    expect(PreparedPublicationCandidateSchema.parse(candidate)).toEqual(candidate);
    for (const change of [{ revision: "" }, { text: " padded " }, { text: " " }, { text: "x".repeat(8001) }]) {
      expect(PreparedPublicationCandidateSchema.safeParse({ ...candidate, ...change }).success).toBe(false);
    }
  });

  it("retains optional source facts without granting candidate or request authority", () => {
    const sourceContext = { generatedBy: { runId: "generation", attemptId: "attempt" },
      materials: [{ label: "External interview", reference: "document:interview", speaker: "Guest", time: "00:12" }] };
    const candidate = { candidateRef: "one", revision: "r1", expiresAt: "2026-10-11T06:00:00.000Z",
      text: "The guest described their experience.", sourceContext };
    expect(PreparedPublicationCandidateSchema.parse(candidate)).toEqual(candidate);
    expect(PreparedPublicationRequestSchema.safeParse({ candidateRef: "one", expectedRevision: "r1", sourceContext }).success).toBe(false);
    expect(PreparedPublicationCandidateSchema.safeParse({ ...candidate, sourceContext: { materials: [{ accepted: true }] } }).success).toBe(false);
  });
});
