/**
 * INPUT:  existing authority epochs and independently verified application policy/Block targets
 * OUTPUT: durable curator claims, exact original targets, saved proposals and local retry state
 * POS:    core/db/migrations — additive version 45; assessment work is distinct from native Pending writes
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightPolicyWorkMigration045: Migration = {
  version: 45,
  sql: `
CREATE TABLE hindsight_policy_work (
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 bank_id TEXT NOT NULL, provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL,
 work_id TEXT NOT NULL, work_kind TEXT NOT NULL CHECK(work_kind IN ('policy','block')),
 target_bytes BLOB NOT NULL, target_bytes_hash TEXT NOT NULL CHECK(length(target_bytes_hash)=64),
 state TEXT NOT NULL CHECK(state IN ('ready','claimed','saved','completed','superseded')),
 revision INTEGER NOT NULL CHECK(revision>=1), claims INTEGER NOT NULL CHECK(claims>=0),
 claim_token TEXT, claim_until TEXT, next_attempt_at TEXT,
 prompt_version TEXT, prompt_hash TEXT CHECK(prompt_hash IS NULL OR length(prompt_hash)=64),
 result_bytes BLOB, result_bytes_hash TEXT CHECK(result_bytes_hash IS NULL OR length(result_bytes_hash)=64),
 command_request_id TEXT NOT NULL,
 last_failure TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
 PRIMARY KEY(authority_epoch_id,bank_id,work_id),
 CHECK((claim_token IS NULL)=(claim_until IS NULL)),
 CHECK((prompt_version IS NULL)=(prompt_hash IS NULL)),
 CHECK((result_bytes IS NULL)=(result_bytes_hash IS NULL)),
 CHECK(state<>'claimed' OR claim_token IS NOT NULL),
 CHECK(state NOT IN ('saved','completed') OR result_bytes IS NOT NULL)
) STRICT;
CREATE INDEX hindsight_policy_work_due ON hindsight_policy_work(authority_epoch_id,bank_id,next_attempt_at,created_at,work_id)
 WHERE state IN ('ready','claimed','saved');
`,
};
