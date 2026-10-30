/**
 * INPUT:  authority epochs and the independent D77 application-state protocol
 * OUTPUT: durable command identities, immutable byte-body preparation and historical remote receipts
 * POS:    core/db/migrations — additive version 44; Pending/G1 and confirmed replica tables are untouched
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightApplicationCommandsMigration044: Migration = {
  version: 44,
  sql: `
CREATE TABLE hindsight_application_command_bodies (
 provider_lineage TEXT NOT NULL, bank_id TEXT NOT NULL, bank_generation TEXT NOT NULL,
 body_id TEXT NOT NULL, ref_bytes BLOB NOT NULL, ref_bytes_hash TEXT NOT NULL CHECK(length(ref_bytes_hash)=64),
 body_bytes BLOB NOT NULL CHECK(length(body_bytes)>0),
 PRIMARY KEY(provider_lineage,bank_id,bank_generation,body_id)
) STRICT;
CREATE TABLE hindsight_application_command_jobs (
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 bank_id TEXT NOT NULL, request_id TEXT NOT NULL,
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL, application_id TEXT NOT NULL CHECK(application_id='taki'),
 operation_id TEXT NOT NULL UNIQUE,
 intent_bytes BLOB NOT NULL, intent_bytes_hash TEXT NOT NULL CHECK(length(intent_bytes_hash)=64),
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 request_bytes BLOB NOT NULL, request_bytes_hash TEXT NOT NULL CHECK(length(request_bytes_hash)=64),
 state TEXT NOT NULL CHECK(state IN ('prepared','dispatched','completed','refused')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 prepared_at TEXT NOT NULL, dispatched_at TEXT, updated_at TEXT NOT NULL,
 receipt_bytes BLOB, receipt_bytes_hash TEXT CHECK(receipt_bytes_hash IS NULL OR length(receipt_bytes_hash)=64),
 PRIMARY KEY(authority_epoch_id,bank_id,request_id),
 CHECK((state='prepared' AND dispatched_at IS NULL) OR (state<>'prepared' AND dispatched_at IS NOT NULL)),
 CHECK((state IN ('prepared','dispatched') AND receipt_bytes IS NULL AND receipt_bytes_hash IS NULL)
    OR (state IN ('completed','refused') AND receipt_bytes IS NOT NULL AND receipt_bytes_hash IS NOT NULL))
) STRICT;
CREATE INDEX hindsight_application_command_pending
 ON hindsight_application_command_jobs(authority_epoch_id,bank_id,prepared_at,request_id)
 WHERE state IN ('prepared','dispatched');
`,
};
