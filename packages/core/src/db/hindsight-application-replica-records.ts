/**
 * INPUT:  exact application checkpoint/record CAS witnesses and verified Canonical projections
 * OUTPUT: byte-preserving application record writes, explicit FTS projection and scoped safe reads
 * POS:    core/db — D77 storage path beside frozen B5 JSON1/decoder behavior; caller owns the publication transaction
 */
import { z } from "zod";
import { HindsightApplicationReplicaRecordSchema, TakiApplicationNamespaceSchema, type CanonicalMemoryRecord,
  type HindsightApplicationReplicaRecord, type TakiApplicationNamespace } from "@taki/shared";
import type { SearchTokenizer } from "../memory/search-tokenizer.ts";
import { buildFtsQuery } from "../memory/fts5-query.ts";
import { hindsightApplicationBytesHash, hindsightApplicationHash, sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";
import { applicationReplicaRecordHash, applicationStoredBytes, parseApplicationStoredBytes } from "./hindsight-application-replica-codec.ts";
import type { Database, SqlRow } from "./sqlite.ts";
import type { ReplicaRecordRead } from "./hindsight-replica-record-store.ts";

type Target = Pick<ReplicaRecordRead, "bankId" | "objectKind" | "objectId">;
export interface ApplicationReplicaRecordCas { objectRevision: number; recordHash: string }
export interface ApplicationReplicaReprojection extends Target {
  namespace: TakiApplicationNamespace;
  /** Hash of the complete prior app checkpoint, or proven absence during the first application publication. */
  expectedCheckpointHash: string | null;
  expectedRecord: ApplicationReplicaRecordCas | null;
  record: HindsightApplicationReplicaRecord | null;
  sourceCursor: number | null;
}
export interface ApplicationReplicaSearch {
  bankId: string; query: string; limit: number;
  /** Current policy/binding eligibility runs before the final result limit. */
  accept?: (record: CanonicalMemoryRecord) => boolean;
}
interface Deps { db: Database; tokenizer: SearchTokenizer }

export function reprojectApplicationReplicaRecord(deps: Deps, input: ApplicationReplicaReprojection): void {
  const params = { bank: input.bankId, kind: input.objectKind, id: input.objectId };
  const checkpoint = deps.db.prepare("SELECT checkpoint_hash FROM hindsight_application_replica_checkpoints WHERE bank_id=:bank").get({ bank: input.bankId });
  if ((checkpoint?.checkpoint_hash ?? null) !== input.expectedCheckpointHash) stale();
  const current = applicationReplicaRecordCas(deps.db, input);
  if (!sameApplicationValue(current, input.expectedRecord)) stale();
  if (input.record === null) {
    deps.db.prepare("DELETE FROM hindsight_application_replica_projections WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id").run(params);
    if (input.objectKind === "memory_unit") deleteFts(deps.db, input.bankId, input.objectId);
    return;
  }
  const record = HindsightApplicationReplicaRecordSchema.parse(input.record);
  const namespace = TakiApplicationNamespaceSchema.parse(input.namespace);
  if (record.bankId !== input.bankId || record.objectKind !== input.objectKind || record.objectId !== input.objectId) stale();
  if (current && current.objectRevision > record.objectRevision) stale();
  const bytes = applicationStoredBytes(record); const memory = record.payload?.kind === "memory_unit" ? record.payload.value : null;
  deps.db.prepare(`INSERT INTO hindsight_application_replica_projections
    (bank_id,object_kind,object_id,namespace_json,object_revision,operation,record_bytes,bytes_sha256,record_hash,source_cursor,unit_state,visibility)
    VALUES (:bank,:kind,:id,:namespace,:revision,:operation,:bytes,:bytesHash,:hash,:cursor,:state,:visibility)
    ON CONFLICT(bank_id,object_kind,object_id) DO UPDATE SET namespace_json=excluded.namespace_json,
    object_revision=excluded.object_revision,operation=excluded.operation,record_bytes=excluded.record_bytes,
    bytes_sha256=excluded.bytes_sha256,record_hash=excluded.record_hash,source_cursor=excluded.source_cursor,
    unit_state=excluded.unit_state,visibility=excluded.visibility`).run({ ...params, namespace: JSON.stringify(namespace),
    revision: record.objectRevision, operation: record.operation, bytes, bytesHash: hindsightApplicationBytesHash(bytes),
    hash: applicationReplicaRecordHash({ bankId: input.bankId, namespace }, record), cursor: input.sourceCursor,
    state: memory?.unit.state ?? null, visibility: memory?.policy.visibility ?? null });
  if (record.objectKind === "memory_unit") writeFts(deps, record);
}

export function applicationReplicaRecordCas(db: Database, input: Target): ApplicationReplicaRecordCas | null {
  const row = db.prepare(`SELECT object_revision,record_hash FROM hindsight_application_replica_projections
    WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id`).get({ bank: input.bankId, kind: input.objectKind, id: input.objectId });
  return row ? { objectRevision: z.int().min(1).parse(row.object_revision), recordHash: z.string().regex(/^[a-f0-9]{64}$/).parse(row.record_hash) } : null;
}

export function getApplicationReplicaRecord(db: Database, input: ReplicaRecordRead): HindsightApplicationReplicaRecord | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_application_replica_projections
    WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id`).get({ bank: input.bankId, kind: input.objectKind, id: input.objectId });
  if (!row) return undefined;
  const record = parseProjection(row);
  if (record.operation === "tombstone" && !input.includeTombstones) return undefined;
  if (record.payload?.kind === "memory_unit" && record.payload.value.unit.state === "invalidated" && !input.includeInvalidated) return undefined;
  return record;
}

export function searchApplicationReplicaRecords(deps: Deps, input: ApplicationReplicaSearch): CanonicalMemoryRecord[] {
  const request = z.strictObject({ bankId: z.string().min(1).max(256), query: z.string().max(16_384), limit: z.int().min(1).max(100) })
    .parse({ bankId: input.bankId, query: input.query, limit: input.limit });
  const query = buildFtsQuery(deps.tokenizer, request.query);
  if (query.kind === "empty") return [];
  const where = query.kind === "match" ? "hindsight_replica_sync_fts MATCH :query"
    : "(text LIKE :query ESCAPE '\\' OR context LIKE :query ESCAPE '\\' OR disclosure LIKE :query ESCAPE '\\')";
  const rank = query.kind === "match" ? "bm25(hindsight_replica_sync_fts,0,0,1,1,2,2),object_id" : "object_id";
  const rows = deps.db.prepare(`SELECT object_id FROM hindsight_replica_sync_fts
    WHERE bank_id=:bank AND ${where} AND EXISTS (SELECT 1 FROM hindsight_application_replica_projections p
      WHERE p.bank_id=hindsight_replica_sync_fts.bank_id AND p.object_kind='memory_unit'
      AND p.object_id=hindsight_replica_sync_fts.object_id AND p.operation='upsert'
      AND p.unit_state='valid' AND p.visibility<>'hidden') ORDER BY ${rank}`)
    .all({ bank: request.bankId, query: query.kind === "match" ? query.match : query.like });
  const records: CanonicalMemoryRecord[] = [];
  for (const row of rows) {
    const record = getApplicationReplicaRecord(deps.db, { bankId: request.bankId, objectKind: "memory_unit", objectId: String(row.object_id) });
    if (record?.payload?.kind !== "memory_unit" || input.accept && !input.accept(record.payload.value)) continue;
    records.push(record.payload.value);
    if (records.length === request.limit) break;
  }
  return records;
}

export function applicationReplicaDigest(db: Database, input: { bankId: string; namespace: TakiApplicationNamespace }): string {
  const rows = db.prepare(`SELECT object_kind,object_id,object_revision,operation,record_hash
    FROM hindsight_application_replica_projections WHERE bank_id=:bank ORDER BY object_kind,object_id`).all({ bank: input.bankId });
  return hindsightApplicationHash({ ...input, domain: "record", value: { projection_contract: "taki-application-replica-manifest.v1", records: rows } });
}

function parseProjection(row: SqlRow): HindsightApplicationReplicaRecord {
  const record = HindsightApplicationReplicaRecordSchema.parse(parseApplicationStoredBytes(row.record_bytes, row.bytes_sha256));
  const namespace = TakiApplicationNamespaceSchema.parse(JSON.parse(String(row.namespace_json)));
  const memory = record.payload?.kind === "memory_unit" ? record.payload.value : null;
  if (record.bankId !== row.bank_id || record.objectKind !== row.object_kind || record.objectId !== row.object_id
    || record.objectRevision !== row.object_revision || record.operation !== row.operation
    || (memory?.unit.state ?? null) !== row.unit_state || (memory?.policy.visibility ?? null) !== row.visibility
    || applicationReplicaRecordHash({ bankId: record.bankId, namespace }, record) !== row.record_hash) {
    throw new Error("HINDSIGHT_APPLICATION_REPLICA_INTEGRITY_ERROR");
  }
  return record;
}

function writeFts(deps: Deps, record: HindsightApplicationReplicaRecord): void {
  deleteFts(deps.db, record.bankId, record.objectId);
  if (record.payload?.kind !== "memory_unit" || record.payload.value.unit.state !== "valid" || record.payload.value.policy.visibility === "hidden") return;
  const { unit, policy } = record.payload.value;
  const terms = deps.tokenizer.tokenize([unit.text, unit.context, policy.disclosure].filter((value) => value !== null).join(" ")).join(" ");
  deps.db.prepare(`INSERT INTO hindsight_replica_sync_fts (bank_id,object_id,text,context,disclosure,search_terms)
    VALUES (:bank,:id,:text,:context,:disclosure,:terms)`).run({ bank: record.bankId, id: record.objectId,
    text: unit.text, context: unit.context, disclosure: policy.disclosure, terms });
}
function deleteFts(db: Database, bankId: string, objectId: string): void {
  db.prepare("DELETE FROM hindsight_replica_sync_fts WHERE bank_id=:bank AND object_id=:id").run({ bank: bankId, id: objectId });
}
function stale(): never { throw new Error("HINDSIGHT_APPLICATION_PROJECTION_CAS_CONFLICT"); }
