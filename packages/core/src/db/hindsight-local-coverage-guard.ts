/**
 * INPUT:  B4 selected Local coverage, current canonical state, and historical versus active run posture
 * OUTPUT: actual readiness refusals and privacy-safe coverage status without claiming new import proof
 * POS:    core/db — shared guard for B4 readiness, verification, and final promotion
 */
import type { HindsightLocalCoverageManifest, HindsightLocalCoverageStatus } from "@taki/shared";
import { createHindsightLocalCoverageRepo } from "./hindsight-local-coverage-repo.ts";
import type { Database } from "./sqlite.ts";
import { hasHindsightCurrentCapture, requireHindsightCurrentCutover } from "./hindsight-current-cutover-guard.ts";

const blockingCodes = new Set([
  "HINDSIGHT_LOCAL_COVERAGE_MISSING", "HINDSIGHT_LOCAL_COVERAGE_STALE", "HINDSIGHT_LOCAL_COVERAGE_CORRUPT",
  "HINDSIGHT_LOCAL_COVERAGE_INVALID", "HINDSIGHT_LOCAL_COVERAGE_LIMIT_EXCEEDED", "HINDSIGHT_LOCAL_COVERAGE_RUN_MISMATCH",
  "HINDSIGHT_LOCAL_COVERAGE_UNPROVEN", "HINDSIGHT_LOCAL_COVERAGE_NOT_READY", "HINDSIGHT_LOCAL_CATCH_UP_REQUIRED",
  "HINDSIGHT_PREDECESSOR_STALE",
]);

export function requireHindsightLocalCoverage(db: Database, input: { runId: string; readyBinding?: boolean; now?: string }): HindsightLocalCoverageManifest {
  const repo = createHindsightLocalCoverageRepo(db);
  const manifest = repo.selected(input.runId);
  if (!manifest) throw new Error("HINDSIGHT_LOCAL_COVERAGE_MISSING");
  repo.assertCurrent(manifest.manifestId);
  if (!hasHindsightCurrentCapture(db, input.runId)) {
    if (manifest.catchUp.some((item) => item.reason !== "b2-unproven")) throw new Error("HINDSIGHT_LOCAL_CATCH_UP_REQUIRED");
    if (manifest.catchUp.length > 0) throw new Error("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
  }
  requireHindsightCurrentCutover(db, { manifest, now: input.now });
  if (input.readyBinding) {
    const row = db.prepare("SELECT ready_manifest_id FROM hindsight_cutover_local_coverage WHERE run_id=:run").get({ run: input.runId });
    if (row?.ready_manifest_id !== manifest.manifestId) throw new Error("HINDSIGHT_LOCAL_COVERAGE_NOT_READY");
  }
  return manifest;
}

export function hindsightLocalCoverageBlockingCode(db: Database, runId: string): string | undefined {
  try { requireHindsightLocalCoverage(db, { runId, readyBinding: true }); return undefined; }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    return blockingCodes.has(message) || /^HINDSIGHT_CURRENT_[A-Z_]+$/.test(message) ? message : "HINDSIGHT_LOCAL_COVERAGE_UNAVAILABLE";
  }
}

export function readHindsightLocalCoverageStatus(db: Database, input: { runId: string; historical: boolean }): HindsightLocalCoverageStatus {
  const repo = createHindsightLocalCoverageRepo(db);
  const manifest = repo.selected(input.runId);
  const base = { manifestId: manifest?.manifestId ?? null, manifestVersion: manifest?.manifestVersion ?? null,
    frozenSourceCount: manifest?.sourceCount ?? null, catchUpCount: manifest?.catchUp.length ?? null };
  if (input.historical) return { ...base, state: "historical", currentSourceCount: null };
  const currentSourceCount = readCurrentSourceCount(db);
  if (!manifest) return { ...base, state: "missing", currentSourceCount };
  if (currentSourceCount === null) return { ...base, state: "stale", currentSourceCount };
  const current = repo.compareCurrent(manifest.manifestId);
  return { ...base, state: current.matches ? "current" : "stale", currentSourceCount: current.currentSourceCount };
}

function readCurrentSourceCount(db: Database): number | null {
  const row = db.prepare(`SELECT (SELECT count(*) FROM canonical_memory_sources c WHERE c.authority_epoch_id=e.epoch_id) AS n
    FROM canonical_memory_authority_state s JOIN canonical_memory_authority_epochs e ON e.epoch_id=s.active_epoch_id
    WHERE s.singleton=1 AND e.provider_id='local' AND e.status='active' AND e.reason='initial-local'`).get();
  return row ? Number(row.n) : null;
}
