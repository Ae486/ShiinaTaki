/**
 * INPUT:  immutable Core migration 058 and the existing durable memory-operation owner
 * OUTPUT: original template plans, executor CAS, unpublished-effect holds and exact execution/publication evidence
 * POS:    additive Core lifecycle storage — legacy histories receive no inferred plans, dispatches or ownership
 */
import type { Migration } from "../migration-runner.ts";

const immutableTables = [
  ["hindsight_template_plans", "plan_id"], ["hindsight_template_admissions", "request_id"],
  ["hindsight_template_dispatches", "dispatch_id"], ["hindsight_template_bank_receipts", "request_id"],
  ["hindsight_template_observations", "observation_id"], ["hindsight_template_publications", "publication_id"],
  ["hindsight_template_bank_reservations", "reservation_id"],
] as const;
const immutable = immutableTables.map(([table, key]) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;
CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${key}=NEW.${key})
 BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;`).join("");

export const hindsightTemplateExecutionMigration059: Migration = {
  version: 59,
  sql: `
CREATE TABLE hindsight_template_config_clock (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991)
) STRICT;
INSERT INTO hindsight_template_config_clock VALUES(1,0);
CREATE TRIGGER hindsight_template_config_insert AFTER INSERT ON config WHEN NEW.key GLOB 'TAKI_HINDSIGHT_*'
 BEGIN UPDATE hindsight_template_config_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER hindsight_template_config_update AFTER UPDATE ON config WHEN OLD.key GLOB 'TAKI_HINDSIGHT_*' OR NEW.key GLOB 'TAKI_HINDSIGHT_*'
 BEGIN UPDATE hindsight_template_config_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TRIGGER hindsight_template_config_delete AFTER DELETE ON config WHEN OLD.key GLOB 'TAKI_HINDSIGHT_*'
 BEGIN UPDATE hindsight_template_config_clock SET revision=revision+1 WHERE singleton=1; END;
CREATE TABLE hindsight_template_plans (
 plan_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES memory_operations(operation_id), epoch_id TEXT NOT NULL,
 plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64), document_hash TEXT NOT NULL CHECK(length(document_hash)=64),
 document_json TEXT NOT NULL CHECK(json_valid(document_json)), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE hindsight_template_bank_reservations (
 reservation_id TEXT PRIMARY KEY, epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL,
 operation_id TEXT NOT NULL REFERENCES memory_operations(operation_id),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 UNIQUE(epoch_id,bank_id)
) STRICT;
CREATE TRIGGER hindsight_template_reservation_bank_unique BEFORE INSERT ON hindsight_template_bank_reservations
 WHEN EXISTS(SELECT 1 FROM hindsight_template_bank_reservations WHERE epoch_id=NEW.epoch_id AND bank_id=NEW.bank_id)
 BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;
CREATE TABLE hindsight_template_admissions (
 request_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE REFERENCES memory_operations(operation_id),
 plan_id TEXT NOT NULL REFERENCES hindsight_template_plans(plan_id), request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 request_json TEXT NOT NULL CHECK(json_valid(request_json))
) STRICT;
CREATE TABLE hindsight_template_executors (
 plan_id TEXT PRIMARY KEY REFERENCES hindsight_template_plans(plan_id), generation INTEGER NOT NULL CHECK(generation>=0 AND generation<=9007199254740991),
 revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991),
 operation_id TEXT NOT NULL REFERENCES memory_operations(operation_id), boot_id TEXT NOT NULL, token TEXT,
 deadline_ms INTEGER NOT NULL CHECK(deadline_ms>=0 AND deadline_ms<=9007199254740991),
 phase TEXT NOT NULL CHECK(phase IN ('admitted','quiescing','applying','verifying','publishing','rebinding','settled')),
 error_code TEXT, updated_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER hindsight_template_executor_step BEFORE UPDATE ON hindsight_template_executors
 WHEN NEW.plan_id<>OLD.plan_id OR NEW.revision<>OLD.revision+1 OR NEW.generation NOT IN (OLD.generation,OLD.generation+1)
 BEGIN SELECT RAISE(ABORT,'template executor CAS'); END;
CREATE TRIGGER hindsight_template_executor_no_delete BEFORE DELETE ON hindsight_template_executors BEGIN SELECT RAISE(ABORT,'template executor CAS'); END;
CREATE TRIGGER hindsight_template_executor_no_replace BEFORE INSERT ON hindsight_template_executors
 WHEN EXISTS(SELECT 1 FROM hindsight_template_executors WHERE plan_id=NEW.plan_id)
 BEGIN SELECT RAISE(ABORT,'template executor CAS'); END;
