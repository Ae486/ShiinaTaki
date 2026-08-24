/** Additive Slice 3B Approval reference column for the existing Run Effect row. */
import type { Migration } from "../migration-runner.ts";

export const effectApprovalRefMigration027: Migration = {
  version: 27,
  sql: "ALTER TABLE run_effects ADD COLUMN approval_ref_json TEXT;",
};
