/**
 * INPUT:  none — test-only programmable doubles for the B5 scheduler and the B3 setup service
 * OUTPUT: fakeRuntime() / fakeSetup() / replicaState() / setupSnapshot() / seedHindsightAuthority() used by the operation owner tests
 * POS:    core/memory/operations — test support; not in the production path
 */
import { vi } from "vitest";
import type { HindsightSetupSnapshot, MemoryReplicaBank, MemoryReplicaRunKind, MemoryReplicaSyncStatus } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { createCanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import type { HindsightSetupService } from "../hindsight/hindsight-setup-service.ts";
import type { HindsightConnectionDrift } from "../hindsight/hindsight-runtime-connection.ts";
import type { MemoryOperationsRuntime } from "./memory-operation-contract.ts";

export const AT = "2026-09-19T00:00:00.000Z";
export const GLOBAL: MemoryReplicaBank = { bankId: "global", scope: "global", characterId: null };
export const CHARACTER: MemoryReplicaBank = { bankId: "character", scope: "character", characterId: "taki" };

export function replicaState(bank: MemoryReplicaBank, patch: Partial<MemoryReplicaSyncStatus> = {}): MemoryReplicaSyncStatus {
  return {
    bankId: bank.bankId, scope: bank.scope, characterId: bank.characterId, automatic: true,
    autoIntervalMs: 6 * 60 * 60_000, fullReconciliationIntervalMs: 7 * 24 * 60 * 60_000, mode: "idle", run: null,
    fullReconciliationState: "idle", nextDueAt: null, nextFullDueAt: null, retryAttempt: 0, retryKind: null, retryDueAt: null,
    pendingManualKind: null, catchUpRequested: false, lastAttemptAt: null, lastSuccessAt: null, lastFullReconciliationAt: null,
    lastObservedCursor: null, lastObservedLineageId: null, lastObservedBankGeneration: null, consecutiveFailures: 0,
    errorCode: null, nextAction: null, createdAt: AT, updatedAt: AT, checkpoint: null, lag: null, ...patch,
  };
}

function claimedRun(bank: MemoryReplicaBank, at: string): NonNullable<MemoryReplicaSyncStatus["run"]> {
  return { kind: "incremental", trigger: "manual", predecessor: null,
    lease: { bankId: bank.bankId, runId: "11111111-1111-4111-8111-111111111111", ownerId: "process", fence: 1, expiresAt: at } };
}

/** Outcome program applied to each pending manual request when a tick runs; `claim` leaves the run in flight. */
export type TickOutcome =
  | { kind: "success" }
  | { kind: "failure"; errorCode: NonNullable<MemoryReplicaSyncStatus["errorCode"]>; automatic?: boolean }
  | { kind: "claim" }
  | { kind: "supervisor"; errorCode: NonNullable<MemoryReplicaSyncStatus["errorCode"]>; automatic?: boolean };

function applyOutcome(current: MemoryReplicaSyncStatus, outcome: TickOutcome, at: string): MemoryReplicaSyncStatus {
  const bank = { bankId: current.bankId, scope: current.scope, characterId: current.characterId };
  if (current.pendingManualKind === null || current.run !== null) return current;
  if (outcome.kind === "claim") return { ...current, mode: "running", run: claimedRun(bank, at), pendingManualKind: null, lastAttemptAt: at };
  if (outcome.kind === "supervisor") return { ...current, automatic: outcome.automatic ?? true };
  if (outcome.kind === "success") {
    return { ...current, run: null, mode: "idle", pendingManualKind: null, lastAttemptAt: at, lastSuccessAt: at, errorCode: null, nextAction: null };
  }
  const automatic = outcome.automatic ?? true;
  // Claim consumes the manual request in the real repo regardless of mode; failure never restores it.
  return { ...current, run: null, mode: "failed", automatic, pendingManualKind: null, lastAttemptAt: at,
    errorCode: outcome.errorCode, nextAction: automatic ? "automatic_retry_scheduled" : "explicit_retry_required", consecutiveFailures: current.consecutiveFailures + 1 };
}

type SchedulerView = MemoryOperationsRuntime["scheduler"];
export interface FakeScheduler extends SchedulerView {
  program(next: TickOutcome): void;
  /** Holds every tick until the returned release runs. */
  hold(): () => void;
  setStarted(value: boolean): void;
  settleClaimed(bankId: string, success: boolean): void;
}

function fakeScheduler(banks: MemoryReplicaBank[], clock: () => string) {
  const states = new Map(banks.map((bank) => [bank.bankId, replicaState(bank)]));
  const control = { started: true, error: null as MemoryReplicaSyncStatus["errorCode"], outcome: { kind: "success" } as TickOutcome, gate: null as Promise<void> | null };
  const required = (bankId: string) => { const state = states.get(bankId); if (!state) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED"); return state; };
  const scheduler: FakeScheduler = {
    started: () => control.started,
    start: vi.fn(() => { control.started = true; }),
    stop: vi.fn(async () => { control.started = false; }),
    setStarted: (value) => { control.started = value; },
    program: (next) => { control.outcome = next; },
    hold: () => { let release = (): void => undefined; control.gate = new Promise<void>((done) => { release = done; }); return () => { control.gate = null; release(); }; },
    requestManual: vi.fn((bankId: string, kind: MemoryReplicaRunKind = "incremental") => {
      const current = required(bankId);
      states.set(bankId, { ...current, pendingManualKind: current.pendingManualKind === "full" ? "full" : kind }); return required(bankId);
    }),
    cancelManual: vi.fn((bankId: string) => {
      const current = required(bankId);
      if (current.run !== null) throw new Error("HINDSIGHT_REPLICA_BUSY");
      states.set(bankId, { ...current, pendingManualKind: null }); return required(bankId);
    }),
    tick: vi.fn(async () => {
      if (!control.started) return;
      if (control.gate) await control.gate;
      for (const bank of banks) {
        if (control.outcome.kind === "supervisor" && required(bank.bankId).pendingManualKind !== null) control.error = control.outcome.errorCode;
        states.set(bank.bankId, applyOutcome(required(bank.bankId), control.outcome, clock()));
      }
    }),
    settleClaimed: (bankId, success) => {
      const current = required(bankId); const at = clock();
      states.set(bankId, { ...current, run: null, mode: success ? "idle" : "failed", lastSuccessAt: success ? at : current.lastSuccessAt,
        errorCode: success ? null : "HINDSIGHT_TIMEOUT", nextAction: success ? null : "automatic_retry_scheduled" });
    },
    status: (bankId?: string) => banks.filter((bank) => bankId === undefined || bank.bankId === bankId).map((bank) => required(bank.bankId)),
    lastError: () => control.error,
    verifiedReconnect: vi.fn(),
  };
  return { scheduler, states };
}

export interface FakeRuntime extends MemoryOperationsRuntime {
  scheduler: FakeScheduler;
  breakConnection(message: string | null): void;
  drift(reason: HindsightConnectionDrift): void;
}

export function fakeRuntime(banks: MemoryReplicaBank[], clock: () => string): FakeRuntime {
  const { scheduler } = fakeScheduler(banks, clock);
  let connectionError: string | null = null; let drift: HindsightConnectionDrift = "none";
  const driftReason = () => { if (connectionError) throw new Error(connectionError); return drift; };
  const guard = () => { if (driftReason() !== "none") throw new Error("MEMORY_AUTHORITY_MISMATCH"); };
  return {
    epochId: "epoch", configFingerprint: "a".repeat(64), deploymentMode: "existing-instance", scheduler, writeFence: createCanonicalLocalWriteFence(),
    banks: () => { guard(); return banks; },
    assertConnection: guard, driftReason,
    pendingSummary: () => ({ pendingCount: 0, nativeConfirmedCount: 0, completedCount: 0, supersededCount: 0, failedCount: 1, unknownCount: 2, cancelledCount: 0 }),
    breakConnection: (message) => { connectionError = message; },
    drift: (reason) => { drift = reason; },
  };
}

export function setupSnapshot(patch: Partial<HindsightSetupSnapshot> = {}): HindsightSetupSnapshot {
  return { revision: 3, phase: "compatible", lastSuccessfulPhase: "compatible", configFingerprint: "a".repeat(64), attemptId: "attempt-3",
    compatibility: null, banks: [], modelHealth: "not-run", latestError: null, lastAttemptAt: AT, lastSuccessAt: AT, updatedAt: AT, ...patch };
}

export interface FakeSetup extends HindsightSetupService { current: HindsightSetupSnapshot }

export function fakeSetup(current: HindsightSetupSnapshot = setupSnapshot()): FakeSetup {
  const service: FakeSetup = {
    current,
    status: () => service.current,
    validate: vi.fn(async () => service.current),
    setup: vi.fn(async () => service.current),
    disable: vi.fn(() => service.current),
    llmHealth: vi.fn(async () => ({ status: "healthy" as const, banks: [] })),
  };
  return service;
}

/** Explicit fixture SQL for a legal Hindsight authority marker; no production activation API is invoked. */
export function seedHindsightAuthority(db: Database): void {
  const lineage = "11111111-1111-4111-8111-111111111111"; const hex = (char: string) => char.repeat(64);
  db.exec(`INSERT INTO canonical_memory_authority_epochs (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('local-epoch','local','local-lineage','closed',NULL,'${AT}','${AT}','initial-local');
    INSERT INTO canonical_memory_authority_epochs (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
      VALUES ('epoch','hindsight','${lineage}','active','local-epoch','${AT}',NULL,'planned-switch');
    INSERT INTO canonical_memory_authority_state (singleton,active_epoch_id,updated_at) VALUES (1,'epoch','${AT}')
      ON CONFLICT(singleton) DO UPDATE SET active_epoch_id='epoch',updated_at='${AT}';
    INSERT INTO memory_migration_runs (run_id,snapshot_id,phase,status,requested_at,updated_at,lease_fence)
      VALUES ('run','snapshot','activated','completed','${AT}','${AT}',1);
    INSERT INTO hindsight_cutover_runs (run_id,expected_predecessor_epoch_id,phase,status,config_fingerprint,checkpoint_set_digest,lease_fence,created_at,updated_at)
      VALUES ('run','local-epoch','activated','completed','${hex("b")}','${hex("c")}',1,'${AT}','${AT}');
    INSERT INTO hindsight_authority_activation_receipts (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,
      config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
      VALUES ('tx','run','local-epoch','epoch','${lineage}','${hex("b")}','${hex("c")}',1,1,'${AT}');
    INSERT INTO hindsight_authority_bank_receipts (transaction_id,bank_id,snapshot_id,bank_generation,replica_epoch_id,end_cursor,manifest_digest,template_digest)
      VALUES ('tx','global','snapshot','${lineage}','${lineage}',0,'${hex("d")}','${hex("e")}');
    UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id='epoch',verified_snapshot_id=NULL,activation_transaction_id='tx',
      provider_lineage_id='${lineage}',replica_checkpoint_digest='${hex("c")}',updated_at='${AT}' WHERE singleton=1;`);
}
