/**
 * INPUT:  authorized canonical Pending Memory intents, an active Hindsight epoch, and existing per-Bank leases
 * OUTPUT: idempotent durable outbox, stage-preserving retries, safe summaries, and checkpoint-fenced completion
 * POS:    core/db — one SQLite writer; never writes confirmed memory, FTS, activation receipts, or authority selection
 */
import { z } from "zod";
import {
  MemoryReplicaRecordSchema, PendingMemoryOverlayEntrySchema, PendingMemoryStateSchema, PendingMemorySummarySchema,
  type PendingMemoryIntent, type PendingMemoryOverlayEntry, type PendingMemoryRecord, type PendingMemoryRef,
  type PendingMemorySummary, type MemoryReplicaCheckpoint, type MemoryReplicaLease,
  type CanonicalMemoryBank,
} from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createHindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { canonicalJson, canonicalPayloadHash, legacyHash } from "../memory/legacy-migration/legacy-identities.ts";
import { hindsightOperationUuid } from "../memory/hindsight/hindsight-import-identity.ts";
import { validatePendingMemoryIntent } from "../memory/pending-memory-safety.ts";
import {
  insertPendingMemory, listPendingMemory, pendingMemoryRef, readPendingMemory, savePendingMemory, type PendingMemoryPageInput,
} from "./pending-memory-store.ts";
import { pendingMemoryState, pendingMemoryTerminal, transitionPendingMemory, type PendingMemoryChange } from "./pending-memory-transition.ts";

export interface PendingMemoryGuard { lease: MemoryReplicaLease; deadlineAt: string }
interface ClaimInput { record: PendingMemoryRecord; guard: PendingMemoryGuard; forceRetry?: boolean }
interface ProgressInput { record: PendingMemoryRecord; guard: PendingMemoryGuard; change: PendingMemoryChange; checkpoint?: MemoryReplicaCheckpoint }
type BankRef = Pick<PendingMemoryRef, "authorityEpochId" | "bankId">;
export interface PendingMemoryRepo {
  enqueue(intent: PendingMemoryIntent): PendingMemoryRecord;
  get(ref: PendingMemoryRef): PendingMemoryRecord | undefined;
  list(input: PendingMemoryPageInput): PendingMemoryRecord[];
  summary(ref: BankRef): PendingMemorySummary;
  overlay(input: PendingMemoryPageInput): PendingMemoryOverlayEntry[];
  claim(input: ClaimInput): PendingMemoryRecord | undefined;
  progress(input: ProgressInput): PendingMemoryRecord;
  cancelQueued(ref: PendingMemoryRef): PendingMemoryRecord;
}
interface Context {
  db: Database; now: () => string;
  readVerifiedBank?: (bankId: string) => Pick<CanonicalMemoryBank, "authorityEpochId" | "bankId" | "scope"> | undefined;
  leases: ReturnType<typeof createHindsightReplicaLeaseRepo>;
  authority: ReturnType<typeof createCanonicalMemoryAuthorityRepo>;
}

export function createPendingMemoryRepo(db: Database, now: () => string = () => new Date().toISOString(),
  readVerifiedBank?: Context["readVerifiedBank"]): PendingMemoryRepo {
  const clock = () => z.iso.datetime({ offset: true }).parse(now());
  const context: Context = { db, now: clock, readVerifiedBank,
    leases: createHindsightReplicaLeaseRepo(db, clock), authority: createCanonicalMemoryAuthorityRepo(db) };
  return {
    enqueue: (intent) => enqueue(context, intent), get: (ref) => readPendingMemory(db, ref),
    list: (input) => listPendingMemory(db, input), summary: (ref) => summary(db, ref),
    overlay: (input) => listPendingMemory(db, { ...input, phases: ["queued", "submitted", "awaiting_derived", "awaiting_pull", "outcome_unknown"] })
      .map((row) => PendingMemoryOverlayEntrySchema.parse({
      confirmed: false, ...pendingMemoryRef(row), originalAt: row.intent.originalAt, phase: row.phase, operation: row.intent.operation,
    })),
    claim: (input) => claim(context, input), progress: (input) => progress(context, input),
    cancelQueued: (ref) => cancelQueued(context, ref),
  };
}

