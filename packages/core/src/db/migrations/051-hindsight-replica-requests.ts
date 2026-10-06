/**
 * INPUT:  immutable migration lineage through 050
 * OUTPUT: durable exact manual-request claims and outcomes, independent of latest Bank diagnostics
 * POS:    core/db/migrations — B5 producer evidence; no rewriting of historical schedule or operation rows
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightReplicaRequestsMigration051: Migration = {
  version: 51,
  sql: `
CREATE TABLE hindsight_replica_manual_requests (
  request_id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','claimed','succeeded','failed','cancelled')),
  state_json TEXT NOT NULL CHECK(json_valid(state_json))
) STRICT;
CREATE UNIQUE INDEX hindsight_replica_manual_requests_queued
  ON hindsight_replica_manual_requests(bank_id) WHERE state='queued';
CREATE TRIGGER hindsight_replica_manual_requests_terminal
  BEFORE UPDATE ON hindsight_replica_manual_requests WHEN OLD.state IN ('succeeded','failed','cancelled')
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_REPLICA_REQUEST_TERMINAL'); END;
CREATE TRIGGER hindsight_replica_manual_requests_no_delete
  BEFORE DELETE ON hindsight_replica_manual_requests
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_REPLICA_REQUEST_IMMUTABLE'); END;
`,
};
