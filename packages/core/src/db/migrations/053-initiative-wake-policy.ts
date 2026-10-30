/**
 * INPUT: existing canonical Runs/model opportunities and Pattern revisions
 * OUTPUT: additive source-occurrence dedupe and bounded deterministic policy diagnostics
 * POS: core/db/migrations — no execution queue or duplicated quota charges
 */
import type { Migration } from "../migration-runner.ts";

export const initiativeWakePolicyMigration053: Migration = { version: 53, sql: `
CREATE TABLE initiative_wake_claims (
 source_key TEXT PRIMARY KEY CHECK(length(source_key) BETWEEN 1 AND 200),
 opportunity_id TEXT NOT NULL UNIQUE CHECK(length(opportunity_id) BETWEEN 1 AND 200),
 canonical_key TEXT NOT NULL UNIQUE CHECK(length(canonical_key) BETWEEN 1 AND 200),
 character_id TEXT NOT NULL,
 pattern_refs_json TEXT NOT NULL CHECK(json_valid(pattern_refs_json) AND length(pattern_refs_json)<=4096),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL CHECK(expires_at>created_at),
 run_id TEXT REFERENCES runs(run_id),
 disposition TEXT NOT NULL CHECK(disposition IN ('pending','admitted','retired')),
 CHECK(disposition!='admitted' OR run_id IS NOT NULL)
) STRICT;
CREATE INDEX initiative_wake_claims_patterns ON initiative_wake_claims(character_id,created_at);
CREATE TABLE initiative_wake_evaluations (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 character_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 source TEXT NOT NULL,
 matched_count INTEGER NOT NULL CHECK(matched_count BETWEEN 0 AND 4),
 occurred_at TEXT NOT NULL
) STRICT;
CREATE INDEX initiative_wake_evaluations_character ON initiative_wake_evaluations(character_id,seq);
CREATE TABLE initiative_wake_counters (
 character_id TEXT NOT NULL, bucket TEXT NOT NULL, reason TEXT NOT NULL,
 count INTEGER NOT NULL CHECK(count>0),
 PRIMARY KEY(character_id,bucket,reason)
) STRICT;
` };
