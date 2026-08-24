/**
 * INPUT:  a completed B2 source run and B4 operator-owned cutover lifecycle requests
 * OUTPUT: separate B4 lease/readiness state without reopening the immutable B2 migration ledger
 * POS:    core/db — sole Hindsight cutover lifecycle writer; promotion consumes its fenced ready state
 */
import type { Database } from "./sqlite.ts";
import { HindsightCutoverStatusSchema, type HindsightCutoverStatus, type HindsightCutoverVerifyResult } from "@taki/shared";

export interface HindsightCutoverLease { runId: string; owner: string; fence: number; expiresAt: string }

export interface HindsightCutoverRunRepo {
  create(input: { runId: string; expectedPredecessorEpochId: string; now: string }): void;
  acquireLease(input: { runId: string; owner: string; now: string; expiresAt: string }): HindsightCutoverLease;
  renewLease(input: { lease: HindsightCutoverLease; now: string; expiresAt: string }): void;
  releaseLease(input: { lease: HindsightCutoverLease; now: string }): void;
  markReady(input: { lease: HindsightCutoverLease; configFingerprint: string; checkpointSetDigest: string; now: string }): void;
  status(runId: string): HindsightCutoverStatus;
  verify(input: { runId: string; expectedRevision: number; expectedEpochId: string }): HindsightCutoverVerifyResult;
}

export function createHindsightCutoverRunRepo(db: Database): HindsightCutoverRunRepo {
  return {
    create: (input) => create(db, input),
    acquireLease: (input) => acquireLease(db, input),
    renewLease: (input) => renewLease(db, input),
    releaseLease: (input) => releaseLease(db, input),
    markReady: (input) => markReady(db, input),
    status: (runId) => status(db, runId),
    verify: (input) => verify(db, input),
  };
}

function status(db: Database, runId: string): HindsightCutoverStatus {
  const row = db.prepare("SELECT * FROM hindsight_cutover_runs WHERE run_id=:run").get({ run: runId });
  if (!row) throw new Error("HINDSIGHT_CUTOVER_NOT_FOUND");
  const counts = { pending: 0, submitted: 0, processing: 0, completed: 0, mapped: 0, failed: 0, cancelled: 0, conflict: 0, excluded: 0 };
  for (const item of db.prepare("SELECT status,count(*) AS count FROM hindsight_import_operations WHERE run_id=:run GROUP BY status").all({ run: runId })) {
    const operationStatus = typeof item.status === "string" ? item.status : "";
    if (operationStatus in counts) counts[operationStatus as keyof typeof counts] = Number(item.count);
  }
  const sourceExclusions = Number(db.prepare(`SELECT count(*) AS count FROM memory_migration_sources s
    WHERE s.run_id=:run AND s.disposition='excluded'
      AND NOT EXISTS (SELECT 1 FROM hindsight_import_operations o WHERE o.run_id=s.run_id AND o.source_id=s.source_id)`)
    .get({ run: runId })?.count ?? 0);
  counts.excluded += sourceExclusions;
  const authority = db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get();
  const setup = db.prepare("SELECT revision FROM hindsight_connection_state WHERE singleton=1").get();
  return HindsightCutoverStatusSchema.parse({
    runId: String(row.run_id), setupRevision: Number(setup?.revision ?? -1), phase: row.phase, status: row.status,
    expectedPredecessorEpochId: String(row.expected_predecessor_epoch_id),
    lease: { active: row.lease_owner !== null && row.lease_expires_at !== null, fence: Number(row.lease_fence), expiresAt: row.lease_expires_at === null ? null : String(row.lease_expires_at) },
    sourceCount: Number(db.prepare("SELECT count(*) AS count FROM memory_migration_sources WHERE run_id=:run").get({ run: runId })?.count ?? 0),
    factMappingCount: Number(db.prepare("SELECT count(*) AS count FROM hindsight_import_facts WHERE run_id=:run").get({ run: runId })?.count ?? 0),
    checkpointCount: Number(db.prepare("SELECT count(*) AS count FROM hindsight_replica_checkpoints c JOIN hindsight_replica_staging_runs s ON s.staging_id=c.staging_id WHERE s.run_id=:run").get({ run: runId })?.count ?? 0),
    operationCounts: counts,
    authority: { mode: authority?.mode ?? "legacy-markdown", epochId: authority?.active_epoch_id === null || authority?.active_epoch_id === undefined ? null : String(authority.active_epoch_id) },
    updatedAt: String(row.updated_at),
  });
}

