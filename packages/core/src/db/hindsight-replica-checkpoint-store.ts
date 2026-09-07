/**
 * INPUT:  validated current replica checkpoint and its expected predecessor
 * OUTPUT: typed checkpoint reads and checkpoint-last CAS publication
 * POS:    core/db — synchronous B5 storage primitive; callers hold the Bank lease and SQLite transaction
 */
import { MemoryReplicaCheckpointSchema, type MemoryReplicaCheckpoint } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export function readReplicaCheckpoint(db: Database, bankId: string): MemoryReplicaCheckpoint | undefined {
  const row = db.prepare("SELECT * FROM hindsight_replica_sync_checkpoints WHERE bank_id=:bank").get({ bank: bankId });
  if (!row) return undefined;
  return MemoryReplicaCheckpointSchema.parse({ providerLineageId: row.provider_lineage_id, bankId: row.bank_id,
    bankGeneration: row.bank_generation, authorityEpochId: row.authority_epoch_id, replicaEpochId: row.replica_epoch_id,
    endCursor: row.end_cursor, snapshotId: row.snapshot_id, snapshotCursor: row.snapshot_cursor,
    snapshotManifestDigest: row.snapshot_manifest_digest, manifestDigest: row.manifest_digest, verifiedAt: row.verified_at });
}

export function publishReplicaCheckpoint(db: Database, input: { previous: MemoryReplicaCheckpoint | null; next: MemoryReplicaCheckpoint }): void {
  const value = MemoryReplicaCheckpointSchema.parse(input.next); const previous = input.previous;
  const params = { bank: value.bankId, lineage: value.providerLineageId, generation: value.bankGeneration,
    authority: value.authorityEpochId, epoch: value.replicaEpochId, cursor: value.endCursor,
    snapshot: value.snapshotId, snapshotCursor: value.snapshotCursor, snapshotDigest: value.snapshotManifestDigest,
    digest: value.manifestDigest, verified: value.verifiedAt };
  if (previous === null) {
    db.prepare(`INSERT INTO hindsight_replica_sync_checkpoints
      (bank_id,provider_lineage_id,bank_generation,authority_epoch_id,replica_epoch_id,end_cursor,snapshot_id,snapshot_cursor,snapshot_manifest_digest,manifest_digest,verified_at)
      VALUES (:bank,:lineage,:generation,:authority,:epoch,:cursor,:snapshot,:snapshotCursor,:snapshotDigest,:digest,:verified)`).run(params);
    return;
  }
  const result = db.prepare(`UPDATE hindsight_replica_sync_checkpoints SET provider_lineage_id=:lineage,
    bank_generation=:generation,authority_epoch_id=:authority,replica_epoch_id=:epoch,end_cursor=:cursor,
    snapshot_id=:snapshot,snapshot_cursor=:snapshotCursor,snapshot_manifest_digest=:snapshotDigest,
    manifest_digest=:digest,verified_at=:verified WHERE bank_id=:bank AND replica_epoch_id=:previousEpoch
    AND end_cursor=:previousCursor AND manifest_digest=:previousDigest`)
    .run({ ...params, previousEpoch: previous.replicaEpochId, previousCursor: previous.endCursor, previousDigest: previous.manifestDigest });
  if (result.changes !== 1) throw new Error("HINDSIGHT_CHECKPOINT_STALE");
}
