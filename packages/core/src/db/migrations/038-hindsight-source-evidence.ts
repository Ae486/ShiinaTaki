/**
 * INPUT:  canonical Local source preparation and verified native object/result identities
 * OUTPUT: independent immutable source/unit evidence and exact object-version binding tables
 * POS:    core/db/migrations — durable migration provenance; no replica, Pending, or B2 ownership dependency
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightSourceEvidenceMigration038: Migration = {
  version: 38,
  sql: `
CREATE TABLE hindsight_source_evidence (
  evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=64 AND evidence_id NOT GLOB '*[^0-9a-f]*'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  local_epoch_id TEXT NOT NULL CHECK(length(local_epoch_id) BETWEEN 1 AND 256),
  bank_id TEXT NOT NULL CHECK(length(bank_id) BETWEEN 1 AND 256),
  document_id TEXT NOT NULL CHECK(length(document_id) BETWEEN 1 AND 256),
  source_revision INTEGER NOT NULL CHECK(source_revision>=1),
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  retained_text_hash TEXT CHECK(retained_text_hash IS NULL OR (length(retained_text_hash)=64 AND retained_text_hash NOT GLOB '*[^0-9a-f]*')),
  source_json TEXT NOT NULL,
  native_item_json TEXT,
  native_item_hash TEXT CHECK(native_item_hash IS NULL OR (length(native_item_hash)=64 AND native_item_hash NOT GLOB '*[^0-9a-f]*')),
  unit_count INTEGER NOT NULL CHECK(unit_count>=0),
  gap_count INTEGER NOT NULL CHECK(gap_count>=0),
  gaps_json TEXT NOT NULL CHECK(json_valid(gaps_json) AND json_type(gaps_json)='array'),
  UNIQUE(evidence_id,bank_id,document_id),
  CHECK((native_item_json IS NULL)=(native_item_hash IS NULL)),
  CHECK((gap_count=0)=(native_item_json IS NOT NULL))
) STRICT;
CREATE INDEX hindsight_source_evidence_source ON hindsight_source_evidence(local_epoch_id,bank_id,document_id,source_revision);
CREATE TABLE hindsight_source_unit_evidence (
  evidence_id TEXT NOT NULL REFERENCES hindsight_source_evidence(evidence_id),
  memory_id TEXT NOT NULL CHECK(length(memory_id) BETWEEN 1 AND 256),
  unit_revision INTEGER NOT NULL CHECK(unit_revision>=1),
  record_hash TEXT NOT NULL CHECK(length(record_hash)=64 AND record_hash NOT GLOB '*[^0-9a-f]*'),
  record_json TEXT NOT NULL,
  PRIMARY KEY(evidence_id,memory_id)
) STRICT;
CREATE TABLE hindsight_source_object_bindings (
  binding_id TEXT NOT NULL UNIQUE CHECK(length(binding_id)=64 AND binding_id NOT GLOB '*[^0-9a-f]*'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  evidence_id TEXT NOT NULL,
  source_bank_id TEXT NOT NULL CHECK(length(source_bank_id) BETWEEN 1 AND 256),
  bank_scope_json TEXT NOT NULL CHECK(json_valid(bank_scope_json) AND json_type(bank_scope_json)='object'),
  source_document_id TEXT NOT NULL,
  source_memory_id TEXT,
  provider_lineage_id TEXT NOT NULL CHECK(length(provider_lineage_id)=36),
  bank_generation TEXT NOT NULL CHECK(length(bank_generation)=36),
  bank_id TEXT NOT NULL CHECK(length(bank_id) BETWEEN 1 AND 256),
  object_kind TEXT NOT NULL CHECK(object_kind IN ('document','memory_unit')),
  object_id TEXT NOT NULL CHECK(length(object_id) BETWEEN 1 AND 256),
  object_revision INTEGER NOT NULL CHECK(object_revision>=1),
  native_payload_hash TEXT NOT NULL CHECK(length(native_payload_hash)=64 AND native_payload_hash NOT GLOB '*[^0-9a-f]*'),
  operation_id TEXT NOT NULL CHECK(length(operation_id)=36),
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
  result_hash TEXT NOT NULL CHECK(length(result_hash)=64 AND result_hash NOT GLOB '*[^0-9a-f]*'),
  native_receipt_hash TEXT NOT NULL CHECK(length(native_receipt_hash)=64 AND native_receipt_hash NOT GLOB '*[^0-9a-f]*'),
  native_through_cursor INTEGER NOT NULL CHECK(native_through_cursor>=0),
  observation_kind TEXT NOT NULL CHECK(observation_kind IN ('snapshot','journal')),
  observation_id TEXT NOT NULL CHECK(length(observation_id)=36),
  observed_cursor INTEGER NOT NULL CHECK(observed_cursor>=native_through_cursor),
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(provider_lineage_id,bank_generation,bank_id,object_kind,object_id,object_revision),
  UNIQUE(evidence_id,source_memory_id,provider_lineage_id,bank_generation,operation_id),
  FOREIGN KEY(evidence_id,source_bank_id,source_document_id) REFERENCES hindsight_source_evidence(evidence_id,bank_id,document_id),
  FOREIGN KEY(evidence_id,source_memory_id) REFERENCES hindsight_source_unit_evidence(evidence_id,memory_id),
  CHECK((object_kind='document' AND source_memory_id IS NULL AND object_id=source_document_id)
    OR (object_kind='memory_unit' AND source_memory_id IS NOT NULL))
) STRICT;
CREATE TRIGGER hindsight_source_evidence_no_update BEFORE UPDATE ON hindsight_source_evidence
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_evidence_no_delete BEFORE DELETE ON hindsight_source_evidence
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_unit_evidence_no_update BEFORE UPDATE ON hindsight_source_unit_evidence
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_unit_evidence_no_delete BEFORE DELETE ON hindsight_source_unit_evidence
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_bindings_no_update BEFORE UPDATE ON hindsight_source_object_bindings
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_BINDING_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_bindings_no_delete BEFORE DELETE ON hindsight_source_object_bindings
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_BINDING_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_evidence_no_replace BEFORE INSERT ON hindsight_source_evidence
  WHEN EXISTS(SELECT 1 FROM hindsight_source_evidence WHERE evidence_id=NEW.evidence_id)
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_unit_evidence_no_replace BEFORE INSERT ON hindsight_source_unit_evidence
  WHEN EXISTS(SELECT 1 FROM hindsight_source_unit_evidence WHERE evidence_id=NEW.evidence_id AND memory_id=NEW.memory_id)
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_unit_evidence_no_append BEFORE INSERT ON hindsight_source_unit_evidence
  WHEN (SELECT count(*) FROM hindsight_source_unit_evidence WHERE evidence_id=NEW.evidence_id)
    >= (SELECT unit_count FROM hindsight_source_evidence WHERE evidence_id=NEW.evidence_id)
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_source_bindings_no_replace BEFORE INSERT ON hindsight_source_object_bindings
  WHEN EXISTS(SELECT 1 FROM hindsight_source_object_bindings WHERE binding_id=NEW.binding_id OR
    (provider_lineage_id=NEW.provider_lineage_id AND bank_generation=NEW.bank_generation AND bank_id=NEW.bank_id
     AND object_kind=NEW.object_kind AND object_id=NEW.object_id AND object_revision=NEW.object_revision) OR
    (evidence_id=NEW.evidence_id AND source_memory_id=NEW.source_memory_id AND provider_lineage_id=NEW.provider_lineage_id
     AND bank_generation=NEW.bank_generation AND operation_id=NEW.operation_id))
  BEGIN SELECT RAISE(ABORT,'HINDSIGHT_SOURCE_BINDING_IMMUTABLE'); END;
`,
};
