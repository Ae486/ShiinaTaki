/**
 * INPUT:  none — hand-built MemoryAuthorityStatus / MemoryOperation values.
 * OUTPUT: localStatus() / hindsightStatus() / bankStatus() / operation() fixtures shared by the memory authority tests, plus
 *         lifecycleBank() / lifecycleSection() and the provisioning / changed / unreviewed / disabled sections (each shaped as
 *         Core derives it) plus degradedStatus() for the Hindsight connection + Bank readiness block.
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
      banks: [{ scope: "global", characterId: null, nativeBankId: "global", readiness: "ready", errorCode: null }], actions: { revalidate: false, provision: [] }, backup: null },
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
type Section = MemoryHindsightStatusSection;

export function lifecycleBank(characterId: string | null, readiness: HindsightBankReadiness, errorCode: HindsightErrorCode | null = null): LifecycleBank {
  return { scope: characterId === null ? "global" : "character", characterId, nativeBankId: characterId === null ? "global" : `character-${characterId}`,
    readiness, errorCode };
}

/** A Timeline Character past the 160-char Bank identity bound: Core shows it without a native id and never offers provision. */
export const UNMAPPABLE_CHARACTER = "u".repeat(161);
const BANKS: LifecycleBank[] = [lifecycleBank(null, "ready"), lifecycleBank("taki", "syncing"), lifecycleBank("nana", "failed", "HINDSIGHT_TEMPLATE_INVALID"),
  lifecycleBank("yui", "not_provisioned"), { scope: "character", characterId: UNMAPPABLE_CHARACTER, nativeBankId: null, readiness: "not_provisioned", errorCode: null }];
const NO_ACTIONS: Section["actions"] = { revalidate: false, provision: [] };

/** Serving runtime, nothing open: provision for the failed and the unprovisioned mappable Characters only. */
export function lifecycleSection(patch: Partial<Section> = {}): Section {
  return { connection: { config: "ready", drift: "none", admittedAt: AT }, banks: BANKS, actions: { revalidate: false, provision: ["nana", "yui"] }, backup: null, ...patch };
}

/** An open bank.provision for mika: every action is withheld while an exclusive family runs. */
export function provisioningSection(): Section {
  return lifecycleSection({ banks: [...BANKS.slice(0, 2), lifecycleBank("mika", "provisioning"), ...BANKS.slice(2)], actions: NO_ACTIONS });
}

/** The connection changed under the bound runtime: revalidate only; provision waits for a serving runtime. */
function changedSection(): Section {
  return lifecycleSection({ connection: { config: "ready", drift: "config_changed", admittedAt: null }, actions: { revalidate: true, provision: [] } });
}

/** Booted on an edited but unreviewed config: the runtime serves, so revalidate and provision are both offered. */
export function unreviewedSection(): Section {
  return lifecycleSection({ connection: { config: "ready", drift: "unreviewed", admittedAt: null }, actions: { revalidate: true, provision: ["nana", "yui"] } });
}

export function disabledSection(config: "disabled" | "unconfigured" = "disabled"): Section {
  return lifecycleSection({ connection: { config, drift: "none", admittedAt: null }, actions: NO_ACTIONS });
}

/** A Hindsight marker whose runtime is down for `reason`; replica and Pending evidence are absent as the schema requires. */
export function degradedStatus(hindsight: Section = changedSection(), reason: MemoryRuntimeUnavailableReason = "config_changed"): MemoryAuthorityStatus {
  return hindsightStatus({ runtime: { providerId: "hindsight", available: false, unavailableReason: reason }, replica: null, pending: null, hindsight });
}
