/**
 * INPUT:  migration runner at the immutable 057 Core head
 * OUTPUT: additive enrollment, catalog, user/base history and CAS-selected application evidence
 * POS:    Core SQLite overlay storage only; existing operation journal retains execution ownership
 */
import type { Migration } from "../migration-runner.ts";

const HISTORY_TABLES = ["hindsight_template_enrollments", "hindsight_template_catalog",
  "hindsight_template_bases", "hindsight_template_users", "hindsight_template_selections", "hindsight_template_default_history"];
const immutable = HISTORY_TABLES.map((table) => `
CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable template evidence'); END;
CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable template evidence'); END;
`).join("");

export const hindsightTemplateOverlaysMigration058: Migration = {
  version: 58,
  sql: `
CREATE TABLE hindsight_template_enrollments (
 identity_key TEXT PRIMARY KEY CHECK(length(identity_key)=64),
 provider_lineage TEXT NOT NULL, canonical_identity TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','character')),
 bank_id TEXT NOT NULL, bank_generation TEXT NOT NULL,
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json) AND json_type(identity_json)='object'),
 UNIQUE(provider_lineage,canonical_identity,bank_id,bank_generation),
 UNIQUE(provider_lineage,bank_id,bank_generation)
) STRICT;
CREATE TRIGGER hindsight_template_enrollments_immutable_replace BEFORE INSERT ON hindsight_template_enrollments
 WHEN EXISTS(SELECT 1 FROM hindsight_template_enrollments WHERE identity_key=NEW.identity_key
 OR (provider_lineage=NEW.provider_lineage AND bank_id=NEW.bank_id AND bank_generation=NEW.bank_generation))
 BEGIN SELECT RAISE(ABORT,'immutable template evidence'); END;
CREATE TABLE hindsight_template_catalog (
 template_revision TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','character')),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 PRIMARY KEY(template_revision,scope_kind)
) STRICT;
CREATE TRIGGER hindsight_template_catalog_immutable_replace BEFORE INSERT ON hindsight_template_catalog
 WHEN EXISTS(SELECT 1 FROM hindsight_template_catalog WHERE template_revision=NEW.template_revision AND scope_kind=NEW.scope_kind)
 BEGIN SELECT RAISE(ABORT,'immutable template evidence'); END;
CREATE TABLE hindsight_template_bases (
 identity_key TEXT NOT NULL REFERENCES hindsight_template_enrollments(identity_key), revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 PRIMARY KEY(identity_key,revision)
) STRICT;
CREATE TABLE hindsight_template_users (
 identity_key TEXT NOT NULL REFERENCES hindsight_template_enrollments(identity_key), revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 PRIMARY KEY(identity_key,revision)
) STRICT;
CREATE TABLE hindsight_template_selections (
 identity_key TEXT NOT NULL REFERENCES hindsight_template_enrollments(identity_key), revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
 base_revision INTEGER NOT NULL, user_revision INTEGER NOT NULL, request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64), receipt_hash TEXT NOT NULL CHECK(length(receipt_hash)=64),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 PRIMARY KEY(identity_key,revision), UNIQUE(request_id),
 FOREIGN KEY(identity_key,base_revision) REFERENCES hindsight_template_bases(identity_key,revision),
 FOREIGN KEY(identity_key,user_revision) REFERENCES hindsight_template_users(identity_key,revision)
) STRICT;
CREATE TABLE hindsight_template_applied (
 identity_key TEXT PRIMARY KEY REFERENCES hindsight_template_enrollments(identity_key),
 revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
 FOREIGN KEY(identity_key,revision) REFERENCES hindsight_template_selections(identity_key,revision)
) STRICT;
CREATE TRIGGER hindsight_template_applied_step BEFORE UPDATE ON hindsight_template_applied
 WHEN NEW.identity_key<>OLD.identity_key OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'template selection CAS'); END;
CREATE TRIGGER hindsight_template_applied_no_delete BEFORE DELETE ON hindsight_template_applied BEGIN SELECT RAISE(ABORT,'template selection CAS'); END;
CREATE TRIGGER hindsight_template_applied_no_replace BEFORE INSERT ON hindsight_template_applied
 WHEN NEW.revision<>1 OR EXISTS(SELECT 1 FROM hindsight_template_applied WHERE identity_key=NEW.identity_key)
 BEGIN SELECT RAISE(ABORT,'template selection CAS'); END;
CREATE TABLE hindsight_template_default_history (
 provider_lineage TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
 document_hash TEXT NOT NULL CHECK(length(document_hash)=64), document_json TEXT NOT NULL CHECK(json_valid(document_json)),
 PRIMARY KEY(provider_lineage,revision)
) STRICT;
CREATE TABLE hindsight_template_defaults (
 provider_lineage TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>=1 AND revision<=9007199254740991),
 FOREIGN KEY(provider_lineage,revision) REFERENCES hindsight_template_default_history(provider_lineage,revision)
) STRICT;
CREATE TRIGGER hindsight_template_defaults_step BEFORE UPDATE ON hindsight_template_defaults
 WHEN NEW.provider_lineage<>OLD.provider_lineage OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'template default CAS'); END;
CREATE TRIGGER hindsight_template_defaults_no_delete BEFORE DELETE ON hindsight_template_defaults BEGIN SELECT RAISE(ABORT,'template default CAS'); END;
CREATE TRIGGER hindsight_template_defaults_no_replace BEFORE INSERT ON hindsight_template_defaults
 WHEN NEW.revision<>1 OR EXISTS(SELECT 1 FROM hindsight_template_defaults WHERE provider_lineage=NEW.provider_lineage)
 BEGIN SELECT RAISE(ABORT,'template default CAS'); END;
${["hindsight_template_bases", "hindsight_template_users", "hindsight_template_selections"].map((table) => `
CREATE TRIGGER ${table}_immutable_replace BEFORE INSERT ON ${table}
 WHEN EXISTS(SELECT 1 FROM ${table} WHERE identity_key=NEW.identity_key AND revision=NEW.revision)
 BEGIN SELECT RAISE(ABORT,'immutable template evidence'); END;`).join("")}
CREATE TRIGGER hindsight_template_selections_request_replace BEFORE INSERT ON hindsight_template_selections
 WHEN EXISTS(SELECT 1 FROM hindsight_template_selections WHERE request_id=NEW.request_id)
 BEGIN SELECT RAISE(ABORT,'immutable template evidence'); END;
CREATE TRIGGER hindsight_template_default_history_immutable_replace BEFORE INSERT ON hindsight_template_default_history
 WHEN EXISTS(SELECT 1 FROM hindsight_template_default_history WHERE provider_lineage=NEW.provider_lineage AND revision=NEW.revision)
 BEGIN SELECT RAISE(ABORT,'immutable template evidence'); END;
${immutable}
`,
};
