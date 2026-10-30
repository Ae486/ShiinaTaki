/**
 * INPUT: recorded migration 051 and existing primary Run/Timeline authorities
 * OUTPUT: additive Pattern identities, immutable revisions/reviews and replay/source bindings
 * POS: core/db/migrations — no grants, Intention store, scheduler or execution ledger
 */
import type { Migration } from "../migration-runner.ts";

export const interactionPatternsMigration052: Migration = { version: 52, sql: `
CREATE TABLE interaction_patterns (
 pattern_id TEXT PRIMARY KEY CHECK(length(pattern_id) BETWEEN 1 AND 200),
 character_id TEXT NOT NULL CHECK(length(character_id) BETWEEN 1 AND 200),
 state TEXT NOT NULL CHECK(state IN ('proposed','active','paused','retired')),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 9007199254740991),
 effective_revision_id TEXT REFERENCES interaction_pattern_revisions(revision_id),
 candidate_revision_id TEXT REFERENCES interaction_pattern_revisions(revision_id),
 seed_key TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(character_id,seed_key),
 CHECK(state NOT IN ('active','paused') OR effective_revision_id IS NOT NULL)
) STRICT;
CREATE TABLE interaction_pattern_revisions (
 revision_id TEXT PRIMARY KEY CHECK(length(revision_id) BETWEEN 1 AND 200),
 pattern_id TEXT NOT NULL REFERENCES interaction_patterns(pattern_id),
 base_version INTEGER NOT NULL CHECK(base_version BETWEEN 0 AND 9007199254740991),
 definition_json TEXT NOT NULL CHECK(json_valid(definition_json) AND length(definition_json)<=16384),
 origin_json TEXT NOT NULL CHECK(json_valid(origin_json) AND length(origin_json)<=1024),
 changes_json TEXT NOT NULL CHECK(json_valid(changes_json) AND length(changes_json)<=512),
 author_key TEXT NOT NULL CHECK(length(author_key) BETWEEN 1 AND 240),
 source_run_id TEXT REFERENCES runs(run_id),
 source_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 UNIQUE(pattern_id,base_version)
) STRICT;
CREATE TABLE interaction_pattern_reviews (
 revision_id TEXT PRIMARY KEY REFERENCES interaction_pattern_revisions(revision_id),
 reviewer_key TEXT NOT NULL CHECK(length(reviewer_key) BETWEEN 1 AND 240),
 accepted_at TEXT NOT NULL
) STRICT;
CREATE TABLE interaction_pattern_commands (
 command_key TEXT PRIMARY KEY CHECK(length(command_key)=64),
 character_id TEXT NOT NULL,
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 pattern_id TEXT NOT NULL REFERENCES interaction_patterns(pattern_id),
 created_at TEXT NOT NULL
) STRICT;
CREATE TABLE interaction_pattern_primary_sources (
 run_id TEXT PRIMARY KEY REFERENCES runs(run_id),
 character_id TEXT NOT NULL,
 timeline_seq INTEGER NOT NULL CHECK(timeline_seq>0),
 timeline_id TEXT NOT NULL CHECK(length(timeline_id) BETWEEN 1 AND 200),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 created_at TEXT NOT NULL,
 UNIQUE(character_id,timeline_seq)
) STRICT;
CREATE INDEX interaction_patterns_character ON interaction_patterns(character_id,pattern_id);
CREATE INDEX interaction_patterns_active ON interaction_patterns(character_id,state);
CREATE INDEX interaction_pattern_revisions_history ON interaction_pattern_revisions(pattern_id,base_version DESC);
CREATE INDEX interaction_pattern_commands_character ON interaction_pattern_commands(character_id);
CREATE INDEX interaction_pattern_primary_sources_character ON interaction_pattern_primary_sources(character_id);
CREATE TRIGGER interaction_pattern_revision_immutable_update BEFORE UPDATE ON interaction_pattern_revisions
 BEGIN SELECT RAISE(ABORT,'immutable Pattern revision'); END;
CREATE TRIGGER interaction_pattern_revision_immutable_delete BEFORE DELETE ON interaction_pattern_revisions
 BEGIN SELECT RAISE(ABORT,'immutable Pattern revision'); END;
CREATE TRIGGER interaction_pattern_review_immutable_update BEFORE UPDATE ON interaction_pattern_reviews
 BEGIN SELECT RAISE(ABORT,'immutable Pattern review'); END;
CREATE TRIGGER interaction_pattern_review_immutable_delete BEFORE DELETE ON interaction_pattern_reviews
 BEGIN SELECT RAISE(ABORT,'immutable Pattern review'); END;
CREATE TRIGGER interaction_pattern_source_immutable_update BEFORE UPDATE ON interaction_pattern_primary_sources
 BEGIN SELECT RAISE(ABORT,'immutable Pattern source'); END;
CREATE TRIGGER interaction_pattern_source_immutable_delete BEFORE DELETE ON interaction_pattern_primary_sources
 BEGIN SELECT RAISE(ABORT,'immutable Pattern source'); END;
CREATE TRIGGER interaction_pattern_command_immutable_update BEFORE UPDATE ON interaction_pattern_commands
 BEGIN SELECT RAISE(ABORT,'immutable Pattern command'); END;
CREATE TRIGGER interaction_pattern_command_immutable_delete BEFORE DELETE ON interaction_pattern_commands
 BEGIN SELECT RAISE(ABORT,'immutable Pattern command'); END;
CREATE TRIGGER interaction_pattern_identity_immutable BEFORE UPDATE OF pattern_id,character_id,seed_key,created_at ON interaction_patterns
 BEGIN SELECT RAISE(ABORT,'immutable Pattern identity'); END;
CREATE TRIGGER interaction_pattern_revision_scope BEFORE UPDATE OF effective_revision_id,candidate_revision_id ON interaction_patterns
 WHEN (NEW.effective_revision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM interaction_pattern_revisions WHERE revision_id=NEW.effective_revision_id AND pattern_id=NEW.pattern_id))
 OR (NEW.candidate_revision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM interaction_pattern_revisions WHERE revision_id=NEW.candidate_revision_id AND pattern_id=NEW.pattern_id))
 BEGIN SELECT RAISE(ABORT,'foreign Pattern revision'); END;
CREATE TRIGGER interaction_pattern_effective_review BEFORE UPDATE OF effective_revision_id ON interaction_patterns
 WHEN NEW.effective_revision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM interaction_pattern_reviews WHERE revision_id=NEW.effective_revision_id)
 BEGIN SELECT RAISE(ABORT,'unreviewed effective Pattern revision'); END;
` };
