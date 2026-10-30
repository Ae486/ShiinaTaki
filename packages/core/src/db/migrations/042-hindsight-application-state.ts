/**
 * INPUT:  the existing B5 native replica/checkpoint schema and independently versioned D77 evidence
 * OUTPUT: immutable body/artifact/publication history, exact native heads and paired application checkpoint storage
 * POS:    core/db/migrations — additive replica state; Bank retirement never cascades away original evidence
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightApplicationStateMigration042: Migration = {
  version: 42,
  sql: `
CREATE TABLE hindsight_application_replica_bodies (
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL, application_id TEXT NOT NULL CHECK(application_id='taki'),
 bank_id TEXT NOT NULL, body_id TEXT NOT NULL, body_schema TEXT NOT NULL,
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json) AND json_type(descriptor_json)='object'),
 body_bytes BLOB NOT NULL, total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 1 AND 9007199254740991),
 bytes_sha256 TEXT NOT NULL CHECK(length(bytes_sha256)=64),
 PRIMARY KEY(provider_lineage,bank_generation,application_id,bank_id,body_id),
 CHECK(length(body_bytes)=total_bytes)
) STRICT;
CREATE TABLE hindsight_application_replica_artifacts (
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL, application_id TEXT NOT NULL CHECK(application_id='taki'),
 bank_id TEXT NOT NULL, artifact_key TEXT NOT NULL CHECK(json_valid(artifact_key) AND json_type(artifact_key)='array'),
 artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('bank','source','memory','block')),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), body_id TEXT NOT NULL,
 record_hash TEXT NOT NULL CHECK(length(record_hash)=64), artifact_bytes BLOB NOT NULL,
 bytes_sha256 TEXT NOT NULL CHECK(length(bytes_sha256)=64), tombstoned INTEGER NOT NULL CHECK(tombstoned IN (0,1)),
 PRIMARY KEY(provider_lineage,bank_generation,application_id,bank_id,artifact_key,revision),
 FOREIGN KEY(provider_lineage,bank_generation,application_id,bank_id,body_id)
   REFERENCES hindsight_application_replica_bodies(provider_lineage,bank_generation,application_id,bank_id,body_id)
) STRICT;
CREATE TABLE hindsight_application_replica_heads (
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL, application_id TEXT NOT NULL CHECK(application_id='taki'),
 bank_id TEXT NOT NULL, object_key TEXT NOT NULL CHECK(json_valid(object_key) AND json_type(object_key)='array'),
 object_kind TEXT NOT NULL CHECK(object_kind IN ('bank','document','memory_unit','mental_model','directive')),
 head_bytes BLOB NOT NULL, bytes_sha256 TEXT NOT NULL CHECK(length(bytes_sha256)=64), body_id TEXT,
 binding_state TEXT NOT NULL CHECK(binding_state IN ('binding_missing','bound','rebind_required','tombstoned','not_applicable')),
 bound_artifact_key TEXT, bound_artifact_revision INTEGER,
 assessment_state TEXT CHECK(assessment_state IS NULL OR assessment_state IN ('not_required','due','failed','assessed')),
 next_attempt_at TEXT, observed_state_cursor INTEGER NOT NULL CHECK(observed_state_cursor BETWEEN 0 AND 9007199254740991),
 projection_hash TEXT CHECK(projection_hash IS NULL OR length(projection_hash)=64),
 PRIMARY KEY(provider_lineage,bank_generation,application_id,bank_id,object_key),
 CHECK((bound_artifact_key IS NULL)=(bound_artifact_revision IS NULL)),
 FOREIGN KEY(provider_lineage,bank_generation,application_id,bank_id,body_id)
   REFERENCES hindsight_application_replica_bodies(provider_lineage,bank_generation,application_id,bank_id,body_id),
 FOREIGN KEY(provider_lineage,bank_generation,application_id,bank_id,bound_artifact_key,bound_artifact_revision)
   REFERENCES hindsight_application_replica_artifacts(provider_lineage,bank_generation,application_id,bank_id,artifact_key,revision)
) STRICT;
CREATE INDEX hindsight_application_replica_work ON hindsight_application_replica_heads
 (bank_id,provider_lineage,bank_generation,application_id,binding_state,assessment_state,next_attempt_at);
CREATE TABLE hindsight_application_replica_publications (
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL, application_id TEXT NOT NULL CHECK(application_id='taki'),
 bank_id TEXT NOT NULL, publication_kind TEXT NOT NULL CHECK(publication_kind IN ('snapshot','event')),
 publication_id TEXT NOT NULL, record_hash TEXT NOT NULL CHECK(length(record_hash)=64),
 manifest_bytes BLOB NOT NULL, bytes_sha256 TEXT NOT NULL CHECK(length(bytes_sha256)=64),
 PRIMARY KEY(provider_lineage,bank_generation,application_id,bank_id,publication_kind,publication_id)
) STRICT;
CREATE TABLE hindsight_application_replica_publication_pages (
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL, application_id TEXT NOT NULL CHECK(application_id='taki'),
 bank_id TEXT NOT NULL, publication_kind TEXT NOT NULL, publication_id TEXT NOT NULL,
 page_number INTEGER NOT NULL CHECK(page_number BETWEEN 0 AND 9007199254740991),
 page_bytes BLOB NOT NULL, bytes_sha256 TEXT NOT NULL CHECK(length(bytes_sha256)=64),
 PRIMARY KEY(provider_lineage,bank_generation,application_id,bank_id,publication_kind,publication_id,page_number),
 FOREIGN KEY(provider_lineage,bank_generation,application_id,bank_id,publication_kind,publication_id)
   REFERENCES hindsight_application_replica_publications(provider_lineage,bank_generation,application_id,bank_id,publication_kind,publication_id)
) STRICT;
CREATE TABLE hindsight_application_replica_checkpoints (
 bank_id TEXT PRIMARY KEY, provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL,
 application_id TEXT NOT NULL CHECK(application_id='taki'), authority_epoch_id TEXT NOT NULL,
 native_cursor INTEGER NOT NULL CHECK(native_cursor BETWEEN 0 AND 9007199254740991),
 state_cursor INTEGER NOT NULL CHECK(state_cursor BETWEEN 0 AND 9007199254740991),
 checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json) AND json_type(checkpoint_json)='object'),
 checkpoint_hash TEXT NOT NULL CHECK(length(checkpoint_hash)=64), bank_deleted INTEGER NOT NULL CHECK(bank_deleted IN (0,1))
) STRICT;
CREATE TABLE hindsight_application_replica_projections (
 bank_id TEXT NOT NULL, object_kind TEXT NOT NULL CHECK(object_kind IN ('bank','document','memory_unit','mental_model','directive')),
 object_id TEXT NOT NULL, namespace_json TEXT NOT NULL CHECK(json_valid(namespace_json) AND json_type(namespace_json)='object'),
 object_revision INTEGER NOT NULL CHECK(object_revision BETWEEN 1 AND 9007199254740991),
 operation TEXT NOT NULL CHECK(operation IN ('upsert','tombstone')),
 record_bytes BLOB NOT NULL, bytes_sha256 TEXT NOT NULL CHECK(length(bytes_sha256)=64),
 record_hash TEXT NOT NULL CHECK(length(record_hash)=64),
 source_cursor INTEGER CHECK(source_cursor IS NULL OR source_cursor BETWEEN 0 AND 9007199254740991),
 unit_state TEXT CHECK(unit_state IS NULL OR unit_state IN ('valid','invalidated')),
 visibility TEXT CHECK(visibility IS NULL OR visibility IN ('pinned','retrieved','mood-gated','hidden')),
 PRIMARY KEY(bank_id,object_kind,object_id)
) STRICT;
CREATE TABLE hindsight_application_replica_block_restores (
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL, application_id TEXT NOT NULL CHECK(application_id='taki'),
 bank_id TEXT NOT NULL, block_key TEXT NOT NULL CHECK(json_valid(block_key) AND json_type(block_key)='array'),
 body_id TEXT NOT NULL, block_revision INTEGER NOT NULL CHECK(block_revision BETWEEN 1 AND 9007199254740991),
 restored_bytes BLOB NOT NULL, bytes_sha256 TEXT NOT NULL CHECK(length(bytes_sha256)=64),
 PRIMARY KEY(provider_lineage,bank_generation,application_id,bank_id,block_key),
 FOREIGN KEY(provider_lineage,bank_generation,application_id,bank_id,body_id)
   REFERENCES hindsight_application_replica_bodies(provider_lineage,bank_generation,application_id,bank_id,body_id)
) STRICT;
`,
};
