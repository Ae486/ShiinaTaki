/**
 * INPUT:  configured Banks, committed replica notifications, curator journal, activity/fences and calendar config
 * OUTPUT: supervised Bank-scoped review, durable catch-up/retry obligations and committed operator invalidations
 * POS:    core/memory/hindsight — no timer or replica lease; one lane resumes saved work before new assessments
 */
import { REPLICA_RETRY_DELAYS_MS, type MemoryReplicaBank } from "@taki/shared";
import type { TurnRegistry } from "../../agents/turn-registry.ts";
import type { HindsightPolicyReviewConfig } from "../../config/hindsight-policy-config.ts";
import type { Database } from "../../db/sqlite.ts";
import { createHindsightPolicyReviewRepo, type HindsightPolicyReviewProgress } from "../../db/hindsight-policy-review-repo.ts";
import { readHindsightPolicyWorkProgress } from "../../db/hindsight-policy-work-progress.ts";
import type { HindsightPolicyCurator, HindsightPolicyCuratorDeps } from "./hindsight-policy-curator.ts";
import { inspectPolicyReviewBank } from "./hindsight-policy-review-inventory.ts";
import { policyScheduleRevision, reconcilePolicySchedule, requirePolicyOccurrence } from "./hindsight-policy-schedule-state.ts";

export const POLICY_REVIEW_IDLE_MS = 5_000;
export interface HindsightPolicySchedule {
  start(): void;
  changed(kind?: "replica" | "config" | "activity", bankId?: string): void;
  nextWake(): string | null;
  dispatch(banks: readonly MemoryReplicaBank[], rearm: () => void): void;
  stop(): Promise<void>;
  retire(): void;
}
interface Input {
  db: Database; deps: HindsightPolicyCuratorDeps; curator: HindsightPolicyCurator;
  config(): HindsightPolicyReviewConfig; timezone(): string; writable(): boolean;
  activity?: Pick<TurnRegistry, "idleSince">;
  onPolicyReviewChanged?: (bankId: string) => void;
  now(): string;
}

export function createHindsightPolicySchedule(input: Input): HindsightPolicySchedule {
  return new PolicySchedule(input);
}

class PolicySchedule implements HindsightPolicySchedule {
  private readonly input: Input;
  private readonly repo;
  private readonly progress = new Map<string, HindsightPolicyReviewProgress>();
  private controller = new AbortController();
  private active: Promise<void> | undefined;
  private running = false;
  private dirty = true;
  private readonly dirtyBanks = new Set<string>();
  private startup = true;
  private supervisorRetry: string | null = null;
  private readonly createdAt: string;

  constructor(input: Input) {
    this.input = input;
    this.repo = createHindsightPolicyReviewRepo(input.db); this.createdAt = input.now();
  }
  start(): void {
    if (this.running) return;
    this.controller = new AbortController(); this.running = true; this.startup = true; this.dirty = true;
  }
  changed(kind: "replica" | "config" | "activity" = "replica", bankId?: string): void {
    if (kind === "activity") {
      for (const value of this.progress.values()) if (value.pending && value.state === "paused") value.retryAt = this.input.now();
    } else if (kind === "replica" && bankId) this.dirtyBanks.add(bankId);
    else this.dirty = true;
  }
  nextWake(): string | null {
    if (!this.running || this.active) return null;
    if (this.supervisorRetry) return this.supervisorRetry;
    if (this.dirty || this.dirtyBanks.size) return this.input.now();
    if (this.configChanged()) return this.input.now();
    const wakes = [...this.progress.values()].map((value) => this.bankWake(value));
    return wakes.length ? wakes.sort()[0]! : null;
  }
  dispatch(banks: readonly MemoryReplicaBank[], rearm: () => void): void {
    if (!this.running || this.active || (this.nextWake() ?? "~") > this.input.now()) return;
    const dirty = this.dirty || this.configChanged(); this.dirty = false;
    const changed = new Set(this.dirtyBanks); this.dirtyBanks.clear();
    this.active = Promise.resolve().then(() => this.drain(banks, { all: dirty, banks: changed })).catch(() => {
      this.supervisorRetry = this.later(REPLICA_RETRY_DELAYS_MS[0]);
    }).finally(() => { this.active = undefined; rearm(); });
  }
  async stop(): Promise<void> { this.retire(); await this.active; }
  retire(): void { this.running = false; this.controller.abort(); }

  private async drain(banks: readonly MemoryReplicaBank[], dirty: { all: boolean; banks: ReadonlySet<string> }): Promise<void> {
    this.supervisorRetry = null;
    const startup = this.startup;
    const current = new Set(banks.map((bank) => bank.bankId));
    for (const id of this.progress.keys()) if (!current.has(id)) this.progress.delete(id);
    for (const bank of banks) {
      if (!this.running) return;
      const previous = this.progress.get(bank.bankId);
      if (!dirty.all && !dirty.banks.has(bank.bankId) && previous && this.bankWake(previous) > this.input.now()) continue;
      try { await this.bank(bank, startup); }
      catch {
        this.supervisorRetry = this.later(REPLICA_RETRY_DELAYS_MS[0]);
        if (previous) { previous.state = "error"; previous.eligibleRemaining = null; this.save(previous); }
      }
    }
    this.startup = false;
  }

