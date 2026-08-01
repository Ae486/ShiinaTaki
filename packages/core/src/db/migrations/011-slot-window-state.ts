/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: slotWindowStateMigration011 — {version:11, sql} creating slot_window_state (per-slot window calibration)
 * POS:    core/db/migrations — migration 11 (T5 batch 6 token window); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// Per-model-slot calibration state (T5-R1 tier 2 / R2): the overflow-shrunk effective window and the EMA
// correction factor both survive a restart — a misconfigured declaration must cost ONE failed request ever,
// not one per boot. Absent row = declared window × factor 1.0 (the calibrator's fail-open default).
export const slotWindowStateMigration011: Migration = {
  version: 11,
  sql: `
    CREATE TABLE slot_window_state (
      slot              TEXT PRIMARY KEY,
      effective_window  INTEGER NOT NULL,
      factor            REAL NOT NULL,
      updated_at        TEXT NOT NULL
    ) STRICT;
  `,
};
