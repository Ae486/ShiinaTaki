import { describe, expect, it } from "vitest";
import { MEMORY_ACTIVATION_METHODS, MemoryActivationStatusParamsSchema, MemoryActivationStatusSchema } from "./memory-activation-schema.ts";

const at = "2026-09-23T00:00:00.000Z";
const operationId = "11111111-1111-4111-8111-111111111111";
const actions = { activate: false, resume: false, recoverBinding: false, cancelOperationId: null };
const run = { runId: "run", phase: "importing", status: "running", lease: { active: true, fence: 2, expiresAt: at }, currentState: null, receipt: null };
const receipt = { transactionId: "tx", epochId: "epoch-h", committedAt: at };
const operation = {
  operationId, kind: "hindsight.activate", state: "running", reason: null, authorityEpochId: "epoch-l",
  request: { kind: "hindsight.activate", source: { mode: "resume", runId: "run" } }, producer: null, result: null, errorCode: null,
  createdAt: at, updatedAt: at, terminalAt: null,
};
const local = {
  authority: { mode: "canonical-local", epochId: "epoch-l" }, runtime: { available: true, unavailableReason: null },
  setup: { phase: "configured", revision: 3, configured: true },
  prerequisites: { banks: [{ scope: "global", characterId: null, localBankId: "bank", nativeBankId: "native-global", verified: true }], blocking: [] },
  run: null, custody: { openGroups: 0, unconsumedWitnesses: 0, pendingSpans: 0 }, operation: null, actions, observedAt: at,
};

describe("memory.activation.status contract", () => {
  it("names the method, keeps params empty and accepts each state with consistent actions", () => {
    expect(MEMORY_ACTIVATION_METHODS.status).toBe("memory.activation.status");
    expect(MemoryActivationStatusParamsSchema.safeParse({ runId: "x" }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, actions: { ...actions, activate: true } }).success).toBe(true);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, run, actions: { ...actions, resume: true } }).success).toBe(true);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, run, operation, actions: { ...actions, cancelOperationId: operationId } }).success).toBe(true);
    const committed = { ...local, authority: { mode: "hindsight", epochId: "epoch-h" }, runtime: { available: false, unavailableReason: "not_installed" },
      run: { ...run, phase: "activated", status: "completed", lease: { active: false, fence: 2, expiresAt: null }, receipt } };
    expect(MemoryActivationStatusSchema.safeParse({ ...committed, actions: { ...actions, recoverBinding: true } }).success).toBe(true);
  });

  it("refuses actions that contradict the run, authority, runtime or open operation", () => {
    expect(MemoryActivationStatusSchema.safeParse({ ...local, run, actions: { ...actions, activate: true } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, actions: { ...actions, resume: true } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, setup: { phase: "compatible", revision: 3, configured: false }, actions: { ...actions, activate: true } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, setup: { phase: "compatible", revision: 3, configured: true } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, run, operation, actions: { ...actions, resume: true } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, actions: { ...actions, cancelOperationId: operationId } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, run: { ...run, receipt } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, actions: { ...actions, recoverBinding: true } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, runtime: { available: true, unavailableReason: "stopped" } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...local, extra: 1 }).success).toBe(false);
  });

  it("permits installed-runtime recovery only for a matching terminal receipt and incomplete producer", () => {
    const producer = { kind: "hindsight", runId: "run", hindsightEpochId: "epoch-h", transactionId: "tx", configFingerprint: "a".repeat(64),
      manifestId: null, banks: [], progress: { phase: "binding", bankCount: 0, preparedBankCount: 0, importedBankCount: 0, verifiedBankCount: 0, carriedWitnessCount: 0 } };
    const failed = { ...operation, state: "failed", reason: "producer_incomplete", terminalAt: at, errorCode: "HINDSIGHT_TIMEOUT", producer };
    const committed = { ...local, authority: { mode: "hindsight", epochId: "epoch-h" }, operation: failed,
      run: { ...run, phase: "activated", status: "completed", lease: { active: false, fence: 2, expiresAt: null }, receipt },
      actions: { ...actions, recoverBinding: true } };
    expect(MemoryActivationStatusSchema.safeParse(committed).success).toBe(true);
    for (const changed of [
      { ...failed, producer: { ...producer, hindsightEpochId: "foreign-epoch" } },
      { ...failed, producer: { ...producer, transactionId: "foreign-transaction" } },
      { ...failed, producer: { ...producer, runId: "foreign-run" } },
      { ...failed, producer: { ...producer, progress: { ...producer.progress, phase: "completed" } } },
      { ...operation, producer },
    ]) expect(MemoryActivationStatusSchema.safeParse({ ...committed, operation: changed }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...committed, operation: null }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...committed, run: { ...committed.run, receipt: null } }).success).toBe(false);
    expect(MemoryActivationStatusSchema.safeParse({ ...committed, authority: { mode: "hindsight", epochId: "foreign-epoch" } }).success).toBe(false);
  });
});
