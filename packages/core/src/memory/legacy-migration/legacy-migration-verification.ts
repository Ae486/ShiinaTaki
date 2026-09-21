/**
 * INPUT:  preserved snapshot bytes, the complete run inventory and the isolated candidate epoch's effects
 * OUTPUT: pure exact source/canonical/receipt/Block closure proof plus lease-private readiness publication
 * POS:    core/memory/legacy-migration — completed runs are immutable receipt reads; only a lease holder writes readiness
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryMigrationVerify } from "@taki/shared";
import { readCanonicalRecord, readCanonicalSource } from "../../db/canonical-memory-maintenance-records.ts";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import { requireMigrationRun, ensureManifestInventory } from "./legacy-candidate-repo.ts";
import { convertLegacyBlock, convertLegacyEntry } from "./legacy-canonical-converter.ts";
import { canonicalJson, legacyHash, sourceIdentity } from "./legacy-identities.ts";
import type { Lease } from "./legacy-migration-ledger-repo.ts";
import { normalizeLegacySource } from "./legacy-source-normalizer.ts";
import { sourceEffectsHash } from "./legacy-source-stage.ts";
import { readLegacySnapshot, type SnapshotManifestEntry } from "./legacy-snapshot.ts";

export function snapshotDirectory(destinationRoot: string, snapshotId: string): string {
  return join(destinationRoot, snapshotId.replace(":", "-"));
}

/** Read-only proof. A completed run answers from its receipt and is never rewritten or re-compared to live memory. */
export function verifyLegacyMigration(db: Database, input: { runId: string; destinationRoot: string }): MemoryMigrationVerify {
  const run = requireMigrationRun(db, input.runId);
  if (run.status === "completed") return completedProof(db, run);
  let blocking = 0;
  const directory = snapshotDirectory(input.destinationRoot, String(run.snapshot_id));
  try {
    const manifest = readLegacySnapshot(directory, String(run.snapshot_id));
    ensureManifestInventory(db, { runId: input.runId, manifest, now: "", fill: false });
    for (const item of manifest.entries) {
      try { verifySource(db, { run, directory, item }); } catch { blocking += 1; }
    }
    if (!candidateClosure(db, run)) blocking += 1;
  } catch { blocking += 1; }
  const sources = db.prepare("SELECT * FROM memory_migration_sources WHERE run_id=:run ORDER BY source_id").all({ run: input.runId });
  const manifestDigest = legacyHash("legacy-manifest-verified/v3", String(run.snapshot_id), String(run.epoch_id));
  const readinessDigest = blocking === 0
    ? legacyHash("legacy-readiness/v3", input.runId, manifestDigest, canonicalJson(sources.map(readinessRow)))
    : null;
  return { runId: input.runId, verified: blocking === 0, manifestDigest: blocking ? null : manifestDigest, readinessDigest, blockingCount: blocking };
}

/** Lease holders publish the proof they just computed; an unverified proof retracts any earlier readiness. */
export function publishMigrationReadiness(db: Database, input: { lease: Lease; proof: MemoryMigrationVerify; now: string }): void {
  const { lease, proof, now } = input;
  db.transaction(() => {
    const guard = { run: lease.runId, owner: lease.owner, fence: lease.fence, now };
    if (proof.verified) {
      db.prepare("UPDATE memory_migration_sources SET phase='verified',updated_at=:now WHERE run_id=:run AND disposition IN ('converted-zero','converted-one','converted-many','excluded')")
        .run({ now, run: lease.runId });
    }
    const changed = db.prepare(`UPDATE memory_migration_runs SET phase=:phase,status=:status,verified_manifest_digest=:manifest,
      readiness_digest=:readiness,updated_at=:now WHERE run_id=:run AND lease_owner=:owner AND lease_fence=:fence
      AND lease_expires_at>:now AND status<>'completed'`)
      .run({ ...guard, phase: proof.verified ? "verified" : "staged", status: proof.verified ? "ready" : "running",
        manifest: proof.manifestDigest, readiness: proof.readinessDigest });
    if (changed.changes !== 1) throw new Error("LEASE_LOST");
  });
}

