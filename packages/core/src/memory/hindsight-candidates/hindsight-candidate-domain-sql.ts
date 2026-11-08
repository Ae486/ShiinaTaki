/**
 * INPUT:  Root's later allocated controlling-Core migration, after the current C2b lineage handoff
 * OUTPUT: additive candidate plan/request/dispatch/fact tables with immutable bounded evidence
 * POS:    candidate domain schema only; never self-installs, assigns a migration number or migrates an archived Core
 */
export const HINDSIGHT_CANDIDATE_DOMAIN_SQL = `
CREATE TABLE hindsight_candidate_records (
 candidate_id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL UNIQUE REFERENCES memory_operations(operation_id),
 plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND length(CAST(plan_json AS BLOB))<=16384),
 admitted_at TEXT NOT NULL
) STRICT;
CREATE TABLE hindsight_candidate_requests (
 request_id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL UNIQUE REFERENCES memory_operations(operation_id),
 candidate_id TEXT NOT NULL REFERENCES hindsight_candidate_records(candidate_id),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(CAST(request_json AS BLOB))<=4096),
 guard_hash TEXT NOT NULL CHECK(length(guard_hash)=64),
 guard_json TEXT NOT NULL CHECK(json_valid(guard_json) AND length(CAST(guard_json AS BLOB))<=4096)
) STRICT;
CREATE INDEX hindsight_candidate_requests_candidate ON hindsight_candidate_requests(candidate_id);
CREATE TABLE hindsight_candidate_dispatches (
 candidate_id TEXT NOT NULL REFERENCES hindsight_candidate_records(candidate_id),
 action TEXT NOT NULL CHECK(action IN ('reserve','restore')),
 operation_id TEXT NOT NULL REFERENCES hindsight_candidate_requests(operation_id),
 effect_id TEXT NOT NULL UNIQUE REFERENCES run_effects(effect_id),
 dispatch_hash TEXT NOT NULL CHECK(length(dispatch_hash)=64),
 dispatch_json TEXT NOT NULL CHECK(json_valid(dispatch_json) AND length(CAST(dispatch_json AS BLOB))<=4096),
 PRIMARY KEY(candidate_id,action)
) STRICT;
CREATE TABLE hindsight_candidate_facts (
 candidate_id TEXT NOT NULL REFERENCES hindsight_candidate_records(candidate_id),
 kind TEXT NOT NULL CHECK(kind IN ('resource','restore','verification')),
 operation_id TEXT NOT NULL REFERENCES hindsight_candidate_requests(operation_id),
 fact_hash TEXT NOT NULL CHECK(length(fact_hash)=64),
 fact_json TEXT NOT NULL CHECK(json_valid(fact_json) AND length(CAST(fact_json AS BLOB))<=16384),
 PRIMARY KEY(candidate_id,kind)
) STRICT;
CREATE TABLE hindsight_candidate_observations (
 operation_id TEXT PRIMARY KEY REFERENCES hindsight_candidate_requests(operation_id),
 result_hash TEXT NOT NULL CHECK(length(result_hash)=64),
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(CAST(result_json AS BLOB))<=16384)
) STRICT;
${["records", "requests", "dispatches", "facts", "observations"].map((table) => `
CREATE TRIGGER hindsight_candidate_${table}_immutable_update BEFORE UPDATE ON hindsight_candidate_${table}
BEGIN SELECT RAISE(ABORT,'HINDSIGHT_CANDIDATE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_candidate_${table}_immutable_delete BEFORE DELETE ON hindsight_candidate_${table}
BEGIN SELECT RAISE(ABORT,'HINDSIGHT_CANDIDATE_IMMUTABLE'); END;`).join("\n")}
`;
