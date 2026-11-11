/**
 * INPUT:  immutable 051 request history and 057 emergency quarantine references/admission guards
 * OUTPUT: additive waiting terminal outcome with byte-preserved historical identities, states and JSON
 * POS:    core/db/migrations — transactional parent/child replacement; schedule and operation JSON stay untouched
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightReplicaWaitingMigration063: Migration = {
  version: 63,
  sql: `
CREATE TABLE hindsight_replica_manual_requests_before_063 AS
  SELECT rowid AS original_rowid,* FROM hindsight_replica_manual_requests;
CREATE TABLE memory_transition_emergency_manual_quarantine_before_063 AS
  SELECT rowid AS original_rowid,* FROM memory_transition_emergency_manual_quarantine;
DROP TABLE memory_transition_emergency_manual_quarantine;
DROP TABLE hindsight_replica_manual_requests;
CREATE TABLE hindsight_replica_manual_requests (
  request_id TEXT PRIMARY KEY,
  bank_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','claimed','waiting','succeeded','failed','cancelled')),
  state_json TEXT NOT NULL CHECK(json_valid(state_json))
) STRICT;
INSERT INTO hindsight_replica_manual_requests(rowid,request_id,bank_id,state,state_json)
  SELECT original_rowid,request_id,bank_id,state,state_json FROM hindsight_replica_manual_requests_before_063;
CREATE TABLE memory_transition_emergency_manual_quarantine (
 request_id TEXT PRIMARY KEY REFERENCES hindsight_replica_manual_requests(request_id),
 emergency_operation_id TEXT NOT NULL REFERENCES memory_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 source_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 original_hash TEXT NOT NULL, recorded_at TEXT NOT NULL
) STRICT;
INSERT INTO memory_transition_emergency_manual_quarantine(rowid,request_id,emergency_operation_id,source_epoch_id,original_hash,recorded_at)
  SELECT original_rowid,request_id,emergency_operation_id,source_epoch_id,original_hash,recorded_at
  FROM memory_transition_emergency_manual_quarantine_before_063;
DROP TABLE memory_transition_emergency_manual_quarantine_before_063;
DROP TABLE hindsight_replica_manual_requests_before_063;
CREATE UNIQUE INDEX hindsight_replica_manual_requests_queued
  ON hindsight_replica_manual_requests(bank_id) WHERE state='queued';
CREATE TRIGGER hindsight_replica_manual_requests_terminal
  BEFORE UPDATE ON hindsight_replica_manual_requests WHEN OLD.state IN ('waiting','succeeded','failed','cancelled')
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_REPLICA_REQUEST_TERMINAL'); END;
CREATE TRIGGER hindsight_replica_manual_requests_no_delete
  BEFORE DELETE ON hindsight_replica_manual_requests
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_REPLICA_REQUEST_IMMUTABLE'); END;
CREATE TRIGGER memory_transition_emergency_manual_quarantine_no_update BEFORE UPDATE ON memory_transition_emergency_manual_quarantine
 BEGIN SELECT RAISE(ABORT,'immutable emergency manual quarantine'); END;
CREATE TRIGGER memory_transition_emergency_manual_quarantine_no_delete BEFORE DELETE ON memory_transition_emergency_manual_quarantine
 BEGIN SELECT RAISE(ABORT,'immutable emergency manual quarantine'); END;
CREATE TRIGGER memory_transition_emergency_manual_quarantine_no_replace BEFORE INSERT ON memory_transition_emergency_manual_quarantine
 WHEN EXISTS(SELECT 1 FROM memory_transition_emergency_manual_quarantine WHERE request_id=NEW.request_id)
 BEGIN SELECT RAISE(ABORT,'immutable emergency manual quarantine'); END;
CREATE TRIGGER memory_transition_quarantined_manual BEFORE UPDATE ON hindsight_replica_manual_requests
 WHEN EXISTS(SELECT 1 FROM memory_transition_emergency_manual_quarantine WHERE request_id=OLD.request_id)
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_REPLICA_SCHEDULE_STALE'); END;
CREATE TRIGGER memory_transition_manual_admission BEFORE INSERT ON hindsight_replica_manual_requests
WHEN EXISTS(SELECT 1 FROM memory_operations WHERE family='memory-transition' AND terminal_at IS NULL)
 OR EXISTS(SELECT 1 FROM memory_transition_attempts a WHERE a.phase<>'terminal'
   AND NOT EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine q WHERE q.transition_id=a.transition_id))
BEGIN SELECT RAISE(ABORT,'MEMORY_OPERATION_BUSY'); END;
`,
};
