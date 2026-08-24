/**
 * INPUT:  a ready B4 cutover lease, fenced Local predecessor, setup evidence, and published checkpoints
 * OUTPUT: one atomic Hindsight Authority Epoch promotion or a bounded refusal with Local state unchanged
 * POS:    core/db — Wave 4 authority transaction; no network, filesystem, await, or provider calls
 */
import { HindsightReplicaCheckpointSchema, type HindsightReplicaCheckpoint } from "@taki/shared";
import type { HindsightCutoverLease } from "./hindsight-cutover-run-repo.ts";
import type { Database, SqlRow } from "./sqlite.ts";
import { readMemoryAuthoritySelection, type MemoryAuthoritySelection } from "../memory/legacy-migration/legacy-activation-repo.ts";
import { canonicalPayloadHash } from "../memory/legacy-migration/legacy-identities.ts";

export interface HindsightPromotionBank {
  bankId: string;
  templateDigest: string;
  checkpoint: HindsightReplicaCheckpoint;
}

export interface HindsightPromotionInput {
  lease: HindsightCutoverLease;
  predecessorEpochId: string;
  hindsightEpochId: string;
  transactionId: string;
  configFingerprint: string;
  checkpointSetDigest: string;
  banks: HindsightPromotionBank[];
  now: string;
}

export interface HindsightPromotionResult {
  selection: MemoryAuthoritySelection;
  hindsightEpochId: string;
  predecessorEpochId: string;
}

export function promoteHindsightAuthority(db: Database, input: HindsightPromotionInput): HindsightPromotionResult {
  db.transaction(() => {
    validateInput(input);
    const lineage = requirePreconditions(db, input);
    commitPromotion(db, input, lineage);
  });
  return { selection: readMemoryAuthoritySelection(db), hindsightEpochId: input.hindsightEpochId, predecessorEpochId: input.predecessorEpochId };
}

function validateInput(input: HindsightPromotionInput): void {
  if (!isId(input.predecessorEpochId) || !isId(input.hindsightEpochId) || !isId(input.transactionId)
    || !isDigest(input.configFingerprint) || !isDigest(input.checkpointSetDigest) || input.banks.length === 0) {
    throw new Error("HINDSIGHT_PROMOTION_INPUT_INVALID");
  }
  const bankIds = new Set(input.banks.map((bank) => bank.bankId));
  if (bankIds.size !== input.banks.length || input.banks.some((bank) => !isId(bank.bankId) || !isDigest(bank.templateDigest))) {
    throw new Error("HINDSIGHT_BANKS_INCOMPLETE");
  }
}

function requirePreconditions(db: Database, input: HindsightPromotionInput): string {
  requirePredecessor(db, input.predecessorEpochId);
  requireSourceActivation(db, input);
  requireReadyCutover(db, input);
  requireImportsComplete(db, input.lease.runId);
  const lineage = requireLineage(input.banks);
  requireConnection(db, input.configFingerprint, lineage);
  requireSetupBanks(db, input.banks);
  requireImportBanks(db, input.lease.runId, input.banks);
    requireCheckpoints(db, input);
  requireReplicaMappings(db, input.lease.runId, input.banks);
  if (hindsightCheckpointSetDigest(input.banks) !== input.checkpointSetDigest) throw new Error("HINDSIGHT_CHECKPOINT_SET_STALE");
  return lineage;
}

function requirePredecessor(db: Database, predecessorEpochId: string): void {
  const row = db.prepare(`SELECT e.epoch_id FROM canonical_memory_authority_state s
    JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id
    WHERE s.singleton=1 AND e.epoch_id=:epoch AND e.provider_id='local' AND e.status='active' AND e.reason='initial-local'`)
    .get({ epoch: predecessorEpochId });
  const marker = db.prepare("SELECT mode,active_epoch_id FROM memory_authority_selection WHERE singleton=1").get();
  if (!row || !marker || marker.mode !== "canonical-local" || marker.active_epoch_id !== predecessorEpochId) {
    throw new Error("HINDSIGHT_PREDECESSOR_STALE");
  }
}