function enqueue(context: Context, raw: PendingMemoryIntent): PendingMemoryRecord {
  const intent = validatePendingMemoryIntent(raw);
  const hash = canonicalPayloadHash(intent);
  let result: PendingMemoryRecord | undefined;
  context.db.transaction(() => {
    const previous = readPendingMemory(context.db, { authorityEpochId: intent.authorityEpochId, bankId: intent.bank.bankId, operationId: intent.operationId });
    if (previous) {
      if (previous.intentHash !== hash) throw new Error("HINDSIGHT_PENDING_IDENTITY_CONFLICT");
      result = previous;
      return;
    }
    requireBinding(context, intent);
    const identity = legacyHash("pending-memory-operation/v1", intent.authorityEpochId, intent.providerLineageId,
      intent.bankGeneration, intent.bank.bankId, intent.operationId);
    const operation = intent.operation;
    const documentId = operation.kind === "retain" ? operation.request.documentId ?? `pending-${identity.slice(7)}` : null;
    const at = context.now();
    result = insertPendingMemory(context.db, PendingMemoryStateSchema.parse({
      intent, intentHash: hash, remoteOperationId: hindsightOperationUuid(identity), documentId,
      preparedMutation: null, preparedMutationHash: null, phase: "queued", version: 1, attempts: 0,
      lastAttemptAt: null, nextRetryAt: null, dispatchedAt: null, acceptedAt: null, nativeReceipt: null, derivedEvidence: null,
      lease: null, diagnosticCode: null, currentRevision: null, createdAt: at, updatedAt: at, terminalAt: null,
    }));
    requireBinding(context, intent);
  });
  if (!result) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  return result;
}

function claim(context: Context, input: ClaimInput): PendingMemoryRecord | undefined {
  let result: PendingMemoryRecord | undefined;
  context.db.transaction(() => {
    const previous = requireCurrent(context, input.record);
    assertGuard(context, { intent: previous.intent, guard: input.guard });
    if (pendingMemoryTerminal(previous) || canonicalJson(previous.lease) === canonicalJson(input.guard.lease)) return;
    if (!input.forceRetry && previous.nextRetryAt !== null && Date.parse(previous.nextRetryAt) > Date.parse(context.now())) return;
    const next = PendingMemoryStateSchema.parse({ ...pendingMemoryState(previous), lease: input.guard.lease,
      attempts: previous.attempts + 1, lastAttemptAt: context.now(), nextRetryAt: null,
      version: previous.version + 1, updatedAt: context.now() });
    result = savePendingMemory(context.db, { previous, next });
    assertGuard(context, { intent: previous.intent, guard: input.guard });
  });
  return result;
}

function progress(context: Context, input: ProgressInput): PendingMemoryRecord {
  let result: PendingMemoryRecord | undefined;
  context.db.transaction(() => {
    const previous = requireCurrent(context, input.record);
    assertGuard(context, { intent: previous.intent, guard: input.guard });
    if (canonicalJson(previous.lease) !== canonicalJson(input.guard.lease)) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
    const bindingRequired = input.change.kind !== "retry" && input.change.kind !== "terminal";
    if (bindingRequired) requireBinding(context, previous.intent);
    if (input.change.kind === "confirm") assertReflected(context, previous, input.checkpoint);
    const next = transitionPendingMemory(previous, input.change, context.now());
    result = savePendingMemory(context.db, { previous, next });
    assertGuard(context, { intent: previous.intent, guard: input.guard });
    if (bindingRequired) requireBinding(context, previous.intent);
  });
  if (!result) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  return result;
}

function cancelQueued(context: Context, ref: PendingMemoryRef): PendingMemoryRecord {
  let result: PendingMemoryRecord | undefined;
  context.db.transaction(() => {
    const previous = readPendingMemory(context.db, ref);
    if (!previous) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
    if (previous.phase === "cancelled") { result = previous; return; }
    // Once dispatch may have happened, local cancellation cannot truthfully undo or relabel the native effect.
    if (previous.phase !== "queued") throw new Error("HINDSIGHT_PENDING_OUTCOME_UNKNOWN");
    const next = transitionPendingMemory(previous, { kind: "terminal", phase: "cancelled", code: "HINDSIGHT_PENDING_OPERATION_CANCELLED" }, context.now());
    result = savePendingMemory(context.db, { previous, next });
  });
  if (!result) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  return result;
}

function requireCurrent(context: Context, expected: PendingMemoryRecord): PendingMemoryRecord {
  const row = readPendingMemory(context.db, pendingMemoryRef(expected));
  if (!row || row.version !== expected.version || row.intentHash !== expected.intentHash) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  return row;
}

