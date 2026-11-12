/**
 * INPUT:  existing canonical memory and its historical success watermarks
 * OUTPUT: exact reviewed revisions, Block review evidence and bounded automatic retry state
 * POS:    core/db/migrations — additive Local tidy checkpoints; no historical coverage is inferred
 */
import type { Migration } from "../migration-runner.ts";

export const memoryTidyReviewsMigration067: Migration = {
  version: 67,
  sql: `
CREATE TABLE memory_tidy_reviews (
 authority_epoch_id TEXT NOT NULL,
 character_id TEXT NOT NULL,
 bank_id TEXT NOT NULL,
 memory_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision >= 1),
 reviewed_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,character_id,bank_id,memory_id)
) STRICT;
CREATE TABLE memory_tidy_block_reviews (
 authority_epoch_id TEXT NOT NULL,
 character_id TEXT NOT NULL,
 block_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision >= 0),
 reviewed_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,character_id,block_id)
) STRICT;
CREATE TABLE memory_tidy_retry (
 authority_epoch_id TEXT NOT NULL,
 character_id TEXT NOT NULL,
 pending INTEGER NOT NULL CHECK(pending IN (0,1)),
 failures INTEGER NOT NULL CHECK(failures >= 0),
 retry_at TEXT,
 PRIMARY KEY(authority_epoch_id,character_id)
) STRICT;
`,
};
