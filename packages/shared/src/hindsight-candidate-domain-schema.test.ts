import { describe, expect, it } from "vitest";
import { HindsightCandidateRequestSchema, HindsightCandidateResultSchema, HindsightCandidateDispatchSchema } from "./hindsight-candidate-domain-schema.ts";

const id = "11111111-1111-4111-8111-111111111111";
describe("candidate durable operation boundary", () => {
  it("admits references only and rejects caller readiness, paths, credentials and restored proofs", () => {
    const prepare = { kind: "candidate.prepare", requestId: id, backupId: id, expectedEpochId: "epoch", expectedManifestHash: "a".repeat(64) };
    expect(HindsightCandidateRequestSchema.safeParse(prepare).success).toBe(true);
    for (const extra of [{ path: "caller.db" }, { endpoint: "http://source" }, { deploymentReady: true }, { proof: {} }, { credentials: "secret" }]) {
      expect(HindsightCandidateRequestSchema.safeParse({ ...prepare, ...extra }).success).toBe(false);
    }
    expect(HindsightCandidateRequestSchema.safeParse({ kind: "candidate.resume", requestId: id, candidateId: id, expectedPlanHash: "a".repeat(64) }).success).toBe(true);
  });
  it("requires the exact Host action references and explicit unknown actions", () => {
    const dispatch = { version: 1, candidateId: id, action: "restore", runId: id, attemptId: id, effectId: id, hostRequestId: id,
      inputHash: "a".repeat(64), authorityHash: "b".repeat(64) };
    expect(HindsightCandidateDispatchSchema.safeParse(dispatch).success).toBe(true);
    expect(HindsightCandidateDispatchSchema.safeParse({ ...dispatch, effectId: undefined }).success).toBe(false);
    const result = { kind: "candidate", candidateId: id, phase: "restore_dispatched", unknownActions: ["restore"], verification: null, refusal: null };
    expect(HindsightCandidateResultSchema.safeParse(result).success).toBe(true);
    expect(HindsightCandidateResultSchema.safeParse({ ...result, unknownActions: ["restore", "restore"] }).success).toBe(false);
    expect(HindsightCandidateResultSchema.safeParse({ ...result, deploymentReady: true }).success).toBe(false);
  });
});
