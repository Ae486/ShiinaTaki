/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: configMigration013 — {version:13, sql} creating config (the operator-set settings store)
 * POS:    core/db/migrations — migration 13 (#26 settings panel batch 1); registered in index-list.ts
 */
import type { Migration } from "../migration-runner.ts";

// SPARSE by design (batch-1 D1): a row exists only for a knob the operator actually set. The effective value is
// resolved at read time as env > stored > built-in default, so a removed env var can never leave a stale seed
// behind. `value` is the JSON encoding of one primitive (string | number | boolean) — never a secret (invariant 5).
export const configMigration013: Migration = {
  version: 13,
  sql: `
    CREATE TABLE config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
};
