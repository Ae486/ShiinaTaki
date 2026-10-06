/**
 * INPUT:  recorded055 healthy-driver history, including existing incomplete native maintenance
 * OUTPUT: immutable original-executor verification dispatch evidence for safe abort recovery
 * POS:    core/db/migrations — additive; no existing command or native outcome is rewritten
 */
import type { Migration } from "../migration-runner.ts";

export const memoryTransitionVerificationDispatchMigration056: Migration = {
  version: 56,
  sql: `
CREATE TABLE memory_transition_native_verifications (
 id TEXT PRIMARY KEY, transition_id TEXT NOT NULL, bank_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation>0), executor_json TEXT NOT NULL CHECK(json_valid(executor_json)),
 dispatched_at TEXT NOT NULL, UNIQUE(transition_id,bank_id,generation),
 FOREIGN KEY(transition_id,bank_id) REFERENCES memory_transition_driver_banks(transition_id,bank_id)
) STRICT;
CREATE TRIGGER memory_transition_verifications_no_update BEFORE UPDATE ON memory_transition_native_verifications
 BEGIN SELECT RAISE(ABORT,'immutable transition verification dispatch'); END;
CREATE TRIGGER memory_transition_verifications_no_delete BEFORE DELETE ON memory_transition_native_verifications
 BEGIN SELECT RAISE(ABORT,'immutable transition verification dispatch'); END;
CREATE TRIGGER memory_transition_verifications_no_replace BEFORE INSERT ON memory_transition_native_verifications
 WHEN EXISTS(SELECT 1 FROM memory_transition_native_verifications WHERE id=NEW.id
 OR (transition_id=NEW.transition_id AND bank_id=NEW.bank_id AND generation=NEW.generation))
 BEGIN SELECT RAISE(ABORT,'immutable transition verification dispatch'); END;
CREATE TRIGGER memory_transition_verification_after_release BEFORE INSERT ON memory_transition_native_verifications
 WHEN EXISTS(SELECT 1 FROM memory_transition_undispatched WHERE transition_id=NEW.transition_id AND bank_id=NEW.bank_id)
 BEGIN SELECT RAISE(ABORT,'transition Bank already released without dispatch'); END;
`,
};
