/**
 * INPUT:  immutable transition history through056
 * OUTPUT: original emergency capture identity and verified sealed-incident joins
 * POS:    core/db/migrations — additive; no predecessor receipt or authority is rewritten
 */
import type { Migration } from "../migration-runner.ts";

export const memoryTransitionEmergencyMigration057: Migration = {
  version: 57,
  sql: `
CREATE TABLE memory_transition_emergency_captures (
 capture_id TEXT PRIMARY KEY, transition_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_intents(transition_id),
 incident_id TEXT NOT NULL UNIQUE, capture_json TEXT NOT NULL CHECK(json_valid(capture_json))
) STRICT;
CREATE TRIGGER memory_transition_emergency_captures_no_update BEFORE UPDATE ON memory_transition_emergency_captures
 BEGIN SELECT RAISE(ABORT,'immutable emergency capture'); END;
CREATE TRIGGER memory_transition_emergency_captures_no_delete BEFORE DELETE ON memory_transition_emergency_captures
 BEGIN SELECT RAISE(ABORT,'immutable emergency capture'); END;
CREATE TRIGGER memory_transition_emergency_captures_no_replace BEFORE INSERT ON memory_transition_emergency_captures
 WHEN EXISTS(SELECT 1 FROM memory_transition_emergency_captures WHERE capture_id=NEW.capture_id OR transition_id=NEW.transition_id OR incident_id=NEW.incident_id)
 BEGIN SELECT RAISE(ABORT,'immutable emergency capture'); END;
CREATE TABLE memory_transition_incidents (
 incident_id TEXT PRIMARY KEY REFERENCES memory_transition_emergency_captures(incident_id),
 transition_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_intents(transition_id),
 manifest_hash TEXT NOT NULL, manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json))
) STRICT;
CREATE TRIGGER memory_transition_incidents_no_update BEFORE UPDATE ON memory_transition_incidents
 BEGIN SELECT RAISE(ABORT,'immutable emergency incident'); END;
CREATE TRIGGER memory_transition_incidents_no_delete BEFORE DELETE ON memory_transition_incidents
 BEGIN SELECT RAISE(ABORT,'immutable emergency incident'); END;
CREATE TRIGGER memory_transition_incidents_no_replace BEFORE INSERT ON memory_transition_incidents
 WHEN EXISTS(SELECT 1 FROM memory_transition_incidents WHERE incident_id=NEW.incident_id OR transition_id=NEW.transition_id)
 BEGIN SELECT RAISE(ABORT,'immutable emergency incident'); END;
CREATE TABLE memory_transition_surviving_evidence (
 id TEXT PRIMARY KEY, transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id),
 slot TEXT NOT NULL, body BLOB NOT NULL, UNIQUE(transition_id,slot)
) STRICT;
CREATE TRIGGER memory_transition_surviving_evidence_no_update BEFORE UPDATE ON memory_transition_surviving_evidence
 BEGIN SELECT RAISE(ABORT,'immutable surviving evidence'); END;
CREATE TRIGGER memory_transition_surviving_evidence_no_delete BEFORE DELETE ON memory_transition_surviving_evidence
 BEGIN SELECT RAISE(ABORT,'immutable surviving evidence'); END;
CREATE TRIGGER memory_transition_surviving_evidence_no_replace BEFORE INSERT ON memory_transition_surviving_evidence
 WHEN EXISTS(SELECT 1 FROM memory_transition_surviving_evidence WHERE id=NEW.id OR (transition_id=NEW.transition_id AND slot=NEW.slot))
 BEGIN SELECT RAISE(ABORT,'immutable surviving evidence'); END;
CREATE TABLE memory_transition_foreign_branches (
 source_epoch_id TEXT PRIMARY KEY REFERENCES canonical_memory_authority_epochs(epoch_id), provider_lineage_id TEXT NOT NULL,
 transition_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_intents(transition_id),
 target_epoch_id TEXT NOT NULL UNIQUE REFERENCES canonical_memory_authority_epochs(epoch_id),
 incident_id TEXT NOT NULL REFERENCES memory_transition_incidents(incident_id),
 receipt_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_receipts(receipt_id)
) STRICT;
CREATE TRIGGER memory_transition_foreign_branches_no_update BEFORE UPDATE ON memory_transition_foreign_branches
 BEGIN SELECT RAISE(ABORT,'immutable foreign branch'); END;
CREATE TRIGGER memory_transition_foreign_branches_no_delete BEFORE DELETE ON memory_transition_foreign_branches
 BEGIN SELECT RAISE(ABORT,'immutable foreign branch'); END;
CREATE TRIGGER memory_transition_foreign_branches_no_replace BEFORE INSERT ON memory_transition_foreign_branches
 WHEN EXISTS(SELECT 1 FROM memory_transition_foreign_branches WHERE source_epoch_id=NEW.source_epoch_id OR transition_id=NEW.transition_id
   OR target_epoch_id=NEW.target_epoch_id OR receipt_id=NEW.receipt_id)
 BEGIN SELECT RAISE(ABORT,'immutable foreign branch'); END;
CREATE TABLE memory_transition_emergency_quarantine (
 operation_id TEXT PRIMARY KEY REFERENCES memory_operations(operation_id),
 transition_id TEXT REFERENCES memory_transition_intents(transition_id),
 emergency_operation_id TEXT NOT NULL REFERENCES memory_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 source_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 original_hash TEXT NOT NULL, recorded_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER memory_transition_emergency_quarantine_no_update BEFORE UPDATE ON memory_transition_emergency_quarantine
 BEGIN SELECT RAISE(ABORT,'immutable emergency quarantine'); END;
CREATE TRIGGER memory_transition_emergency_quarantine_no_delete BEFORE DELETE ON memory_transition_emergency_quarantine
 BEGIN SELECT RAISE(ABORT,'immutable emergency quarantine'); END;
CREATE TRIGGER memory_transition_emergency_quarantine_no_replace BEFORE INSERT ON memory_transition_emergency_quarantine
 WHEN EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine WHERE operation_id=NEW.operation_id)
 BEGIN SELECT RAISE(ABORT,'immutable emergency quarantine'); END;
CREATE TABLE memory_transition_emergency_manual_quarantine (
 request_id TEXT PRIMARY KEY REFERENCES hindsight_replica_manual_requests(request_id),
 emergency_operation_id TEXT NOT NULL REFERENCES memory_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
 source_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 original_hash TEXT NOT NULL, recorded_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER memory_transition_emergency_manual_quarantine_no_update BEFORE UPDATE ON memory_transition_emergency_manual_quarantine
 BEGIN SELECT RAISE(ABORT,'immutable emergency manual quarantine'); END;
CREATE TRIGGER memory_transition_emergency_manual_quarantine_no_delete BEFORE DELETE ON memory_transition_emergency_manual_quarantine
 BEGIN SELECT RAISE(ABORT,'immutable emergency manual quarantine'); END;
CREATE TRIGGER memory_transition_emergency_manual_quarantine_no_replace BEFORE INSERT ON memory_transition_emergency_manual_quarantine
 WHEN EXISTS(SELECT 1 FROM memory_transition_emergency_manual_quarantine WHERE request_id=NEW.request_id)
 BEGIN SELECT RAISE(ABORT,'immutable emergency manual quarantine'); END;
CREATE TRIGGER memory_transition_quarantined_attempt BEFORE UPDATE ON memory_transition_attempts
 WHEN EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine WHERE transition_id=OLD.transition_id)
 BEGIN SELECT RAISE(ABORT,'MEMORY_TRANSITION_LEASE_LOST'); END;
CREATE TRIGGER memory_transition_quarantined_manual BEFORE UPDATE ON hindsight_replica_manual_requests
 WHEN EXISTS(SELECT 1 FROM memory_transition_emergency_manual_quarantine WHERE request_id=OLD.request_id)
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_REPLICA_SCHEDULE_STALE'); END;
DROP TRIGGER memory_transition_operation_admission;
CREATE TRIGGER memory_transition_operation_admission BEFORE INSERT ON memory_operations
WHEN (NEW.family='memory-transition' AND (
 EXISTS(SELECT 1 FROM memory_operations WHERE terminal_at IS NULL AND (family IN ('setup','local-onboarding','hindsight-activation','hindsight-lifecycle','hindsight-backup','memory-transition') OR kind='replica.sync'))
 OR EXISTS(SELECT 1 FROM hindsight_replica_manual_requests m WHERE m.state IN ('queued','claimed')
   AND NOT EXISTS(SELECT 1 FROM memory_transition_emergency_manual_quarantine q WHERE q.request_id=m.request_id))
 OR EXISTS(SELECT 1 FROM memory_transition_attempts a WHERE a.phase<>'terminal'
   AND a.transition_id<>coalesce(json_extract(NEW.request_json,'$.recovery.transitionId'),'')
   AND NOT EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine q WHERE q.transition_id=a.transition_id))))
 OR ((NEW.family IN ('setup','local-onboarding','hindsight-activation','hindsight-lifecycle','hindsight-backup') OR NEW.kind='replica.sync') AND (
 EXISTS(SELECT 1 FROM memory_operations WHERE family='memory-transition' AND terminal_at IS NULL)
 OR EXISTS(SELECT 1 FROM memory_transition_attempts a WHERE a.phase<>'terminal'
   AND NOT EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine q WHERE q.transition_id=a.transition_id))))
BEGIN SELECT RAISE(ABORT,'MEMORY_OPERATION_BUSY'); END;
DROP TRIGGER memory_transition_manual_admission;
CREATE TRIGGER memory_transition_manual_admission BEFORE INSERT ON hindsight_replica_manual_requests
WHEN EXISTS(SELECT 1 FROM memory_operations WHERE family='memory-transition' AND terminal_at IS NULL)
 OR EXISTS(SELECT 1 FROM memory_transition_attempts a WHERE a.phase<>'terminal'
   AND NOT EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine q WHERE q.transition_id=a.transition_id))
BEGIN SELECT RAISE(ABORT,'MEMORY_OPERATION_BUSY'); END;
`,
};
