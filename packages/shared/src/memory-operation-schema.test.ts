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

  it("binds both lifecycle kinds to their own producer/result arms through the explicit producer table", () => {
    const bank = { ...base, kind: "bank.provision", state: "running", request: { kind: "bank.provision", characterId: "mika" },
      producer: { kind: "bank", origin: "automatic", characterId: "mika", nativeBankId: "taki-hs-v1-c-1", templateRevision: "taki-bank-v1",
        admittedEpochId: "epoch-h", configFingerprint: "a".repeat(64), phase: "applying" } } as const;
    expect(MemoryOperationSchema.safeParse(bank).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...bank, producer: { ...bank.producer, origin: "client" } }).success).toBe(false);
    const bankResult = { kind: "bank", characterId: "mika", nativeBankId: "taki-hs-v1-c-1", readiness: "ready" };
    expect(MemoryOperationSchema.safeParse({ ...bank, state: "completed", terminalAt: at, result: bankResult }).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...bank, state: "failed", terminalAt: at, reason: "producer_failed", errorCode: "HINDSIGHT_BANK_OCCUPIED" }).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...bank, state: "failed", terminalAt: at, reason: "producer_failed", errorCode: "HINDSIGHT_LIFECYCLE_INTERRUPTED" }).success).toBe(true);
    const connection = { ...base, kind: "connection.revalidate", state: "running", request: { kind: "connection.revalidate", expectedEpochId: "epoch-h" },
      producer: { kind: "connection", origin: "operator", epochId: "epoch-h", fingerprintBefore: null, fingerprintAfter: "b".repeat(64), phase: "rebinding" } } as const;
    expect(MemoryOperationSchema.safeParse(connection).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...connection, producer: bank.producer }).success).toBe(false);
    expect(MemoryOperationSchema.safeParse({ ...bank, producer: connection.producer }).success).toBe(false);
    const rebound = { kind: "connection", outcome: "rebound", fingerprint: "b".repeat(64) };
    expect(MemoryOperationSchema.safeParse({ ...connection, state: "completed", terminalAt: at, result: rebound }).success).toBe(true);
    expect(MemoryOperationSchema.safeParse({ ...connection, state: "completed", terminalAt: at, result: bankResult }).success).toBe(false);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "bank.provision", characterId: "x".repeat(161) }).success).toBe(false);
    expect(MemoryOperationRequestSchema.safeParse({ kind: "connection.revalidate", expectedEpochId: "epoch", origin: "automatic" }).success).toBe(false);
  });
});
