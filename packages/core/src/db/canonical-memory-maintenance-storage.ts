/**
 * INPUT:  captured authority/Bank identities and synchronous canonical mutations
 * OUTPUT: shared Local fences, atomic boundaries, historical snapshots, and request receipts
 * POS:    core/db — storage primitives shared by foreground and internal Local maintenance repositories
 */
import {
  HindsightCurrentCanonicalRecordSchema, type CanonicalMemoryRecord,
} from "@taki/shared";
import { z } from "zod";
import type { CanonicalMaintenanceScope } from "./canonical-memory-maintenance-contract.ts";
import type { Database } from "./sqlite.ts";

const Id = z.string().min(1).max(256);
const Scope = z.strictObject({ epochId: Id, bankId: Id, characterId: Id.nullable() });

export function canonicalMemoryAtomic<T>(db: Database, operation: () => T): T {
  if (Object.prototype.toString.call(operation) === "[object AsyncFunction]") {
    throw new Error("MEMORY_INVALID_REQUEST: synchronous transaction required");
  }
  let result: T | undefined;
  db.transaction(() => {
    result = operation();
    if (result !== null && typeof result === "object" && "then" in result && typeof result.then === "function") {
      throw new Error("MEMORY_INVALID_REQUEST: synchronous transaction required");
    }
  });
  return result as T;
}

export function assertCanonicalLocalAuthority(db: Database, epochId: string): void {
  if (!Id.safeParse(epochId).success) throw new Error("MEMORY_INVALID_REQUEST");
  const row = db.prepare(`SELECT e.epoch_id,e.provider_id,e.status FROM canonical_memory_authority_state s
    JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id WHERE s.singleton=1`).get();
  if (!row || row.epoch_id !== epochId || row.provider_id !== "local" || row.status !== "active") {
    throw new Error("MEMORY_AUTHORITY_MISMATCH");
  }
}

export function assertCanonicalMaintenanceScope(db: Database, input: CanonicalMaintenanceScope): void {
  const scope = Scope.safeParse({ epochId: input.epochId, bankId: input.bankId, characterId: input.characterId });
  if (!scope.success) throw new Error("MEMORY_INVALID_REQUEST");
  assertCanonicalLocalAuthority(db, input.epochId);
  const bank = db.prepare(`SELECT scope_kind,character_id FROM canonical_memory_banks
    WHERE authority_epoch_id=:epoch AND bank_id=:bank`).get({ epoch: input.epochId, bank: input.bankId });
  if (!bank || bank.scope_kind !== "global" && bank.scope_kind !== "character"
    || bank.scope_kind === "global" && bank.character_id !== null
    || bank.scope_kind === "character" && bank.character_id !== input.characterId) {
    throw new Error("MEMORY_AUTHORITY_MISMATCH");
  }
}

export function readCanonicalReceipt(db: Database, epochId: string, requestId: string): {
  operation: string; requestHash: string; result: unknown;
} | undefined {
  const row = db.prepare(`SELECT operation,request_hash,result_json FROM canonical_memory_operation_receipts
    WHERE authority_epoch_id=:epoch AND request_id=:request`).get({ epoch: epochId, request: requestId });
  return row ? { operation: String(row.operation), requestHash: String(row.request_hash),
    result: JSON.parse(String(row.result_json)) as unknown } : undefined;
}

export function saveCanonicalReceipt(db: Database, input: {
  epochId: string; requestId: string; operation: string; requestHash: string; result: unknown; createdAt: string;
}): void {
  db.prepare(`INSERT INTO canonical_memory_operation_receipts
    (authority_epoch_id,request_id,operation,request_hash,result_json,created_at)
    VALUES (:epoch,:request,:operation,:hash,:result,:created)`)
    .run({ epoch: input.epochId, request: input.requestId, operation: input.operation,
      hash: input.requestHash, result: JSON.stringify(input.result), created: input.createdAt });
}

export function saveCanonicalSnapshot(db: Database, record: CanonicalMemoryRecord, createdAt: string): void {
  const parsed = HindsightCurrentCanonicalRecordSchema.parse(record);
  db.prepare(`INSERT INTO canonical_memory_revision_snapshots
    (authority_epoch_id,bank_id,memory_id,revision,record_json,created_at)
    VALUES (:epoch,:bank,:memory,:revision,:record,:created)`)
    .run({ epoch: parsed.unit.authorityEpochId, bank: parsed.unit.bankId, memory: parsed.unit.memoryId,
      revision: parsed.unit.revision, record: JSON.stringify(parsed), created: createdAt });
}

export function readCanonicalSnapshot(db: Database, input: {
  epochId: string; bankId: string; memoryId: string; revision: number;
}): CanonicalMemoryRecord | undefined {
  const row = db.prepare(`SELECT record_json FROM canonical_memory_revision_snapshots
    WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory AND revision=:revision`)
    .get({ epoch: input.epochId, bank: input.bankId, memory: input.memoryId, revision: input.revision });
  if (!row) return undefined;
  const record = HindsightCurrentCanonicalRecordSchema.parse(JSON.parse(String(row.record_json)));
  if (record.unit.authorityEpochId !== input.epochId || record.unit.bankId !== input.bankId
    || record.unit.memoryId !== input.memoryId || record.unit.revision !== input.revision) {
    throw new Error("MEMORY_INTEGRITY_ERROR: snapshot identity mismatch");
  }
  return record;
}
