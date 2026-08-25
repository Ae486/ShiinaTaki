/** Additive Slice 4 recovery/admission facts and a durable owner-generation marker. */
import type { Migration } from "../migration-runner.ts";

export const recoveryAdmissionMigration028: Migration = {
  version: 28,
  sql: `
    ALTER TABLE runs ADD COLUMN recovery_generation TEXT;
    ALTER TABLE runs ADD COLUMN recovery_classification TEXT;
    ALTER TABLE runs ADD COLUMN recovered_at TEXT;
    ALTER TABLE runs ADD COLUMN budget_limit INTEGER CHECK (budget_limit IS NULL OR budget_limit BETWEEN 0 AND 10000000);
    ALTER TABLE runs ADD COLUMN budget_used INTEGER NOT NULL DEFAULT 0 CHECK (budget_used BETWEEN 0 AND 10000000);
    CREATE TABLE IF NOT EXISTS core_process_generations (
      generation_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('running','completed','gone')),
      scanned_count INTEGER NOT NULL DEFAULT 0,
      classified_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX IF NOT EXISTS runs_queue_status_idx ON runs(state, queued_at, run_id);
  `,
};
