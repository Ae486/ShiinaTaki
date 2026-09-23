import { describe, expect, it } from "vitest";
import {
  MemoryOperationListParamsSchema, MemoryOperationRequestSchema, MemoryOperationSchema, MemoryOperationSubmitParamsSchema,
} from "./memory-operation-schema.ts";

const at = "2026-09-19T00:00:00.000Z";
const base = {
  operationId: "11111111-1111-4111-8111-111111111111", kind: "replica.sync", state: "admitted", reason: null,
  authorityEpochId: "epoch", request: { kind: "replica.sync", bankId: "global", syncKind: "incremental" },
  producer: null, result: null, errorCode: null, createdAt: at, updatedAt: at, terminalAt: null,
} as const;

describe("memory operation contracts", () => {
  it("round-trips an admitted replica operation and a settled setup operation", () => {
    expect(MemoryOperationSchema.parse(base)).toEqual(base);
    const setup = {
      ...base, kind: "setup.validate", state: "completed", request: { kind: "setup.validate", expectedRevision: 3 },
      producer: { kind: "setup", attemptId: "attempt", revisionBefore: 3, revisionAfter: 5 },
      result: { kind: "setup", phase: "compatible", revision: 5, latestError: null }, terminalAt: at,
    } as const;
    expect(MemoryOperationSchema.safeParse(setup).success).toBe(true);
  });

  it("refuses inconsistent terminal/result/reason combinations", () => {
    expect(MemoryOperationSchema.safeParse({ ...base, state: "completed" }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...base, terminalAt: at }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...base, result: { kind: "replica", errorCode: null, nextAction: null, lastSuccessAt: null } }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...base, state: "outcome_unknown", terminalAt: at }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...base, state: "outcome_unknown", terminalAt: at, reason: "core_restart" }).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...base, state: "completed", terminalAt: at, errorCode: "HINDSIGHT_TIMEOUT" }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...base, kind: "setup.apply" }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...base, errorCode: "anything goes" }).success).toBe(false);
  });

  it("keeps requests closed and bounded", () => {
    expect(MemoryOperationRequestSchema.safeParse({ kind: "replica.sync", bankId: "global", syncKind: "full" }).success).toBe(true);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "replica.sync", bankId: "global", syncKind: "rebuild" }).success).toBe(false);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "backup.create" }).success).toBe(false);
    expect(MemoryOperationSubmitParamsSchema.safeParse({ request: { kind: "setup.validate", expectedRevision: 0 }, extra: 1 }).success).toBe(false);
    expect(MemoryOperationListParamsSchema.parse({})).toEqual({ includeTerminal: false, limit: 20 });
    expect(MemoryOperationListParamsSchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it("binds the hindsight.activate kind to Hindsight producer/result arms and its closed error codes", () => {
    const progress = { phase: "importing", bankCount: 2, preparedBankCount: 2, importedBankCount: 1, verifiedBankCount: 0, carriedWitnessCount: 0 };
    const producer = { kind: "hindsight", runId: "run", hindsightEpochId: "epoch-h", transactionId: "tx", configFingerprint: "a".repeat(64),
      manifestId: "manifest", progress, banks: [] };
    const request = { kind: "hindsight.activate", source: { mode: "new", setupRevision: 2, expectedEpochId: "epoch-l" } };
    const running = { ...base, kind: "hindsight.activate", state: "running", request, producer } as const;
    expect(MemoryOperationSchema.safeParse(running).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...running, producer: { kind: "local", runId: "run", previewId: null, snapshotId: null, activationTransactionId: null, progress: { phase: "reserved", sourceCount: null, resolvedCount: null, blockingCount: null } } }).success).toBe(false);
    const result = { kind: "hindsight", runId: "run", outcome: "activated", epochId: "epoch-h", runtimeAvailable: true, blocking: [] };
    expect(MemoryOperationSchema.safeParse({ ...running, state: "completed", terminalAt: at, result }).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...running, state: "completed", terminalAt: at, result: { ...result, runId: "other" } }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...running, state: "failed", terminalAt: at, reason: "producer_failed", errorCode: "HINDSIGHT_CUTOVER_LEASE_LOST" }).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...running, state: "failed", terminalAt: at, reason: "producer_failed", errorCode: "LEASE_LOST" }).success).toBe(false);
  });
});
