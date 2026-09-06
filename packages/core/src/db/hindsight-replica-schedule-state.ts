/**
 * INPUT:  validated Bank scheduling state and one captured clock value
 * OUTPUT: deterministic due selection, configuration changes, and retry transitions
 * POS:    core/db — pure policy for the fenced replica scheduler repository
 */
import {
  MemoryReplicaSyncStateSchema, REPLICA_RETRY_DELAYS_MS,
  type MemoryReplicaBank, type MemoryReplicaErrorCode, type MemoryReplicaScheduleConfig,
  type MemoryReplicaScheduledRun, type MemoryReplicaSyncState,
} from "@taki/shared";

type Due = Pick<MemoryReplicaScheduledRun, "kind" | "trigger">;

export function initialReplicaSchedule(input: { bank: MemoryReplicaBank; config: MemoryReplicaScheduleConfig; now: string }): MemoryReplicaSyncState {
  return MemoryReplicaSyncStateSchema.parse({
    ...input.bank, ...input.config, mode: "idle", run: null, fullReconciliationState: "idle",
    nextDueAt: input.config.automatic ? input.now : null,
    nextFullDueAt: input.config.automatic ? after(input.now, input.config.fullReconciliationIntervalMs) : null,
    retryAttempt: 0, retryKind: null, retryDueAt: null, pendingManualKind: null, catchUpRequested: false,
    lastAttemptAt: null, lastSuccessAt: null, lastFullReconciliationAt: null, lastObservedCursor: null,
    lastObservedLineageId: null, lastObservedBankGeneration: null, consecutiveFailures: 0,
    errorCode: null, nextAction: null, createdAt: input.now, updatedAt: input.now,
  });
}

export function configureReplicaSchedule(state: MemoryReplicaSyncState, config: MemoryReplicaScheduleConfig, now: string): MemoryReplicaSyncState {
  const automatic = config.automatic;
  return { ...state, ...config,
    nextDueAt: automatic ? state.lastSuccessAt === null ? now : after(state.lastSuccessAt, config.autoIntervalMs) : null,
    nextFullDueAt: automatic ? after(state.lastFullReconciliationAt ?? state.createdAt, config.fullReconciliationIntervalMs) : null,
    retryAttempt: automatic ? state.retryAttempt : 0, retryKind: automatic ? state.retryKind : null,
    retryDueAt: automatic ? state.retryDueAt : null, catchUpRequested: automatic && state.catchUpRequested,
    nextAction: state.errorCode === null ? null : automatic ? "automatic_retry_scheduled" : "explicit_retry_required",
    updatedAt: now,
  };
}

export function replicaScheduleDue(state: MemoryReplicaSyncState, now: string): Due | undefined {
  if (state.run !== null) return undefined;
  if (state.pendingManualKind !== null) return { kind: state.pendingManualKind, trigger: "manual" };
  if (!state.automatic) return undefined;
  if (state.catchUpRequested) {
    return { kind: isDue(state.nextFullDueAt, now) ? "full" : state.retryKind ?? "incremental", trigger: "catch_up" };
  }
  // A future retry owns the wake. An already-overdue ordinary/full poll must not create a retry storm.
  if (state.retryDueAt !== null) {
    return isDue(state.retryDueAt, now) ? { kind: state.retryKind ?? "incremental", trigger: "retry" } : undefined;
  }
  if (isDue(state.nextFullDueAt, now)) return { kind: "full", trigger: "interval" };
  if (isDue(state.nextDueAt, now)) return { kind: "incremental", trigger: "interval" };
  return undefined;
}

export function replicaNextWake(state: MemoryReplicaSyncState, now: string): string | null {
  if (state.run) return state.run.lease.expiresAt;
  if (replicaScheduleDue(state, now)) return now;
  if (!state.automatic) return null;
  if (state.retryDueAt) return state.retryDueAt;
  const dates = [state.nextDueAt, state.nextFullDueAt].filter((value): value is string => value !== null);
  return dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

export function failedReplicaSchedule(state: MemoryReplicaSyncState, code: MemoryReplicaErrorCode, now: string): MemoryReplicaSyncState {
  const attempt = state.automatic ? Math.min(REPLICA_RETRY_DELAYS_MS.length, state.retryAttempt + 1) : 0;
  const delay = REPLICA_RETRY_DELAYS_MS[attempt - 1];
  return { ...state, mode: "failed", run: null,
    fullReconciliationState: state.run?.kind === "full" ? "failed" : state.fullReconciliationState,
    retryAttempt: attempt, retryKind: state.automatic ? state.run?.kind ?? "incremental" : null,
    retryDueAt: delay === undefined ? null : after(now, delay),
    consecutiveFailures: Math.min(Number.MAX_SAFE_INTEGER, state.consecutiveFailures + 1), errorCode: code,
    nextAction: state.automatic ? "automatic_retry_scheduled" : "explicit_retry_required", updatedAt: now,
  };
}

export function after(now: string, delayMs: number): string { return new Date(Date.parse(now) + delayMs).toISOString(); }
function isDue(value: string | null, now: string): boolean { return value !== null && Date.parse(value) <= Date.parse(now); }
