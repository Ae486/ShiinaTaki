/**
 * INPUT:  validated canonical replica records and one shared search tokenizer
 * OUTPUT: full record reads, revision-safe writes, atomic FTS updates, and full-state manifest digests
 * POS:    core/db — synchronous B5 record projection used only inside the sync repository transaction
 */
import { z } from "zod";
import { MemoryReplicaRecordSchema, type CanonicalMemoryRecord, type MemoryReplicaRecord, type MemoryReplicaObjectKind } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import type { SearchTokenizer } from "../memory/search-tokenizer.ts";
import { buildFtsQuery } from "../memory/fts5-query.ts";

export interface ReplicaRecordRead {
  bankId: string; objectKind: MemoryReplicaObjectKind; objectId: string;
  includeInvalidated?: boolean; includeTombstones?: boolean;
}
export interface ReplicaRecordStore {
  write(record: MemoryReplicaRecord, sourceCursor: number | null): void;
  replace(record: MemoryReplicaRecord, sourceCursor: number | null): void;
  get(input: ReplicaRecordRead): MemoryReplicaRecord | undefined;
  search(input: { bankId: string; query: string; limit: number }): CanonicalMemoryRecord[];
  digest(bankId: string): string;
  entries(bankId: string): Array<{ objectKind: MemoryReplicaObjectKind; objectId: string; recordHash: string }>;
  reconcile(bankId: string, records: MemoryReplicaRecord[]): void;
  clear(bankId: string): void;
}

export function createReplicaRecordStore(db: Database, tokenizer: SearchTokenizer): ReplicaRecordStore {
  return {
    write: (record, sourceCursor) => write({ db, tokenizer }, record, sourceCursor),
    replace: (record, sourceCursor) => replace({ db, tokenizer }, record, sourceCursor),
    get: (input) => get(db, input), search: (input) => search({ db, tokenizer }, input),
    digest: (bankId) => digest(db, bankId),
    entries: (bankId) => db.prepare("SELECT object_kind,object_id,record_hash FROM hindsight_replica_sync_records WHERE bank_id=:bank ORDER BY object_kind,object_id")
      .all({ bank: bankId }).map((row) => ({ objectKind: String(row.object_kind) as MemoryReplicaObjectKind, objectId: String(row.object_id), recordHash: String(row.record_hash) })),
    reconcile: (bankId, records) => reconcile({ db, tokenizer }, bankId, records),
    clear: (bankId) => {
      db.prepare("DELETE FROM hindsight_replica_sync_records WHERE bank_id=:bank").run({ bank: bankId });
      db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE bank_id=:bank").run({ bank: bankId });
    },
  };
}

function write(deps: { db: Database; tokenizer: SearchTokenizer }, input: MemoryReplicaRecord, sourceCursor: number | null): void {
  const record = MemoryReplicaRecordSchema.parse(input); const db = deps.db;
  const hash = canonicalPayloadHash(record);
  const previous = db.prepare(`SELECT object_revision,record_hash FROM hindsight_replica_sync_records
    WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id`)
    .get({ bank: record.bankId, kind: record.objectKind, id: record.objectId });
  if (previous && (Number(previous.object_revision) > record.objectRevision
    || (previous.object_revision === record.objectRevision && previous.record_hash !== hash))) {
    throw new Error("HINDSIGHT_REPLICA_REVISION_STALE");
  }
  db.prepare(`INSERT INTO hindsight_replica_sync_records
    (bank_id,object_kind,object_id,object_revision,operation,record_json,record_hash,source_cursor)
    VALUES (:bank,:kind,:id,:revision,:operation,:record,:hash,:cursor)
    ON CONFLICT(bank_id,object_kind,object_id) DO UPDATE SET object_revision=excluded.object_revision,
    operation=excluded.operation,record_json=excluded.record_json,record_hash=excluded.record_hash,source_cursor=excluded.source_cursor`)
    .run({ bank: record.bankId, kind: record.objectKind, id: record.objectId, revision: record.objectRevision,
      operation: record.operation, record: canonicalJson(record), hash, cursor: sourceCursor });
  if (record.objectKind === "memory_unit") writeFts(deps, record);
}

function replace(deps: { db: Database; tokenizer: SearchTokenizer }, input: MemoryReplicaRecord, sourceCursor: number | null): void {
  const record = MemoryReplicaRecordSchema.parse(input);
  deps.db.prepare("DELETE FROM hindsight_replica_sync_records WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id")
    .run({ bank: record.bankId, kind: record.objectKind, id: record.objectId });
  if (record.objectKind === "memory_unit") {
    deps.db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE bank_id=:bank AND object_id=:id")
      .run({ bank: record.bankId, id: record.objectId });
  }
  write(deps, record, sourceCursor);
}

function writeFts(deps: { db: Database; tokenizer: SearchTokenizer }, record: MemoryReplicaRecord): void {
  deps.db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE bank_id=:bank AND object_id=:id")
    .run({ bank: record.bankId, id: record.objectId });
  const row = ftsRow(record, deps.tokenizer);
  if (row === null) return;
  deps.db.prepare(`INSERT INTO hindsight_replica_sync_fts (bank_id,object_id,text,context,disclosure,search_terms)
    VALUES (:bank_id,:object_id,:text,:context,:disclosure,:search_terms)`).run(row);
}