function requireSourceActivation(db: Database, input: HindsightPromotionInput): void {
  const row = db.prepare(`SELECT 1 AS valid FROM memory_migration_runs r
    JOIN memory_migration_activation_receipts receipt ON receipt.run_id=r.run_id
    WHERE r.run_id=:run AND r.phase='activated' AND r.status='completed'
      AND receipt.epoch_id=:predecessor AND receipt.marker_mode='canonical-local'`)
    .get({ run: input.lease.runId, predecessor: input.predecessorEpochId });
  if (!row) throw new Error("HINDSIGHT_SOURCE_RUN_NOT_COMPLETED");
}

function requireReadyCutover(db: Database, input: HindsightPromotionInput): void {
  const row = db.prepare(`SELECT 1 AS valid FROM hindsight_cutover_runs WHERE run_id=:run
    AND expected_predecessor_epoch_id=:predecessor AND phase='ready' AND status='ready'
    AND config_fingerprint=:config AND checkpoint_set_digest=:digest AND lease_owner=:owner
    AND lease_fence=:fence AND lease_expires_at>:now`).get({ run: input.lease.runId,
    predecessor: input.predecessorEpochId, config: input.configFingerprint, digest: input.checkpointSetDigest,
    owner: input.lease.owner, fence: input.lease.fence, now: input.now });
  if (!row) throw new Error("LEASE_LOST");
}

function requireImportsComplete(db: Database, runId: string): void {
  const unresolved = db.prepare(`SELECT count(*) AS n FROM hindsight_import_operations WHERE run_id=:run
    AND status NOT IN ('mapped','excluded')`).get({ run: runId });
  const sources = db.prepare(`SELECT count(*) AS n FROM memory_migration_sources WHERE run_id=:run
    AND disposition NOT IN ('converted-zero','converted-one','converted-many','excluded','verified')`).get({ run: runId });
  const missing = db.prepare(`SELECT count(*) AS n FROM memory_migration_sources s WHERE s.run_id=:run
    AND s.disposition<>'excluded' AND NOT EXISTS (SELECT 1 FROM hindsight_import_operations o
      WHERE o.run_id=s.run_id AND o.source_id=s.source_id)`).get({ run: runId });
  const mappings = db.prepare(`SELECT count(*) AS n FROM hindsight_import_operations o WHERE o.run_id=:run AND o.status='mapped'
    AND (o.mapping_complete<>1 OR o.derived_unit_count<>(SELECT count(*) FROM hindsight_import_facts f
      WHERE f.run_id=o.run_id AND f.source_id=o.source_id) OR (o.derived_unit_count=0 AND o.zero_fact_allowed<>1))`).get({ run: runId });
  if ([unresolved, sources, missing, mappings].some((row) => Number(row?.n ?? 0) !== 0)) throw new Error("HINDSIGHT_IMPORT_UNRESOLVED");
}

function requireLineage(banks: HindsightPromotionBank[]): string {
  const lineage = banks[0]?.checkpoint.providerLineage;
  if (!lineage || banks.some((bank) => bank.checkpoint.providerLineage !== lineage)) throw new Error("HINDSIGHT_PROVIDER_LINEAGE_MISMATCH");
  return lineage;
}

function requireConnection(db: Database, configFingerprint: string, lineage: string): void {
  const row = db.prepare("SELECT phase,config_fingerprint,compatibility_json FROM hindsight_connection_state WHERE singleton=1").get();
  if (!row || row.phase !== "configured" || row.config_fingerprint !== configFingerprint || !row.compatibility_json) {
    throw new Error("HINDSIGHT_CONNECTION_NOT_VERIFIED");
  }
  let compatibility: unknown;
  try { compatibility = JSON.parse(String(row.compatibility_json)); } catch { throw new Error("HINDSIGHT_CONNECTION_NOT_VERIFIED"); }
  if (!isRecord(compatibility) || compatibility.providerLineage !== lineage) throw new Error("HINDSIGHT_PROVIDER_LINEAGE_MISMATCH");
}

