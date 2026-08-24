import { RunStatusResultSchema, type Attempt, type Run, type RunStatusResult } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import { readAttemptRow, readReceiptRow, readRunRow } from "./run-row-mappers.ts";

export function readStatus(db: Database, runId: string): RunStatusResult {
  const run = readRunById(db, runId);
  const attempts = db.prepare(`SELECT a.*,s.manifest_digest,s.schema_version FROM run_attempts a
    JOIN run_snapshots s ON s.snapshot_id=a.snapshot_id WHERE a.run_id=:id ORDER BY a.ordinal`)
    .all({ id: runId }).map(readAttemptRow);
  const receiptRow = db.prepare(`SELECT rr.*,s.manifest_digest,s.schema_version FROM run_receipts rr
    JOIN run_snapshots s ON s.snapshot_id=rr.snapshot_id WHERE rr.run_id=:id`).get({ id: runId });
  const receipt = receiptRow ? readReceiptRow(receiptRow) : undefined;
  return RunStatusResultSchema.parse({ run, attempts, ...(receipt ? { receipt } : {}) });
}

export function readRunById(db: Database, runId: string): Run {
  const row = db.prepare(`SELECT r.*,s.manifest_json FROM runs r JOIN run_snapshots s
    ON s.snapshot_id=r.snapshot_id WHERE r.run_id=:id`).get({ id: runId });
  if (!row) throw new Error("RUN_NOT_FOUND");
  return readRunRow(row);
}

export function readRunByIdempotency(db: Database, key: string): Record<string, unknown> | undefined {
  return db.prepare(`SELECT r.*,s.manifest_json FROM runs r JOIN run_snapshots s
    ON s.snapshot_id=r.snapshot_id WHERE r.idempotency_key=:key`).get({ key });
}

export function readAttemptById(db: Database, attemptId: string): Attempt {
  const row = db.prepare(`SELECT a.*,s.manifest_digest,s.schema_version FROM run_attempts a
    JOIN run_snapshots s ON s.snapshot_id=a.snapshot_id WHERE a.attempt_id=:id`).get({ id: attemptId });
  if (!row) throw new Error("RUN_ATTEMPT_MISSING");
  return readAttemptRow(row);
}
