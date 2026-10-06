/**
 * INPUT:  W1 transition intent/lease history and existing canonical Local data
 * OUTPUT: immutable complete captures, native evidence, isolated candidates and durable replay identities
 * POS:    core/db/migrations — additive W3 storage; no authority marker or historical receipt changes
 */
import type { Migration } from "../migration-runner.ts";

const documents = ["captures", "native_evidence", "candidates", "baselines", "preparations", "delta_results", "source_uploads", "source_upload_attempts"];
export const memoryTransitionCandidatesMigration053: Migration = {
  version: 53,
  sql: documents.map((name) => `
CREATE TABLE memory_transition_${name} (
 id TEXT PRIMARY KEY CHECK(length(id)=64),
 transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id),
 slot TEXT NOT NULL,
 body BLOB NOT NULL,
 UNIQUE(transition_id,slot)
) STRICT;
CREATE TRIGGER memory_transition_${name}_immutable_update BEFORE UPDATE ON memory_transition_${name}
 BEGIN SELECT RAISE(ABORT,'immutable transition ${name}'); END;
CREATE TRIGGER memory_transition_${name}_immutable_delete BEFORE DELETE ON memory_transition_${name}
 BEGIN SELECT RAISE(ABORT,'immutable transition ${name}'); END;
CREATE TRIGGER memory_transition_${name}_immutable_replace BEFORE INSERT ON memory_transition_${name}
 WHEN EXISTS(SELECT 1 FROM memory_transition_${name} WHERE id=NEW.id OR (transition_id=NEW.transition_id AND slot=NEW.slot))
 BEGIN SELECT RAISE(ABORT,'immutable transition ${name}'); END;
`).join("\n") + `
CREATE TABLE memory_transition_scope_ids (
 lineage_id TEXT NOT NULL, scope_key TEXT NOT NULL, local_bank_id TEXT NOT NULL,
 origin_epoch_id TEXT, transition_id TEXT NOT NULL REFERENCES memory_transition_intents(transition_id),
 PRIMARY KEY(lineage_id,scope_key), UNIQUE(lineage_id,local_bank_id)
) STRICT;
CREATE TABLE memory_transition_candidate_reservations (
 transition_id TEXT PRIMARY KEY REFERENCES memory_transition_intents(transition_id),
 target_epoch_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
) STRICT;
` + ["scope_ids", "candidate_reservations"].map((name) => `
CREATE TRIGGER memory_transition_${name}_immutable_update BEFORE UPDATE ON memory_transition_${name}
 BEGIN SELECT RAISE(ABORT,'immutable transition identity'); END;
CREATE TRIGGER memory_transition_${name}_immutable_delete BEFORE DELETE ON memory_transition_${name}
 BEGIN SELECT RAISE(ABORT,'immutable transition identity'); END;
CREATE TRIGGER memory_transition_${name}_immutable_replace BEFORE INSERT ON memory_transition_${name}
 WHEN EXISTS(SELECT 1 FROM memory_transition_${name} WHERE ${name === "scope_ids"
    ? "lineage_id=NEW.lineage_id AND (scope_key=NEW.scope_key OR local_bank_id=NEW.local_bank_id)"
    : "transition_id=NEW.transition_id OR target_epoch_id=NEW.target_epoch_id"})
 BEGIN SELECT RAISE(ABORT,'immutable transition identity'); END;
`).join("\n") + `
CREATE TABLE canonical_memory_record_provenance (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL,
 provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
 PRIMARY KEY(authority_epoch_id,bank_id,memory_id),
 FOREIGN KEY(authority_epoch_id,bank_id,memory_id)
 REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE canonical_memory_historical_identities (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,bank_id,memory_id),
 FOREIGN KEY(authority_epoch_id,bank_id) REFERENCES canonical_memory_banks(authority_epoch_id,bank_id)
) STRICT;
CREATE TABLE canonical_memory_historical_references (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL, source_memory_id TEXT NOT NULL,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 PRIMARY KEY(authority_epoch_id,bank_id,memory_id,source_memory_id),
 FOREIGN KEY(authority_epoch_id,bank_id,memory_id)
 REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE canonical_memory_source_aliases (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, document_id TEXT NOT NULL, artifact_key TEXT NOT NULL,
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 PRIMARY KEY(authority_epoch_id,bank_id,artifact_key),
 FOREIGN KEY(authority_epoch_id,bank_id,document_id) REFERENCES canonical_memory_sources(authority_epoch_id,bank_id,document_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE canonical_memory_source_sets (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,bank_id,memory_id),
 FOREIGN KEY(authority_epoch_id,bank_id,memory_id) REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE canonical_memory_source_references (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK(ordinal>=0),
 document_id TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 PRIMARY KEY(authority_epoch_id,bank_id,memory_id,ordinal),
 FOREIGN KEY(authority_epoch_id,bank_id,memory_id) REFERENCES canonical_memory_source_sets(authority_epoch_id,bank_id,memory_id) ON DELETE CASCADE,
 FOREIGN KEY(authority_epoch_id,bank_id,document_id) REFERENCES canonical_memory_sources(authority_epoch_id,bank_id,document_id)
) STRICT;
`,
};
