import { describe, expect, it } from "vitest";
import { MemoryOperationRequestSchema } from "./memory-operation-schema.ts";
import { MemoryTransitionAttemptSchema, MemoryTransitionFinalProofSchema, MemoryTransitionIdentitySchema, MemoryTransitionQueuePolicySchema,
  MemoryTransitionRequestSchema, MemoryTransitionResultSchema } from "./memory-transition-schema.ts";
import { MemoryTransitionQueuedIntentSchema, MemoryTransitionQueueOutcomeSchema } from "./memory-transition-queue-schema.ts";

const ID = "11111111-1111-4111-8111-111111111111"; const HASH = "a".repeat(64); const AT = "2026-09-29T00:00:00.000Z";
function identity() {
  return { predecessorEpochId: "source", sourceProvider: "hindsight", sourceLineageId: "lineage", targetProvider: "local", targetLineageId: "new-lineage",
    configRevision: 1, configFingerprint: HASH, inventoryRevision: 1, inventoryHash: HASH,
    banks: [{ scope: { kind: "global", characterId: null }, sourceBankId: "global", targetBankId: "local", sourceRevision: 1, nativeBankId: "native",
      nativeGeneration: "generation", manifestHash: HASH, mappingHash: HASH, policyRevision: 1, blockRevision: 1 }],
    baselineReceiptId: null, baselineHash: null, custodyBoundaryHash: HASH };
}
function request() { return { kind: "transition.return-local", requestId: ID, previewId: ID, previewHash: HASH, expected: identity(), confirmation: "healthy-switch" }; }

describe("strict transition wire contracts", () => {
  it("validates direction, separate emergency confirmation and nested strictness at the public operation boundary", () => {
    expect(MemoryOperationRequestSchema.parse(request())).toEqual(request());
    for (const invalid of [
      { ...request(), kind: "transition.reenter-hindsight" },
      { ...request(), kind: "transition.emergency-local" },
      { ...request(), expected: { ...identity(), targetProvider: "hindsight" } },
      { ...request(), expected: { ...identity(), injected: true } },
      { ...request(), replayClosure: "execute" },
    ]) expect(MemoryOperationRequestSchema.safeParse(invalid).success).toBe(false);
    const emergency = { ...request(), kind: "transition.emergency-local", confirmation: "emergency-takeover" };
    expect(MemoryTransitionRequestSchema.safeParse(emergency).success).toBe(true);
    expect(MemoryOperationRequestSchema.safeParse({ ...request(), recovery: { transitionId: ID, expectedReceiptId: HASH, expectedGeneration: 1 } }).success).toBe(true);
  });

  it("requires full unique inventory and a paired common baseline", () => {
    expect(MemoryTransitionIdentitySchema.safeParse({ ...identity(), banks: [] }).success).toBe(false);
    expect(MemoryTransitionIdentitySchema.safeParse({ ...identity(), banks: [...identity().banks, ...identity().banks] }).success).toBe(false);
    expect(MemoryTransitionIdentitySchema.safeParse({ ...identity(), baselineReceiptId: "receipt" }).success).toBe(false);
    expect(MemoryTransitionRequestSchema.safeParse({ ...request(), kind: "transition.reenter-hindsight", expected: { ...identity(), sourceProvider: "local", targetProvider: "hindsight" } }).success).toBe(false);
  });

  it("rejects incomplete proof, omitted cutoff coordinates, invalid server limits and false completion", () => {
    expect(MemoryTransitionQueuePolicySchema.safeParse({ maxIntents: 1, maxBytes: 1024, maxIntentBytes: 2048, admissionWindowMs: 1000 }).success).toBe(false);
    expect(MemoryTransitionAttemptSchema.safeParse({ transitionId: ID, operationId: ID, attemptId: ID, ownerId: "owner", generation: 1, revision: 0,
      leaseUntil: AT, phase: "fenced", admissionOpenedAt: AT, cutoffAt: AT, cutoffSequence: null, lastEvidenceId: null, cancellationRequested: false }).success).toBe(false);
    expect(MemoryTransitionFinalProofSchema.safeParse({ version: 1, transitionId: ID, attemptId: ID, generation: 1, identity: identity(),
      fencedManifestHash: HASH, mappingHash: HASH, custodyBoundaryHash: HASH, cutoffSequence: 0, unresolvedSourceHash: HASH,
      banks: [{ sourceBankId: "global", manifestHash: HASH, mappingHash: HASH, native: null }], incidentId: null, incidentHash: null, backupId: null, recordedAt: AT }).success).toBe(false);
    const result = { kind: "transition", transitionId: ID, receiptId: HASH, authorityCommitted: true, runtime: "ready", queue: "settled", outcome: "completed", errorCode: null };
    expect(MemoryTransitionResultSchema.safeParse(result).success).toBe(true);
    for (const patch of [{ runtime: "unavailable" }, { queue: "unsettled" }, { receiptId: null }, { outcome: "cancelled" }]) {
      expect(MemoryTransitionResultSchema.safeParse({ ...result, ...patch }).success).toBe(false);
    }
  });

  it("accepts existing branch request IDs and preserves Run provenance while separating queue ACK from write success", () => {
    const value = { version: 1, intentId: ID, transitionId: ID, sequence: 1, sourceEpochId: "source", callerRequestId: `memory-branch:global:${HASH}`,
      replayId: ID, commandHash: HASH, provenance: { callerId: "caller", runId: "run", attemptId: "attempt", effectId: "effect" },
      scope: { kind: "global", characterId: null }, logicalTargetId: "memory", expectedRevision: 1,
      command: { kind: "mutation", request: { kind: "restore", bankId: "global", memoryId: "memory", expectedRevision: 1 } }, admittedAt: AT };
    expect(MemoryTransitionQueuedIntentSchema.parse(value)).toEqual(value);
    expect(MemoryTransitionQueuedIntentSchema.safeParse({ ...value, expectedRevision: 2 }).success).toBe(false);
    expect(MemoryTransitionQueuedIntentSchema.safeParse({ ...value, provenance: { ...value.provenance, runId: null } }).success).toBe(false);
    expect(MemoryTransitionQueueOutcomeSchema.safeParse({ status: "queued", transitionId: ID, intentId: ID, sequence: 1 }).success).toBe(true);
    expect(MemoryTransitionQueueOutcomeSchema.safeParse({ status: "queued", transitionId: ID, intentId: ID, sequence: 1, memories: [] }).success).toBe(false);
  });
});
