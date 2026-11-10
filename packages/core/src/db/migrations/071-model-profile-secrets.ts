/**
 * INPUT: Core database through revisioned model profiles
 * OUTPUT: durable ownership of staged and published profile credential references
 * POS: core/db/migrations — enables crash cleanup without enumerating or deleting other catalog owners
 */
import type { Migration } from "../migration-runner.ts";

export const modelProfileSecretsMigration071: Migration = { version: 71, sql: `
CREATE TABLE model_profile_secrets (
  secret_ref TEXT PRIMARY KEY,
  slot TEXT NOT NULL CHECK(slot IN ('main','utility')),
  created_at TEXT NOT NULL
) STRICT;
` };
