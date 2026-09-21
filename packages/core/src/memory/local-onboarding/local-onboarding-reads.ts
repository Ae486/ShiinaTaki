/**
 * INPUT:  the migration ledger/candidate/receipt tables, the pure Local binding snapshot and a clock
 * OUTPUT: MemoryOnboardingRun projection (discovered or exact), bounded exceptions with an exclusion hint, and the
 *         closed Local runtime availability derived from the binding snapshot
 * POS:    core/memory/local-onboarding — pure reads over B2 evidence; no producer, no authority or runtime side effect
 */
import {
  MemoryOnboardingRunSchema, type MemoryLocalProgress, type MemoryMigrationStatus, type MemoryOnboardingExceptionsParams,
  type MemoryOnboardingExceptionsResult, type MemoryOnboardingRun, type MemoryRuntimeUnavailableReason,
} from "@taki/shared";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import { readMigrationRun, selectedMigrationRun } from "../legacy-migration/legacy-candidate-repo.ts";
import { readMigrationReceipt, readMigrationStatus } from "../legacy-migration/legacy-migration-reads.ts";
import type { LocalBindingSnapshot } from "../local-runtime-binding.ts";

export interface LocalRuntimeAvailability { available: boolean; unavailableReason: MemoryRuntimeUnavailableReason | null }

/** The selected/latest non-superseded run, including raw pre-S2a runs; runs without an epoch cannot onboard and read as null. */
export function discoverOnboardingRun(db: Database, now: string): MemoryOnboardingRun | null {
  const row = selectedMigrationRun(db);
  return row ? projectRun(db, row, now) : null;
}

export function readOnboardingRun(db: Database, runId: string, now: string): MemoryOnboardingRun | null {
  const row = readMigrationRun(db, runId);
  return row ? projectRun(db, row, now) : null;
}

function projectRun(db: Database, row: SqlRow, now: string): MemoryOnboardingRun | null {
  if (row.epoch_id === null || row.epoch_id === undefined) return null;
  const runId = String(row.run_id);
  const status = readMigrationStatus(db, runId);
  return MemoryOnboardingRunSchema.parse({
    runId, snapshotId: String(row.snapshot_id), epochId: String(row.epoch_id), status: status.status,
    supersededByRunId: row.superseded_by_run_id === null || row.superseded_by_run_id === undefined ? null : String(row.superseded_by_run_id),
    progress: runProgress(status, leaseHeld(row, now)), receipt: readMigrationReceipt(db, runId),
  });
}

function leaseHeld(row: SqlRow, now: string): boolean {
  return row.lease_owner !== null && row.lease_expires_at !== null && String(row.lease_expires_at) > now;
}

/** Bounded checkpoint view of a run; a held lease means a producer is still converting, blocked needs operator resolution. */
export function runProgress(status: MemoryMigrationStatus, converting: boolean): MemoryLocalProgress {
  const counts = { sourceCount: status.sourceCount, resolvedCount: status.resolvedCount, blockingCount: status.blockingCount };
  if (status.status === "completed") return { phase: "completed", ...counts };
  if (status.status === "ready") return { phase: "ready", ...counts };
  if (converting) return { phase: "converting", ...counts };
  return { phase: status.blockingCount > 0 ? "blocked" : "verifying", ...counts };
}

const EXCLUDABLE = new Set(["pending", "normalized", "staged", "failed"]);

/** Diagnostics only: relative paths and closed codes, never source bodies; canExclude is a hint the exclusion re-proves. */
export function readOnboardingExceptions(db: Database, params: MemoryOnboardingExceptionsParams): MemoryOnboardingExceptionsResult {
  const run = readMigrationRun(db, params.runId);
  if (!run) throw new Error("MIGRATION_NOT_FOUND");
  const rows = db.prepare(`SELECT source_id,diagnostic_code,relative_path,disposition FROM memory_migration_sources
    WHERE run_id=:run AND diagnostic_code IS NOT NULL AND disposition<>'excluded' AND source_id>:cursor ORDER BY source_id LIMIT :limit`)
    .all({ run: params.runId, cursor: params.cursor ?? "", limit: params.limit + 1 });
  const page = rows.slice(0, params.limit);
  return {
    items: page.map((row) => ({ sourceId: String(row.source_id), code: String(row.diagnostic_code), relativePath: String(row.relative_path),
      canExclude: run.status !== "completed" && EXCLUDABLE.has(String(row.disposition)) })),
    nextCursor: rows.length > params.limit ? String(page.at(-1)?.source_id) : null,
  };
}

/** Under Legacy or Hindsight authority the Local binding is not the selected runtime; only a selected Local epoch is judged. */
export function localRuntimeAvailability(snapshot: LocalBindingSnapshot): LocalRuntimeAvailability {
  if (snapshot.selection !== "canonical-local") return { available: true, unavailableReason: null };
  if (snapshot.lifetime === "stopped") return { available: false, unavailableReason: "stopped" };
  if (snapshot.binding.kind !== "published") return { available: false, unavailableReason: "not_installed" };
  if (snapshot.binding.epochId !== snapshot.selectedEpochId) return { available: false, unavailableReason: "authority_mismatch" };
  return { available: true, unavailableReason: null };
}