function ftsRow(record: MemoryReplicaRecord, tokenizer: SearchTokenizer): SqlRow | null {
  if (record.payload?.kind !== "memory_unit" || record.payload.value.unit.state !== "valid") return null;
  const { unit, policy } = record.payload.value;
  const text = [unit.text, unit.context, policy.disclosure].filter((value) => value !== null).join(" ");
  return { bank_id: record.bankId, object_id: record.objectId, text: unit.text, context: unit.context,
    disclosure: policy.disclosure, search_terms: tokenizer.tokenize(text).join(" ") };
}

function reconcile(deps: { db: Database; tokenizer: SearchTokenizer }, bankId: string, records: MemoryReplicaRecord[]): void {
  const existing = deps.db.prepare("SELECT * FROM hindsight_replica_sync_records WHERE bank_id=:bank").all({ bank: bankId });
  const byKey = new Map(existing.map((row) => [`${row.object_kind}\0${row.object_id}`, row]));
  const validMemoryIds = new Set<string>();
  for (const record of records) {
    const key = `${record.objectKind}\0${record.objectId}`;
    const row = byKey.get(key);
    // Compare both stored content and its digest; trusting only a stored hash would miss local JSON corruption.
    if (!row || row.record_json !== canonicalJson(record) || row.record_hash !== canonicalPayloadHash(record)
      || row.object_revision !== record.objectRevision || row.operation !== record.operation) replace(deps, record, null);
    byKey.delete(key);
    if (record.objectKind !== "memory_unit") continue;
    const expected = ftsRow(record, deps.tokenizer);
    const actual = deps.db.prepare(`SELECT bank_id,object_id,text,context,disclosure,search_terms
      FROM hindsight_replica_sync_fts WHERE bank_id=:bank AND object_id=:id`).all({ bank: bankId, id: record.objectId });
    if (canonicalJson(actual) !== canonicalJson(expected ? [expected] : [])) writeFts(deps, record);
    if (expected) validMemoryIds.add(record.objectId);
  }
  for (const row of byKey.values()) remove(deps.db, row);
  const indexed = deps.db.prepare("SELECT rowid,object_id FROM hindsight_replica_sync_fts WHERE bank_id=:bank").all({ bank: bankId });
  for (const row of indexed) {
    // FTS virtual tables accept NULL/non-text IDs. Address corrupt rows by rowid instead of changing their SQL type.
    if (typeof row.object_id !== "string" || !validMemoryIds.has(row.object_id)) {
      deps.db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE rowid=:rowid").run({ rowid: z.int().parse(row.rowid) });
    }
  }
}

function remove(db: Database, row: SqlRow): void {
  db.prepare("DELETE FROM hindsight_replica_sync_records WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id")
    .run({ bank: String(row.bank_id), kind: String(row.object_kind), id: String(row.object_id) });
  if (row.object_kind === "memory_unit") db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE bank_id=:bank AND object_id=:id")
    .run({ bank: String(row.bank_id), id: String(row.object_id) });
}

function get(db: Database, input: ReplicaRecordRead): MemoryReplicaRecord | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_replica_sync_records
    WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id`)
    .get({ bank: input.bankId, kind: input.objectKind, id: input.objectId });
  if (!row) return undefined;
  const value = parseRow(row);
  if (value.operation === "tombstone" && !input.includeTombstones) return undefined;
  if (value.payload?.kind === "memory_unit" && value.payload.value.unit.state === "invalidated" && !input.includeInvalidated) return undefined;
  return value;
}

function search(deps: { db: Database; tokenizer: SearchTokenizer }, input: { bankId: string; query: string; limit: number }): CanonicalMemoryRecord[] {
  const request = z.strictObject({ bankId: z.string().min(1).max(256), query: z.string().max(16_384), limit: z.int().min(1).max(100) }).parse(input);
  const query = buildFtsQuery(deps.tokenizer, request.query);
  if (query.kind === "empty") return [];
  const where = query.kind === "match" ? "hindsight_replica_sync_fts MATCH :query"
    : "(text LIKE :query ESCAPE '\\' OR context LIKE :query ESCAPE '\\' OR disclosure LIKE :query ESCAPE '\\')";
  const rank = query.kind === "match" ? "bm25(hindsight_replica_sync_fts,0,0,1,1,2,2),object_id" : "object_id";
  const rows = deps.db.prepare(`SELECT object_id FROM hindsight_replica_sync_fts
    WHERE bank_id=:bank AND ${where} ORDER BY ${rank} LIMIT :limit`)
    .all({ bank: request.bankId, query: query.kind === "match" ? query.match : query.like, limit: request.limit });
  return rows.flatMap((row) => {
    const record = get(deps.db, { bankId: request.bankId, objectKind: "memory_unit", objectId: String(row.object_id) });
    return record?.payload?.kind === "memory_unit" ? [record.payload.value] : [];
  });
}

function digest(db: Database, bankId: string): string {
  const rows = db.prepare(`SELECT object_kind,object_id,object_revision,operation,record_hash
    FROM hindsight_replica_sync_records WHERE bank_id=:bank ORDER BY object_kind,object_id`).all({ bank: bankId });
  return canonicalPayloadHash({ contract: "taki-replica-manifest.v1", bankId, records: rows });
}

function parseRow(row: SqlRow): MemoryReplicaRecord {
  const record = MemoryReplicaRecordSchema.parse(JSON.parse(String(row.record_json)));
  if (record.bankId !== row.bank_id || record.objectKind !== row.object_kind || record.objectId !== row.object_id
    || record.objectRevision !== row.object_revision || record.operation !== row.operation
    || canonicalPayloadHash(record) !== row.record_hash) throw new Error("HINDSIGHT_REPLICA_INTEGRITY_ERROR");
  return record;
}
