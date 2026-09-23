/**
 * INPUT:  explicit activation test overrides
 * OUTPUT: Shared-schema-validated MemoryActivationStatus / run / operation fixtures, one per meaningful card state
 * POS:    ui/windows/home/pages/operations — test support only; never imported by the production flow
 */
import { MemoryActivationStatusSchema, MemoryOperationSchema, type MemoryActivationBank, type MemoryActivationRun, type MemoryActivationStatus,
  type MemoryHindsightPhase, type MemoryHindsightProducerRef, type MemoryHindsightProgress, type MemoryOperation } from "@taki/shared";

export const ACTIVATION_AT = "2026-09-23T00:00:00.000Z";
export const ACTIVATION_OPERATION_ID = "33333333-3333-4333-8333-333333333333";
export const ACTIVATION_EPOCH_ID = "epoch-local-1";
export const HINDSIGHT_EPOCH_ID = "epoch-hindsight-1";
const NO_ACTIONS: MemoryActivationStatus["actions"] = { activate: false, resume: false, recoverBinding: false, cancelOperationId: null };
const RECEIPT: MemoryActivationRun["receipt"] = { transactionId: "transaction-hindsight-1", epochId: HINDSIGHT_EPOCH_ID, committedAt: ACTIVATION_AT };

export function activationBank(scope: MemoryActivationBank["scope"], patch: Partial<MemoryActivationBank> = {}): MemoryActivationBank {
  const character = scope === "character";
  return { scope, characterId: character ? "taki" : null, localBankId: character ? "local-taki" : "local-global",
    nativeBankId: character ? "native-taki" : "native-global", verified: true, ...patch };
}

export function activationRun(patch: Partial<MemoryActivationRun> = {}): MemoryActivationRun {
  return { runId: "run-hindsight-1", phase: "importing", status: "running", lease: { active: true, fence: 2, expiresAt: ACTIVATION_AT },
    currentState: null, receipt: null, ...patch };
}

/** Local authority, configured setup, every Bank verified, no run: Core offers the single 启用 action. */
export function activationStatus(patch: Partial<MemoryActivationStatus> = {}): MemoryActivationStatus {
  return MemoryActivationStatusSchema.parse({
    authority: { mode: "canonical-local", epochId: ACTIVATION_EPOCH_ID }, runtime: { available: true, unavailableReason: null },
    setup: { phase: "configured", revision: 3, configured: true },
    prerequisites: { banks: [activationBank("global"), activationBank("character")], blocking: [] },
    run: null, custody: { openGroups: 0, unconsumedWitnesses: 0, pendingSpans: 0 }, operation: null,
    actions: { ...NO_ACTIONS, activate: true }, observedAt: ACTIVATION_AT, ...patch,
  });
}

export function activationProducer(progress: Partial<MemoryHindsightProgress> = {}): MemoryHindsightProducerRef {
  return { kind: "hindsight", runId: "run-hindsight-1", hindsightEpochId: HINDSIGHT_EPOCH_ID, transactionId: "transaction-hindsight-1",
    configFingerprint: "ab".repeat(32), manifestId: null,
    progress: { phase: "reserved", bankCount: 2, preparedBankCount: 0, importedBankCount: 0, verifiedBankCount: 0, carriedWitnessCount: 0, ...progress },
    banks: [
      { nativeBankId: "native-global", scope: "global", replicaEpochId: "44444444-4444-4444-8444-444444444444", verificationId: "55555555-5555-4555-8555-555555555555", preparationId: null },
      { nativeBankId: "native-taki", scope: "character", replicaEpochId: "66666666-6666-4666-8666-666666666666", verificationId: "77777777-7777-4777-8777-777777777777", preparationId: null },
    ] };
}

export function activationOperation(patch: Partial<MemoryOperation> = {}): MemoryOperation {
  return MemoryOperationSchema.parse({
    operationId: ACTIVATION_OPERATION_ID, kind: "hindsight.activate", state: "admitted", reason: null, authorityEpochId: ACTIVATION_EPOCH_ID,
    request: { kind: "hindsight.activate", source: { mode: "new", setupRevision: 3, expectedEpochId: ACTIVATION_EPOCH_ID } },
    producer: activationProducer(), result: null, errorCode: null, createdAt: ACTIVATION_AT, updatedAt: ACTIVATION_AT, terminalAt: null, ...patch,
  });
}

export function legacyStatus(): MemoryActivationStatus {
  return activationStatus({ authority: { mode: "legacy-markdown", epochId: null }, prerequisites: { banks: [], blocking: [] }, actions: NO_ACTIONS });
}

