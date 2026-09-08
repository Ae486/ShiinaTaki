/**
 * INPUT:  canonical authority epochs and migration 033's independently leased replica Banks
 * OUTPUT: an additive idempotent Pending Memory outbox with indexed recovery state and immutable identity
 * POS:    core/db/migrations — Wave 3 storage only; never promotes or modifies Memory Authority
 */
import type { Migration } from "../migration-runner.ts";

export const pendingMemoryMigration035: Migration = {
  version: 35,
  sql: `
CREATE TABLE pending_memory (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
  bank_id TEXT NOT NULL CHECK(length(bank_id) BETWEEN 1 AND 256),
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 256),
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('retain','edit','invalidate','restore')),
  intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64 AND intent_hash NOT GLOB '*[^0-9a-f]*'),
  phase TEXT NOT NULL CHECK(phase IN ('queued','submitted','awaiting_derived','awaiting_pull','completed','superseded','failed','outcome_unknown','cancelled')),
  version INTEGER NOT NULL CHECK(version >= 1),
  state_json TEXT NOT NULL CHECK(json_valid(state_json) AND json_type(state_json)='object' AND length(CAST(state_json AS BLOB)) <= 2097152),
  UNIQUE(authority_epoch_id,bank_id,operation_id)
) STRICT;
CREATE INDEX pending_memory_recovery ON pending_memory(authority_epoch_id,bank_id,phase,operation_kind,sequence);
CREATE TRIGGER pending_memory_identity_immutable BEFORE UPDATE OF authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash ON pending_memory
BEGIN SELECT RAISE(ABORT, 'pending memory identity is immutable'); END;
`,
};
