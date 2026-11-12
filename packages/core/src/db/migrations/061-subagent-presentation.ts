/**
 * INPUT: canonical private messages and the exercised T4 conversation-order lineage
 * OUTPUT: immutable presentation references to existing private message parts
 * POS: core/db/migrations — additive read metadata only; no source rewrite or execution wake
 */
import type { Migration } from "../migration-runner.ts";

export const subagentPresentationMigration061: Migration = { version: 61, sql: `
CREATE TABLE subagent_message_presentation (
 message_seq INTEGER PRIMARY KEY REFERENCES run_messages(seq),
 references_json TEXT NOT NULL CHECK(json_valid(references_json))
) STRICT;
CREATE TRIGGER subagent_presentation_immutable BEFORE UPDATE ON subagent_message_presentation
 BEGIN SELECT RAISE(ABORT,'SUBAGENT_PRESENTATION_IMMUTABLE'); END;
` };
