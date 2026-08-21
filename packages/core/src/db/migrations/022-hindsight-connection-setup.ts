/**
 * INPUT:  migration runner applies version 22 after the canonical local/legacy migration schemas
 * OUTPUT: additive sanitized Hindsight connection and per-Bank setup state tables
 * POS:    core/db/migrations — B3 setup evidence only; never changes Memory Authority tables or rows
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightConnectionSetupMigration022: Migration = {
  version: 22,
  sql: `
CREATE TABLE IF NOT EXISTS hindsight_connection_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0),
 phase TEXT NOT NULL CHECK(phase IN ('disabled','unconfigured','ready-to-validate','validating','compatible','validating-templates','initializing-banks','applying-templates','waiting-template-operations','configured','failed')),
 last_successful_phase TEXT, config_fingerprint TEXT CHECK(config_fingerprint IS NULL OR length(config_fingerprint)=64),
 attempt_id TEXT CHECK(attempt_id IS NULL OR length(attempt_id)<=240),
 compatibility_json TEXT CHECK(compatibility_json IS NULL OR (json_valid(compatibility_json) AND json_type(compatibility_json)='object')),
 model_health TEXT NOT NULL CHECK(model_health IN ('not-run','running','healthy','degraded','failed')),
 latest_error_json TEXT CHECK(latest_error_json IS NULL OR (json_valid(latest_error_json) AND json_type(latest_error_json)='object')),
 last_attempt_at TEXT, last_success_at TEXT, updated_at TEXT NOT NULL
) STRICT;
INSERT OR IGNORE INTO hindsight_connection_state
 (singleton,revision,phase,last_successful_phase,config_fingerprint,attempt_id,compatibility_json,model_health,latest_error_json,last_attempt_at,last_success_at,updated_at)
 VALUES (1,0,'unconfigured',NULL,NULL,NULL,NULL,'not-run',NULL,NULL,NULL,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE IF NOT EXISTS hindsight_bank_setup (
 canonical_identity TEXT PRIMARY KEY, scope_kind TEXT NOT NULL CHECK(scope_kind IN ('global','character')),
 external_bank_id TEXT NOT NULL UNIQUE, template_revision TEXT NOT NULL,
 template_digest TEXT NOT NULL CHECK(length(template_digest)=64),
 status TEXT NOT NULL CHECK(status IN ('pending','dry-run-ok','applied','verified','failed')),
 operation_ids_json TEXT NOT NULL CHECK(json_valid(operation_ids_json) AND json_type(operation_ids_json)='array'),
 last_verified_at TEXT,
 last_error_json TEXT CHECK(last_error_json IS NULL OR (json_valid(last_error_json) AND json_type(last_error_json)='object')),
 updated_at TEXT NOT NULL
) STRICT;
`,
};
