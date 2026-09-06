/**
 * INPUT:  admitted one-record snapshot pages and Bank/lineage/generation-scoped page hashes
 * OUTPUT: payload-and-witness integrity-checked cache reads and replacement of the current manifest's cache
 * POS:    core/db — derivative transfer evidence; publication/pruning requires the replica transaction and lease
 */
import {
  HindsightLogicalSnapshotRecordSchema, type HindsightLogicalSnapshotMetadata,
  type HindsightLogicalSnapshotPage, type HindsightLogicalSnapshotRecord, type MemoryReplicaRecord,
} from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";

export interface ReplicaSnapshotCacheKey {
  bankId: string; providerLineageId: string; bankGeneration: string; pageHash: string;
}

export function readReplicaSnapshotCache(db: Database, key: ReplicaSnapshotCacheKey): HindsightLogicalSnapshotRecord | undefined {
  const row = db.prepare(`SELECT record_json,record_hash,object_kind,object_id FROM hindsight_replica_sync_snapshot_cache
    WHERE bank_id=:bank AND provider_lineage_id=:lineage AND bank_generation=:generation AND page_hash=:hash`)
    .get({ bank: key.bankId, lineage: key.providerLineageId, generation: key.bankGeneration, hash: key.pageHash });
  if (!row) return undefined;
  try {
    const record = HindsightLogicalSnapshotRecordSchema.parse(JSON.parse(String(row.record_json)));
    if (record.payload.value.bankId !== key.bankId || record.objectKind !== row.object_kind
      || record.objectId !== row.object_id || cacheRecordHash(key, record) !== row.record_hash) return undefined;
    return record;
  } catch {
    // This is rebuildable evidence, not authority. Corruption requires a fresh authenticated page read.
    return undefined;
  }
}

export function publishReplicaSnapshotCache(db: Database, input: {
  metadata: HindsightLogicalSnapshotMetadata; pages: HindsightLogicalSnapshotPage[];
}): void {
  const manifest = input.metadata.manifest;
  // Only the current verified manifest is retained, so deleted/superseded private payloads do not accumulate.
  db.prepare("DELETE FROM hindsight_replica_sync_snapshot_cache WHERE bank_id=:bank").run({ bank: manifest.bankId });
  const insert = db.prepare(`INSERT INTO hindsight_replica_sync_snapshot_cache
    (bank_id,provider_lineage_id,bank_generation,object_kind,object_id,page_hash,record_json,record_hash)
    VALUES (:bank,:lineage,:generation,:kind,:id,:hash,:record,:digest)`);
  for (const page of input.pages) {
    if (page.recordCount !== 1) continue;
    const record = HindsightLogicalSnapshotRecordSchema.parse(page.records[0]);
    const key = { bankId: manifest.bankId, providerLineageId: manifest.providerLineage,
      bankGeneration: manifest.bankGeneration, pageHash: page.contentHash };
    insert.run({ bank: manifest.bankId, lineage: manifest.providerLineage, generation: manifest.bankGeneration,
      kind: record.objectKind, id: record.objectId, hash: page.contentHash, record: canonicalJson(record), digest: cacheRecordHash(key, record) });
  }
}

export function invalidateReplicaSnapshotCache(db: Database, record: MemoryReplicaRecord): void {
  db.prepare("DELETE FROM hindsight_replica_sync_snapshot_cache WHERE bank_id=:bank AND object_kind=:kind AND object_id=:id")
    .run({ bank: record.bankId, kind: record.objectKind, id: record.objectId });
}

function cacheRecordHash(key: ReplicaSnapshotCacheKey, record: HindsightLogicalSnapshotRecord): string {
  // The normalized payload and its provider-byte witness are one integrity unit. A damaged key must not rebind it.
  return canonicalPayloadHash({ contract: "taki-replica-snapshot-cache.v1", bankId: key.bankId,
    providerLineageId: key.providerLineageId, bankGeneration: key.bankGeneration, pageHash: key.pageHash, record });
}