function assertGuard(context: Context, input: { intent: PendingMemoryIntent; guard: PendingMemoryGuard }): void {
  context.leases.assert(input.guard.lease);
  if (input.guard.lease.bankId !== input.intent.bank.bankId) throw new Error("HINDSIGHT_REPLICA_BANK_MISMATCH");
  if (Date.parse(z.iso.datetime({ offset: true }).parse(input.guard.deadlineAt)) <= Date.parse(context.now())) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");
  const authority = context.authority.authorityEpoch();
  if (authority.epochId !== input.intent.authorityEpochId || authority.providerId !== "hindsight"
    || authority.providerLineageId !== input.intent.providerLineageId) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
}

function requireBinding(context: Context, intent: PendingMemoryIntent): MemoryReplicaCheckpoint {
  const authority = context.authority.authorityEpoch();
  const checkpoint = readReplicaCheckpoint(context.db, intent.bank.bankId);
  if (authority.epochId !== intent.authorityEpochId || authority.providerId !== "hindsight"
    || authority.providerLineageId !== intent.providerLineageId || !checkpoint || checkpoint.authorityEpochId !== intent.authorityEpochId
    || checkpoint.providerLineageId !== intent.providerLineageId || checkpoint.bankGeneration !== intent.bankGeneration
    || checkpoint.endCursor < intent.baseCursor) throw new Error("HINDSIGHT_PENDING_AUTHORITY_MISMATCH");
  // An installed application reader owns this decision. Missing or invalid
  // application evidence must never fall back to a stale native-only projection.
  const bank = context.readVerifiedBank ? context.readVerifiedBank(intent.bank.bankId) : readNativeBank(context.db, intent.bank.bankId);
  if (!bank || bank.authorityEpochId !== intent.authorityEpochId || bank.bankId !== intent.bank.bankId
    || bank.scope.kind !== intent.bank.scope || bank.scope.characterId !== intent.bank.characterId) {
    throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  }
  return checkpoint;
}

function readNativeBank(db: Database, bankId: string): CanonicalMemoryBank | undefined {
  const bank = db.prepare(`SELECT record_json,record_hash FROM hindsight_replica_sync_records
    WHERE bank_id=:bank AND object_kind='bank' AND object_id=:bank`).get({ bank: bankId });
  const record = bank ? MemoryReplicaRecordSchema.parse(JSON.parse(String(bank.record_json))) : null;
  if (record?.payload?.kind !== "bank" || canonicalPayloadHash(record) !== bank?.record_hash) {
    throw new Error("HINDSIGHT_REPLICA_BANK_BINDING_MISMATCH");
  }
  return record.payload.value;
}

function assertReflected(context: Context, record: PendingMemoryRecord, expected?: MemoryReplicaCheckpoint): void {
  const current = readReplicaCheckpoint(context.db, record.intent.bank.bankId);
  const throughCursor = record.nativeResultReceipt?.result.native_through_cursor ?? record.derivedEvidence?.throughCursor;
  if (!expected || !current || canonicalJson(expected) !== canonicalJson(current)
    || throughCursor === undefined || current.endCursor < throughCursor) {
    throw new Error(record.nativeResultReceipt ? "HINDSIGHT_NATIVE_RESULT_INVALID" : "HINDSIGHT_DERIVED_FENCE_INVALID");
  }
  if (record.nativeResultReceipt?.result.inputs[0]?.full_result_count === 0
    && record.intent.operation.kind === "retain" && !record.intent.operation.zeroResultAllowed) {
    throw new Error("HINDSIGHT_PENDING_RECEIPT_INVALID");
  }
}

function summary(db: Database, ref: BankRef): PendingMemorySummary {
  const parsed = z.strictObject({ authorityEpochId: z.string().min(1).max(256), bankId: z.string().min(1).max(256) }).parse(ref);
  const rows = db.prepare(`SELECT phase,count(*) AS n,sum(CASE WHEN json_type(state_json,'$.nativeReceipt')='object'
    OR json_type(state_json,'$.nativeResultReceipt')='object' THEN 1 ELSE 0 END) AS native
    FROM pending_memory WHERE authority_epoch_id=:authorityEpochId AND bank_id=:bankId GROUP BY phase`).all(parsed);
  const result: PendingMemorySummary = { pendingCount: 0, nativeConfirmedCount: 0, completedCount: 0,
    supersededCount: 0, failedCount: 0, unknownCount: 0, cancelledCount: 0 };
  for (const row of rows) {
    result.nativeConfirmedCount += Number(row.native);
    const key = row.phase === "completed" ? "completedCount" : row.phase === "superseded" ? "supersededCount"
      : row.phase === "failed" ? "failedCount" : row.phase === "outcome_unknown" ? "unknownCount"
        : row.phase === "cancelled" ? "cancelledCount" : "pendingCount";
    result[key] += Number(row.n);
  }
  return PendingMemorySummarySchema.parse(result);
}