function verify(db: Database, input: { runId: string; expectedRevision: number; expectedEpochId: string }): HindsightCutoverVerifyResult {
  const snapshot = status(db, input.runId);
  const blockingCodes: string[] = [];
  if (snapshot.setupRevision !== input.expectedRevision) blockingCodes.push("HINDSIGHT_STATE_CONFLICT");
  if (snapshot.expectedPredecessorEpochId !== input.expectedEpochId) blockingCodes.push("HINDSIGHT_PREDECESSOR_STALE");
  if (snapshot.authority.mode === "canonical-local" && snapshot.authority.epochId !== input.expectedEpochId
    && !blockingCodes.includes("HINDSIGHT_PREDECESSOR_STALE")) blockingCodes.push("HINDSIGHT_PREDECESSOR_STALE");
  if (!(["ready", "activated"].includes(snapshot.phase) && ["ready", "completed"].includes(snapshot.status))) blockingCodes.push("HINDSIGHT_CUTOVER_NOT_READY");
  if (snapshot.operationCounts.pending + snapshot.operationCounts.submitted + snapshot.operationCounts.processing
    + snapshot.operationCounts.completed + snapshot.operationCounts.failed + snapshot.operationCounts.cancelled + snapshot.operationCounts.conflict > 0) {
    blockingCodes.push("HINDSIGHT_IMPORT_UNRESOLVED");
  }
  if (snapshot.sourceCount > snapshot.operationCounts.mapped + snapshot.operationCounts.excluded) {
    blockingCodes.push("HINDSIGHT_SOURCE_MAPPING_MISSING");
  }
  if (snapshot.checkpointCount === 0) blockingCodes.push("HINDSIGHT_CHECKPOINT_MISSING");
  if (snapshot.authority.mode !== "canonical-local" && snapshot.authority.mode !== "hindsight") blockingCodes.push("HINDSIGHT_AUTHORITY_NOT_LOCAL");
  return { runId: input.runId, expectedRevision: input.expectedRevision, expectedEpochId: input.expectedEpochId,
    eligible: blockingCodes.length === 0, blockingCodes, status: snapshot };
}

function create(db: Database, input: { runId: string; expectedPredecessorEpochId: string; now: string }): void {
  const source = db.prepare("SELECT phase,status FROM memory_migration_runs WHERE run_id=:run").get({ run: input.runId });
  if (!source || source.phase !== "activated" || source.status !== "completed") throw new Error("HINDSIGHT_SOURCE_RUN_NOT_COMPLETED");
  const predecessor = db.prepare("SELECT 1 AS ok FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch AND provider_id='local' AND status='active'").get({ epoch: input.expectedPredecessorEpochId });
  if (!predecessor) throw new Error("HINDSIGHT_PREDECESSOR_STALE");
  db.prepare(`INSERT INTO hindsight_cutover_runs
    (run_id,expected_predecessor_epoch_id,phase,status,created_at,updated_at)
    VALUES (:run,:predecessor,'importing','running',:now,:now)`)
    .run({ run: input.runId, predecessor: input.expectedPredecessorEpochId, now: input.now });
}

function acquireLease(db: Database, input: { runId: string; owner: string; now: string; expiresAt: string }): HindsightCutoverLease {
  let fence = 0;
  db.transaction(() => {
    const result = db.prepare(`UPDATE hindsight_cutover_runs SET lease_owner=:owner,lease_fence=lease_fence+1,
      lease_expires_at=:expires,updated_at=:now WHERE run_id=:run AND status IN ('running','ready')
      AND (lease_owner IS NULL OR lease_expires_at<=:now OR lease_owner=:owner)`)
      .run({ run: input.runId, owner: input.owner, now: input.now, expires: input.expiresAt });
    if (result.changes !== 1) throw new Error("LEASE_LOST");
    fence = Number(db.prepare("SELECT lease_fence FROM hindsight_cutover_runs WHERE run_id=:run").get({ run: input.runId })?.lease_fence ?? 0);
  });
  return { runId: input.runId, owner: input.owner, fence, expiresAt: input.expiresAt };
}

function renewLease(db: Database, input: { lease: HindsightCutoverLease; now: string; expiresAt: string }): void {
  const result = db.prepare(`UPDATE hindsight_cutover_runs SET lease_expires_at=:expires,updated_at=:now
    WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now AND status IN ('running','ready')`)
    .run({ run: input.lease.runId, owner: input.lease.owner, fence: input.lease.fence, now: input.now, expires: input.expiresAt });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}

function releaseLease(db: Database, input: { lease: HindsightCutoverLease; now: string }): void {
  const result = db.prepare(`UPDATE hindsight_cutover_runs SET lease_owner=NULL,lease_expires_at=NULL,updated_at=:now
    WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence`)
    .run({ run: input.lease.runId, owner: input.lease.owner, fence: input.lease.fence, now: input.now });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}

function markReady(db: Database, input: { lease: HindsightCutoverLease; configFingerprint: string; checkpointSetDigest: string; now: string }): void {
  const result = db.prepare(`UPDATE hindsight_cutover_runs SET phase='ready',status='ready',config_fingerprint=:config,
    checkpoint_set_digest=:digest,updated_at=:now WHERE run_id=:run AND phase IN ('importing','replica-verified')
    AND lease_owner=:owner AND lease_fence=:fence AND lease_expires_at>:now`)
    .run({ run: input.lease.runId, owner: input.lease.owner, fence: input.lease.fence, now: input.now,
      config: input.configFingerprint, digest: input.checkpointSetDigest });
  if (result.changes !== 1) throw new Error("LEASE_LOST");
}