CREATE TRIGGER hindsight_template_executor_quarantined BEFORE UPDATE ON hindsight_template_executors
 WHEN EXISTS(SELECT 1 FROM hindsight_template_admissions a JOIN memory_transition_emergency_quarantine q
   ON q.operation_id=a.operation_id WHERE a.plan_id=OLD.plan_id)
 BEGIN SELECT RAISE(ABORT,'quarantined template executor'); END;
CREATE TABLE hindsight_template_dispatches (
 dispatch_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES hindsight_template_plans(plan_id), bank_key TEXT NOT NULL,
 request_id TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation>=1), executor_token TEXT NOT NULL,
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json))
) STRICT;
CREATE INDEX hindsight_template_dispatch_bank ON hindsight_template_dispatches(plan_id,bank_key);
CREATE TABLE hindsight_template_bank_receipts (
 request_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES hindsight_template_plans(plan_id), bank_key TEXT NOT NULL,
 receipt_hash TEXT NOT NULL CHECK(length(receipt_hash)=64),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 UNIQUE(plan_id,bank_key)
) STRICT;
CREATE TABLE hindsight_template_observations (
 observation_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES hindsight_template_plans(plan_id), bank_key TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation>=1), executor_revision INTEGER NOT NULL CHECK(executor_revision>=1),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json))
) STRICT;
CREATE INDEX hindsight_template_observation_bank ON hindsight_template_observations(plan_id,bank_key);
CREATE TABLE hindsight_template_publications (
 publication_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE REFERENCES hindsight_template_plans(plan_id),
 selection_identity TEXT NOT NULL CHECK(length(selection_identity)=64),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json))
) STRICT;
CREATE TABLE hindsight_template_holds (
 plan_id TEXT PRIMARY KEY REFERENCES hindsight_template_plans(plan_id), epoch_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','published','cancelled','quarantined')),
 publication_id TEXT REFERENCES hindsight_template_publications(publication_id),
 CHECK((state='published')=(publication_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX hindsight_template_active_hold ON hindsight_template_holds(epoch_id) WHERE state='active';
CREATE TRIGGER hindsight_template_hold_step BEFORE UPDATE ON hindsight_template_holds
 WHEN OLD.state<>'active' OR NEW.plan_id<>OLD.plan_id OR NEW.epoch_id<>OLD.epoch_id OR NEW.state='active'
 OR (NEW.state='cancelled' AND EXISTS(SELECT 1 FROM hindsight_template_dispatches WHERE plan_id=OLD.plan_id))
 OR (NEW.state='cancelled' AND EXISTS(SELECT 1 FROM hindsight_template_bank_receipts WHERE plan_id=OLD.plan_id))
 OR (NEW.state='published' AND NOT EXISTS(SELECT 1 FROM hindsight_template_publications WHERE publication_id=NEW.publication_id AND plan_id=OLD.plan_id))
 OR (NEW.state='quarantined' AND NOT EXISTS(SELECT 1 FROM memory_transition_emergency_quarantine q
   JOIN hindsight_template_admissions a ON a.operation_id=q.operation_id WHERE a.plan_id=OLD.plan_id AND q.source_epoch_id=OLD.epoch_id))
 BEGIN SELECT RAISE(ABORT,'template hold ownership'); END;
CREATE TRIGGER hindsight_template_hold_no_delete BEFORE DELETE ON hindsight_template_holds BEGIN SELECT RAISE(ABORT,'template hold ownership'); END;
CREATE TRIGGER hindsight_template_hold_no_replace BEFORE INSERT ON hindsight_template_holds
 WHEN NEW.state<>'active' OR EXISTS(SELECT 1 FROM hindsight_template_holds WHERE plan_id=NEW.plan_id)
 BEGIN SELECT RAISE(ABORT,'template hold ownership'); END;
CREATE TRIGGER hindsight_template_plan_operation_unique BEFORE INSERT ON hindsight_template_plans
 WHEN EXISTS(SELECT 1 FROM hindsight_template_plans WHERE operation_id=NEW.operation_id)
 BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;
CREATE TRIGGER hindsight_template_admission_operation_unique BEFORE INSERT ON hindsight_template_admissions
 WHEN EXISTS(SELECT 1 FROM hindsight_template_admissions WHERE operation_id=NEW.operation_id)
 BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;
CREATE TRIGGER hindsight_template_receipt_bank_unique BEFORE INSERT ON hindsight_template_bank_receipts
 WHEN EXISTS(SELECT 1 FROM hindsight_template_bank_receipts WHERE plan_id=NEW.plan_id AND bank_key=NEW.bank_key)
 BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;
CREATE TRIGGER hindsight_template_publication_plan_unique BEFORE INSERT ON hindsight_template_publications
 WHEN EXISTS(SELECT 1 FROM hindsight_template_publications WHERE plan_id=NEW.plan_id)
 BEGIN SELECT RAISE(ABORT,'immutable template execution evidence'); END;
${immutable}
`,
};
