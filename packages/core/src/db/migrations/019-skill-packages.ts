/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: skillPackagesMigration019 — durable Skill package lifecycle rows and active-name uniqueness
 * POS:    core/db migration 19; immutable content paths are derived and never persisted
 */
import type { Migration } from "../migration-runner.ts";

export const skillPackagesMigration019: Migration = {
  version: 19,
  sql: `
    CREATE TABLE IF NOT EXISTS skill_packages (
      package_id TEXT PRIMARY KEY,
      skill_name TEXT,
      description TEXT,
      owner_host_id TEXT NOT NULL,
      content_hash TEXT,
      lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active','quarantined','rejected')),
      enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('directory','zip','legacy-directory')),
      source_locator TEXT NOT NULL,
      trust TEXT NOT NULL CHECK (trust IN ('bundled-reviewed','operator-local','external-archive','legacy-local','blocked')),
      scan_version TEXT NOT NULL,
      scan_verdict TEXT NOT NULL CHECK (scan_verdict IN ('passed','review','rejected')),
      scan_findings TEXT NOT NULL,
      failure_reason TEXT,
      config_revision INTEGER NOT NULL CHECK (config_revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS skill_packages_active_name ON skill_packages(skill_name)
      WHERE lifecycle_state = 'active' AND skill_name IS NOT NULL;
  `,
};
