/**
 * INPUT:  exact current authority marker schema and additive transition evidence through053
 * OUTPUT: explicit transition selection plus immutable publication and target effect journals
 * POS:    core/db/migrations —054 preserves historical marker bytes and never invents old activation receipts
 */
import type { Migration } from "../migration-runner.ts";
import { currentHindsightCutoverSchema040 } from "./040-hindsight-cutover-schema.ts";

export const memoryTransitionPublicationMigration054: Migration = {
  version: 54,
  schemaBranches: [{ name: "current-marker-with-transition-discriminator",
    schema: currentHindsightCutoverSchema040.filter((row) => row.name === "memory_authority_selection"),
    absentObjects: ["memory_authority_selection_pre_054"], replacedTables: ["memory_authority_selection"],
    sql: `
ALTER TABLE memory_authority_selection RENAME TO memory_authority_selection_pre_054;
CREATE TABLE memory_authority_selection (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 mode TEXT NOT NULL CHECK(mode IN ('legacy-markdown','canonical-local','hindsight')),
 active_epoch_id TEXT, verified_snapshot_id TEXT, activation_transaction_id TEXT,
 provider_lineage_id TEXT, replica_checkpoint_digest TEXT, updated_at TEXT NOT NULL,
 transition_receipt_id TEXT,
 CHECK((transition_receipt_id IS NULL AND (
   (mode='legacy-markdown' AND active_epoch_id IS NULL AND verified_snapshot_id IS NULL AND activation_transaction_id IS NULL AND provider_lineage_id IS NULL AND replica_checkpoint_digest IS NULL)
   OR (mode='canonical-local' AND active_epoch_id IS NOT NULL AND verified_snapshot_id IS NOT NULL AND activation_transaction_id IS NOT NULL AND provider_lineage_id IS NULL AND replica_checkpoint_digest IS NULL)
   OR (mode='hindsight' AND active_epoch_id IS NOT NULL AND verified_snapshot_id IS NULL AND activation_transaction_id IS NOT NULL AND provider_lineage_id IS NOT NULL AND replica_checkpoint_digest IS NOT NULL)))
   OR (transition_receipt_id IS NOT NULL AND length(transition_receipt_id)=64 AND mode<>'legacy-markdown'
     AND active_epoch_id IS NOT NULL AND provider_lineage_id IS NOT NULL AND verified_snapshot_id IS NULL
     AND activation_transaction_id IS NULL AND replica_checkpoint_digest IS NOT NULL)),
 CHECK(replica_checkpoint_digest IS NULL OR (length(replica_checkpoint_digest)=64 AND replica_checkpoint_digest NOT GLOB '*[^a-f0-9]*'))
) STRICT;
INSERT INTO memory_authority_selection
 (singleton,mode,active_epoch_id,verified_snapshot_id,activation_transaction_id,provider_lineage_id,replica_checkpoint_digest,updated_at)
 SELECT singleton,mode,active_epoch_id,verified_snapshot_id,activation_transaction_id,provider_lineage_id,replica_checkpoint_digest,updated_at
 FROM memory_authority_selection_pre_054;
DROP TABLE memory_authority_selection_pre_054;` }],
  sql: `
CREATE TABLE memory_transition_publications (
 publication_id TEXT PRIMARY KEY, transition_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_intents(transition_id),
 receipt_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_receipts(receipt_id),
 candidate_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_candidates(id), publication_json TEXT NOT NULL CHECK(json_valid(publication_json))
) STRICT;
CREATE TRIGGER memory_transition_publications_no_update BEFORE UPDATE ON memory_transition_publications
 BEGIN SELECT RAISE(ABORT,'immutable transition publication'); END;
CREATE TRIGGER memory_transition_publications_no_delete BEFORE DELETE ON memory_transition_publications
 BEGIN SELECT RAISE(ABORT,'immutable transition publication'); END;
CREATE TRIGGER memory_transition_publications_no_replace BEFORE INSERT ON memory_transition_publications
 WHEN EXISTS(SELECT 1 FROM memory_transition_publications WHERE publication_id=NEW.publication_id OR transition_id=NEW.transition_id OR receipt_id=NEW.receipt_id OR candidate_id=NEW.candidate_id)
 BEGIN SELECT RAISE(ABORT,'immutable transition publication'); END;
CREATE TABLE memory_transition_effect_receipts (
 target_request_id TEXT PRIMARY KEY REFERENCES memory_transition_queue_executions(target_request_id),
 intent_id TEXT NOT NULL UNIQUE REFERENCES memory_transition_queue(intent_id), receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))
) STRICT;
CREATE TRIGGER memory_transition_effect_receipts_no_update BEFORE UPDATE ON memory_transition_effect_receipts
 BEGIN SELECT RAISE(ABORT,'immutable transition effect receipt'); END;
CREATE TRIGGER memory_transition_effect_receipts_no_delete BEFORE DELETE ON memory_transition_effect_receipts
 BEGIN SELECT RAISE(ABORT,'immutable transition effect receipt'); END;
CREATE TRIGGER memory_transition_effect_receipts_no_replace BEFORE INSERT ON memory_transition_effect_receipts
 WHEN EXISTS(SELECT 1 FROM memory_transition_effect_receipts WHERE target_request_id=NEW.target_request_id OR intent_id=NEW.intent_id)
 BEGIN SELECT RAISE(ABORT,'immutable transition effect receipt'); END;
CREATE TABLE memory_transition_target_refusals (
 target_request_id TEXT PRIMARY KEY REFERENCES memory_transition_queue_executions(target_request_id),
 refusal_json TEXT NOT NULL CHECK(json_valid(refusal_json))
) STRICT;
CREATE TRIGGER memory_transition_target_refusals_no_update BEFORE UPDATE ON memory_transition_target_refusals
 BEGIN SELECT RAISE(ABORT,'immutable transition target refusal'); END;
CREATE TRIGGER memory_transition_target_refusals_no_delete BEFORE DELETE ON memory_transition_target_refusals
 BEGIN SELECT RAISE(ABORT,'immutable transition target refusal'); END;
CREATE TRIGGER memory_transition_target_refusals_no_replace BEFORE INSERT ON memory_transition_target_refusals
 WHEN EXISTS(SELECT 1 FROM memory_transition_target_refusals WHERE target_request_id=NEW.target_request_id)
 BEGIN SELECT RAISE(ABORT,'immutable transition target refusal'); END;
CREATE TABLE memory_transition_native_outcomes (
 transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id), bank_id TEXT NOT NULL,
 status_json TEXT NOT NULL CHECK(json_valid(status_json)), PRIMARY KEY(transition_id,bank_id)
) STRICT;
CREATE TRIGGER memory_transition_native_outcomes_no_update BEFORE UPDATE ON memory_transition_native_outcomes
 BEGIN SELECT RAISE(ABORT,'immutable transition native outcome'); END;
CREATE TRIGGER memory_transition_native_outcomes_no_delete BEFORE DELETE ON memory_transition_native_outcomes
 BEGIN SELECT RAISE(ABORT,'immutable transition native outcome'); END;
CREATE TRIGGER memory_transition_native_outcomes_no_replace BEFORE INSERT ON memory_transition_native_outcomes
 WHEN EXISTS(SELECT 1 FROM memory_transition_native_outcomes WHERE transition_id=NEW.transition_id AND bank_id=NEW.bank_id)
 BEGIN SELECT RAISE(ABORT,'immutable transition native outcome'); END;
`,
};
