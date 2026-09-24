/**
 * INPUT:  immutable migration lineage through 049 and the B3 hindsight_connection_state singleton
 * OUTPUT: hindsightReviewedDeploymentModeMigration050 — nullable reviewed_deployment_mode beside the reviewed fingerprint
 * POS:    core/db/migrations — migration 50 (Stage 2c); registered in index-list.ts; Core-internal, never projected to Shared
 */
import type { Migration } from "../migration-runner.ts";

// The fingerprint hashes the deployment mode but cannot be inverted, so a revalidation after a restart that rebuilt the
// runtime on changed settings could not tell a Stage 4 change from a Stage 5 mode change. NULL marks a pre-050 row whose
// reviewed mode is unknown; readers fail closed on it.
export const hindsightReviewedDeploymentModeMigration050: Migration = {
  version: 50,
  sql: `
ALTER TABLE hindsight_connection_state ADD COLUMN reviewed_deployment_mode TEXT
 CHECK(reviewed_deployment_mode IS NULL OR reviewed_deployment_mode IN ('existing-instance','managed-helper'));
`,
};
