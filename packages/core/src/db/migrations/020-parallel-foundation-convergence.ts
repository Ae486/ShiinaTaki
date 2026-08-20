/**
 * INPUT:  databases created by either parallel migration-17 lineage before the T4/Main merge
 * OUTPUT: parallelFoundationConvergenceMigration020 — idempotently guarantees the canonical-memory schema exists
 * POS:    core/db/migrations — compatibility bridge; 018/019 separately guarantee MCP and Skill tables
 */
import type { Migration } from "../migration-runner.ts";
import { canonicalMemoryMigration017 } from "./017-canonical-memory.ts";

export const parallelFoundationConvergenceMigration020: Migration = {
  version: 20,
  sql: canonicalMemoryMigration017.sql,
};