/** Readiness hashes source identity and outcome; bookkeeping columns change on every re-verification and must not. */
const VOLATILE_SOURCE_COLUMNS = new Set(["updated_at", "phase"]);
function readinessRow(row: SqlRow): SqlRow {
  return Object.fromEntries(Object.entries(row).filter(([column]) => !VOLATILE_SOURCE_COLUMNS.has(column)));
}

function completedProof(db: Database, run: SqlRow): MemoryMigrationVerify {
  const receipt = db.prepare(`SELECT * FROM memory_migration_activation_receipts WHERE run_id=:run AND epoch_id=:epoch
    AND snapshot_id=:snapshot AND transaction_id=:tx`)
    .get({ run: String(run.run_id), epoch: String(run.epoch_id), snapshot: String(run.snapshot_id), tx: String(run.activation_transaction_id) });
  if (!receipt) throw new Error("INTEGRITY_MISMATCH");
  return { runId: String(run.run_id), verified: true, manifestDigest: String(receipt.manifest_digest),
    readinessDigest: String(receipt.readiness_digest), blockingCount: 0 };
}

function verifySource(db: Database, input: { run: SqlRow; directory: string; item: SnapshotManifestEntry }): void {
  const runId = String(input.run.run_id);
  const epochId = String(input.run.epoch_id);
  const sourceId = sourceIdentity(input.item.relativePath, input.item.rawSha256);
  const row = db.prepare("SELECT * FROM memory_migration_sources WHERE run_id=:run AND source_id=:source").get({ run: runId, source: sourceId });
  if (!row) throw new Error("INTEGRITY_MISMATCH");
  if (row.disposition === "excluded") {
    verifyExclusion(db, { run: input.run, row });
    return;
  }
  if (!String(row.disposition).startsWith("converted-") || input.item.exception) throw new Error("MIGRATION_NOT_READY");
  const normalized = normalizeLegacySource(input.item.relativePath, readFileSync(join(input.directory, input.item.relativePath)));
  if (!normalized.ok || normalized.source.contentHash !== row.content_hash) throw new Error("INTEGRITY_MISMATCH");
  if (normalized.source.kind === "block") {
    verifyBlock(db, { runId, sourceId, expected: convertLegacyBlock(normalized.source, String(input.run.requested_at)) });
  } else {
    const bankId = legacyHash("legacy-bank/v1", normalized.source.characterId ?? "global");
    const converted = convertLegacyEntry({ source: normalized.source, epochId, bankId });
    if (!converted.ok || row.operation_id !== converted.operationId || row.document_id !== converted.source.documentId
      || row.canonical_source_id !== converted.source.documentId) throw new Error("INTEGRITY_MISMATCH");
    const saved = readCanonicalSource(db, { epochId, bankId, documentId: converted.source.documentId });
    if (canonicalJson(saved) !== canonicalJson(converted.source)) throw new Error("INTEGRITY_MISMATCH");
    verifyConverted(db, { runId, sourceId, row, converted });
  }
  const proof = db.prepare("SELECT effects_hash FROM memory_migration_source_proofs WHERE run_id=:run AND source_id=:source").get({ run: runId, source: sourceId });
  if (proof && proof.effects_hash !== sourceEffectsHash(db, { runId, sourceId, epochId })) throw new Error("INTEGRITY_MISMATCH");
}

type ConvertedEntry = Exclude<ReturnType<typeof convertLegacyEntry>, { ok: false }>;

function verifyConverted(db: Database, input: { runId: string; sourceId: string; row: SqlRow; converted: ConvertedEntry }): void {
  const converted = input.converted;
  const epoch = converted.source.authorityEpochId;
  const bank = converted.source.bankId;
  const results = db.prepare("SELECT * FROM memory_migration_results WHERE run_id=:run AND source_id=:source ORDER BY result_ordinal")
    .all({ run: input.runId, source: input.sourceId });
  const count = converted.kind === "record" ? 1 : 0;
  if (results.length !== count || input.row.result_count !== count) throw new Error("INTEGRITY_MISMATCH");
  if (converted.kind === "record") {
    const saved = readCanonicalRecord(db, { epochId: epoch, bankId: bank, memoryId: converted.record.unit.memoryId });
    const result = results[0];
    if (canonicalJson(saved) !== canonicalJson(converted.record) || result?.memory_id !== converted.record.unit.memoryId
      || result?.revision !== 1 || result?.result_payload_hash !== converted.payloadHash) throw new Error("INTEGRITY_MISMATCH");
  }
  const receipt = db.prepare("SELECT request_hash,result_json FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch AND request_id=:request")
    .get({ epoch, request: converted.operationId });
  const expected = converted.kind === "record" ? { memoryId: converted.record.unit.memoryId } : { memories: [] };
  if (!receipt || receipt.request_hash !== converted.payloadHash
    || canonicalJson(JSON.parse(String(receipt.result_json))) !== canonicalJson(expected)) throw new Error("INTEGRITY_MISMATCH");
}