  private async bank(bank: MemoryReplicaBank, startup: boolean): Promise<void> {
    const binding = this.input.deps.replica.bankBinding(bank.bankId);
    if (!binding || binding.bindingState !== "bound" || !binding.bank || binding.bankDeleted) throw new Error("HINDSIGHT_POLICY_BANK_UNAVAILABLE");
    const scope = { authorityEpochId: binding.authorityEpochId, bankId: bank.bankId, namespace: binding.namespace };
    const value = reconcilePolicySchedule({ previous: this.repo.get(scope), scope, config: this.input.config(),
      timezone: this.input.timezone(), at: this.input.now(), startup });
    this.progress.set(bank.bankId, value);
    try {
      const inventory = await this.inventory(bank, value);
      if (inventory.remaining > 0) requirePolicyOccurrence(value, { at: this.input.now(), reason: "recovery" });
      if (inventory.eligible >= this.input.config().threshold) requirePolicyOccurrence(value, { at: this.input.now(), reason: "threshold" });
      if (startup && value.pending) value.catchUpOccurrenceId = value.pending.id;
      if (!value.pending) { value.state = null; value.retryAt = null; value.failures = 0; this.save(value); return; }
      if (inventory.eligible === 0 && inventory.remaining === 0) { this.complete(value); return; }
      if (!this.canRun(bank, value)) { this.save(value); return; }
      if (value.state === "paused") { value.state = "pending"; value.retryAt = null; }
      const next = [inventory.retryAt, inventory.workRetry].filter((at): at is string => at !== null).sort()[0];
      if (next && next > this.input.now()) { value.retryAt = next; this.save(value); return; }
      if (value.retryAt && value.retryAt > this.input.now()) { this.save(value); return; }
      value.state = "running"; value.lastAttempted = { id: value.pending.id, at: this.input.now() }; this.save(value);
      const result = await this.input.curator.runBank(bank, this.controller.signal);
      const after = await this.inventory(bank, value);
      if (after.eligible === 0 && after.remaining === 0) { this.complete(value); return; }
      value.state = result.status === "failed" ? "error" : "pending";
      value.failures = result.status === "failed" ? value.failures + 1 : 0;
      const due = [after.retryAt, after.workRetry].filter((at): at is string => at !== null).sort()[0];
      value.retryAt = due && due > this.input.now() ? due : this.later(result.status === "failed"
        ? REPLICA_RETRY_DELAYS_MS[Math.min(value.failures - 1, REPLICA_RETRY_DELAYS_MS.length - 1)]! : POLICY_REVIEW_IDLE_MS);
      this.save(value);
    } catch {
      value.eligibleRemaining = null;
      value.state = !this.running || !this.input.writable() ? "paused" : "error";
      value.failures++; value.retryAt = this.later(REPLICA_RETRY_DELAYS_MS[Math.min(value.failures - 1, REPLICA_RETRY_DELAYS_MS.length - 1)]!);
      this.save(value);
    }
  }

  private async inventory(bank: MemoryReplicaBank, value: HindsightPolicyReviewProgress) {
    const current = await inspectPolicyReviewBank(this.input.deps, bank, this.controller.signal);
    const work = readHindsightPolicyWorkProgress(this.input.db, value.scope, this.input.now());
    value.eligibleRemaining = current.eligible; value.savedAwaitingPublication = work.saved; value.observedStateCursor = current.stateCursor;
    return { ...current, remaining: work.remaining, workRetry: work.retryAt };
  }
  private canRun(bank: MemoryReplicaBank, value: HindsightPolicyReviewProgress): boolean {
    const idle = this.input.activity?.idleSince(bank.characterId) ?? (this.input.activity ? null : Date.parse(this.createdAt));
    if (!this.running || !this.input.writable() || idle === null || Date.parse(this.input.now()) < idle + POLICY_REVIEW_IDLE_MS) {
      value.state = "paused";
      value.retryAt = idle === null || !this.input.writable() ? this.later(REPLICA_RETRY_DELAYS_MS[0])
        : new Date(Math.max(Date.parse(this.input.now()) + POLICY_REVIEW_IDLE_MS, idle + POLICY_REVIEW_IDLE_MS)).toISOString();
      return false;
    }
    return true;
  }
  private complete(value: HindsightPolicyReviewProgress): void {
    if (!value.pending) return;
    value.lastCompleted = { id: value.pending.id, at: this.input.now() };
    value.pending = null; value.state = null; value.retryAt = null; value.failures = 0; this.save(value);
  }
  private save(value: HindsightPolicyReviewProgress): void {
    this.repo.save(value);
    this.input.onPolicyReviewChanged?.(value.scope.bankId);
  }
  private bankWake(value: HindsightPolicyReviewProgress): string {
    return value.pending || value.state === "error" ? [value.nextDueAt, value.retryAt ?? this.input.now()].sort()[0]! : value.nextDueAt;
  }
  private later(ms: number): string { return new Date(Date.parse(this.input.now()) + ms).toISOString(); }
  private configChanged(): boolean {
    try {
      const revision = policyScheduleRevision(this.input.config(), this.input.timezone());
      return [...this.progress.values()].some((value) => value.scheduleRevision !== revision);
    } catch { return true; } // The supervised pass records/retries invalid live settings instead of a zero-delay wake loop.
  }
}
