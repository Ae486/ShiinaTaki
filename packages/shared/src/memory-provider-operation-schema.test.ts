import { describe, expect, it } from "vitest";
import { EditableMemoryPatchSchema, MutationResultSchema, RecallRequestSchema, RecallResultSchema, RetainBankProgressSchema, RetainRequestSchema, RetainResultSchema } from "./memory-provider-operation-schema.ts";

const time = "2026-08-19T00:00:00.000Z";
const provenance = { actor: "agent" as const, origin: "explicit-agent" as const, characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: time, sanitized: true as const, sourceRef: null };
const policy = { layerId: "episodes", importance: 4, visibility: "retrieved" as const, disclosure: null, origin: "self" as const, emotionalWeight: null, retention: { kind: "rolling-window" as const, days: 30 }, policyVersion: 1 };
describe("canonical operation schemas", () => {
  it("rejects empty edit and provider identities in retain", () => {
    expect(EditableMemoryPatchSchema.safeParse({}).success).toBe(false);
    const request = { bankId: "b", content: "remember", context: null, timestamp: null, tags: [], entities: [], metadata: {}, observationScopes: null, documentId: null, strategy: null, updateMode: "replace" as const, provenance, policy };
    expect(RetainRequestSchema.safeParse({ ...request, providerId: "local" }).success).toBe(false);
    expect(RetainRequestSchema.safeParse(request).success).toBe(true);
  });
  it("requires explicit bounded recall controls", () => {
    const request = { bankId: "b", query: "hello", queryTimestamp: null, budget: "mid" as const, limit: 10, maxTokens: 1024, factTypes: ["experience" as const], layerIds: [], includeInvalidated: false as const };
    expect(RecallRequestSchema.safeParse(request).success).toBe(true);
    expect(RecallRequestSchema.safeParse({ ...request, includeInvalidated: true }).success).toBe(false);
  });
  it("rejects contradictory branch failure retry guidance", () => {
    const result = { hits: [], returned: 0, truncated: false, vectorState: "unavailable" as const, partial: true, branchFailures: [{ scope: "global" as const, code: "MEMORY_PROVIDER_UNAVAILABLE" as const, retryable: false, nextAction: "none" as const }] };
    expect(RecallResultSchema.safeParse(result).success).toBe(false);
    expect(RecallResultSchema.safeParse({ ...result, branchFailures: [{ ...result.branchFailures[0], retryable: true, nextAction: "check-provider" as const }] }).success).toBe(true);
  });
  it("represents pending receipts and policy-permitted zero-result completion", () => {
    expect(RetainResultSchema.safeParse({ status: "pending", operationId: "op", documentId: "doc", sourceRevision: null, memories: [] }).success).toBe(true);
    expect(RetainResultSchema.safeParse({ status: "completed", documentId: "doc", sourceRevision: 1, memories: [], zeroResult: true }).success).toBe(true);
    expect(RetainResultSchema.safeParse({ status: "completed", documentId: "doc", sourceRevision: 1, memories: [] }).success).toBe(false);
  });
  it("keeps stale and missing mutations non-blocking and validates two-bank progress", () => {
    expect(MutationResultSchema.safeParse({ outcome: "superseded", record: null }).success).toBe(true);
    expect(MutationResultSchema.safeParse({ outcome: "not_found", record: null }).success).toBe(true);
    const progress = { status: "failed" as const, operationId: null, memoryCount: 0, error: "MEMORY_PROVIDER_UNAVAILABLE" as const };
    expect(RetainResultSchema.safeParse({ status: "pending", operationId: "op", documentId: null, sourceRevision: null, memories: [], bankProgress: [{ scope: "global" as const, ...progress }, { scope: "character" as const, status: "pending" as const, operationId: "op-2", memoryCount: 0, error: null }] }).success).toBe(true);
    expect(RetainResultSchema.safeParse({ status: "pending", operationId: "op", documentId: null, sourceRevision: null, memories: [], bankProgress: [{ scope: "global" as const, ...progress, error: null }] }).success).toBe(false);
  });
  it("rejects incomplete Bank progress in a completed retain receipt", () => {
    const completed = { status: "completed", documentId: "doc", sourceRevision: 1, memories: [{ memoryId: "m", revision: 1 }] };
    for (const status of ["pending", "failed"] as const) {
      const bankProgress = [{ scope: "global", status, operationId: "op", memoryCount: 0,
        error: status === "failed" ? "MEMORY_PROVIDER_UNAVAILABLE" : null }];
      expect(RetainResultSchema.safeParse({ ...completed, bankProgress }).success).toBe(false);
    }
  });
  it("validates a standalone Bank receipt before an aggregate can accept it", () => {
    const progress = { scope: "global", operationId: null, memoryCount: 0, error: null };
    expect(RetainBankProgressSchema.safeParse({ ...progress, status: "failed" }).success).toBe(false);
    expect(RetainBankProgressSchema.safeParse({ ...progress, status: "pending" }).success).toBe(false);
    expect(RetainBankProgressSchema.safeParse({ ...progress, status: "completed", error: "MEMORY_OUTCOME_UNKNOWN" }).success).toBe(false);
  });
});
