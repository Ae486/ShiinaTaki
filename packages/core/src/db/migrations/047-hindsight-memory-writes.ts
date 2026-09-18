/**
 * INPUT:  canonical foreground writes with independent native and Taki policy effects
 * OUTPUT: durable original requests, exact mutation targets and stable whole-operation results
 * POS:    core/db/migrations — additive parent intents; frozen Pending/G1 receipts keep their original meaning
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightMemoryWritesMigration047: Migration = {
  version: 47,
  sql: `
CREATE TABLE hindsight_memory_write_intents (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 authority_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 bank_id TEXT NOT NULL, request_id TEXT NOT NULL,
 provider_lineage TEXT NOT NULL, bank_generation TEXT NOT NULL,
 intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 native_operation_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('pending','completed')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 payload_bytes BLOB NOT NULL,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 UNIQUE(authority_epoch_id,bank_id,request_id)
) STRICT;
CREATE INDEX hindsight_memory_write_pending
 ON hindsight_memory_write_intents(authority_epoch_id,bank_id,sequence) WHERE state='pending';
CREATE UNIQUE INDEX hindsight_memory_write_native
 ON hindsight_memory_write_intents(authority_epoch_id,bank_id,native_operation_id)
 WHERE native_operation_id IS NOT NULL;
`,
};
