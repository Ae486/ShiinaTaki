/**
 * INPUT:  one captured Hindsight epoch, Character and actual B5 Bank/checkpoint evidence
 * OUTPUT: synchronous authority/namespace fences for ingestion plans and durable coverage
 * POS:    core/db — Hindsight-only read guards; never weakens Local maintenance or changes authority
 */
import { MemoryReplicaRecordSchema, type MemoryReplicaBank, type CanonicalMemoryBank } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { HindsightIngestionBindingSchema, HindsightIngestionScopeSchema,
  type HindsightIngestionScope, type HindsightIngestionBinding } from "../memory/hindsight/hindsight-ingestion-contract.ts";

export interface HindsightIngestionBankReader {
  db: Database;
  readVerifiedBank?: (bankId: string) => Pick<CanonicalMemoryBank, "authorityEpochId" | "bankId" | "scope"> | undefined;
}

export function assertHindsightIngestionScope(db: Database, scope: HindsightIngestionScope) {
  HindsightIngestionScopeSchema.parse(scope);
  const epoch = createCanonicalMemoryAuthorityRepo(db).authorityEpoch(scope.epochId);
  if (epoch.providerId !== "hindsight") throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return epoch;
}

export function readHindsightIngestionBinding(deps: HindsightIngestionBankReader, input: HindsightIngestionScope & { bank: MemoryReplicaBank }): HindsightIngestionBinding {
  const { db } = deps;
  const epoch = assertHindsightIngestionScope(db, input);
  const checkpoint = readReplicaCheckpoint(db, input.bank.bankId);
  const bank = deps.readVerifiedBank ? deps.readVerifiedBank(input.bank.bankId) : readLegacyBank(db, input.bank.bankId);
  if (!checkpoint || checkpoint.authorityEpochId !== input.epochId || checkpoint.providerLineageId !== epoch.providerLineageId
    || bank?.authorityEpochId !== input.epochId || bank.bankId !== input.bank.bankId || bank.scope.kind !== input.bank.scope
    || bank.scope.characterId !== input.bank.characterId
    || input.bank.scope === "character" && input.bank.characterId !== input.characterId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  return HindsightIngestionBindingSchema.parse({ bank: input.bank, providerLineageId: checkpoint.providerLineageId,
    bankGeneration: checkpoint.bankGeneration, baseCursor: checkpoint.endCursor });
}

export function assertHindsightIngestionBinding(deps: HindsightIngestionBankReader, input: HindsightIngestionScope & HindsightIngestionBinding): void {
  const actual = readHindsightIngestionBinding(deps, input);
  if (actual.providerLineageId !== input.providerLineageId || actual.bankGeneration !== input.bankGeneration
    || actual.baseCursor < input.baseCursor) throw new Error("MEMORY_AUTHORITY_MISMATCH");
}

function readLegacyBank(db: Database, bankId: string): CanonicalMemoryBank | undefined {
  const row = db.prepare(`SELECT record_json,record_hash FROM hindsight_replica_sync_records
    WHERE bank_id=:bank AND object_kind='bank' AND object_id=:bank`).get({ bank: bankId });
  if (!row) return;
  try {
    const record = MemoryReplicaRecordSchema.parse(JSON.parse(String(row.record_json)));
    if (record.payload?.kind !== "bank" || canonicalPayloadHash(record) !== row.record_hash) throw new Error();
    return record.payload.value;
  } catch { throw new Error("MEMORY_AUTHORITY_MISMATCH"); }
}

export function hindsightIngestionAtomic<T>(db: Database, input: HindsightIngestionScope, action: () => T): T {
  if (Object.prototype.toString.call(action) === "[object AsyncFunction]") throw new Error("MEMORY_INVALID_REQUEST");
  let result: { value: T } | undefined;
  db.transaction(() => {
    const epoch = assertHindsightIngestionScope(db, input);
    result = { value: action() };
    if (result.value !== null && typeof result.value === "object" && "then" in result.value) throw new Error("MEMORY_INVALID_REQUEST");
    if (assertHindsightIngestionScope(db, input).providerLineageId !== epoch.providerLineageId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  });
  if (!result) throw new Error("MEMORY_INGESTION_INCOMPLETE");
  return result.value;
}
