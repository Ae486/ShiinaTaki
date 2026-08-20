import { describe, expect, it } from "vitest";
import { RecallEnvelopeSchema } from "./memory-provider-envelope-schema.ts";

describe("canonical envelopes", () => {
  it("rejects malformed envelope metadata", () => {
    expect(RecallEnvelopeSchema.safeParse({ ok: true, requestId: "r", providerId: "local", authorityEpochId: "e", capabilities: {}, data: {} }).success).toBe(false);
  });
  it("rejects provider identity that contradicts the capability snapshot", () => {
    const capabilities = { providerId: "other", contractVersion: 1, retain: true, recall: true, reflect: false, edit: true, invalidate: true, restore: true, conditionalMutation: true, idempotentWrites: true, sparseRetrieval: true, vectorRetrieval: "unavailable", derivedMemoryRead: false };
    const envelope = { ok: true, requestId: "r", providerId: "local", authorityEpochId: "e", capabilities, data: { hits: [], returned: 0, truncated: false, vectorState: "unavailable", partial: false, branchFailures: [] } };
    expect(RecallEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
