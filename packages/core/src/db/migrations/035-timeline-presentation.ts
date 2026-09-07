/**
 * INPUT:  existing canonical timeline_messages rows through migration 034
 * OUTPUT: one additive nullable presentation column; all canonical data remains unchanged
 * POS:    core/db/migrations — display metadata only, never a second Timeline or replay authority
 */
import type { Migration } from "../migration-runner.ts";

export const timelinePresentationMigration035: Migration = {
  version: 35,
  sql: "ALTER TABLE timeline_messages ADD COLUMN presentation TEXT;",
};
