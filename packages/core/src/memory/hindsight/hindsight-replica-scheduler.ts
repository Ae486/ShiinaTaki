/**
 * INPUT:  configured Banks, durable schedule/checkpoints, and the bounded replica data-plane runner
 * OUTPUT: asynchronous single-flight execution, bounded supervisor retries, and truthful per-Bank status
 * POS:    core/memory/hindsight — deterministic B5 scheduling; no chat, Heartbeat policy, Pending replay, or authority wiring
 */
import { z } from "zod";
import {
  MemoryReplicaBankSchema, MemoryReplicaSyncStatusSchema, REPLICA_RETRY_DELAYS_MS,
  type MemoryReplicaBank, type MemoryReplicaErrorCode, type MemoryReplicaRunKind,
  type MemoryReplicaSyncState, type MemoryReplicaSyncStatus,
} from "@taki/shared";
import type { HindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { replicaNextWake } from "../../db/hindsight-replica-schedule-state.ts";
import { executeHindsightReplicaRun } from "./hindsight-replica-run-execution.ts";
import { replicaErrorCode } from "./hindsight-replica-errors.ts";
import type { HindsightReplicaSchedulerRunner } from "./hindsight-replica-sync-runner.ts";

export interface HindsightReplicaScheduler {
  start(): void;
  stop(): Promise<void>;
  tick(): Promise<void>;
  requestManual(bankId: string, kind?: MemoryReplicaRunKind): MemoryReplicaSyncStatus;
  /** Clears an unclaimed manual request; throws HINDSIGHT_REPLICA_BUSY once the run is claimed. */
  cancelManual(bankId: string): MemoryReplicaSyncStatus;
  verifiedReconnect(): void;
  status(bankId?: string): MemoryReplicaSyncStatus[];
  lastError(): MemoryReplicaErrorCode | null;
  started(): boolean;
}
interface SchedulerInput {
  repo: HindsightReplicaSchedulerRepo;
  replica: Pick<HindsightReplicaSyncRepo, "leases" | "checkpoint">;
  banks: MemoryReplicaBank[] | (() => MemoryReplicaBank[]);
  runner: HindsightReplicaSchedulerRunner;
  ownerId: string;
  runTimeoutMs?: number;
  leaseDurationMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export function createHindsightReplicaScheduler(input: SchedulerInput): HindsightReplicaScheduler {
  return new ReplicaScheduler(input);
}

class ReplicaScheduler implements HindsightReplicaScheduler {
  private readonly input: SchedulerInput;
  private readonly leaseDurationMs: number;
  private readonly runTimeoutMs: number;
  private running = false;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private cancel: (() => void) | undefined;
  private error: MemoryReplicaErrorCode | null = null;
  private readonly supervisorRetries = new Map<string, number>();

  constructor(input: SchedulerInput) {
    this.input = { ...input, ownerId: z.string().min(1).max(256).parse(input.ownerId) };
    this.leaseDurationMs = z.int().min(2).max(3_600_000).parse(input.leaseDurationMs ?? 61_000);
    this.runTimeoutMs = z.int().min(1).max(this.leaseDurationMs - 1).parse(input.runTimeoutMs ?? Math.min(60_000, this.leaseDurationMs - 1));
  }

  start(): void {
    if (this.running) return;
    for (const bank of this.banks()) {
      const state = this.input.repo.ensureBank({ bank });
      this.input.repo.recover(bank.bankId);
      this.input.repo.requestCatchUp(bank.bankId);
      if (state.automatic) this.supervisorRetries.delete(bank.bankId);
    }
    this.running = true;
    this.armTimer();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearWake();
    this.cancel?.();
    await this.active;
  }

  tick(): Promise<void> {
    if (this.active) return this.active;
    if (!this.running) return Promise.resolve();
    this.clearWake();
    this.active = this.drain().finally(() => {
      this.active = undefined;
      this.armTimer();
    });
    return this.active;
  }

  requestManual(bankId: string, kind: MemoryReplicaRunKind = "incremental"): MemoryReplicaSyncStatus {
    const bank = this.banks().find((candidate) => candidate.bankId === bankId);
    if (!bank) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    this.input.repo.ensureBank({ bank });
    this.input.repo.requestManual({ bankId, kind });
    this.supervisorRetries.delete(bankId);
    this.rerun = true;
    this.armTimer();
    const status = this.status(bankId)[0];
    if (!status) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    return status;
  }

  verifiedReconnect(): void {
    for (const bank of this.banks()) {
      const state = this.input.repo.ensureBank({ bank });
      this.input.repo.recover(bank.bankId);
      this.input.repo.requestCatchUp(bank.bankId);
      if (state.automatic) this.supervisorRetries.delete(bank.bankId);
    }
    this.rerun = true;
    this.armTimer();
  }

  status(bankId?: string): MemoryReplicaSyncStatus[] {
    return this.banks().filter((bank) => bankId === undefined || bank.bankId === bankId).flatMap((bank) => {
      const state = this.input.repo.get(bank.bankId);
      return state ? [this.projectStatus(state)] : [];
    });
  }

  lastError(): MemoryReplicaErrorCode | null { return this.error; }

  started(): boolean { return this.running; }

  cancelManual(bankId: string): MemoryReplicaSyncStatus {
    this.input.repo.cancelManual(bankId);
    const status = this.status(bankId)[0];
    if (!status) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    return status;
  }

  private banks(): MemoryReplicaBank[] {
    const source = typeof this.input.banks === "function" ? this.input.banks() : this.input.banks;
    const banks = source.map((bank) => MemoryReplicaBankSchema.parse(bank));
    if (new Set(banks.map((bank) => bank.bankId)).size !== banks.length) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
    return banks.sort((a, b) => a.scope === b.scope ? a.bankId.localeCompare(b.bankId) : a.scope === "global" ? -1 : 1);
  }

  private async drain(): Promise<void> {
    do {
      this.rerun = false;
      for (const bank of this.banks()) {
        if (!this.running) return;
        try { await this.runBank(bank); }
        catch (error) {
          this.error = replicaErrorCode(error);
          // The database may be unable to persist failure state. Bound supervisor wakes without fabricating a run.
          this.supervisorRetries.set(bank.bankId, Date.parse(this.input.repo.now()) + REPLICA_RETRY_DELAYS_MS[0]);
        }
      }
    } while (this.rerun && this.running);
    if (this.supervisorRetries.size === 0) this.error = null;
  }

  private async runBank(bank: MemoryReplicaBank): Promise<void> {
    const state = this.input.repo.ensureBank({ bank });
    const retryAt = this.supervisorRetries.get(bank.bankId);
    if (retryAt !== undefined && (!state.automatic || retryAt > Date.parse(this.input.repo.now()))) return;
    this.supervisorRetries.delete(bank.bankId);
    const run = this.input.repo.claim({ bankId: bank.bankId, ownerId: this.input.ownerId, leaseDurationMs: this.leaseDurationMs });
    if (!run) return;
    const remaining = Date.parse(run.lease.expiresAt) - Date.parse(this.input.repo.now()) - 1;
    if (remaining <= 0) { this.input.repo.recover(bank.bankId); return; }
    const execution = executeHindsightReplicaRun({ bank, run, repo: this.input.repo, runner: this.input.runner,
      leases: this.input.replica.leases, timeoutMs: Math.min(remaining, this.runTimeoutMs) });
    this.cancel = execution.cancel;
    try { await execution.completion; }
    finally { this.cancel = undefined; }
  }

  private projectStatus(state: MemoryReplicaSyncState): MemoryReplicaSyncStatus {
    const checkpoint = this.input.replica.checkpoint(state.bankId) ?? null;
    const bound = checkpoint !== null && checkpoint.providerLineageId === state.lastObservedLineageId
      && checkpoint.bankGeneration === state.lastObservedBankGeneration;
    const lag = bound && state.lastObservedCursor !== null && state.lastObservedCursor >= checkpoint.endCursor
      ? state.lastObservedCursor - checkpoint.endCursor : null;
    return MemoryReplicaSyncStatusSchema.parse({ ...state, checkpoint, lag });
  }

  private armTimer(): void {
    this.clearWake();
    if (!this.running || this.active) return;
    let now: string; let due: string[];
    // Callers arm from settle paths; a drifted connection refusing banks() must surface as lastError, not an escaped rejection.
    try {
      now = this.input.repo.now();
      due = this.status().map((state) => this.nextWake(state, now)).filter((value): value is string => value !== null);
    } catch (error) { this.error = replicaErrorCode(error); return; }
    if (due.length === 0) return;
    const delay = Math.max(0, Math.min(60 * 60_000, Math.min(...due.map(Date.parse)) - Date.parse(now)));
    const setTimer = this.input.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.timer = setTimer(() => {
      this.timer = undefined;
      void this.tick().catch((error: unknown) => { this.error = replicaErrorCode(error); });
    }, delay);
    this.timer.unref?.();
  }

  private nextWake(state: MemoryReplicaSyncState, now: string): string | null {
    const wake = replicaNextWake(state, now);
    const retryAt = this.supervisorRetries.get(state.bankId);
    if (retryAt === undefined || wake === null) return wake;
    // A failed manual claim retains its request for inspection/restart, but only an explicit action may retry it here.
    if (!state.automatic) return null;
    return new Date(Math.max(Date.parse(wake), retryAt)).toISOString();
  }

  private clearWake(): void {
    if (this.timer !== undefined) (this.input.clearTimer ?? clearTimeout)(this.timer);
    this.timer = undefined;
  }
}
