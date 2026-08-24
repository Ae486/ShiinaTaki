import { describe, expect, it } from "vitest";
import { canonicalJson, canonicalPayloadHash, documentIdentity, legacyHash, memoryIdentity, sourceIdentity } from "./legacy-identities.ts";

describe("legacy migration identities", () => {
  it("uses length-delimited fields and domain separation", () => {
    expect(legacyHash("d", "ab", "c")).not.toBe(legacyHash("d", "a", "bc"));
    expect(legacyHash("d1", "same")).not.toBe(legacyHash("d2", "same"));
    expect(sourceIdentity("entries/global/profile/a.md", "a".repeat(64))).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("canonicalizes object keys recursively without reordering arrays", () => {
    const left = { z: [{ b: 2, a: 1 }], a: true };
    const right = { a: true, z: [{ a: 1, b: 2 }] };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalPayloadHash(left)).toBe(canonicalPayloadHash(right));
    expect(canonicalJson({ a: [2, 1] })).not.toBe(canonicalJson({ a: [1, 2] }));
  });

  it("keeps Bank and result ordinal in downstream identities", () => {
    const source = sourceIdentity("entries/global/profile/a.md", "b".repeat(64));
    const document = documentIdentity("bank-a", source);
    expect(document).not.toBe(documentIdentity("bank-b", source));
    expect(memoryIdentity({ bankId: "bank-a", documentId: document, ordinal: 0, payloadHash: "c".repeat(64) }))
      .not.toBe(memoryIdentity({ bankId: "bank-a", documentId: document, ordinal: 1, payloadHash: "c".repeat(64) }));
  });
});
