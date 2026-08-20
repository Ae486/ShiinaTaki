/**
 * INPUT:  Core startup migration runner
 * OUTPUT: additive canonical memory tables, constraints, and rebuildable sparse projection
 * POS:    core/db/migrations — dormant schema beside legacy Markdown-derived memory tables
 */
import type { Migration } from "../migration-runner.ts";

export const canonicalMemoryMigration017: Migration = {
  version: 17,
  sql: `
CREATE TABLE IF NOT EXISTS canonical_memory_authority_epochs (
 epoch_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, provider_lineage_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('active','closed')), predecessor_epoch_id TEXT REFERENCES canonical_memory_authority_epochs(epoch_id),
 started_at TEXT NOT NULL, ended_at TEXT, reason TEXT NOT NULL CHECK(reason IN ('initial-local','planned-switch','emergency-takeover')),
 CHECK(length(epoch_id)>0 AND length(provider_id)>0 AND length(provider_lineage_id)>0),
 CHECK((status='active' AND ended_at IS NULL) OR (status='closed' AND ended_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_memory_one_active_epoch ON canonical_memory_authority_epochs(status) WHERE status='active';
CREATE TABLE IF NOT EXISTS canonical_memory_authority_state (singleton INTEGER PRIMARY KEY CHECK(singleton=1), active_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id), updated_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS canonical_memory_banks (
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id), bank_id TEXT NOT NULL,
 scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','character')), character_id TEXT, name TEXT NOT NULL,
 disposition_json TEXT NOT NULL CHECK(json_valid(disposition_json) AND json_type(disposition_json)='object'), mission TEXT NOT NULL, config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json)='object'),
 revision INTEGER NOT NULL CHECK(revision>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(authority_epoch_id,bank_id),
 CHECK((scope_kind='global' AND character_id IS NULL) OR (scope_kind='character' AND character_id IS NOT NULL AND length(character_id)>0))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_memory_bank_scope ON canonical_memory_banks(authority_epoch_id,scope_kind,ifnull(character_id,''));
CREATE TABLE IF NOT EXISTS canonical_memory_sources (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, document_id TEXT NOT NULL, content_hash TEXT, retained_text TEXT, context TEXT,
 tags_json TEXT NOT NULL CHECK(json_valid(tags_json) AND json_type(tags_json)='array'), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json) AND json_type(metadata_json)='object'), observation_scopes_json TEXT CHECK(observation_scopes_json IS NULL OR (json_valid(observation_scopes_json) AND json_type(observation_scopes_json) IN ('text','array'))),
 provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json) AND json_type(provenance_json)='object'), revision INTEGER NOT NULL CHECK(revision>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,bank_id,document_id), FOREIGN KEY(authority_epoch_id,bank_id) REFERENCES canonical_memory_banks(authority_epoch_id,bank_id)
) STRICT;
CREATE TABLE IF NOT EXISTS canonical_memory_units (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL, document_id TEXT, chunk_id TEXT, text TEXT NOT NULL, context TEXT,
 fact_type TEXT NOT NULL CHECK(fact_type IN ('world','experience','observation')), state TEXT NOT NULL CHECK(state IN ('valid','invalidated')),
 revision INTEGER NOT NULL CHECK(revision>=1), tags_json TEXT NOT NULL CHECK(json_valid(tags_json) AND json_type(tags_json)='array'), metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json) AND json_type(metadata_json)='object'), entities_json TEXT NOT NULL CHECK(json_valid(entities_json) AND json_type(entities_json)='array'), observation_scopes_json TEXT CHECK(observation_scopes_json IS NULL OR (json_valid(observation_scopes_json) AND json_type(observation_scopes_json) IN ('text','array'))),
 event_date TEXT, occurred_start TEXT, occurred_end TEXT, mentioned_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, edited_at TEXT, consolidated_at TEXT, consolidation_failed_at TEXT, invalidation_reason TEXT, invalidated_at TEXT,
 proof_count INTEGER NOT NULL CHECK(proof_count>=1), PRIMARY KEY(authority_epoch_id,bank_id,memory_id),
 FOREIGN KEY(authority_epoch_id,bank_id) REFERENCES canonical_memory_banks(authority_epoch_id,bank_id),
 FOREIGN KEY(authority_epoch_id,bank_id,document_id) REFERENCES canonical_memory_sources(authority_epoch_id,bank_id,document_id),
 CHECK(length(memory_id)>0 AND length(text)>0),
 CHECK((state='valid' AND invalidated_at IS NULL AND invalidation_reason IS NULL) OR (state='invalidated' AND invalidated_at IS NOT NULL))
) STRICT;
CREATE INDEX IF NOT EXISTS idx_canonical_memory_units_recall ON canonical_memory_units(authority_epoch_id,bank_id,state,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_canonical_memory_units_document ON canonical_memory_units(authority_epoch_id,bank_id,document_id);
CREATE TABLE IF NOT EXISTS canonical_memory_unit_sources (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL, source_memory_id TEXT NOT NULL, PRIMARY KEY(authority_epoch_id,bank_id,memory_id,source_memory_id),
 FOREIGN KEY(authority_epoch_id,bank_id,memory_id) REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id),
 FOREIGN KEY(authority_epoch_id,bank_id,source_memory_id) REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id), CHECK(memory_id<>source_memory_id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_canonical_memory_unit_sources_reverse ON canonical_memory_unit_sources(authority_epoch_id,bank_id,source_memory_id,memory_id);
CREATE TABLE IF NOT EXISTS canonical_memory_derived (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, object_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('mental_model','directive')), payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND json_type(payload_json)='object'), object_revision INTEGER NOT NULL CHECK(object_revision>=1), PRIMARY KEY(authority_epoch_id,bank_id,kind,object_id), FOREIGN KEY(authority_epoch_id,bank_id) REFERENCES canonical_memory_banks(authority_epoch_id,bank_id)
) STRICT;
CREATE TABLE IF NOT EXISTS canonical_memory_policy (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL, layer_id TEXT NOT NULL, importance INTEGER NOT NULL CHECK(importance BETWEEN 1 AND 10), visibility TEXT NOT NULL CHECK(visibility IN ('pinned','retrieved','mood-gated','hidden')), disclosure TEXT, origin TEXT NOT NULL CHECK(origin IN ('self','observed')), emotional_weight REAL, retention_json TEXT NOT NULL CHECK(json_valid(retention_json) AND json_type(retention_json)='object'), policy_version INTEGER NOT NULL CHECK(policy_version>=1), updated_at TEXT NOT NULL, PRIMARY KEY(authority_epoch_id,bank_id,memory_id), FOREIGN KEY(authority_epoch_id,bank_id,memory_id) REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX IF NOT EXISTS idx_canonical_memory_policy_layer ON canonical_memory_policy(authority_epoch_id,bank_id,layer_id,visibility);
CREATE TABLE IF NOT EXISTS canonical_memory_revision_snapshots (
 authority_epoch_id TEXT NOT NULL, bank_id TEXT NOT NULL, memory_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1),
 record_json TEXT NOT NULL CHECK(json_valid(record_json) AND json_type(record_json)='object'), created_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,bank_id,memory_id,revision),
 FOREIGN KEY(authority_epoch_id,bank_id,memory_id) REFERENCES canonical_memory_units(authority_epoch_id,bank_id,memory_id) ON DELETE CASCADE
) STRICT;
CREATE TABLE IF NOT EXISTS canonical_memory_operation_receipts (
 authority_epoch_id TEXT NOT NULL, request_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('retain','edit','invalidate','restore')), request_hash TEXT NOT NULL, result_json TEXT NOT NULL CHECK(json_valid(result_json) AND json_type(result_json)='object'), created_at TEXT NOT NULL, PRIMARY KEY(authority_epoch_id,request_id), FOREIGN KEY(authority_epoch_id) REFERENCES canonical_memory_authority_epochs(epoch_id), CHECK(length(request_id)>0 AND length(request_hash)=64)
) STRICT;
CREATE TABLE IF NOT EXISTS taki_memory_blocks (
 block_row_id INTEGER PRIMARY KEY, block_id TEXT NOT NULL, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','character')), character_id TEXT, content TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1), updated_at TEXT NOT NULL,
 CHECK((scope_kind='global' AND character_id IS NULL) OR (scope_kind='character' AND character_id IS NOT NULL AND length(character_id)>0))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_taki_memory_blocks_scope ON taki_memory_blocks(block_id,scope_kind,ifnull(character_id,''));
CREATE VIRTUAL TABLE IF NOT EXISTS canonical_memory_fts USING fts5(authority_epoch_id UNINDEXED, bank_id UNINDEXED, memory_id UNINDEXED, text, context, search_terms, tokenize='unicode61');
`,
};
