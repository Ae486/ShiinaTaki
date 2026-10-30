/**
 * INPUT:  the verified application replica and the historical native snapshot cache
 * OUTPUT: the existing Pending recovery reader interface backed by current D77 projections
 * POS:    core/memory/hindsight — explicit read adapter; old B5 write/hash meanings are never reinterpreted
 */
import type { Database } from "../../db/sqlite.ts";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import { readReplicaSnapshotCache } from "../../db/hindsight-replica-snapshot-cache.ts";

export function createHindsightApplicationRecoveryReplica(input: { db: Database; replica: HindsightApplicationReplicaRepo }): HindsightReplicaSyncRepo {
  const scope = (bankId: string) => {
    const checkpoint = input.replica.checkpoint(bankId);
    if (!checkpoint) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
    return { bankId, namespace: checkpoint.namespace };
  };
  const nativeWrite = (): never => { throw new Error("HINDSIGHT_APPLICATION_NATIVE_PUBLICATION_REFUSED"); };
  return { leases: input.replica.leases, checkpoint: input.replica.nativeCheckpoint,
    seedVerifiedSnapshot: nativeWrite, reconcileVerifiedSnapshot: nativeWrite, applyPage: nativeWrite,
    cachedSnapshotRecord: (key) => readReplicaSnapshotCache(input.db, key),
    logicalRecord: (query) => input.replica.logicalRecord({ ...query, ...scope(query.bankId) }),
    record: (query) => input.replica.record({ ...query, ...scope(query.bankId), includeHidden: true }),
    search: (query) => input.replica.search({ ...query, ...scope(query.bankId) }) };
}
