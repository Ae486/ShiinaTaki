/**
 * INPUT:  the existing operation ledger and exact manual-sync requests
 * OUTPUT: additive transition intent/lease/proof/receipt/queue custody and admission guards
 * POS:    core/db/migrations — no authority publication or historical receipt rewrite
 */
import type { Migration } from "../migration-runner.ts";

export const memoryTransitionsMigration052: Migration = {
  version: 52,
  sql: `
CREATE TABLE memory_transition_intents (
 transition_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES memory_operations(operation_id),
 request_id TEXT NOT NULL UNIQUE, intent_json TEXT NOT NULL CHECK(json_valid(intent_json))
) STRICT;
CREATE TABLE memory_transition_attempts (
 transition_id TEXT PRIMARY KEY REFERENCES memory_transition_intents(transition_id),
 revision INTEGER NOT NULL CHECK(revision>=0), phase TEXT NOT NULL,
 attempt_json TEXT NOT NULL CHECK(json_valid(attempt_json))
) STRICT;
CREATE TABLE memory_transition_evidence (
 evidence_id TEXT PRIMARY KEY, transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id),
 proof_json TEXT NOT NULL CHECK(json_valid(proof_json))
) STRICT;
CREATE TABLE memory_transition_receipts (
 receipt_id TEXT PRIMARY KEY, transition_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_intents(transition_id),
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))
) STRICT;
CREATE TABLE memory_transition_results (
 transition_id TEXT PRIMARY KEY REFERENCES memory_transition_intents(transition_id),
 result_json TEXT NOT NULL CHECK(json_valid(result_json))
) STRICT;
CREATE TABLE memory_transition_queue (
 intent_id TEXT PRIMARY KEY, transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id),
 sequence INTEGER NOT NULL CHECK(sequence>0), caller_request_id TEXT NOT NULL, replay_id TEXT NOT NULL UNIQUE,
 bytes INTEGER NOT NULL CHECK(bytes>0), intent_json TEXT NOT NULL CHECK(json_valid(intent_json)),
 UNIQUE(transition_id,sequence), UNIQUE(transition_id,caller_request_id)
) STRICT;
CREATE TABLE memory_transition_queue_executions (
 intent_id TEXT PRIMARY KEY REFERENCES memory_transition_queue(intent_id), target_request_id TEXT NOT NULL UNIQUE,
 execution_json TEXT NOT NULL CHECK(json_valid(execution_json))
) STRICT;
CREATE TABLE memory_transition_queue_results (
 intent_id TEXT PRIMARY KEY REFERENCES memory_transition_queue(intent_id), outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json))
) STRICT;
CREATE TABLE memory_transition_queue_observations (
 observation_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES memory_transition_queue(intent_id),
 outcome_json TEXT NOT NULL CHECK(json_valid(outcome_json))
) STRICT;
CREATE TABLE memory_transition_recoveries (
 operation_id TEXT PRIMARY KEY REFERENCES memory_operations(operation_id), request_id TEXT NOT NULL UNIQUE,
 transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id), recovery_json TEXT NOT NULL CHECK(json_valid(recovery_json))
) STRICT;
CREATE TABLE memory_transition_resolutions (
 resolution_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES memory_operations(operation_id),
 transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id), resolution_json TEXT NOT NULL CHECK(json_valid(resolution_json))
) STRICT;
${["intents", "evidence", "receipts", "results", "queue", "queue_executions", "queue_results", "queue_observations", "recoveries", "resolutions"].map((suffix) => `
CREATE TRIGGER memory_transition_${suffix}_immutable_update BEFORE UPDATE ON memory_transition_${suffix}
 BEGIN SELECT RAISE(ABORT,'MEMORY_TRANSITION_IMMUTABLE'); END;
CREATE TRIGGER memory_transition_${suffix}_immutable_delete BEFORE DELETE ON memory_transition_${suffix}
 BEGIN SELECT RAISE(ABORT,'MEMORY_TRANSITION_IMMUTABLE'); END;`).join("\n")}
CREATE TRIGGER memory_transition_attempt_terminal BEFORE UPDATE ON memory_transition_attempts WHEN OLD.phase='terminal'
 BEGIN SELECT RAISE(ABORT,'MEMORY_TRANSITION_IMMUTABLE'); END;
CREATE TRIGGER memory_transition_attempt_delete BEFORE DELETE ON memory_transition_attempts
 BEGIN SELECT RAISE(ABORT,'MEMORY_TRANSITION_IMMUTABLE'); END;
CREATE TRIGGER memory_transition_operation_admission BEFORE INSERT ON memory_operations
WHEN (NEW.family='memory-transition' AND (
 EXISTS(SELECT 1 FROM memory_operations WHERE terminal_at IS NULL AND (family IN ('setup','local-onboarding','hindsight-activation','hindsight-lifecycle','hindsight-backup','memory-transition') OR kind='replica.sync'))
 OR EXISTS(SELECT 1 FROM hindsight_replica_manual_requests WHERE state IN ('queued','claimed'))
 OR EXISTS(SELECT 1 FROM memory_transition_attempts WHERE phase<>'terminal'
   AND transition_id<>coalesce(json_extract(NEW.request_json,'$.recovery.transitionId'),''))))
 OR ((NEW.family IN ('setup','local-onboarding','hindsight-activation','hindsight-lifecycle','hindsight-backup') OR NEW.kind='replica.sync') AND (
 EXISTS(SELECT 1 FROM memory_operations WHERE family='memory-transition' AND terminal_at IS NULL)
 OR EXISTS(SELECT 1 FROM memory_transition_attempts WHERE phase<>'terminal')))
BEGIN SELECT RAISE(ABORT,'MEMORY_OPERATION_BUSY'); END;
CREATE TRIGGER memory_transition_manual_admission BEFORE INSERT ON hindsight_replica_manual_requests
WHEN EXISTS(SELECT 1 FROM memory_operations WHERE family='memory-transition' AND terminal_at IS NULL)
 OR EXISTS(SELECT 1 FROM memory_transition_attempts WHERE phase<>'terminal')
BEGIN SELECT RAISE(ABORT,'MEMORY_OPERATION_BUSY'); END;
`,
};
