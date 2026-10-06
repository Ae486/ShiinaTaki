/**
 * INPUT:  immutable transition history through054 and the existing Core operation owner
 * OUTPUT: preview, original request, dispatch, observation and positive non-dispatch journals
 * POS:    core/db/migrations — additive W5 evidence; prior native outcomes are never synthesized
 */
import type { Migration } from "../migration-runner.ts";

const tables = ["previews", "driver_banks", "native_commands", "native_dispatches", "native_observations", "undispatched", "driver_failures"];
export const memoryTransitionDriversMigration055: Migration = {
  version: 55,
  sql: `
CREATE TABLE memory_transition_previews (
 id TEXT PRIMARY KEY, body_json TEXT NOT NULL CHECK(json_valid(body_json))
) STRICT;
CREATE TABLE memory_transition_driver_banks (
 transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id), bank_id TEXT NOT NULL,
 source_bank_id TEXT NOT NULL, body_json TEXT NOT NULL CHECK(json_valid(body_json)),
 PRIMARY KEY(transition_id,bank_id), UNIQUE(transition_id,source_bank_id)
) STRICT;
CREATE TABLE memory_transition_native_commands (
 id TEXT PRIMARY KEY, transition_id TEXT NOT NULL, bank_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('acquire','claim','decision','application-snapshot')), slot TEXT NOT NULL,
 body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(transition_id,bank_id,kind,slot),
 FOREIGN KEY(transition_id,bank_id) REFERENCES memory_transition_driver_banks(transition_id,bank_id)
) STRICT;
CREATE TABLE memory_transition_native_dispatches (
 command_id TEXT PRIMARY KEY REFERENCES memory_transition_native_commands(id), dispatched_at TEXT NOT NULL
) STRICT;
CREATE TABLE memory_transition_native_observations (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, transition_id TEXT NOT NULL, bank_id TEXT NOT NULL,
 body_json TEXT NOT NULL CHECK(json_valid(body_json)),
 FOREIGN KEY(transition_id,bank_id) REFERENCES memory_transition_driver_banks(transition_id,bank_id)
) STRICT;
CREATE TABLE memory_transition_undispatched (
 id TEXT PRIMARY KEY, transition_id TEXT NOT NULL, bank_id TEXT NOT NULL,
 body_json TEXT NOT NULL CHECK(json_valid(body_json)), UNIQUE(transition_id,bank_id),
 FOREIGN KEY(transition_id,bank_id) REFERENCES memory_transition_driver_banks(transition_id,bank_id)
) STRICT;
CREATE TABLE memory_transition_driver_failures (
 operation_id TEXT PRIMARY KEY REFERENCES memory_operations(operation_id),
 transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id),
 result_json TEXT NOT NULL CHECK(json_valid(result_json))
) STRICT;
CREATE TRIGGER memory_transition_dispatch_after_release BEFORE INSERT ON memory_transition_native_dispatches
 WHEN EXISTS(SELECT 1 FROM memory_transition_native_commands c JOIN memory_transition_undispatched u
 ON u.transition_id=c.transition_id AND u.bank_id=c.bank_id WHERE c.id=NEW.command_id)
 BEGIN SELECT RAISE(ABORT,'transition Bank already released without dispatch'); END;
CREATE TRIGGER memory_transition_release_after_dispatch BEFORE INSERT ON memory_transition_undispatched
 WHEN EXISTS(SELECT 1 FROM memory_transition_native_commands c JOIN memory_transition_native_dispatches d
 ON d.command_id=c.id WHERE c.transition_id=NEW.transition_id AND c.bank_id=NEW.bank_id)
 BEGIN SELECT RAISE(ABORT,'transition Bank dispatch remains owned'); END;
` + tables.map((name) => `
CREATE TRIGGER memory_transition_${name}_no_update BEFORE UPDATE ON memory_transition_${name}
 BEGIN SELECT RAISE(ABORT,'immutable transition driver evidence'); END;
CREATE TRIGGER memory_transition_${name}_no_delete BEFORE DELETE ON memory_transition_${name}
 BEGIN SELECT RAISE(ABORT,'immutable transition driver evidence'); END;
CREATE TRIGGER memory_transition_${name}_no_replace BEFORE INSERT ON memory_transition_${name}
 WHEN EXISTS(SELECT 1 FROM memory_transition_${name} WHERE ${name === "driver_banks"
    ? "transition_id=NEW.transition_id AND (bank_id=NEW.bank_id OR source_bank_id=NEW.source_bank_id)"
    : name === "driver_failures" ? "operation_id=NEW.operation_id"
    : name === "native_dispatches" ? "command_id=NEW.command_id"
    : name === "native_commands" ? "id=NEW.id OR (transition_id=NEW.transition_id AND bank_id=NEW.bank_id AND kind=NEW.kind AND slot=NEW.slot)"
    : name === "undispatched" ? "id=NEW.id OR (transition_id=NEW.transition_id AND bank_id=NEW.bank_id)" : "id=NEW.id"})
 BEGIN SELECT RAISE(ABORT,'immutable transition driver evidence'); END;
`).join("\n"),
};
