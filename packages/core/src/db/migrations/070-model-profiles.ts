/**
 * INPUT: the existing Core database at migration 069
 * OUTPUT: revisioned model drafts and separately committed applied profiles
 * POS: core/db/migrations — non-secret configuration only; credentials remain catalog references
 */
import type { Migration } from "../migration-runner.ts";

export const modelProfilesMigration070: Migration = { version: 70, sql: `
CREATE TABLE model_profiles (
  slot TEXT PRIMARY KEY CHECK(slot IN ('main','utility')),
  revision INTEGER NOT NULL CHECK(revision > 0),
  draft_json TEXT NOT NULL,
  applied_json TEXT,
  application_state TEXT NOT NULL CHECK(application_state IN ('applied','draft','failed')),
  issues_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
` };
