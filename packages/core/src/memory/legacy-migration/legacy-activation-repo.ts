/**
 * INPUT:  verified run identity, readiness/manifest digests, prepared epoch, and current fenced lease
 * OUTPUT: atomic canonical-local authority marker plus immutable activation receipt
 * POS:    core/memory/legacy-migration — sole migration cutover transaction; no filesystem or async work inside
 */
import type { Database } from "../../db/sqlite.ts";
import type { Lease } from "./legacy-migration-ledger-repo.ts";

export interface MemoryAuthoritySelection {
  mode: "legacy-markdown" | "canonical-local" | "hindsight";
  epochId: string | null;
  snapshotId: string | null;
  transactionId: string | null;
  providerLineageId: string | null;
  replicaCheckpointDigest: string | null;
}
export function readMemoryAuthoritySelection(db: Database): MemoryAuthoritySelection {
  const row = db.prepare("SELECT * FROM memory_authority_selection WHERE singleton=1").get();
  if (!row || !["legacy-markdown", "canonical-local", "hindsight"].includes(String(row.mode))) throw new Error("MEMORY_INTEGRITY_ERROR");
  if (row.mode === "canonical-local" && (!row.active_epoch_id || !row.verified_snapshot_id || !row.activation_transaction_id)) throw new Error("MEMORY_INTEGRITY_ERROR");
  if (row.mode === "hindsight" && (!row.active_epoch_id || row.verified_snapshot_id !== null || !row.activation_transaction_id || !row.provider_lineage_id || !row.replica_checkpoint_digest)) throw new Error("MEMORY_INTEGRITY_ERROR");
  if (row.mode === "hindsight") verifyHindsightSelection(db, row);
  return { mode: row.mode as MemoryAuthoritySelection["mode"], epochId: row.active_epoch_id === null ? null : String(row.active_epoch_id),
    snapshotId: row.verified_snapshot_id === null ? null : String(row.verified_snapshot_id), transactionId: row.activation_transaction_id === null ? null : String(row.activation_transaction_id),
    providerLineageId: row.provider_lineage_id === null || row.provider_lineage_id === undefined ? null : String(row.provider_lineage_id),
    replicaCheckpointDigest: row.replica_checkpoint_digest === null || row.replica_checkpoint_digest === undefined ? null : String(row.replica_checkpoint_digest) };
}

function verifyHindsightSelection(db: Database, row: Record<string, unknown>): void {
  const receipt = db.prepare(`SELECT receipt.bank_count,run.phase,run.status FROM hindsight_authority_activation_receipts receipt
    JOIN hindsight_cutover_runs run ON run.run_id=receipt.run_id WHERE receipt.transaction_id=:tx
    AND receipt.hindsight_epoch_id=:epoch AND receipt.provider_lineage=:lineage AND receipt.checkpoint_set_digest=:digest`)
    .get({ tx: String(row.activation_transaction_id), epoch: String(row.active_epoch_id),
      lineage: String(row.provider_lineage_id), digest: String(row.replica_checkpoint_digest) });
  const authority = db.prepare(`SELECT e.provider_id,e.provider_lineage_id,e.status FROM canonical_memory_authority_state state
    JOIN canonical_memory_authority_epochs e ON e.epoch_id=state.active_epoch_id
    WHERE state.singleton=1 AND state.active_epoch_id=:epoch`).get({ epoch: String(row.active_epoch_id) });
  const banks = db.prepare("SELECT count(*) AS n FROM hindsight_authority_bank_receipts WHERE transaction_id=:tx")
    .get({ tx: String(row.activation_transaction_id) });
  if (!receipt || receipt.phase !== "activated" || receipt.status !== "completed"
    || Number(receipt.bank_count) < 1 || Number(receipt.bank_count) !== Number(banks?.n ?? -1)
    || !authority || authority.provider_id !== "hindsight" || authority.status !== "active"
    || authority.provider_lineage_id !== row.provider_lineage_id) throw new Error("MEMORY_INTEGRITY_ERROR");
}

export function activateCanonicalLocal(db: Database, input: { lease: Lease; manifestDigest: string; readinessDigest: string; transactionId: string; now: string }): MemoryAuthoritySelection {
  db.transaction(() => {
    const run = db.prepare(`SELECT snapshot_id,epoch_id,status,verified_manifest_digest,readiness_digest FROM memory_migration_runs
      WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now`).get({ run: input.lease.runId, owner: input.lease.owner, fence: input.lease.fence, now: input.now });
    if (!run || run.status !== "ready" || run.verified_manifest_digest !== input.manifestDigest || run.readiness_digest !== input.readinessDigest || !run.epoch_id) throw new Error("INTEGRITY_MISMATCH");
    const unresolved = db.prepare("SELECT count(*) AS n FROM memory_migration_sources WHERE run_id=:run AND disposition NOT IN ('converted-zero','converted-one','converted-many','excluded','verified')").get({ run: input.lease.runId });
    if (Number(unresolved?.n ?? 0) !== 0) throw new Error("INTEGRITY_MISMATCH");
    const active = db.prepare("SELECT active_epoch_id FROM canonical_memory_authority_state WHERE singleton=1").get();
    if (active?.active_epoch_id !== run.epoch_id) throw new Error("INTEGRITY_MISMATCH");
    const selected = db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,verified_snapshot_id=:snapshot,activation_transaction_id=:tx,updated_at=:now WHERE singleton=1 AND mode='legacy-markdown'")
      .run({ epoch: String(run.epoch_id), snapshot: String(run.snapshot_id), tx: input.transactionId, now: input.now });
    if (selected.changes !== 1) throw new Error("INTEGRITY_MISMATCH");
    db.prepare("INSERT INTO memory_migration_activation_receipts (run_id,transaction_id,snapshot_id,manifest_digest,readiness_digest,epoch_id,lease_fence,committed_at,marker_mode) VALUES (:run,:tx,:snapshot,:manifest,:readiness,:epoch,:fence,:now,'canonical-local')")
      .run({ run: input.lease.runId, tx: input.transactionId, snapshot: String(run.snapshot_id), manifest: input.manifestDigest, readiness: input.readinessDigest, epoch: String(run.epoch_id), fence: input.lease.fence, now: input.now });
    db.prepare("UPDATE memory_migration_runs SET phase='activated',status='completed',activation_transaction_id=:tx,updated_at=:now WHERE run_id=:run AND lease_fence=:fence")
      .run({ tx: input.transactionId, now: input.now, run: input.lease.runId, fence: input.lease.fence });
  });
  return readMemoryAuthoritySelection(db);
}
