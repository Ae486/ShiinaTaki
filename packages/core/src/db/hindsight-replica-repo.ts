/**
 * INPUT:  verified Hindsight logical snapshot pages plus an isolated replica epoch identity
 * OUTPUT: atomic staging replacement and per-Bank checkpoint publication with restart-safe reads
 * POS:    core/db — single-writer replica staging store; checkpoint is always written last
 */
import { randomUUID } from "node:crypto";
import { HindsightReplicaCheckpointSchema, type HindsightLogicalSnapshotMetadata, type HindsightLogicalSnapshotPage, type HindsightReplicaCheckpoint } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import { canonicalJson, canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";

export interface StagedReplica {
  stagingId: string;
  replicaEpochId: string;
  bankId: string;
  snapshotId: string;
  status: "verified" | "published";
  recordCount: number;
}

export interface HindsightReplicaRepo {
  stage(input: { runId: string; replicaEpochId: string; metadata: HindsightLogicalSnapshotMetadata; pages: HindsightLogicalSnapshotPage[]; now: string }): StagedReplica;
  publish(input: { stagingId: string; capturedAt: string; publishedAt: string }): HindsightReplicaCheckpoint;
  checkpoint(bankId: string): HindsightReplicaCheckpoint | undefined;
  staged(stagingId: string): StagedReplica | undefined;
  records(stagingId: string): Array<{ objectKind: string; objectId: string; objectRevision: number; payloadHash: string }>;
  visibleRecords(bankId: string): Array<{ objectKind: string; objectId: string; objectRevision: number; payloadHash: string }>;
}

export function createHindsightReplicaRepo(db: Database): HindsightReplicaRepo {
  return {
    stage: (input) => stage(db, input), publish: (input) => publish(db, input),
    checkpoint: (bankId) => checkpoint(db, bankId), staged: (stagingId) => staged(db, stagingId),
    records: (stagingId) => records(db, stagingId), visibleRecords: (bankId) => visibleRecords(db, bankId),
  };
}

function stage(db: Database, input: { runId: string; replicaEpochId: string; metadata: HindsightLogicalSnapshotMetadata; pages: HindsightLogicalSnapshotPage[]; now: string }): StagedReplica {
  const manifest = input.metadata.manifest;
  const stagingId = randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO hindsight_replica_staging_runs
      (staging_id,run_id,replica_epoch_id,provider_lineage,bank_id,bank_generation,snapshot_id,end_cursor,manifest_digest,manifest_json,snapshot_expires_at,status,created_at,updated_at)
      VALUES (:staging,:run,:epoch,:lineage,:bank,:generation,:snapshot,:cursor,:digest,:manifest,:expires,'building',:now,:now)`)
      .run({ staging: stagingId, run: input.runId, epoch: input.replicaEpochId, lineage: manifest.providerLineage,
        bank: manifest.bankId, generation: manifest.bankGeneration, snapshot: input.metadata.snapshotId,
        cursor: manifest.endCursor, digest: manifest.manifestDigest, manifest: canonicalJson(manifest), expires: input.metadata.expiresAt, now: input.now });
    const insert = db.prepare(`INSERT INTO hindsight_replica_staging_records
      (staging_id,page_number,record_ordinal,object_kind,object_id,object_revision,payload_hash,payload_json)
      VALUES (:staging,:page,:ordinal,:kind,:id,:revision,:hash,:payload)`);
    for (const page of input.pages) for (const [ordinal, record] of page.records.entries()) {
      insert.run({ staging: stagingId, page: page.pageNumber, ordinal, kind: record.objectKind, id: record.objectId,
        revision: record.objectRevision, hash: canonicalPayloadHash(record.payload.value), payload: canonicalJson(record.payload.value) });
    }
    const count = Number(db.prepare("SELECT count(*) AS n FROM hindsight_replica_staging_records WHERE staging_id=:staging").get({ staging: stagingId })?.n ?? -1);
    if (count !== manifest.totalRecords) throw new Error("HINDSIGHT_REPLICA_RECORD_COUNT_MISMATCH");
    db.prepare("UPDATE hindsight_replica_staging_runs SET status='verified',updated_at=:now WHERE staging_id=:staging")
      .run({ staging: stagingId, now: input.now });
  });
  return requiredStaged(db, stagingId);
}

function publish(db: Database, input: { stagingId: string; capturedAt: string; publishedAt: string }): HindsightReplicaCheckpoint {
  let bankId = "";
  db.transaction(() => {
    const row = db.prepare("SELECT * FROM hindsight_replica_staging_runs WHERE staging_id=:staging AND status IN ('verified','published')")
      .get({ staging: input.stagingId });
    if (!row) throw new Error("HINDSIGHT_REPLICA_NOT_VERIFIED");
    bankId = String(row.bank_id);
    const current = db.prepare("SELECT staging_id FROM hindsight_replica_checkpoints WHERE bank_id=:bank").get({ bank: bankId });
    if (row.status === "published" && current && current.staging_id !== input.stagingId) throw new Error("HINDSIGHT_CHECKPOINT_STALE");
    db.prepare("DELETE FROM hindsight_replica_records WHERE bank_id=:bank").run({ bank: bankId });
    db.prepare(`INSERT INTO hindsight_replica_records
      (bank_id,replica_epoch_id,object_kind,object_id,object_revision,payload_hash,payload_json)
      SELECT :bank,:epoch,object_kind,object_id,object_revision,payload_hash,payload_json
      FROM hindsight_replica_staging_records WHERE staging_id=:staging ORDER BY page_number,record_ordinal`)
      .run({ bank: bankId, epoch: String(row.replica_epoch_id), staging: input.stagingId });
    db.prepare(`INSERT INTO hindsight_replica_checkpoints
      (bank_id,replica_epoch_id,provider_lineage,bank_generation,snapshot_id,end_cursor,manifest_digest,captured_at,snapshot_expires_at,published_at,staging_id)
      VALUES (:bank,:epoch,:lineage,:generation,:snapshot,:cursor,:digest,:captured,:expires,:published,:staging)
      ON CONFLICT(bank_id) DO UPDATE SET replica_epoch_id=excluded.replica_epoch_id,provider_lineage=excluded.provider_lineage,
      bank_generation=excluded.bank_generation,snapshot_id=excluded.snapshot_id,end_cursor=excluded.end_cursor,
      manifest_digest=excluded.manifest_digest,captured_at=excluded.captured_at,snapshot_expires_at=excluded.snapshot_expires_at,
      published_at=excluded.published_at,staging_id=excluded.staging_id`)
      .run({ bank: String(row.bank_id), epoch: String(row.replica_epoch_id), lineage: String(row.provider_lineage), generation: String(row.bank_generation),
        snapshot: String(row.snapshot_id), cursor: Number(row.end_cursor), digest: String(row.manifest_digest), captured: input.capturedAt,
        expires: String(row.snapshot_expires_at),
        published: input.publishedAt, staging: input.stagingId });
    db.prepare("UPDATE hindsight_replica_staging_runs SET status='published',updated_at=:now WHERE staging_id=:staging")
      .run({ staging: input.stagingId, now: input.publishedAt });
  });
  return requiredCheckpoint(db, bankId);
}

function checkpoint(db: Database, bankId: string): HindsightReplicaCheckpoint | undefined {
  const row = db.prepare("SELECT * FROM hindsight_replica_checkpoints WHERE bank_id=:bank").get({ bank: bankId });
  return row ? parseCheckpoint(row) : undefined;
}
function staged(db: Database, stagingId: string): StagedReplica | undefined {
  const row = db.prepare(`SELECT s.*,count(r.object_id) AS record_count FROM hindsight_replica_staging_runs s
    LEFT JOIN hindsight_replica_staging_records r ON r.staging_id=s.staging_id WHERE s.staging_id=:staging GROUP BY s.staging_id`).get({ staging: stagingId });
  if (!row || (row.status !== "verified" && row.status !== "published")) return undefined;
  return { stagingId: String(row.staging_id), replicaEpochId: String(row.replica_epoch_id), bankId: String(row.bank_id),
    snapshotId: String(row.snapshot_id), status: String(row.status) as StagedReplica["status"], recordCount: Number(row.record_count) };
}
function records(db: Database, stagingId: string): Array<{ objectKind: string; objectId: string; objectRevision: number; payloadHash: string }> {
  return db.prepare(`SELECT object_kind,object_id,object_revision,payload_hash FROM hindsight_replica_staging_records
    WHERE staging_id=:staging ORDER BY page_number,record_ordinal`).all({ staging: stagingId })
    .map((row) => ({ objectKind: String(row.object_kind), objectId: String(row.object_id), objectRevision: Number(row.object_revision), payloadHash: String(row.payload_hash) }));
}
function visibleRecords(db: Database, bankId: string): Array<{ objectKind: string; objectId: string; objectRevision: number; payloadHash: string }> {
  return db.prepare(`SELECT object_kind,object_id,object_revision,payload_hash FROM hindsight_replica_records
    WHERE bank_id=:bank ORDER BY object_kind,object_id`).all({ bank: bankId })
    .map((row) => ({ objectKind: String(row.object_kind), objectId: String(row.object_id), objectRevision: Number(row.object_revision), payloadHash: String(row.payload_hash) }));
}
function parseCheckpoint(row: SqlRow): HindsightReplicaCheckpoint {
  return HindsightReplicaCheckpointSchema.parse({ providerLineage: row.provider_lineage, bankId: row.bank_id,
    bankGeneration: row.bank_generation, replicaEpochId: row.replica_epoch_id, snapshotId: row.snapshot_id, endCursor: row.end_cursor,
    manifestDigest: row.manifest_digest, capturedAt: row.captured_at, snapshotExpiresAt: row.snapshot_expires_at,
    publishedAt: row.published_at });
}
function requiredStaged(db: Database, id: string): StagedReplica { const value = staged(db, id); if (!value) throw new Error("HINDSIGHT_REPLICA_STAGE_FAILED"); return value; }
function requiredCheckpoint(db: Database, id: string): HindsightReplicaCheckpoint { const value = checkpoint(db, id); if (!value) throw new Error("HINDSIGHT_REPLICA_CHECKPOINT_FAILED"); return value; }
