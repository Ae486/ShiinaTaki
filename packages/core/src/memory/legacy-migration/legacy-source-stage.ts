/**
 * INPUT:  one registered immutable source descriptor and the currently fenced migration lease
 * OUTPUT: one atomic canonical import plus source/result/attempt proof, or a separately committed source failure
 * POS:    core/memory/legacy-migration — the per-source transaction boundary; never publishes shared Blocks
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../../db/sqlite.ts";
import { convertLegacyBlock, convertLegacyEntry } from "./legacy-canonical-converter.ts";
import { createLegacyCanonicalImportRepo } from "./legacy-canonical-import-repo.ts";
import { ensureMigrationBank, stageMigrationBlock } from "./legacy-candidate-repo.ts";
import { LEGACY_DIAGNOSTIC_CODES, type LegacyDiagnosticCode } from "./legacy-diagnostics.ts";
import { canonicalPayloadHash, legacyHash, sourceIdentity } from "./legacy-identities.ts";
import { createLegacyMigrationLedgerRepo, type Lease } from "./legacy-migration-ledger-repo.ts";
import { normalizeLegacySource, type NormalizedLegacySource } from "./legacy-source-normalizer.ts";
import type { SnapshotManifestEntry } from "./legacy-snapshot.ts";

interface SourceInput { directory: string; item: SnapshotManifestEntry; epochId: string; lease: Lease; now: string }

export function stageLegacySource(db: Database, input: SourceInput): void {
  const sourceId = sourceIdentity(input.item.relativePath, input.item.rawSha256);
  const ledger = createLegacyMigrationLedgerRepo(db);
  const attempt = ledger.beginAttempt({ lease: input.lease, sourceId, phase: "normalize", now: input.now });
  try {
    db.transaction(() => {
      if (input.item.exception) throw new Error(input.item.exception.code);
      const normalized = normalizeLegacySource(input.item.relativePath, readFileSync(join(input.directory, input.item.relativePath)));
      if (!normalized.ok) throw new Error(normalized.diagnostic.code);
      const payloadHash = importSource(db, { ...input, sourceId, source: normalized.source });
      ledger.finishAttempt({ lease: input.lease, sourceId, attemptNo: attempt, now: input.now });
      db.prepare(`INSERT INTO memory_migration_source_proofs (run_id,source_id,payload_hash,effects_hash)
        VALUES (:run,:source,:payload,:effects) ON CONFLICT(run_id,source_id) DO UPDATE SET payload_hash=:payload,effects_hash=:effects`)
        .run({ run: input.lease.runId, source: sourceId, payload: payloadHash,
          effects: sourceEffectsHash(db, { runId: input.lease.runId, sourceId, epochId: input.epochId }) });
    });
  } catch (error) {
    const code = diagnosticCode(error);
    // A lost lease means another writer owns the run; recording it as a source defect would hide that.
    if (code === "LEASE_LOST") throw error;
    db.transaction(() => {
      ledger.finishAttempt({ lease: input.lease, sourceId, attemptNo: attempt, now: input.now, diagnostic: { code, detail: null } });
      db.prepare("UPDATE memory_migration_sources SET disposition='failed',diagnostic_code=:code,updated_at=:now WHERE run_id=:run AND source_id=:source")
        .run({ code, now: input.now, run: input.lease.runId, source: sourceId });
    });
  }
}

function diagnosticCode(error: unknown): LegacyDiagnosticCode {
  const message = error instanceof Error ? error.message : "";
  return (LEGACY_DIAGNOSTIC_CODES as readonly string[]).includes(message) ? message as LegacyDiagnosticCode : "INTEGRITY_MISMATCH";
}

function importSource(db: Database, input: SourceInput & { sourceId: string; source: NormalizedLegacySource }): string {
  const { source, lease, sourceId, now } = input;
  const ledger = createLegacyMigrationLedgerRepo(db);
  db.prepare(`UPDATE memory_migration_sources SET normalized_hash=:normalized,content_hash=:content,phase='normalized',
    disposition='normalized',diagnostic_code=NULL,updated_at=:now WHERE run_id=:run AND source_id=:source`)
    .run({ normalized: legacyHash("legacy-normalized/v1", source.kind, source.contentHash, source.layerId ?? "", source.characterId ?? ""),
      content: source.contentHash, now, run: lease.runId, source: sourceId });
  if (source.kind === "block") {
    const block = convertLegacyBlock(source, now);
    if (block) stageMigrationBlock(db, { runId: lease.runId, sourceId, block });
    ledger.setResults({ lease, sourceId, results: [], now });
    return canonicalPayloadHash(block && { ...block, updatedAt: null });
  }
  const bankId = ensureMigrationBank(db, { epochId: input.epochId, characterId: source.characterId, now });
  const converted = convertLegacyEntry({ source, epochId: input.epochId, bankId });
  if (!converted.ok) throw new Error(converted.diagnostic.code);
  const importer = createLegacyCanonicalImportRepo(db);
  if (converted.kind === "record") importer.importRecord(converted);
  else importer.importZero(converted);
  const results = converted.kind === "record"
    ? [{ memoryId: converted.record.unit.memoryId, revision: 1, payloadHash: converted.payloadHash }]
    : [];
  ledger.setResults({ lease, sourceId, results, now });
  db.prepare(`UPDATE memory_migration_sources SET document_id=:document,operation_id=:operation,canonical_source_id=:document
    WHERE run_id=:run AND source_id=:source`)
    .run({ document: converted.source.documentId, operation: converted.operationId, run: lease.runId, source: sourceId });
  return converted.payloadHash;
}

/** Canonical hash of everything one source committed; verification recomputes it to detect missing or extra effects. */
export function sourceEffectsHash(db: Database, input: { runId: string; sourceId: string; epochId: string }): string {
  const key = { run: input.runId, source: input.sourceId };
  const ids = db.prepare("SELECT document_id,operation_id FROM memory_migration_sources WHERE run_id=:run AND source_id=:source").get(key);
  const sourceKey = { epoch: input.epochId, document: ids?.document_id ?? null };
  const source = db.prepare("SELECT * FROM canonical_memory_sources WHERE authority_epoch_id=:epoch AND document_id=:document ORDER BY bank_id").all(sourceKey);
  const units = db.prepare("SELECT * FROM canonical_memory_units WHERE authority_epoch_id=:epoch AND document_id=:document ORDER BY memory_id").all(sourceKey);
  const policies = db.prepare(`SELECT p.* FROM canonical_memory_policy p JOIN canonical_memory_units u
    ON p.authority_epoch_id=u.authority_epoch_id AND p.bank_id=u.bank_id AND p.memory_id=u.memory_id
    WHERE u.authority_epoch_id=:epoch AND u.document_id=:document ORDER BY p.memory_id`).all(sourceKey);
  const receipts = db.prepare("SELECT * FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch AND request_id=:operation")
    .all({ epoch: input.epochId, operation: ids?.operation_id ?? null });
  const results = db.prepare("SELECT * FROM memory_migration_results WHERE run_id=:run AND source_id=:source ORDER BY result_ordinal").all(key);
  const plans = db.prepare("SELECT * FROM memory_migration_block_plans WHERE run_id=:run AND source_id=:source").all(key);
  return canonicalPayloadHash({ source, units, policies, receipts, results, plans });
}