function requireSetupBanks(db: Database, banks: HindsightPromotionBank[]): void {
  const configured = db.prepare("SELECT external_bank_id,template_digest,status FROM hindsight_bank_setup ORDER BY external_bank_id").all();
  const expected = [...banks].sort((left, right) => left.bankId.localeCompare(right.bankId));
  if (configured.length !== expected.length) throw new Error("HINDSIGHT_BANKS_INCOMPLETE");
  for (const [index, bank] of expected.entries()) {
    const row = configured[index];
    if (!row || row.status !== "verified" || row.external_bank_id !== bank.bankId || row.template_digest !== bank.templateDigest) {
      throw new Error("HINDSIGHT_TEMPLATE_NOT_VERIFIED");
    }
  }
}

function requireImportBanks(db: Database, runId: string, banks: HindsightPromotionBank[]): void {
  const expected = [...new Set(banks.map((bank) => bank.bankId))].sort();
  const actual = db.prepare("SELECT DISTINCT bank_id FROM hindsight_import_operations WHERE run_id=:run ORDER BY bank_id")
    .all({ run: runId }).map((row) => String(row.bank_id));
  if (actual.length !== expected.length || actual.some((bankId, index) => bankId !== expected[index])) {
    throw new Error("HINDSIGHT_BANKS_INCOMPLETE");
  }
}

function requireCheckpoints(db: Database, input: HindsightPromotionInput): void {
  const count = db.prepare("SELECT count(*) AS n FROM hindsight_replica_checkpoints").get();
  if (Number(count?.n ?? -1) !== input.banks.length) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
  for (const bank of input.banks) {
    const row = db.prepare("SELECT * FROM hindsight_replica_checkpoints WHERE bank_id=:bank").get({ bank: bank.bankId });
    if (!row) throw new Error("HINDSIGHT_CHECKPOINT_MISSING");
    let checkpoint: HindsightReplicaCheckpoint;
    try { checkpoint = parseCheckpoint(row); } catch { throw new Error("HINDSIGHT_CHECKPOINT_STALE"); }
    if (!sameCheckpoint(checkpoint, bank.checkpoint) || Date.parse(checkpoint.snapshotExpiresAt) <= Date.parse(input.now)) {
      throw new Error("HINDSIGHT_CHECKPOINT_STALE");
    }
    const staged = db.prepare("SELECT run_id,status,manifest_digest,snapshot_id FROM hindsight_replica_staging_runs WHERE staging_id=:staging")
      .get({ staging: String(row.staging_id ?? "") });
    if (!staged || staged.run_id !== input.lease.runId || staged.status !== "published"
      || staged.manifest_digest !== row.manifest_digest || staged.snapshot_id !== row.snapshot_id) {
      throw new Error("HINDSIGHT_MANIFEST_STALE");
    }
    requireVisibleReplica(db, bank, String(row.staging_id));
  }
}

function requireVisibleReplica(db: Database, bank: HindsightPromotionBank, stagingId: string): void {
  const counts = db.prepare(`SELECT
    (SELECT count(*) FROM hindsight_replica_staging_records WHERE staging_id=:staging) AS staged,
    (SELECT count(*) FROM hindsight_replica_records WHERE bank_id=:bank AND replica_epoch_id=:epoch) AS visible`).get({ staging: stagingId, bank: bank.bankId, epoch: bank.checkpoint.replicaEpochId });
  const different = db.prepare(`SELECT count(*) AS n FROM hindsight_replica_staging_records staged
    LEFT JOIN hindsight_replica_records visible ON visible.bank_id=:bank AND visible.replica_epoch_id=:epoch
      AND visible.object_kind=staged.object_kind AND visible.object_id=staged.object_id
      AND visible.object_revision=staged.object_revision AND visible.payload_hash=staged.payload_hash
    WHERE staged.staging_id=:staging AND visible.object_id IS NULL`).get({ staging: stagingId, bank: bank.bankId, epoch: bank.checkpoint.replicaEpochId });
  if (Number(counts?.staged ?? -1) !== Number(counts?.visible ?? -2) || Number(different?.n ?? -1) !== 0) {
    throw new Error("HINDSIGHT_REPLICA_NOT_PUBLISHED");
  }
}

