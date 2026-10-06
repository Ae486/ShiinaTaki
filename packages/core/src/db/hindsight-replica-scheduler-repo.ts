/**
 * INPUT:  Core-owned Bank configuration, one clock, and per-Bank run/lease tokens
 * OUTPUT: atomic durable claims, manual/catch-up requests, fenced settlement, and restart recovery
 * POS:    core/db — scheduler state is separate from replica payloads, Pending Memory, and Memory Authority
 */
import { z } from "zod";
import {
  MemoryReplicaBankSchema, MemoryReplicaErrorCodeSchema, MemoryReplicaRunKindSchema, MemoryReplicaRunResultSchema,
  MemoryReplicaScheduleConfigSchema, MemoryReplicaScheduledRunSchema, MemoryReplicaSyncStateSchema,
  type MemoryReplicaBank, type MemoryReplicaErrorCode, type MemoryReplicaRunKind, type MemoryReplicaRunResult,
  type MemoryReplicaScheduleConfig, type MemoryReplicaScheduledRun, type MemoryReplicaSyncState,
} from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { canonicalJson } from "../memory/legacy-migration/legacy-identities.ts";
import { createHindsightReplicaLeaseRepo, type HindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { claimReplicaRequest, insertReplicaRequest, readReplicaRequest, settleReplicaRequest, updateReplicaRequest } from "./hindsight-replica-request-repo.ts";
import { after, configureReplicaSchedule, failedReplicaSchedule, initialReplicaSchedule, replicaScheduleDue } from "./hindsight-replica-schedule-state.ts";

interface Stored { version: number; state: MemoryReplicaSyncState }
interface Context { db: Database; leases: HindsightReplicaLeaseRepo; now: () => string }
interface BankInput { bank: MemoryReplicaBank; config?: MemoryReplicaScheduleConfig }
interface ClaimInput { bankId: string; ownerId: string; leaseDurationMs: number }

export interface HindsightReplicaSchedulerRepo {
  now(): string;
  request: (requestId: string) => ReturnType<typeof readReplicaRequest>;
  ensureBank(input: BankInput): MemoryReplicaSyncState;
  get(bankId: string): MemoryReplicaSyncState | undefined;
  list(): MemoryReplicaSyncState[];
  requestManual(input: { bankId: string; kind: MemoryReplicaRunKind; requestId?: string }): MemoryReplicaSyncState;
  /** Cancels an exact queued request independently of a previous Bank run; legacy unqualified calls remain guarded. */
  cancelManual(bankId: string, requestId?: string): MemoryReplicaSyncState;
  failManual(input: { bankId: string; requestId: string; errorCode: MemoryReplicaErrorCode }): MemoryReplicaSyncState;
  requestCatchUp(bankId: string): MemoryReplicaSyncState;
  recover(bankId: string): MemoryReplicaSyncState;
  claim(input: ClaimInput): MemoryReplicaScheduledRun | undefined;
  promoteToFull(run: MemoryReplicaScheduledRun): MemoryReplicaScheduledRun;
  succeed(input: { run: MemoryReplicaScheduledRun; result: MemoryReplicaRunResult }): MemoryReplicaSyncState;
  fail(input: { run: MemoryReplicaScheduledRun; errorCode: MemoryReplicaErrorCode }): MemoryReplicaSyncState;
}

export function createHindsightReplicaSchedulerRepo(db: Database, now: () => string = () => new Date().toISOString()): HindsightReplicaSchedulerRepo {
  const clock = () => z.iso.datetime({ offset: true }).parse(now());
  const context = { db, now: clock, leases: createHindsightReplicaLeaseRepo(db, clock) };
  return {
    now: clock, request: (requestId) => readReplicaRequest(db, requestId), ensureBank: (input) => ensureBank(context, input),
    get: (bankId) => read(db, bankId)?.state,
    list: () => db.prepare("SELECT bank_id FROM hindsight_replica_sync_schedule ORDER BY bank_id").all()
      .map((row) => required(db, String(row.bank_id)).state),
    requestManual: (input) => {
      const kind = MemoryReplicaRunKindSchema.parse(input.kind);
      return mutate(context, input.bankId, (state) => {
        const existing = input.requestId ? readReplicaRequest(db, input.requestId) : undefined;
        if (existing) {
          if (existing.bankId !== input.bankId || existing.kind !== kind) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
          return state;
        }
        if (state.pendingManualRequestId || input.requestId && state.pendingManualKind !== null) throw new Error("HINDSIGHT_REPLICA_BUSY");
        if (input.requestId) insertReplicaRequest(db, { requestId: input.requestId, bankId: input.bankId, kind,
          state: "queued", claim: null, createdAt: clock(), settledAt: null, errorCode: null, nextAction: null, lastSuccessAt: null });
        return { ...state, pendingManualKind: state.pendingManualKind === "full" ? "full" : kind, pendingManualRequestId: input.requestId ?? null };
      });
    },
    cancelManual: (bankId, requestId) => mutate(context, bankId, (state) => {
      if (requestId) {
        const row = readReplicaRequest(db, requestId);
        if (!row || row.bankId !== bankId || row.state !== "queued" || state.pendingManualRequestId !== requestId) throw new Error("HINDSIGHT_REPLICA_BUSY");
        updateReplicaRequest(db, row, { ...row, state: "cancelled", settledAt: clock() });
      } else if (state.run !== null || state.pendingManualRequestId) throw new Error("HINDSIGHT_REPLICA_BUSY");
      return { ...state, pendingManualKind: null, pendingManualRequestId: null };
    }),
    failManual: (input) => mutate(context, input.bankId, (state) => {
      const row = readReplicaRequest(db, input.requestId);
      if (!row || row.state !== "queued" || state.pendingManualRequestId !== input.requestId || state.run !== null) return state;
      const failed = failedReplicaSchedule(state, input.errorCode, clock());
      updateReplicaRequest(db, row, { ...row, state: "failed", settledAt: clock(), errorCode: input.errorCode,
        nextAction: failed.nextAction, lastSuccessAt: state.lastSuccessAt });
      return { ...failed, retryKind: failed.retryDueAt === null ? null : row.kind, pendingManualKind: null, pendingManualRequestId: null };
    }),
    requestCatchUp: (bankId) => mutate(context, bankId, (state) => ({ ...state,
      catchUpRequested: state.automatic && state.run === null && (state.catchUpRequested || state.retryDueAt !== null
        || replicaScheduleDue(state, clock()) !== undefined) })),
    recover: (bankId) => recover(context, bankId),
    claim: (input) => claim(context, input),
    promoteToFull: (run) => promoteToFull(context, run),
    succeed: (input) => succeed(context, input),
    fail: (input) => settle(context, input.run, (state) => failedReplicaSchedule(state, MemoryReplicaErrorCodeSchema.parse(input.errorCode), clock())),
  };
}

function ensureBank(context: Context, input: BankInput): MemoryReplicaSyncState {
  const bank = MemoryReplicaBankSchema.parse(input.bank);
  let result: MemoryReplicaSyncState | undefined;
  context.db.transaction(() => {
    const current = read(context.db, bank.bankId);
    if (current && (current.state.scope !== bank.scope || current.state.characterId !== bank.characterId)) {
      throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
    }
    if (current && input.config === undefined) { result = current.state; return; }
    const config = MemoryReplicaScheduleConfigSchema.parse(input.config ?? {});
    result = current ? configureReplicaSchedule(current.state, config, context.now())
      : initialReplicaSchedule({ bank, config, now: context.now() });
    save(context.db, { version: current?.version ?? 0, state: result });
  });
  if (!result) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  return result;
}

function claim(context: Context, input: ClaimInput): MemoryReplicaScheduledRun | undefined {
  let run: MemoryReplicaScheduledRun | undefined;
  context.db.transaction(() => {
    recover(context, input.bankId);
    const current = required(context.db, input.bankId);
    const due = replicaScheduleDue(current.state, context.now());
    if (!due) return;
    const lease = context.leases.acquire({ bankId: input.bankId, ownerId: input.ownerId, durationMs: input.leaseDurationMs });
    run = MemoryReplicaScheduledRunSchema.parse({ ...due, lease, predecessor: readReplicaCheckpoint(context.db, input.bankId) ?? null,
      ...(due.trigger === "manual" && current.state.pendingManualRequestId ? { manualRequestId: current.state.pendingManualRequestId } : {}) });
    claimReplicaRequest(context.db, run);
    save(context.db, { ...current, state: { ...current.state, run, mode: "running",
      fullReconciliationState: due.kind === "full" ? "running" : current.state.fullReconciliationState,
      pendingManualKind: due.trigger === "manual" ? null : current.state.pendingManualKind,
      pendingManualRequestId: due.trigger === "manual" ? null : current.state.pendingManualRequestId,
      catchUpRequested: false, lastAttemptAt: context.now(), updatedAt: context.now(),
    } });
  });
  return run;
}

function recover(context: Context, bankId: string): MemoryReplicaSyncState {
  return mutate(context, bankId, (state) => {
    if (state.run === null) return state;
    try { context.leases.assert(state.run.lease); return state; }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "HINDSIGHT_REPLICA_LEASE_LOST") throw error;
    }
    // Recovery is a new CAS transition after verified lease loss, never a late callback settling its old run.
    const recovered = { ...failedReplicaSchedule(state, "HINDSIGHT_REPLICA_LEASE_LOST", context.now()), catchUpRequested: state.automatic };
    settleReplicaRequest(context.db, state.run, recovered);
    return recovered;
  });
}