function verifyBlock(db: Database, input: { runId: string; sourceId: string; expected: ReturnType<typeof convertLegacyBlock> }): void {
  const plan = db.prepare("SELECT * FROM memory_migration_block_plans WHERE run_id=:run AND source_id=:source").get({ run: input.runId, source: input.sourceId });
  const expected = input.expected;
  if (!expected) {
    if (plan) throw new Error("INTEGRITY_MISMATCH");
    return;
  }
  if (!plan || plan.block_id !== expected.blockId || plan.scope_kind !== expected.scopeKind || plan.character_id !== expected.characterId
    || plan.content !== expected.content) throw new Error("INTEGRITY_MISMATCH");
  const current = db.prepare("SELECT revision,content FROM taki_memory_blocks WHERE block_id=:id AND scope_kind=:scope AND ifnull(character_id,'')=ifnull(:character,'')")
    .get({ id: expected.blockId, scope: expected.scopeKind, character: expected.characterId });
  if (Number(current?.revision ?? 0) !== plan.expected_revision || (current?.content ?? null) !== plan.expected_content) throw new Error("IMPORT_CONFLICT");
}

function verifyExclusion(db: Database, input: { run: SqlRow; row: SqlRow }): void {
  const receipt = db.prepare("SELECT * FROM memory_migration_exclusions WHERE run_id=:run AND source_id=:source")
    .get({ run: String(input.run.run_id), source: String(input.row.source_id) });
  if (!receipt || receipt.snapshot_id !== input.run.snapshot_id || receipt.relative_path !== input.row.relative_path
    || receipt.raw_sha256 !== input.row.raw_sha256 || !receipt.reason || !receipt.operator_actor
    || input.row.canonical_source_id || input.row.operation_id || input.row.result_count !== 0) throw new Error("INTEGRITY_MISMATCH");
}

/** Missing AND extra effects fail: every canonical source, unit and receipt in the epoch must belong to this run. */
function candidateClosure(db: Database, run: SqlRow): boolean {
  const key = { run: String(run.run_id), epoch: String(run.epoch_id) };
  const epochTests = [
    `SELECT 1 FROM canonical_memory_sources c WHERE authority_epoch_id=:epoch AND NOT EXISTS
      (SELECT 1 FROM memory_migration_sources s WHERE s.run_id=:run AND s.canonical_source_id=c.document_id) LIMIT 1`,
    `SELECT 1 FROM canonical_memory_units c WHERE authority_epoch_id=:epoch AND NOT EXISTS
      (SELECT 1 FROM memory_migration_results r WHERE r.run_id=:run AND r.memory_id=c.memory_id) LIMIT 1`,
    `SELECT 1 FROM canonical_memory_operation_receipts c WHERE authority_epoch_id=:epoch AND NOT EXISTS
      (SELECT 1 FROM memory_migration_sources s WHERE s.run_id=:run AND s.operation_id=c.request_id) LIMIT 1`,
  ];
  // node:sqlite refuses unused named parameters, so the run-scoped plan test binds only :run.
  const orphanPlan = `SELECT 1 FROM memory_migration_block_plans p WHERE p.run_id=:run AND NOT EXISTS
      (SELECT 1 FROM memory_migration_sources s WHERE s.run_id=:run AND s.source_id=p.source_id AND s.disposition LIKE 'converted-%') LIMIT 1`;
  return epochTests.every((sql) => db.prepare(sql).get(key) === undefined) && db.prepare(orphanPlan).get({ run: key.run }) === undefined;
}
