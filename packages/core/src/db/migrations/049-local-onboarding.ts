/**
 * INPUT:  immutable migration lineage through 048 and existing Legacy migration evidence
 * OUTPUT: candidate isolation, staged Block plans, exact primary group/member custody
 * POS:    core/db/migrations — additive Local onboarding storage; no historical receipt is rewritten
 */
import type { Migration } from "../migration-runner.ts";

export const localOnboardingMigration049: Migration = {
  version: 49,
  sql: `
CREATE TABLE memory_migration_candidates (
 run_id TEXT PRIMARY KEY REFERENCES memory_migration_runs(run_id), workspace_root TEXT NOT NULL,
 superseded_by_run_id TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE memory_migration_block_plans (
 run_id TEXT NOT NULL, source_id TEXT NOT NULL, block_id TEXT NOT NULL, scope_kind TEXT NOT NULL,
 character_id TEXT, content TEXT NOT NULL, expected_revision INTEGER NOT NULL,
 expected_content TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id),
 FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id)
) STRICT;
CREATE UNIQUE INDEX memory_migration_block_plan_scope
 ON memory_migration_block_plans(run_id,block_id,scope_kind,ifnull(character_id,''));
CREATE TABLE memory_migration_source_proofs (
 run_id TEXT NOT NULL, source_id TEXT NOT NULL, payload_hash TEXT NOT NULL, effects_hash TEXT NOT NULL,
 PRIMARY KEY(run_id,source_id),
 FOREIGN KEY(run_id,source_id) REFERENCES memory_migration_sources(run_id,source_id)
) STRICT;
CREATE TABLE primary_memory_groups (
 group_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, run_id TEXT, creator_boot_id TEXT NOT NULL,
 original_epoch_id TEXT REFERENCES canonical_memory_authority_epochs(epoch_id),
 assigned_epoch_id TEXT REFERENCES canonical_memory_authority_epochs(epoch_id),
 state TEXT NOT NULL CHECK(state IN ('open','finalized','closed-empty','retracted')),
 producer_settled INTEGER NOT NULL DEFAULT 0 CHECK(producer_settled IN (0,1)),
 finalized_through_seq INTEGER, created_at TEXT NOT NULL, finalized_at TEXT,
 CHECK((state='finalized' AND finalized_through_seq IS NOT NULL) OR
       (state<>'finalized' AND finalized_through_seq IS NULL))
) STRICT;
CREATE TABLE primary_memory_members (
 group_id TEXT NOT NULL REFERENCES primary_memory_groups(group_id),
 timeline_seq INTEGER NOT NULL UNIQUE, entry_id TEXT NOT NULL UNIQUE, entry_digest TEXT NOT NULL,
 PRIMARY KEY(group_id,timeline_seq)
) STRICT;
CREATE INDEX primary_memory_groups_epoch ON primary_memory_groups(assigned_epoch_id,state);
`,
};