function requireReplicaMappings(db: Database, runId: string, banks: HindsightPromotionBank[]): void {
  const expectedBanks = new Set(banks.map((bank) => bank.bankId));
  const documents = db.prepare(`SELECT o.bank_id,o.document_id,c.staging_id FROM hindsight_import_operations o
    LEFT JOIN hindsight_replica_checkpoints c ON c.bank_id=o.bank_id WHERE o.run_id=:run AND o.status='mapped'`).all({ run: runId });
  for (const row of documents) {
    const bankId = String(row.bank_id);
    if (!expectedBanks.has(bankId) || !row.staging_id) throw new Error("HINDSIGHT_MAPPING_UNVERIFIED");
    const document = db.prepare(`SELECT 1 AS valid FROM hindsight_replica_staging_records WHERE staging_id=:staging
      AND object_kind='document' AND object_id=:document`).get({ staging: String(row.staging_id), document: String(row.document_id) });
    if (!document) throw new Error("HINDSIGHT_MAPPING_UNVERIFIED");
  }
  const facts = db.prepare(`SELECT o.bank_id,f.fact_id,f.revision,f.payload_hash,c.staging_id FROM hindsight_import_operations o
    JOIN hindsight_import_facts f ON f.run_id=o.run_id AND f.source_id=o.source_id
    LEFT JOIN hindsight_replica_checkpoints c ON c.bank_id=o.bank_id
    WHERE o.run_id=:run AND o.status='mapped'`).all({ run: runId });
  for (const row of facts) {
    const bankId = String(row.bank_id);
    if (!expectedBanks.has(bankId) || !row.staging_id) throw new Error("HINDSIGHT_MAPPING_UNVERIFIED");
    const record = db.prepare(`SELECT 1 AS valid FROM hindsight_replica_staging_records WHERE staging_id=:staging
      AND object_kind='memory_unit' AND object_id=:fact AND object_revision=:revision AND payload_hash=:hash`)
      .get({ staging: String(row.staging_id), fact: String(row.fact_id), revision: Number(row.revision), hash: String(row.payload_hash) });
    if (!record) throw new Error("HINDSIGHT_MAPPING_UNVERIFIED");
  }
}

function commitPromotion(db: Database, input: HindsightPromotionInput, lineage: string): void {
  changed(db.prepare("UPDATE canonical_memory_authority_epochs SET status='closed',ended_at=:now WHERE epoch_id=:epoch AND status='active'")
    .run({ now: input.now, epoch: input.predecessorEpochId }), "HINDSIGHT_PREDECESSOR_STALE");
  const conflict = db.prepare("SELECT 1 AS conflict FROM canonical_memory_authority_epochs WHERE epoch_id=:epoch")
    .get({ epoch: input.hindsightEpochId });
  if (conflict) throw new Error("HINDSIGHT_PROMOTION_CONFLICT");
  changed(db.prepare(`INSERT INTO canonical_memory_authority_epochs
    (epoch_id,provider_id,provider_lineage_id,status,predecessor_epoch_id,started_at,ended_at,reason)
    VALUES (:epoch,'hindsight',:lineage,'active',:predecessor,:now,NULL,'planned-switch')`)
    .run({ epoch: input.hindsightEpochId, lineage, predecessor: input.predecessorEpochId, now: input.now }), "HINDSIGHT_PROMOTION_CONFLICT");
  changed(db.prepare("UPDATE canonical_memory_authority_state SET active_epoch_id=:epoch,updated_at=:now WHERE singleton=1 AND active_epoch_id=:predecessor")
    .run({ epoch: input.hindsightEpochId, predecessor: input.predecessorEpochId, now: input.now }), "HINDSIGHT_PREDECESSOR_STALE");
  writeReceipts(db, input, lineage);
  changed(db.prepare(`UPDATE memory_authority_selection SET mode='hindsight',active_epoch_id=:epoch,verified_snapshot_id=NULL,
    activation_transaction_id=:tx,provider_lineage_id=:lineage,replica_checkpoint_digest=:digest,updated_at=:now
    WHERE singleton=1 AND mode='canonical-local' AND active_epoch_id=:predecessor`)
    .run({ epoch: input.hindsightEpochId, tx: input.transactionId, lineage, digest: input.checkpointSetDigest,
      now: input.now, predecessor: input.predecessorEpochId }), "HINDSIGHT_PREDECESSOR_STALE");
  changed(db.prepare(`UPDATE hindsight_cutover_runs SET phase='activated',status='completed',lease_owner=NULL,
    lease_expires_at=NULL,updated_at=:now WHERE run_id=:run AND phase='ready' AND status='ready' AND lease_owner=:owner
    AND lease_fence=:fence AND lease_expires_at>:now`).run({ run: input.lease.runId, owner: input.lease.owner,
      fence: input.lease.fence, now: input.now }), "LEASE_LOST");
}

