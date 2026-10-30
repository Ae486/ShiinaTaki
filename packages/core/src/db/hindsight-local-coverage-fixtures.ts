/**
 * INPUT:  an owned test database with the current migration registry
 * OUTPUT: real converter/importer/ledger-produced Local records and a selected B4 coverage fixture
 * POS:    core/db — test support only; no runtime wiring, user files, or provider calls
 */
import type { CanonicalMemoryRecord, CanonicalMemorySource } from "@taki/shared";
import { convertLegacyEntry } from "../memory/legacy-migration/legacy-canonical-converter.ts";
import { createLegacyCanonicalImportRepo } from "../memory/legacy-migration/legacy-canonical-import-repo.ts";
import { createLegacyMigrationLedgerRepo } from "../memory/legacy-migration/legacy-migration-ledger-repo.ts";
import { normalizeLegacySource } from "../memory/legacy-migration/legacy-source-normalizer.ts";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createCanonicalMemoryRepo } from "./canonical-memory-repo.ts";
import { createHindsightCutoverRunRepo } from "./hindsight-cutover-run-repo.ts";
import { createHindsightLocalCoverageRepo } from "./hindsight-local-coverage-repo.ts";
import type { Database } from "./sqlite.ts";

export const LOCAL_COVERAGE_NOW = "2026-08-22T00:00:00.000Z";
export const LOCAL_COVERAGE_LATER = "2026-08-22T01:00:00.000Z";
export const LOCAL_COVERAGE_NEXT = "2026-08-22T00:01:00.000Z";

export function seedLocalB2CoverageFixture(db: Database) {
  const now = LOCAL_COVERAGE_NOW; const bankId = "bank"; const runId = "run";
  const authority = createCanonicalMemoryAuthorityRepo(db);
  const epochId = authority.initializeLocalAuthority(now).epochId;
  authority.createBank({ authorityEpochId: epochId, bankId, scope: { kind: "global", characterId: null }, name: "Global",
    disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "remember", config: {}, createdAt: now, updatedAt: now });
  const bytes = new TextEncoder().encode(`---\r\nid: old-source\r\nlayer: profile\r\nimportance: 7\r\ncreated: ${now}\r\nstatus: active\r\ncustom_number: 1\r\n---\r\nOriginal retained source text.\r\nSecond line.`);
  const normalized = normalizeLegacySource("entries/global/profile/source.md", bytes);
  if (!normalized.ok) throw new Error("TEST_NORMALIZATION_FAILED");
  const converted = convertLegacyEntry({ source: normalized.source, epochId, bankId });
  if (!converted.ok || converted.kind !== "record") throw new Error("TEST_CONVERSION_FAILED");
  const sourceId = normalized.source.sourceId;
  const ledger = createLegacyMigrationLedgerRepo(db);
  ledger.createRun({ runId, snapshotId: "legacy-snapshot", epochId, now });
  const lease = ledger.acquireLease({ runId, owner: "b2", now, expiresAt: LOCAL_COVERAGE_LATER });
  ledger.addSource({ runId, sourceId, kind: "entry", relativePath: normalized.source.relativePath,
    rawSha256: normalized.source.rawSha256, byteLength: bytes.length, now });
  createLegacyCanonicalImportRepo(db).importRecord(converted);
  ledger.setResults({ lease, sourceId, results: [{ memoryId: converted.record.unit.memoryId,
    revision: converted.record.unit.revision, payloadHash: converted.payloadHash }], now });
  db.prepare(`UPDATE memory_migration_sources SET content_hash=:hash,canonical_source_id=:document,
    document_id=:document,operation_id=:operation,phase='verified' WHERE run_id=:run AND source_id=:source`)
    .run({ hash: converted.source.contentHash, document: converted.source.documentId, operation: converted.operationId, run: runId, source: sourceId });
  ledger.releaseLease({ lease, now });
  seedB2Activation(db, epochId);
  return { db, epochId, bankId, runId, sourceId, source: converted.source, record: converted.record,
    operationId: converted.operationId, rawBytes: bytes };
}

export function createLocalCoverageFixture(db: Database) {
  const fixture = seedLocalB2CoverageFixture(db);
  const runs = createHindsightCutoverRunRepo(db);
  runs.create({ runId: fixture.runId, expectedPredecessorEpochId: fixture.epochId, now: LOCAL_COVERAGE_NOW });
  const lease = runs.acquireLease({ runId: fixture.runId, owner: "cutover", now: LOCAL_COVERAGE_NOW, expiresAt: LOCAL_COVERAGE_LATER });
  const coverage = createHindsightLocalCoverageRepo(db); const manifest = coverage.selected(fixture.runId);
  if (!manifest) throw new Error("TEST_COVERAGE_MISSING");
  return { ...fixture, runs, lease, coverage, manifest };
}

export function retainNewLocalSource(db: Database, input: { source: CanonicalMemorySource; record: CanonicalMemoryRecord; suffix?: string }) {
  const suffix = input.suffix ?? "new";
  const source = { ...input.source, documentId: `document-${suffix}`, contentHash: null, retainedText: `Current retained source ${suffix}.`,
    metadata: { numeric: 1, text: "1" }, provenance: { ...input.source.provenance, origin: "explicit-user" as const,
      actor: "user" as const, sourceRef: null }, createdAt: LOCAL_COVERAGE_NEXT, updatedAt: LOCAL_COVERAGE_NEXT };
  const unit = { ...input.record.unit, memoryId: `memory-${suffix}`, documentId: source.documentId,
    text: `Current unit ${suffix}.`, metadata: { numeric: 2, text: "2" }, createdAt: LOCAL_COVERAGE_NEXT, updatedAt: LOCAL_COVERAGE_NEXT };
  const policy = { ...input.record.policy, memoryId: unit.memoryId, updatedAt: LOCAL_COVERAGE_NEXT };
  createCanonicalMemoryRepo(db).retain({ epochId: source.authorityEpochId, bankId: source.bankId,
    requestId: `retain-${suffix}`, requestHash: "a".repeat(64), source, unit, policy, searchTerms: unit.text });
  return { source, record: { unit, policy, provenance: source.provenance } };
}

function seedB2Activation(db: Database, epochId: string): void {
  const now = LOCAL_COVERAGE_NOW;
  // Activation itself needs a filesystem snapshot. This fixture represents its committed historical receipt;
  // the source/result payloads above come from the real B2 producers rather than an invented canonical snapshot.
  db.prepare(`UPDATE memory_migration_runs SET phase='activated',status='completed',activation_transaction_id='local-tx'
    WHERE run_id='run'`).run();
  db.prepare(`INSERT INTO memory_migration_activation_receipts
    (run_id,transaction_id,snapshot_id,manifest_digest,readiness_digest,epoch_id,lease_fence,committed_at,marker_mode)
    VALUES ('run','local-tx','legacy-snapshot',:hash,:hash,:epoch,1,:now,'canonical-local')`)
    .run({ hash: "d".repeat(64), epoch: epochId, now });
  db.prepare(`UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id=:epoch,
    verified_snapshot_id='legacy-snapshot',activation_transaction_id='local-tx',updated_at=:now WHERE singleton=1`)
    .run({ epoch: epochId, now });
}
