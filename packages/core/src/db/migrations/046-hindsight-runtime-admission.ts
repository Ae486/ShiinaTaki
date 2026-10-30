/**
 * INPUT:  an authenticated D77 capability observation under one active authority and connection fingerprint
 * OUTPUT: durable last-verified runtime admission for truthful offline capability reporting
 * POS:    core/db/migrations — additive runtime evidence; no Authority promotion or setup/model-health result
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightRuntimeAdmissionMigration046: Migration = {
  version: 46,
  sql: `
CREATE TABLE hindsight_application_runtime_admission (
 authority_epoch_id TEXT NOT NULL,
 config_fingerprint TEXT NOT NULL CHECK(length(config_fingerprint)=64),
 provider_lineage TEXT NOT NULL,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND json_type(manifest_json)='object'),
 evidence_hash TEXT NOT NULL CHECK(length(evidence_hash)=64),
 admitted_at TEXT NOT NULL,
 PRIMARY KEY(authority_epoch_id,config_fingerprint)
) STRICT;
`,
};
