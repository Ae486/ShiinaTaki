/**
 * INPUT:  migration 061 and the existing per-item hindsight_policy_work journal
 * OUTPUT: per-epoch/Bank-namespace review schedule progress independent of replica sync configuration
 * POS:    Core SQLite additive migration; item/result/command evidence stays in its original journal
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightPolicyReviewScheduleMigration062: Migration = {
  version: 62,
  sql: `CREATE TABLE hindsight_policy_review_schedule (
    authority_epoch_id TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    provider_lineage TEXT NOT NULL,
    bank_generation TEXT NOT NULL,
    progress_json TEXT NOT NULL CHECK(json_valid(progress_json)),
    PRIMARY KEY(authority_epoch_id,bank_id,provider_lineage,bank_generation)
  ) STRICT;`,
};
