/**
 * INPUT:  validated Bank scheduling state and one captured clock value
 * OUTPUT: deterministic due/configuration transitions and earliest in-flight retry; a provider rollback holds the Bank for
 *         explicit runs only
 * POS:    core/db — pure policy for the fenced replica scheduler repository
 */
import {
  MemoryReplicaSyncStateSchema, REPLICA_RETRY_DELAYS_MS,
  type MemoryReplicaBank, type MemoryReplicaErrorCode, type MemoryReplicaScheduleConfig,
  type MemoryReplicaScheduledRun, type MemoryReplicaSyncState,
} from "@taki/shared";
import type { PendingRecoveryState } from "./hindsight-pending-recovery-state.ts";

type Due = Pick<MemoryReplicaScheduledRun, "kind" | "trigger">;

// Native stays behind Taki on the same lineage until an operator restores a verified pair or decides; a timed run only refuses again.
function heldForOperator(code: MemoryReplicaErrorCode | null): boolean { return code === "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED"; }

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
  const resumeWaiting = automatic && state.mode === "waiting" && state.retryDueAt === null;
  return { ...state, ...config,
    nextDueAt: automatic ? state.lastSuccessAt === null ? now : after(state.lastSuccessAt, config.autoIntervalMs) : null,
    nextFullDueAt: automatic ? after(state.lastFullReconciliationAt ?? state.createdAt, config.fullReconciliationIntervalMs) : null,
    retryAttempt: automatic ? state.retryAttempt : 0,
    retryKind: !automatic ? null : resumeWaiting ? state.fullReconciliationState === "waiting" ? "full" : "incremental" : state.retryKind,
    retryDueAt: !automatic ? null : resumeWaiting ? now : state.retryDueAt, catchUpRequested: automatic && state.catchUpRequested,
    nextAction: state.errorCode === null && state.nextAction === null ? null
      : automatic && !heldForOperator(state.errorCode) ? "automatic_retry_scheduled" : "explicit_retry_required",
    updatedAt: now,
  };
}

export function replicaScheduleDue(state: MemoryReplicaSyncState, now: string): Due | undefined {
  if (state.run !== null) return undefined;
  if (state.pendingManualKind !== null) return { kind: state.pendingManualKind, trigger: "manual" };
  if (!state.automatic || heldForOperator(state.errorCode)) return undefined;
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
  if (!state.automatic || heldForOperator(state.errorCode)) return null;
  if (state.retryDueAt) return state.retryDueAt;
  const dates = [state.nextDueAt, state.nextFullDueAt].filter((value): value is string => value !== null);
  return dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

export function requestReplicaRetry(state: MemoryReplicaSyncState, dueAt: string, now: string): MemoryReplicaSyncState {
  if (!state.automatic || heldForOperator(state.errorCode)) return state;
  const wake = replicaNextWake(state, now);
  let retryDueAt = wake !== null && Date.parse(wake) < Date.parse(dueAt) ? wake : dueAt;
  if (state.run !== null && state.retryDueAt !== null && Date.parse(state.retryDueAt) < Date.parse(retryDueAt)) {
    retryDueAt = state.retryDueAt;
  }
  const waiting = state.mode === "waiting" || state.run !== null && state.errorCode === null && state.nextAction !== null;
  return { ...state, retryDueAt, retryAttempt: waiting ? state.retryAttempt : Math.max(1, state.retryAttempt),
    retryKind: state.retryKind ?? (isDue(state.nextFullDueAt, retryDueAt) ? "full" : "incremental") };
}

export function failedReplicaSchedule(state: MemoryReplicaSyncState, code: MemoryReplicaErrorCode, now: string): MemoryReplicaSyncState {
  const automatic = state.automatic && !heldForOperator(code);
  const attempt = automatic ? Math.min(REPLICA_RETRY_DELAYS_MS.length, state.retryAttempt + 1) : 0;
  const delay = REPLICA_RETRY_DELAYS_MS[attempt - 1];
  return { ...state, mode: "failed", run: null,
    fullReconciliationState: state.run?.kind === "full" ? "failed" : state.fullReconciliationState,
    retryAttempt: attempt, retryKind: automatic ? state.run?.kind ?? "incremental" : null,
    retryDueAt: delay === undefined ? null : after(now, delay),
    consecutiveFailures: Math.min(Number.MAX_SAFE_INTEGER, state.consecutiveFailures + 1), errorCode: code,
    nextAction: automatic ? "automatic_retry_scheduled" : "explicit_retry_required", updatedAt: now,
  };
}

export function pendingReplicaSchedule(state: MemoryReplicaSyncState, pending: PendingRecoveryState, now: string): MemoryReplicaSyncState {
  if (pending.unresolvedCount === 0 || pending.waitingCount !== pending.unresolvedCount) {
    const failed = failedReplicaSchedule(state, pending.blockingErrorCode ?? "HINDSIGHT_PENDING_REMAINS", now);
    return pending.nextRetryAt === null || Date.parse(pending.nextRetryAt) <= Date.parse(now)
      ? failed : requestReplicaRetry(failed, pending.nextRetryAt, now);
  }
  // Already-due ordinary intervals and a consumed lease are not new Pending work. Only a future row owns this wake.
  const retryDueAt = pending.nextRetryAt !== null && Date.parse(pending.nextRetryAt) > Date.parse(now)
    ? pending.nextRetryAt : after(now, REPLICA_RETRY_DELAYS_MS[0]);
  return { ...state, mode: "waiting", run: null,
    fullReconciliationState: state.run?.kind === "full" ? "waiting" : state.fullReconciliationState,
    retryDueAt: state.automatic ? retryDueAt : null,
    retryKind: state.automatic ? state.run?.kind ?? "incremental" : null,
    errorCode: null, nextAction: state.automatic ? "automatic_retry_scheduled" : "explicit_retry_required", updatedAt: now,
  };
}

export function after(now: string, delayMs: number): string { return new Date(Date.parse(now) + delayMs).toISOString(); }
function isDue(value: string | null, now: string): boolean { return value !== null && Date.parse(value) <= Date.parse(now); }
