/**
 * INPUT: immutable provider journals and existing Timeline history through T4 migration 063
 * OUTPUT: local primary-source lifecycle and exact nullable Timeline membership
 * POS: core/db/migrations — additive capture only; historical rows and provider receipts stay unchanged
 */
import type { Migration } from "../migration-runner.ts";

export const primaryConversationSourcesMigration064: Migration = { version: 64, sql: `
CREATE TABLE primary_conversation_sources (
 source_id TEXT PRIMARY KEY, character_id TEXT NOT NULL,
 original_user_id TEXT NOT NULL UNIQUE, original_user_seq INTEGER NOT NULL UNIQUE CHECK(original_user_seq>0),
 original_user_digest TEXT NOT NULL CHECK(length(original_user_digest)=64), run_id TEXT,
 memory_json TEXT CHECK(memory_json IS NULL OR json_valid(memory_json)),
 state TEXT NOT NULL CHECK(state IN ('open','retained','retracted')),
 through_seq INTEGER, source_digest TEXT, created_at TEXT NOT NULL, closed_at TEXT,
 CHECK((state='open' AND closed_at IS NULL AND through_seq IS NULL AND source_digest IS NULL)
   OR (state='retracted' AND closed_at IS NOT NULL AND through_seq IS NULL AND source_digest IS NULL)
   OR (state='retained' AND closed_at IS NOT NULL AND through_seq IS NOT NULL AND source_digest IS NOT NULL
     AND through_seq>=original_user_seq AND length(source_digest)=64))
) STRICT;
ALTER TABLE timeline_messages ADD COLUMN primary_source_id TEXT REFERENCES primary_conversation_sources(source_id);
CREATE INDEX timeline_primary_source_members ON timeline_messages(primary_source_id,seq) WHERE primary_source_id IS NOT NULL;
CREATE INDEX primary_conversation_source_ready ON primary_conversation_sources(character_id,state,original_user_seq);
CREATE TRIGGER primary_conversation_source_immutable BEFORE UPDATE ON primary_conversation_sources
 WHEN OLD.state<>'open' OR NEW.source_id IS NOT OLD.source_id OR NEW.character_id IS NOT OLD.character_id
 OR NEW.original_user_id IS NOT OLD.original_user_id OR NEW.original_user_seq IS NOT OLD.original_user_seq
 OR NEW.original_user_digest IS NOT OLD.original_user_digest OR NEW.run_id IS NOT OLD.run_id
 OR NEW.memory_json IS NOT OLD.memory_json OR NEW.created_at IS NOT OLD.created_at OR NEW.state='open'
 BEGIN SELECT RAISE(ABORT,'PRIMARY_SOURCE_IMMUTABLE'); END;
CREATE TRIGGER primary_conversation_source_no_delete BEFORE DELETE ON primary_conversation_sources
 BEGIN SELECT RAISE(ABORT,'PRIMARY_SOURCE_IMMUTABLE'); END;
CREATE TRIGGER timeline_primary_source_link BEFORE UPDATE OF primary_source_id ON timeline_messages
 WHEN NEW.primary_source_id IS NOT OLD.primary_source_id AND
 (OLD.primary_source_id IS NOT NULL OR NOT EXISTS (
   SELECT 1 FROM primary_conversation_sources s WHERE s.source_id=NEW.primary_source_id
   AND s.state='open' AND s.character_id=NEW.character_id AND NEW.seq>=s.original_user_seq
   AND (NEW.role<>'user' OR NEW.id=s.original_user_id)
 ))
 BEGIN SELECT RAISE(ABORT,'PRIMARY_SOURCE_MEMBERSHIP'); END;
CREATE TRIGGER timeline_primary_source_insert BEFORE INSERT ON timeline_messages
 WHEN NEW.primary_source_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM primary_conversation_sources s WHERE s.source_id=NEW.primary_source_id
   AND s.state='open' AND s.character_id=NEW.character_id AND NEW.role IN ('assistant','tool')
 )
 BEGIN SELECT RAISE(ABORT,'PRIMARY_SOURCE_MEMBERSHIP'); END;
CREATE TRIGGER timeline_primary_source_identity BEFORE UPDATE OF id,seq,character_id,role ON timeline_messages
 WHEN OLD.primary_source_id IS NOT NULL AND
 (NEW.id IS NOT OLD.id OR NEW.seq IS NOT OLD.seq OR NEW.character_id IS NOT OLD.character_id OR NEW.role IS NOT OLD.role)
 BEGIN SELECT RAISE(ABORT,'PRIMARY_SOURCE_MEMBERSHIP'); END;
CREATE TRIGGER timeline_primary_source_delete BEFORE DELETE ON timeline_messages
 WHEN OLD.primary_source_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM primary_conversation_sources s WHERE s.source_id=OLD.primary_source_id
   AND s.state='retracted' AND s.original_user_id=OLD.id
 )
 BEGIN SELECT RAISE(ABORT,'PRIMARY_SOURCE_MEMBERSHIP'); END;
` };
