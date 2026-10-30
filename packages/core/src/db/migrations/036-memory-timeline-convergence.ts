/**
 * INPUT:  either applied migration-035 history: Pending Memory on main or Timeline presentation on T4
 * OUTPUT: memoryTimelineConvergenceMigration036 — the additive union of both historical schemas
 * POS:    core/db/migrations — forward compatibility bridge; preserves historical receipts and stored bytes
 */
import type { Migration } from "../migration-runner.ts";

// Both 035 meanings have already been applied. Repeat its Pending constraints without rewriting that history.
export const memoryTimelineConvergenceMigration036: Migration = {
  version: 36,
  ensureNullableTextColumns: [{ table: "timeline_messages", column: "presentation" }],
  sql: `
CREATE TABLE IF NOT EXISTS pending_memory (
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
CREATE INDEX IF NOT EXISTS pending_memory_recovery ON pending_memory(authority_epoch_id,bank_id,phase,operation_kind,sequence);
CREATE TRIGGER IF NOT EXISTS pending_memory_identity_immutable BEFORE UPDATE OF authority_epoch_id,bank_id,operation_id,operation_kind,intent_hash ON pending_memory
BEGIN SELECT RAISE(ABORT, 'pending memory identity is immutable'); END;
`,
};
