import { describe, expect, it } from "vitest";
import { MemoryReplicaRequestSchema } from "./memory-replica-request-schema.ts";
import { MemoryOperationProducerRefSchema } from "./memory-operation-schema.ts";

const AT = "2026-09-29T00:00:00.000Z";
const ID = "11111111-1111-4111-8111-111111111111";
const queued = { requestId: ID, bankId: "bank", kind: "full", state: "queued", claim: null,
  createdAt: AT, settledAt: null, errorCode: null, nextAction: null, lastSuccessAt: null };
const claim = { bankId: "bank", runId: ID, ownerId: "owner", fence: 1, expiresAt: AT };

describe("exact replica request contract", () => {
  it("requires claim and settlement evidence instead of successful-looking timestamps", () => {
    expect(MemoryReplicaRequestSchema.parse(queued)).toEqual(queued);
    expect(MemoryReplicaRequestSchema.safeParse({ ...queued, state: "succeeded", settledAt: AT, lastSuccessAt: AT }).success).toBe(false);
    expect(MemoryReplicaRequestSchema.safeParse({ ...queued, state: "claimed", claim: { ...claim, bankId: "other" } }).success).toBe(false);
    expect(MemoryReplicaRequestSchema.safeParse({ ...queued, state: "succeeded", claim, settledAt: AT, lastSuccessAt: AT }).success).toBe(true);
    expect(MemoryReplicaRequestSchema.safeParse({ ...queued, state: "failed", settledAt: AT }).success).toBe(false);
  });

  it("preserves legacy producer references without inventing a request identity", () => {
    const old = { kind: "replica", bankId: "bank", admittedAt: AT };
    expect(MemoryOperationProducerRefSchema.parse(old)).toEqual(old);
    expect(MemoryOperationProducerRefSchema.parse({ ...old, requestId: ID })).toEqual({ ...old, requestId: ID });
  });
});
