/**
 * INPUT:  an explicit operator exclusion (run, source, reason, authenticated actor) against the candidate ledger
 * OUTPUT: one synchronous lease-guarded exclusion receipt; exact duplicates are idempotent, changed audit identity conflicts
 * POS:    core/memory/legacy-migration — the only path that marks a source excluded; resolved or imported sources refuse
 */
import type { MemoryMigrationStatus } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { requireMigrationRun } from "./legacy-candidate-repo.ts";
import { createLegacyMigrationLedgerRepo } from "./legacy-migration-ledger-repo.ts";
import { readMigrationStatus } from "./legacy-migration-reads.ts";

export interface ExclusionInput { runId: string; sourceId: string; reason: string; actor: string; now: string }

const LEASE_MS = 60_000;

export function excludeLegacySource(db: Database, input: ExclusionInput): MemoryMigrationStatus {
  db.transaction(() => {
    const run = requireMigrationRun(db, input.runId);
    if (run.status === "completed") throw new Error("MIGRATION_SOURCE_RESOLVED");
    const source = db.prepare("SELECT * FROM memory_migration_sources WHERE run_id=:run AND source_id=:source")
      .get({ run: input.runId, source: input.sourceId });
    if (!source) throw new Error("MIGRATION_NOT_FOUND");
    const receipt = db.prepare("SELECT reason,operator_actor FROM memory_migration_exclusions WHERE run_id=:run AND source_id=:source")
      .get({ run: input.runId, source: input.sourceId });
    if (receipt) {
      if (receipt.reason === input.reason && receipt.operator_actor === input.actor) return;
      throw new Error("MIGRATION_EXCLUSION_CONFLICT");
    }
    if (String(source.disposition).startsWith("converted-") || source.disposition === "verified") throw new Error("MIGRATION_SOURCE_RESOLVED");
    if (hasCommittedEffects(db, input)) throw new Error("INTEGRITY_MISMATCH");
    const ledger = createLegacyMigrationLedgerRepo(db);
    const lease = claim(db, input);
    ledger.exclude({ lease, sourceId: input.sourceId, reason: input.reason, actor: input.actor, now: input.now });
    // An exclusion changes the proof; earlier readiness no longer describes this run.
    db.prepare(`UPDATE memory_migration_runs SET status='running',phase='staged',verified_manifest_digest=NULL,readiness_digest=NULL,
      updated_at=:now WHERE run_id=:run AND status='ready'`).run({ now: input.now, run: input.runId });
    ledger.releaseLease({ lease, now: input.now });
  });
  return readMigrationStatus(db, input.runId);
}

function claim(db: Database, input: ExclusionInput) {
  try {
    return createLegacyMigrationLedgerRepo(db).acquireLease({ runId: input.runId, owner: `exclude:${input.actor}`, now: input.now,
      expiresAt: new Date(Date.parse(input.now) + LEASE_MS).toISOString() });
  } catch (error) {
    // A live producer lease owns the run; the operator retries after that command settles.
    if (error instanceof Error && error.message === "LEASE_LOST") throw new Error("MIGRATION_BUSY", { cause: error });
    throw error;
  }
}

/** Historical partial imports must be reconciled by resume, never certified excluded while their data stays active. */
function hasCommittedEffects(db: Database, input: ExclusionInput): boolean {
  const key = { run: input.runId, source: input.sourceId };
  const source = db.prepare("SELECT canonical_source_id,operation_id,result_count FROM memory_migration_sources WHERE run_id=:run AND source_id=:source").get(key);
  if (source?.canonical_source_id || source?.operation_id || Number(source?.result_count ?? 0) > 0) return true;
  const tables = ["memory_migration_source_proofs", "memory_migration_block_plans", "memory_migration_results"];
  return tables.some((table) => db.prepare(`SELECT 1 FROM ${table} WHERE run_id=:run AND source_id=:source LIMIT 1`).get(key) !== undefined);
}
