/**
 * INPUT:  fully verified current maintenance evidence inside the Local writer-reserved transaction
 * OUTPUT: monotonic raw B4 checkpoint publication and reconstruction from immutable retained pages
 * POS:    core/db — disposable replica publication; late certificates cannot roll back an observed native cursor
 */
import type { HindsightCurrentVerificationEvidence, HindsightLogicalSnapshotPage } from "@taki/shared";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";
import { normalizeSnapshotMetadata, normalizeSnapshotPage } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import { createHindsightReplicaRepo } from "./hindsight-replica-repo.ts";
import type { Database, SqlRow } from "./sqlite.ts";

export function publishHindsightCurrentReplica(db: Database, input: {
  evidence: HindsightCurrentVerificationEvidence; runId: string; replicaEpochId: string; now: string;
}): void {
  const certificate = input.evidence.status.certificate;
  if (!certificate) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE");
  const metadata = normalizeSnapshotMetadata(certificate.snapshot);
  const pages = input.evidence.snapshotPages.map(normalizeSnapshotPage);
  const replica = createHindsightReplicaRepo(db); const checkpoint = replica.checkpoint(certificate.bank_id);
  if (checkpoint) {
    if (checkpoint.providerLineage !== certificate.provider_lineage || checkpoint.bankGeneration !== certificate.bank_generation
      || checkpoint.endCursor > metadata.manifest.endCursor
      || checkpoint.endCursor === metadata.manifest.endCursor && checkpoint.manifestDigest !== metadata.manifest.manifestDigest) {
      throw new Error("HINDSIGHT_CURRENT_REPLICA_STALE");
    }
    if (checkpoint.snapshotId === metadata.snapshotId) {
      if (checkpoint.endCursor !== metadata.manifest.endCursor || checkpoint.manifestDigest !== metadata.manifest.manifestDigest || checkpoint.capturedAt !== metadata.createdAt
        || checkpoint.snapshotExpiresAt !== metadata.expiresAt) throw new Error("HINDSIGHT_CURRENT_REPLICA_STALE");
    }
  }
  const existing = db.prepare(`SELECT * FROM hindsight_replica_staging_runs
    WHERE run_id=:run AND bank_id=:bank AND snapshot_id=:snapshot`)
    .get({ run: input.runId, bank: certificate.bank_id, snapshot: metadata.snapshotId });
  if (existing) {
    requireMatchingStage(db, { row: existing, evidence: input.evidence, pages });
    const rows = db.prepare("SELECT * FROM hindsight_replica_records WHERE bank_id=:bank").all({ bank: certificate.bank_id });
    if (checkpoint?.snapshotId === metadata.snapshotId && existing.status === "published"
      && replicaRowsMatch(rows, pages, checkpoint.replicaEpochId)) return;
  }
  // Replica epochs and run/Bank/snapshot tuples are unique. Reuse an intact staged snapshot on lost-checkpoint replay.
  const staged = existing ? { stagingId: String(existing.staging_id) }
    : replica.stage({ runId: input.runId, replicaEpochId: input.replicaEpochId, metadata, pages, now: input.now });
  replica.publish({ stagingId: staged.stagingId, capturedAt: metadata.createdAt, publishedAt: input.now });
}

function requireMatchingStage(db: Database, input: {
  row: SqlRow; evidence: HindsightCurrentVerificationEvidence; pages: HindsightLogicalSnapshotPage[];
}): void {
  const certificate = input.evidence.status.certificate;
  if (!certificate) throw new Error("HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE");
  const metadata = normalizeSnapshotMetadata(certificate.snapshot); const row = input.row;
  const records = db.prepare("SELECT * FROM hindsight_replica_staging_records WHERE staging_id=:id").all({ id: String(row.staging_id) });
  if (row.provider_lineage !== certificate.provider_lineage || row.bank_generation !== certificate.bank_generation
    || row.end_cursor !== metadata.manifest.endCursor || row.manifest_digest !== metadata.manifest.manifestDigest
    || row.manifest_json !== canonicalJson(metadata.manifest) || row.snapshot_expires_at !== metadata.expiresAt
    || row.status !== "verified" && row.status !== "published" || !replicaRowsMatch(records, input.pages)) {
    throw new Error("HINDSIGHT_CURRENT_REPLICA_STALE");
  }
}

function replicaRowsMatch(rows: SqlRow[], pages: HindsightLogicalSnapshotPage[], replicaEpochId?: string): boolean {
  const expected = new Map(pages.flatMap((page) => page.records).map((record) =>
    [`${record.objectKind}:${record.objectId}`, record]));
  if (rows.length !== expected.size) return false;
  return rows.every((row) => {
    const record = expected.get(`${String(row.object_kind)}:${String(row.object_id)}`);
    if (!record || replicaEpochId !== undefined && row.replica_epoch_id !== replicaEpochId || row.object_revision !== record.objectRevision
      || row.payload_hash !== canonicalPayloadHash(record.payload.value)) return false;
    try { return canonicalPayloadHash(JSON.parse(String(row.payload_json))) === row.payload_hash; }
    catch { return false; }
  });
}