function promoteToFull(context: Context, raw: MemoryReplicaScheduledRun): MemoryReplicaScheduledRun {
  let result: MemoryReplicaScheduledRun | undefined;
  context.db.transaction(() => {
    const run = MemoryReplicaScheduledRunSchema.parse(raw);
    const current = requireRun(context, run);
    result = { ...run, kind: "full", predecessor: readReplicaCheckpoint(context.db, run.lease.bankId) ?? null };
    save(context.db, { ...current, state: { ...current.state, run: result, fullReconciliationState: "running", updatedAt: context.now() } });
  });
  if (!result) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  return result;
}

function succeed(context: Context, input: { run: MemoryReplicaScheduledRun; result: MemoryReplicaRunResult }): MemoryReplicaSyncState {
  const result = MemoryReplicaRunResultSchema.parse(input.result);
  return settle(context, input.run, (state) => {
    if (canonicalJson(readReplicaCheckpoint(context.db, state.bankId) ?? null) !== canonicalJson(result.checkpoint)) {
      throw new Error("HINDSIGHT_REPLICA_RESULT_INVALID");
    }
    const now = context.now(); const full = input.run.kind === "full";
    return { ...state, run: null, mode: "idle", lastSuccessAt: now,
      fullReconciliationState: full ? "succeeded" : state.fullReconciliationState,
      lastFullReconciliationAt: full ? now : state.lastFullReconciliationAt,
      nextDueAt: state.automatic ? after(now, state.autoIntervalMs) : null,
      nextFullDueAt: !state.automatic ? null : full ? after(now, state.fullReconciliationIntervalMs) : state.nextFullDueAt,
      retryAttempt: 0, retryKind: null, retryDueAt: null, consecutiveFailures: 0, errorCode: null, nextAction: null,
      lastObservedCursor: result.observedCursor, lastObservedLineageId: result.checkpoint.providerLineageId,
      lastObservedBankGeneration: result.checkpoint.bankGeneration, updatedAt: now,
    };
  });
}

