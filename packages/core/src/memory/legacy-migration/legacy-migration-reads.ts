/**
 * INPUT:  the Core workspace root, the migration ledger and the activation receipt table
 * OUTPUT: read-only migration projections: dry-run/preview report, run status, bounded exceptions, exact receipt
 * POS:    core/memory/legacy-migration — pure reads shared by the Local onboarding service and the retained operator RPCs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryMigrationReport, MemoryMigrationStatus } from "@taki/shared";
import type { Database, SqlRow } from "../../db/sqlite.ts";
import { normalizeLegacySource } from "./legacy-source-normalizer.ts";
import { publishLegacySnapshot, publishLegacySnapshotCooperatively, type LegacySnapshotManifest } from "./legacy-snapshot.ts";

export interface MigrationExceptionPage { items: Array<{ sourceId: string; code: string; relativePath?: string }>; nextCursor: string | null }
export interface MigrationReceipt { runId: string; snapshotId: string; epochId: string; transactionId: string; activatedAt: string }

/** Synchronous preview for the retained operator RPC; creates no run, snapshot or authority. */
export function dryRunLegacyMigration(workspaceRoot: string, now: string): MemoryMigrationReport {
  const snapshot = publishLegacySnapshot({ workspaceRoot, destinationRoot: workspaceRoot, now, dryRun: true });
  return reportOf(workspaceRoot, snapshot.manifest);
}

/** Cooperative preview: yields between files so status reads and pushes stay responsive on a large Workspace. */
export async function previewLegacyMigration(workspaceRoot: string, now: string): Promise<MemoryMigrationReport> {
  const snapshot = await publishLegacySnapshotCooperatively({ workspaceRoot, destinationRoot: workspaceRoot, now, dryRun: true });
  return reportOf(workspaceRoot, snapshot.manifest);
}

function reportOf(workspaceRoot: string, manifest: LegacySnapshotManifest): MemoryMigrationReport {
  let exceptional = 0;
  let plannedZero = 0;
  let plannedOne = 0;
  for (const item of manifest.entries) {
    if (item.exception) {
      exceptional += 1;
      continue;
    }
    const result = normalizeLegacySource(item.relativePath, readFileSync(livePath(workspaceRoot, item.relativePath)));
    if (!result.ok) exceptional += 1;
    else if (result.source.content.length === 0) plannedZero += 1;
    else plannedOne += 1;
  }
  return { reportId: manifest.snapshotId, exceptional, plannedZero, plannedOne, plannedMany: 0, sourceCount: manifest.entries.length };
}

function livePath(workspaceRoot: string, relativePath: string): string {
  const parts = relativePath.split("/");
  return join(workspaceRoot, parts[0] === "entries" ? "memory" : "blocks", ...parts.slice(1));
}

export const RESOLVED_DISPOSITIONS = "('converted-zero','converted-one','converted-many','excluded','verified')";
export const BLOCKING_DISPOSITIONS = "('pending','normalized','staged','failed')";

export function readMigrationStatus(db: Database, runId: string): MemoryMigrationStatus {
  const run = db.prepare("SELECT phase,status FROM memory_migration_runs WHERE run_id=:run").get({ run: runId });
  if (!run) throw new Error("MIGRATION_NOT_FOUND");
  const row = db.prepare(`SELECT count(*) AS total,
    sum(CASE WHEN disposition IN ${RESOLVED_DISPOSITIONS} THEN 1 ELSE 0 END) AS resolved,
    sum(CASE WHEN disposition IN ${BLOCKING_DISPOSITIONS} THEN 1 ELSE 0 END) AS blocking
    FROM memory_migration_sources WHERE run_id=:run`).get({ run: runId });
  return { runId, phase: String(run.phase), status: String(run.status), sourceCount: Number(row?.total ?? 0),
    resolvedCount: Number(row?.resolved ?? 0), blockingCount: Number(row?.blocking ?? 0) };
}

export function readMigrationExceptions(db: Database, input: { runId: string; cursor: string | null; limit: number }): MigrationExceptionPage {
  const rows = db.prepare(`SELECT source_id,diagnostic_code,relative_path FROM memory_migration_sources
    WHERE run_id=:run AND diagnostic_code IS NOT NULL AND disposition<>'excluded' AND source_id>:cursor ORDER BY source_id LIMIT :limit`)
    .all({ run: input.runId, cursor: input.cursor ?? "", limit: input.limit + 1 });
  const page = rows.slice(0, input.limit);
  return {
    items: page.map((row) => ({ sourceId: String(row.source_id), code: String(row.diagnostic_code), relativePath: String(row.relative_path) })),
    nextCursor: rows.length > input.limit ? String(page.at(-1)?.source_id) : null,
  };
}

/** The positive commit proof: receipt, run and marker must agree on run, snapshot, epoch and transaction. */
export function readMigrationReceipt(db: Database, runId: string): MigrationReceipt | null {
  const row = db.prepare(`SELECT c.run_id,c.snapshot_id,c.epoch_id,c.transaction_id,c.committed_at FROM memory_migration_activation_receipts c
    JOIN memory_migration_runs r ON r.run_id=c.run_id AND r.snapshot_id=c.snapshot_id AND r.epoch_id=c.epoch_id
      AND r.activation_transaction_id=c.transaction_id AND r.status='completed'
    JOIN memory_authority_selection m ON m.singleton=1 AND m.mode='canonical-local' AND m.active_epoch_id=c.epoch_id
      AND m.verified_snapshot_id=c.snapshot_id AND m.activation_transaction_id=c.transaction_id
    WHERE c.run_id=:run`).get({ run: runId });
  return row ? receiptOf(row) : null;
}

function receiptOf(row: SqlRow): MigrationReceipt {
  return { runId: String(row.run_id), snapshotId: String(row.snapshot_id), epochId: String(row.epoch_id),
    transactionId: String(row.transaction_id), activatedAt: String(row.committed_at) };
}
