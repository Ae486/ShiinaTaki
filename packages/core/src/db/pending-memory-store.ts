/**
 * INPUT:  Core SQLite and validated Pending Memory identity/progress records
 * OUTPUT: strict immutable-intent reads, ordered recovery pages, and version-CAS writes
 * POS:    core/db — synchronous outbox storage primitive; callers own the lease and transaction
 */
import { z } from "zod";
import {
  PendingMemoryPhaseSchema, PendingMemoryRecordSchema, PendingMemoryRefSchema, PendingMemoryStateSchema,
  type PendingMemoryPhase, type PendingMemoryRecord, type PendingMemoryRef, type PendingMemoryState,
} from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { assertNativeResultBinding, trackedDispatchHash } from "../memory/hindsight/hindsight-native-proof.ts";

export interface PendingMemoryPageInput {
  authorityEpochId: string; bankId: string; afterSequence?: number; limit?: number; kind?: "retain" | "mutation";
  phases?: PendingMemoryPhase[];
}
const PageSchema = z.strictObject({
  authorityEpochId: z.string().min(1).max(256), bankId: z.string().min(1).max(256),
  afterSequence: z.int().min(0).default(0), limit: z.int().min(1).max(256).default(100),
  kind: z.enum(["retain", "mutation"]).optional(),
  phases: z.array(PendingMemoryPhaseSchema).min(1).max(9).optional(),
});

export function pendingMemoryRef(record: PendingMemoryState): PendingMemoryRef {
  return { authorityEpochId: record.intent.authorityEpochId, bankId: record.intent.bank.bankId, operationId: record.intent.operationId };
}

export function readPendingMemory(db: Database, raw: PendingMemoryRef): PendingMemoryRecord | undefined {
  const ref = PendingMemoryRefSchema.parse(raw);
  const row = db.prepare(`SELECT * FROM pending_memory
    WHERE authority_epoch_id=:authorityEpochId AND bank_id=:bankId AND operation_id=:operationId`).get(ref);
  return row ? parsePendingRow(row) : undefined;
}

export function listPendingMemory(db: Database, raw: PendingMemoryPageInput): PendingMemoryRecord[] {
  const input = PageSchema.parse(raw);
  return db.prepare(`SELECT * FROM pending_memory WHERE authority_epoch_id=:epoch AND bank_id=:bank
    AND sequence>:after AND (:kind IS NULL OR (:kind='retain' AND operation_kind='retain')
      OR (:kind='mutation' AND operation_kind<>'retain'))
    AND (:phases IS NULL OR phase IN (SELECT value FROM json_each(:phases))) ORDER BY sequence LIMIT :limit`)
    .all({ epoch: input.authorityEpochId, bank: input.bankId, after: input.afterSequence, kind: input.kind ?? null,
      phases: input.phases ? JSON.stringify(input.phases) : null, limit: input.limit })
    .map(parsePendingRow);
}

export function insertPendingMemory(db: Database, value: PendingMemoryState): PendingMemoryRecord {
  const state = PendingMemoryStateSchema.parse(value);
  const ref = pendingMemoryRef(state);
  const inserted = db.prepare(`INSERT INTO pending_memory
    (authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash,phase,version,state_json)
    VALUES (:authorityEpochId,:bankId,:operationId,:kind,:hash,:phase,:version,:json)`)
    .run({ ...ref, kind: operationKind(state), hash: state.intentHash, phase: state.phase, version: state.version, json: encodeState(state) });
  return PendingMemoryRecordSchema.parse({ ...state, sequence: inserted.lastInsertRowid });
}

export function savePendingMemory(db: Database, input: { previous: PendingMemoryRecord; next: PendingMemoryState }): PendingMemoryRecord {
  const next = PendingMemoryStateSchema.parse(input.next);
  const previous = input.previous;
  if (next.intentHash !== previous.intentHash || canonicalJson(next.intent) !== canonicalJson(previous.intent)
    || next.remoteOperationId !== previous.remoteOperationId || next.documentId !== previous.documentId
    || next.version !== previous.version + 1) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  if ((previous.dispatchedAt !== null && canonicalJson(next.dispatch ?? null) !== canonicalJson(previous.dispatch ?? null))
    || (previous.nativeResultReceipt && canonicalJson(next.nativeResultReceipt) !== canonicalJson(previous.nativeResultReceipt))) {
    throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  }
  const result = db.prepare(`UPDATE pending_memory SET phase=:phase,version=:version,state_json=:json
    WHERE sequence=:sequence AND version=:previousVersion AND intent_hash=:hash`)
    .run({ phase: next.phase, version: next.version, json: encodeState(next), sequence: previous.sequence,
      previousVersion: previous.version, hash: previous.intentHash });
  if (result.changes !== 1) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  return PendingMemoryRecordSchema.parse({ ...next, sequence: previous.sequence });
}

function parsePendingRow(row: SqlRow): PendingMemoryRecord {
  try {
    const state = PendingMemoryStateSchema.parse(JSON.parse(String(row.state_json)));
    validateNativeIntegrity(state);
    const ref = pendingMemoryRef(state);
    if (ref.authorityEpochId !== row.authority_epoch_id || ref.bankId !== row.bank_id || ref.operationId !== row.operation_id
      || operationKind(state) !== row.operation_kind || state.intentHash !== row.intent_hash || state.intentHash !== canonicalPayloadHash(state.intent)
      || state.phase !== row.phase || state.version !== row.version
      || (state.preparedMutation !== null && canonicalPayloadHash(state.preparedMutation) !== state.preparedMutationHash)
      || (state.derivedEvidence !== null && canonicalPayloadHash(state.nativeReceipt) !== state.derivedEvidence.nativeReceiptHash)) {
      throw new Error();
    }
    return PendingMemoryRecordSchema.parse({ ...state, sequence: row.sequence });
  } catch { throw new Error("HINDSIGHT_PENDING_STATE_STALE"); }
}

function operationKind(state: PendingMemoryState): string {
  return state.intent.operation.kind === "retain" ? "retain" : state.intent.operation.request.kind;
}

function encodeState(state: PendingMemoryState): string {
  validateNativeIntegrity(state);
  const encoded = canonicalJson(state);
  if (new TextEncoder().encode(encoded).byteLength > 2 * 1024 * 1024) throw new Error("HINDSIGHT_PENDING_PAYLOAD_UNSAFE");
  return encoded;
}

function validateNativeIntegrity(state: PendingMemoryState): void {
  if (state.dispatch?.protocol === "tracked_native_v1"
    && state.dispatch.requestHash !== trackedDispatchHash(state.intent.bank.bankId, state.dispatch)) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  if (!state.nativeResultReceipt) return;
  if (state.nativeResultReceiptHash !== canonicalPayloadHash(state.nativeResultReceipt)) throw new Error("HINDSIGHT_PENDING_STATE_STALE");
  assertNativeResultBinding(state, state.nativeResultReceipt.result);
}
