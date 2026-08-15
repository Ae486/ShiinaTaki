/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: governancePolicyMigration014 — Core-owned global policy singleton and sparse cell overrides
 * POS:    core/db/migrations — migration 14; durable global policy authority, no descriptor definitions in SQLite
 */
import type { Migration } from "../migration-runner.ts";

export const governancePolicyMigration014: Migration = {
  version: 14,
  sql: `
    CREATE TABLE governance_policy (
      singleton_id      INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      level             TEXT NOT NULL CHECK (level IN ('strict', 'standard', 'relaxed')),
      policy_generation INTEGER NOT NULL CHECK (policy_generation > 0),
      registry_revision INTEGER NOT NULL CHECK (registry_revision > 0),
      updated_at        TEXT NOT NULL
    ) STRICT;

    CREATE TABLE governance_cell_overrides (
      cell_key            TEXT NOT NULL,
      level               TEXT NOT NULL CHECK (level IN ('strict', 'standard', 'relaxed')),
      posture             TEXT NOT NULL CHECK (posture IN ('auto', 'ask', 'deny')),
      descriptor_revision INTEGER NOT NULL CHECK (descriptor_revision > 0),
      updated_at          TEXT NOT NULL,
      PRIMARY KEY (cell_key, level)
    ) STRICT;

    INSERT INTO governance_policy (
      singleton_id, level, policy_generation, registry_revision, updated_at
    ) VALUES (1, 'standard', 1, 1, '1970-01-01T00:00:00.000Z');
  `,
};