function writeReceipts(db: Database, input: HindsightPromotionInput, lineage: string): void {
  changed(db.prepare(`INSERT INTO hindsight_authority_activation_receipts
    (transaction_id,run_id,predecessor_epoch_id,hindsight_epoch_id,provider_lineage,config_fingerprint,checkpoint_set_digest,bank_count,lease_fence,committed_at)
    VALUES (:tx,:run,:predecessor,:epoch,:lineage,:config,:checkpoints,:count,:fence,:now)`)
    .run({ tx: input.transactionId, run: input.lease.runId, predecessor: input.predecessorEpochId, epoch: input.hindsightEpochId,
      lineage, config: input.configFingerprint, checkpoints: input.checkpointSetDigest, count: input.banks.length,
      fence: input.lease.fence, now: input.now }), "HINDSIGHT_PROMOTION_CONFLICT");
  const insert = db.prepare(`INSERT INTO hindsight_authority_bank_receipts
    (transaction_id,bank_id,snapshot_id,bank_generation,replica_epoch_id,end_cursor,manifest_digest,template_digest)
    VALUES (:tx,:bank,:snapshot,:generation,:replica,:cursor,:manifest,:template)`);
  for (const bank of input.banks) {
    changed(insert.run({ tx: input.transactionId, bank: bank.bankId, snapshot: bank.checkpoint.snapshotId,
      generation: bank.checkpoint.bankGeneration, replica: bank.checkpoint.replicaEpochId,
      cursor: bank.checkpoint.endCursor, manifest: bank.checkpoint.manifestDigest, template: bank.templateDigest }), "HINDSIGHT_PROMOTION_CONFLICT");
  }
}

function parseCheckpoint(row: SqlRow): HindsightReplicaCheckpoint {
  return HindsightReplicaCheckpointSchema.parse({ providerLineage: row.provider_lineage, bankId: row.bank_id,
    bankGeneration: row.bank_generation, replicaEpochId: row.replica_epoch_id, snapshotId: row.snapshot_id,
    endCursor: row.end_cursor, manifestDigest: row.manifest_digest, capturedAt: row.captured_at,
    snapshotExpiresAt: row.snapshot_expires_at, publishedAt: row.published_at });
}

export function hindsightCheckpointSetDigest(banks: HindsightPromotionBank[]): string {
  return canonicalPayloadHash([...banks].sort((left, right) => left.bankId.localeCompare(right.bankId)).map((bank) => ({
    ...bank.checkpoint, bankId: bank.bankId, templateDigest: bank.templateDigest,
  })));
}

function changed(result: { changes: number }, code: string): void { if (result.changes !== 1) throw new Error(code); }
function sameCheckpoint(left: HindsightReplicaCheckpoint, right: HindsightReplicaCheckpoint): boolean {
  return left.providerLineage === right.providerLineage && left.bankId === right.bankId && left.bankGeneration === right.bankGeneration
    && left.replicaEpochId === right.replicaEpochId && left.snapshotId === right.snapshotId && left.endCursor === right.endCursor
    && left.manifestDigest === right.manifestDigest && left.capturedAt === right.capturedAt
    && left.snapshotExpiresAt === right.snapshotExpiresAt && left.publishedAt === right.publishedAt;
}
function isId(value: string): boolean { return value.length > 0 && value.length <= 256; }
function isDigest(value: string): boolean { return /^[a-f0-9]{64}$/.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
