/**
 * INPUT: durable inbox consumers and immutable original delivery/action receipts
 * OUTPUT: explicit operation-keyed successor consumer links
 * POS: core/db/migrations — additive recovery identity only; never reissues automatic eligibility
 */
import type { Migration } from "../migration-runner.ts";

export const subagentInboxResumeMigration062: Migration = { version: 62, sql: `
CREATE TABLE subagent_inbox_resumes (
 previous_consumer_id TEXT NOT NULL REFERENCES subagent_inbox_consumers(consumer_id),
 operation_key TEXT NOT NULL, consumer_id TEXT NOT NULL UNIQUE REFERENCES subagent_inbox_consumers(consumer_id),
 PRIMARY KEY(previous_consumer_id,operation_key)
) STRICT;
CREATE TRIGGER subagent_inbox_resume_immutable BEFORE UPDATE ON subagent_inbox_resumes
 BEGIN SELECT RAISE(ABORT,'SUBAGENT_INBOX_RESUME_IMMUTABLE'); END;
` };
