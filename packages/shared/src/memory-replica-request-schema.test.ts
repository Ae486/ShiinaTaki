import { describe, expect, it } from "vitest";
import { MemoryReplicaRequestSchema } from "./memory-replica-request-schema.ts";

const at = "2026-11-11T00:00:00.000Z";
const waiting = { requestId: "11111111-1111-4111-8111-111111111111", bankId: "global", kind: "full", state: "waiting",
  claim: { bankId: "global", ownerId: "process", runId: "22222222-2222-4222-8222-222222222222", fence: 1, expiresAt: at },
  createdAt: at, settledAt: at, errorCode: null, nextAction: "explicit_retry_required", lastSuccessAt: null };

describe("exact replica waiting requests", () => {
  it("requires a terminal claimed attempt and its next action without inventing success", () => {
    expect(MemoryReplicaRequestSchema.parse(waiting)).toEqual(waiting);
    for (const patch of [{ claim: null }, { settledAt: null }, { nextAction: null }, { errorCode: "HINDSIGHT_TIMEOUT" },
      { state: "succeeded" }, { state: "queued" }, { state: "failed" }]) {
      expect(MemoryReplicaRequestSchema.safeParse({ ...waiting, ...patch }).success).toBe(false);
    }
    expect(MemoryReplicaRequestSchema.safeParse({ ...waiting, lastSuccessAt: "2026-11-10T00:00:00.000Z" }).success).toBe(true);
  });
});
