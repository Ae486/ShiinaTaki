/**
 * INPUT:  configured Banks, foreground retry requests, durable schedule/checkpoints, and the bounded replica data-plane runner
 * OUTPUT: one sync/review/retry wake, supervised policy dispatch, bounded diagnostics and persisted per-Bank status
 * POS:    core/memory/hindsight — deterministic B5 scheduling; no chat, Heartbeat policy, Pending replay, or authority wiring
 */
import { z } from "zod";
import { AsyncResource } from "node:async_hooks";
import {
  MemoryReplicaBankSchema, MemoryReplicaSyncStatusSchema, REPLICA_RETRY_DELAYS_MS,
  type MemoryReplicaBank, type MemoryReplicaErrorCode, type MemoryReplicaRunKind,
  type MemoryReplicaSyncState, type MemoryReplicaSyncStatus,
  type MemoryReplicaScheduleConfig,
} from "@taki/shared";
import type { HindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import type { Logger } from "../../logging/logger.ts";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import { replicaNextWake } from "../../db/hindsight-replica-schedule-state.ts";
import { executeHindsightReplicaRun } from "./hindsight-replica-run-execution.ts";
import { replicaErrorCode } from "./hindsight-replica-errors.ts";
import type { HindsightReplicaSchedulerRunner } from "./hindsight-replica-sync-runner.ts";
import type { HindsightPolicySchedule } from "./hindsight-policy-schedule.ts";

export interface HindsightReplicaScheduler {
  request: HindsightReplicaSchedulerRepo["request"];
  start(): void;
  stop(): Promise<void>;
  /** Stops new scheduler admissions and settles the accepted run without cancelling its actual producer. */
  pause(): Promise<void>;
  /** Irreversibly closes this scheduler's dispatch without awaiting a lost Native reply. */
  retire(): void;
  tick(): Promise<void>;
  requestManual(bankId: string, kind?: MemoryReplicaRunKind, requestId?: string): MemoryReplicaSyncStatus;
  /** Arms existing automatic recovery; scheduling errors stay observable without changing a durable write receipt. */
  requestRetry(bankId: string, dueAt: string): void;
  /** Cancels the exact queued request even while a prior run is active; claimed requests refuse. */
  cancelManual(bankId: string, requestId?: string): MemoryReplicaSyncStatus;
  verifiedReconnect(): void;
  status(bankId?: string): MemoryReplicaSyncStatus[];
  lastError(): MemoryReplicaErrorCode | null;
  started(): boolean;
  configure(bankId: string, config: MemoryReplicaScheduleConfig): MemoryReplicaSyncStatus;
  rearmPolicy(kind?: "replica" | "config" | "activity", bankId?: string): void;
}
interface SchedulerInput {
  repo: HindsightReplicaSchedulerRepo;
  replica: Pick<HindsightReplicaSyncRepo, "leases" | "checkpoint">;
  banks: MemoryReplicaBank[] | (() => MemoryReplicaBank[]);
  runner: HindsightReplicaSchedulerRunner;
  ownerId: string;
  logger?: Logger;
  runTimeoutMs?: number;
  leaseDurationMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  policy?: HindsightPolicySchedule;
}

export function createHindsightReplicaScheduler(input: SchedulerInput): HindsightReplicaScheduler & {
  statusForBanks(banks: readonly MemoryReplicaBank[]): MemoryReplicaSyncStatus[];
} {
  return new ReplicaScheduler(input);
}

class ReplicaScheduler implements HindsightReplicaScheduler {
  private readonly input: SchedulerInput;
  private readonly leaseDurationMs: number;
  private readonly runTimeoutMs: number;
  private running = false;
  private transitionPaused = false;
  private rerun = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private cancel: (() => void) | undefined;
  private error: MemoryReplicaErrorCode | null = null;
  private readonly supervisorRetries = new Map<string, number>();
  // A wake belongs to this scheduler, never to the foreground fence owner that happened to rearm it.
  private readonly wake = AsyncResource.bind(() => {
    this.timer = undefined;
    void this.tick().catch((error: unknown) => { this.error = replicaErrorCode(error); });
  }, "HindsightReplicaScheduler");

  constructor(input: SchedulerInput) {
    this.input = { ...input, ownerId: z.string().min(1).max(256).parse(input.ownerId) };
    this.leaseDurationMs = z.int().min(2).max(3_600_000).parse(input.leaseDurationMs ?? 61_000);
    this.runTimeoutMs = z.int().min(1).max(this.leaseDurationMs - 1).parse(input.runTimeoutMs ?? Math.min(60_000, this.leaseDurationMs - 1));
  }

  start(): void {
    if (this.transitionPaused) throw new Error("MEMORY_AUTHORITY_FENCED");
    if (this.running) return;
    for (const bank of this.banks()) {
      const state = this.input.repo.ensureBank({ bank });
      this.input.repo.recover(bank.bankId);
      this.input.repo.requestCatchUp(bank.bankId);
      if (state.automatic) this.supervisorRetries.delete(bank.bankId);
    }
    this.running = true;
    this.input.policy?.start();
    this.armTimer();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearWake();
    this.cancel?.();
    await Promise.all([this.active, this.input.policy?.stop()]);
  }

  async pause(): Promise<void> {
    this.transitionPaused = true;
    this.running = false;
    this.clearWake();
    for (const bank of this.banks()) {
      const requestId = this.input.repo.get(bank.bankId)?.pendingManualRequestId;
      if (requestId) this.input.repo.cancelManual(bank.bankId, requestId);
    }
    await Promise.all([this.active, this.input.policy?.stop()]);
  }

  retire(): void {
    this.transitionPaused = true;
    this.running = false;
    this.clearWake();
    this.cancel?.();
    this.input.policy?.retire();
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

  requestManual(bankId: string, kind: MemoryReplicaRunKind = "incremental", requestId?: string): MemoryReplicaSyncStatus {
    if (this.transitionPaused) throw new Error("MEMORY_AUTHORITY_FENCED");
    const bank = this.banks().find((candidate) => candidate.bankId === bankId);
    if (!bank) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    this.input.repo.ensureBank({ bank });
    this.input.repo.requestManual({ bankId, kind, requestId });
    this.supervisorRetries.delete(bankId);
    this.rerun = true;
    this.armTimer();
    const status = this.status(bankId)[0];
    if (!status) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    return status;
  }

  verifiedReconnect(): void {
    if (this.transitionPaused) throw new Error("MEMORY_AUTHORITY_FENCED");
    for (const bank of this.banks()) {
      const state = this.input.repo.ensureBank({ bank });
      this.input.repo.recover(bank.bankId);
      this.input.repo.requestCatchUp(bank.bankId);
      if (state.automatic) this.supervisorRetries.delete(bank.bankId);
    }
    this.rerun = true;
    this.input.policy?.changed();
    this.armTimer();
  }

  rearmPolicy(kind: "replica" | "config" | "activity" = "replica", bankId?: string): void {
    this.input.policy?.changed(kind, bankId); this.armTimer();
  }

  requestRetry(bankId: string, dueAt: string): void {
    try {
      if (this.transitionPaused) throw new Error("MEMORY_AUTHORITY_FENCED");
      const bank = this.banks().find((candidate) => candidate.bankId === bankId);
      if (!bank) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
      this.input.repo.ensureBank({ bank });
      this.input.repo.requestRetry(bankId, dueAt);
      this.rerun = true;
    } catch (error) { this.error = replicaErrorCode(error); }
    this.armTimer();
  }

  status(bankId?: string): MemoryReplicaSyncStatus[] {
    return this.statusForBanks(this.banks().filter((bank) => bankId === undefined || bank.bankId === bankId));
  }

  /** Operator projection over Banks verified in the caller's current SQLite read snapshot; never admits work. */
  statusForBanks(banks: readonly MemoryReplicaBank[]): MemoryReplicaSyncStatus[] {
    return orderedBanks(banks).flatMap((bank) => {
      const state = this.input.repo.get(bank.bankId);
      return state ? [this.projectStatus(state)] : [];
    });
  }

  lastError(): MemoryReplicaErrorCode | null { return this.error; }
  request(requestId: string) { return this.input.repo.request(requestId); }

  started(): boolean { return this.running; }

  configure(bankId: string, config: MemoryReplicaScheduleConfig): MemoryReplicaSyncStatus {
    if (this.transitionPaused) throw new Error("MEMORY_AUTHORITY_FENCED");
    const bank = this.banks().find((candidate) => candidate.bankId === bankId);
    if (!bank) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    const state = this.input.repo.ensureBank({ bank, config });
    this.armTimer();
    return this.projectStatus(state);
  }

  cancelManual(bankId: string, requestId?: string): MemoryReplicaSyncStatus {
    this.input.repo.cancelManual(bankId, requestId);
    const status = this.status(bankId)[0];
    if (!status) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
    return status;
  }

  private banks(): MemoryReplicaBank[] {
    return orderedBanks(typeof this.input.banks === "function" ? this.input.banks() : this.input.banks);
  }

  private async drain(): Promise<void> {
    do {
      this.rerun = false;
      for (const bank of this.banks()) {
        if (!this.running) return;
        let requestId: string | null | undefined;
        try { requestId = this.input.repo.get(bank.bankId)?.pendingManualRequestId; await this.runBank(bank); }
        catch (error) {
          this.error = replicaErrorCode(error);
          if (requestId) {
            // Persist only the request this Bank actually attempted. If storage itself failed, retain the open
            // identity for later inspection; a process-global supervisor diagnostic cannot settle it.
            try { this.input.repo.failManual({ bankId: bank.bankId, requestId, errorCode: this.error }); }
            catch { /* No durable outcome was written; never manufacture one in the operation projection. */ }
          }
          // The database may be unable to persist failure state. Bound supervisor wakes without fabricating a run.
          this.supervisorRetries.set(bank.bankId, Date.parse(this.input.repo.now()) + REPLICA_RETRY_DELAYS_MS[0]);
        }
      }
    } while (this.rerun && this.running);
    if (this.supervisorRetries.size === 0) this.error = null;
    // Model work never extends the serial Bank drain or the replica lease lifetime.
    this.input.policy?.dispatch(this.banks(), () => this.armTimer());
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
      leases: this.input.replica.leases, timeoutMs: Math.min(remaining, this.runTimeoutMs), logger: this.input.logger });
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
      const policyWake = this.input.policy?.nextWake();
      if (policyWake) due.push(policyWake);
    } catch (error) { this.error = replicaErrorCode(error); return; }
    if (due.length === 0) return;
    const delay = Math.max(0, Math.min(60 * 60_000, Math.min(...due.map(Date.parse)) - Date.parse(now)));
    const setTimer = this.input.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.timer = setTimer(this.wake, delay);
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

function orderedBanks(source: readonly MemoryReplicaBank[]): MemoryReplicaBank[] {
  const banks = source.map((bank) => MemoryReplicaBankSchema.parse(bank));
  if (new Set(banks.map((bank) => bank.bankId)).size !== banks.length) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  return banks.sort((a, b) => a.scope === b.scope ? a.bankId.localeCompare(b.bankId) : a.scope === "global" ? -1 : 1);
}
