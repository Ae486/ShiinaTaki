/**
 * INPUT: isolated test database with a prepared Local authority epoch
 * OUTPUT: synthetic joined activation receipt and current marker for runtime contract tests
 * POS: core/memory test support only — does not establish actual migration or operator acceptance
 */
import type { Database } from "../db/sqlite.ts";

export function activateLocalRuntimeFixture(db: Database, epochId: string, identity: {
  runId?: string; snapshotId?: string; transactionId?: string; at?: string;
} = {}): void {
  const at = identity.at ?? "2026-08-29T00:00:00.000Z";
  const run = identity.runId ?? "local-run";
  const snapshot = identity.snapshotId ?? "snapshot";
  const transaction = identity.transactionId ?? "activation";
  db.prepare(`INSERT INTO memory_migration_runs(run_id,snapshot_id,epoch_id,phase,status,requested_at,updated_at,lease_fence,activation_transaction_id)
    VALUES (:run,:snapshot,:epoch,'activated','completed',:at,:at,1,:transaction)`).run({ run, snapshot, epoch: epochId, at, transaction });
  db.prepare(`INSERT INTO memory_migration_activation_receipts(run_id,transaction_id,snapshot_id,manifest_digest,readiness_digest,epoch_id,lease_fence,committed_at,marker_mode)
    VALUES (:run,:transaction,:snapshot,:digest,:digest,:epoch,1,:at,'canonical-local')`)
    .run({ run, transaction, snapshot, digest: "a".repeat(64), epoch: epochId, at });
  db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
    verified_snapshot_id=:snapshot,activation_transaction_id=:transaction,updated_at=:at WHERE singleton=1`)
    .run({ epoch: epochId, snapshot, transaction, at });
}