function settle(context: Context, raw: MemoryReplicaScheduledRun, transition: (state: MemoryReplicaSyncState) => MemoryReplicaSyncState): MemoryReplicaSyncState {
  let result: MemoryReplicaSyncState | undefined;
  context.db.transaction(() => {
    const run = MemoryReplicaScheduledRunSchema.parse(raw);
    const current = requireRun(context, run);
    result = transition(current.state);
    context.leases.assert(run.lease);
    settleReplicaRequest(context.db, run, result);
    save(context.db, { ...current, state: result });
    context.leases.release(run.lease);
  });
  if (!result) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  return result;
}

function requireRun(context: Context, run: MemoryReplicaScheduledRun): Stored {
  context.leases.assert(run.lease);
  const current = required(context.db, run.lease.bankId);
  if (canonicalJson(current.state.run) !== canonicalJson(run)) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  return current;
}

function mutate(context: Context, bankId: string, transition: (state: MemoryReplicaSyncState) => MemoryReplicaSyncState): MemoryReplicaSyncState {
  let result: MemoryReplicaSyncState | undefined;
  context.db.transaction(() => {
    const current = required(context.db, bankId);
    result = transition(current.state);
    if (canonicalJson(result) === canonicalJson(current.state)) return;
    result.updatedAt = context.now();
    save(context.db, { ...current, state: result });
  });
  if (!result) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
  return result;
}

function read(db: Database, bankId: string): Stored | undefined {
  const id = z.string().min(1).max(256).parse(bankId);
  const row = db.prepare("SELECT * FROM hindsight_replica_sync_schedule WHERE bank_id=:bank").get({ bank: id });
  if (!row) return undefined;
  const state = MemoryReplicaSyncStateSchema.parse(JSON.parse(String(row.state_json)));
  if (state.bankId !== id) throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  return { version: z.int().min(1).parse(row.version), state };
}

function required(db: Database, bankId: string): Stored {
  const row = read(db, bankId);
  if (!row) throw new Error("HINDSIGHT_REPLICA_BANK_NOT_SCHEDULED");
  return row;
}

function save(db: Database, input: Stored): void {
  const state = MemoryReplicaSyncStateSchema.parse(input.state);
  const params = { bank: state.bankId, state: canonicalJson(state), version: input.version };
  const result = input.version === 0
    ? db.prepare("INSERT INTO hindsight_replica_sync_schedule (bank_id,version,state_json) VALUES (:bank,1,:state)")
      .run({ bank: params.bank, state: params.state })
    : db.prepare("UPDATE hindsight_replica_sync_schedule SET version=version+1,state_json=:state WHERE bank_id=:bank AND version=:version").run(params);
  if (result.changes !== 1) throw new Error("HINDSIGHT_REPLICA_SCHEDULE_STALE");
}
