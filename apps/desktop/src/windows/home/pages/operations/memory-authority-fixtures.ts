/**
 * INPUT:  none — hand-built MemoryAuthorityStatus / MemoryOperation values.
 * OUTPUT: localStatus() / hindsightStatus() / bankStatus() / operation() fixtures shared by the memory authority tests, plus
 *         lifecycleBank() / lifecycleSection() / degradedStatus() for the Hindsight connection + Bank readiness block.
 * POS:    ui/windows/home/pages/operations — test support only; not in the production path.
 */
import type { HindsightBankReadiness, HindsightErrorCode, MemoryAuthorityStatus, MemoryHindsightStatusSection, MemoryOperation,
  MemoryReplicaSyncStatus, MemoryRuntimeUnavailableReason } from "@taki/shared";

export const AT = "2026-09-19T00:00:00.000Z";
export const OPERATION_ID = "22222222-2222-4222-8222-222222222222";

// "compatible" rather than "configured": the strict shared schema requires verified Banks plus compatibility evidence for
// a configured snapshot, and this card never needs that much setup detail.
const setup: MemoryAuthorityStatus["setup"] = {
  revision: 3, phase: "compatible", lastSuccessfulPhase: "compatible", configFingerprint: null, attemptId: null, compatibility: null,
  banks: [], modelHealth: "not-run", latestError: null, lastAttemptAt: null, lastSuccessAt: AT, updatedAt: AT,
};

export function bankStatus(bankId: string, patch: Partial<MemoryReplicaSyncStatus> = {}): MemoryReplicaSyncStatus {
  const scope = bankId === "global" ? { scope: "global" as const, characterId: null } : { scope: "character" as const, characterId: "taki" };
  return {
    bankId, ...scope, automatic: true, autoIntervalMs: 6 * 60 * 60_000, fullReconciliationIntervalMs: 7 * 24 * 60 * 60_000,
    mode: "idle", run: null, fullReconciliationState: "idle", nextDueAt: null, nextFullDueAt: null, retryAttempt: 0, retryKind: null,
    retryDueAt: null, pendingManualKind: null, catchUpRequested: false, lastAttemptAt: null, lastSuccessAt: null,
    lastFullReconciliationAt: null, lastObservedCursor: null, lastObservedLineageId: null, lastObservedBankGeneration: null,
    consecutiveFailures: 0, errorCode: null, nextAction: null, createdAt: AT, updatedAt: AT, checkpoint: null, lag: null, ...patch,
  };
}

export function localStatus(): MemoryAuthorityStatus {
  return {
    authority: { mode: "canonical-local", epochId: "epoch-1", providerLineageId: null },
    runtime: { providerId: "local", available: true, unavailableReason: null },
    setup, replica: null, pending: null, operations: { active: [], recent: [] }, hindsight: null, derivedFreshness: "unknown", observedAt: AT,
  };
}

export function hindsightStatus(patch: Partial<MemoryAuthorityStatus> = {}): MemoryAuthorityStatus {
  return {
    ...localStatus(),
    authority: { mode: "hindsight", epochId: "epoch-2", providerLineageId: "11111111-1111-4111-8111-111111111111" },
    runtime: { providerId: "hindsight", available: true, unavailableReason: null },
    replica: [bankStatus("global")],
    pending: [{ bankId: "global", parentWritesPending: 2,
      summary: { pendingCount: 1, nativeConfirmedCount: 0, completedCount: 4, supersededCount: 0, failedCount: 0, unknownCount: 1, cancelledCount: 0 } }],
    hindsight: { connection: { config: "ready", drift: "none", admittedAt: AT },
      banks: [{ scope: "global", characterId: null, nativeBankId: "global", readiness: "ready", errorCode: null }], actions: { revalidate: false, provision: [] } },
    ...patch,
  };
}

export function operation(patch: Partial<MemoryOperation> = {}): MemoryOperation {
  return {
    operationId: OPERATION_ID, kind: "replica.sync", state: "admitted", reason: null, authorityEpochId: "epoch-2",
    request: { kind: "replica.sync", bankId: "global", syncKind: "incremental" },
    producer: { kind: "replica", bankId: "global", admittedAt: AT }, result: null, errorCode: null,
    createdAt: AT, updatedAt: AT, terminalAt: null, ...patch,
  };
}

type LifecycleBank = MemoryHindsightStatusSection["banks"][number];

export function lifecycleBank(characterId: string | null, readiness: HindsightBankReadiness, errorCode: HindsightErrorCode | null = null): LifecycleBank {
  const scope = characterId === null ? "global" : "character";
  const nativeBankId = readiness === "not_provisioned" ? null : characterId === null ? "global" : `character-${characterId}`;
  return { scope, characterId, nativeBankId, readiness, errorCode };
}

/** One Bank per readiness state, a changed configuration, revalidate offered and the two unserved Characters listed. */
export function lifecycleSection(patch: Partial<MemoryHindsightStatusSection> = {}): MemoryHindsightStatusSection {
  return {
    connection: { config: "ready", drift: "config_changed", admittedAt: AT },
    banks: [lifecycleBank(null, "ready"), lifecycleBank("taki", "syncing"), lifecycleBank("mika", "provisioning"),
      lifecycleBank("nana", "failed", "HINDSIGHT_BANK_OCCUPIED"), lifecycleBank("yui", "not_provisioned")],
    actions: { revalidate: true, provision: ["nana", "yui"] },
    ...patch,
  };
}

/** A Hindsight marker whose runtime is down for `reason`; replica and Pending evidence are absent as the schema requires. */
export function degradedStatus(hindsight: MemoryHindsightStatusSection = lifecycleSection(), reason: MemoryRuntimeUnavailableReason = "config_changed"): MemoryAuthorityStatus {
  return hindsightStatus({ runtime: { providerId: "hindsight", available: false, unavailableReason: reason }, replica: null, pending: null, hindsight });
}