/** Setup not yet configured: the character Bank has no native counterpart and blocks activation. */
export function unconfiguredStatus(phase: MemoryActivationStatus["setup"]["phase"] = "ready-to-validate"): MemoryActivationStatus {
  return activationStatus({
    setup: { phase, revision: 2, configured: false },
    prerequisites: { banks: [activationBank("global", { nativeBankId: null, verified: false }), activationBank("character", { nativeBankId: null, verified: false })],
      blocking: [{ scope: "global", characterId: null, localBankId: "local-global", code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" },
        { scope: "character", characterId: "taki", localBankId: "local-taki", code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" }] },
    actions: NO_ACTIONS,
  });
}

/** Configured, but B3 carries a Bank with no Local counterpart (D86 lazy Character creation). */
export function blockedStatus(): MemoryActivationStatus {
  return activationStatus({
    prerequisites: { banks: [activationBank("global")], blocking: [{ scope: "character", characterId: "taki", localBankId: null, code: "HINDSIGHT_BANKS_INCOMPLETE" }] },
    actions: NO_ACTIONS,
  });
}

/** Configured, but a Character Bank created after setup (D86) has no verified B3 row yet; setup.apply provisions it. */
export function missingBankStatus(): MemoryActivationStatus {
  return activationStatus({
    prerequisites: { banks: [activationBank("global"), activationBank("character", { nativeBankId: null, verified: false })],
      blocking: [{ scope: "character", characterId: "taki", localBankId: "local-taki", code: "HINDSIGHT_TEMPLATE_NOT_VERIFIED" }] },
    actions: NO_ACTIONS,
  });
}

export function admittedStatus(): MemoryActivationStatus {
  return activationStatus({ operation: activationOperation(), actions: { ...NO_ACTIONS, cancelOperationId: ACTIVATION_OPERATION_ID } });
}

export function runningStatus(phase: MemoryHindsightPhase = "importing"): MemoryActivationStatus {
  const producer = activationProducer({ phase, preparedBankCount: 2, importedBankCount: 1, carriedWitnessCount: 1 });
  return activationStatus({ operation: activationOperation({ state: "running", producer }), run: activationRun(), actions: NO_ACTIONS });
}

/** The last operation lost its lease before COMMIT; Core offers 继续 on the persisted run. */
export function interruptedStatus(): MemoryActivationStatus {
  return activationStatus({
    operation: activationOperation({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_CUTOVER_LEASE_LOST", terminalAt: ACTIVATION_AT }),
    run: activationRun({ status: "failed", phase: "failed", lease: { active: false, fence: 2, expiresAt: null } }),
    actions: { ...NO_ACTIONS, resume: true },
  });
}

export function unknownStatus(): MemoryActivationStatus {
  return activationStatus({
    operation: activationOperation({ state: "outcome_unknown", reason: "core_restart", terminalAt: ACTIVATION_AT }),
    run: activationRun({ lease: { active: false, fence: 2, expiresAt: null } }),
    actions: { ...NO_ACTIONS, resume: true },
  });
}

/** COMMIT succeeded, the rebind did not: Hindsight authority with an unavailable runtime and 恢复运行时 offered. */
export function committedUnavailableStatus(): MemoryActivationStatus {
  return activationStatus({
    authority: { mode: "hindsight", epochId: HINDSIGHT_EPOCH_ID }, runtime: { available: false, unavailableReason: "connection_unavailable" },
    operation: activationOperation({ state: "failed", reason: "runtime_unavailable", errorCode: "MEMORY_RUNTIME_UNAVAILABLE", terminalAt: ACTIVATION_AT,
      result: { kind: "hindsight", runId: "run-hindsight-1", outcome: "binding_unavailable", epochId: HINDSIGHT_EPOCH_ID, runtimeAvailable: false, blocking: [] } }),
    run: activationRun({ phase: "activated", status: "completed", lease: { active: false, fence: 2, expiresAt: null }, receipt: RECEIPT }),
    custody: { openGroups: 1, unconsumedWitnesses: 2, pendingSpans: 0 },
    actions: { ...NO_ACTIONS, recoverBinding: true },
  });
}

export function activatedStatus(): MemoryActivationStatus {
  return activationStatus({
    authority: { mode: "hindsight", epochId: HINDSIGHT_EPOCH_ID },
    operation: activationOperation({ state: "completed", terminalAt: ACTIVATION_AT,
      result: { kind: "hindsight", runId: "run-hindsight-1", outcome: "activated", epochId: HINDSIGHT_EPOCH_ID, runtimeAvailable: true, blocking: [] } }),
    run: activationRun({ phase: "activated", status: "completed", lease: { active: false, fence: 2, expiresAt: null }, receipt: RECEIPT }),
    actions: NO_ACTIONS,
  });
}
