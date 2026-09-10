/**
 * INPUT:  both converged 035 histories and immutable Local/source evidence through 038
 * OUTPUT: independent D78 capture, frozen transfer, result and finite verification evidence tables
 * POS:    core/db/migrations — append-only migration provenance, independent of disposable replicas
 */
import type { Migration } from "../migration-runner.ts";

const tables = ["hindsight_current_captures", "hindsight_current_preparations", "hindsight_current_import_evidence",
  "hindsight_current_verification_candidates", "hindsight_current_verification_evidence", "hindsight_current_native_invalidations"];
const immutable = tables.map((table) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_CURRENT_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_CURRENT_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table}
 WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${table === "hindsight_current_captures" ? "capture_id=NEW.capture_id OR manifest_id=NEW.manifest_id"
    : table === "hindsight_current_preparations" ? "preparation_id=NEW.preparation_id OR operation_id=NEW.operation_id OR (capture_id=NEW.capture_id AND bank_id=NEW.bank_id)"
      : table === "hindsight_current_import_evidence" ? "evidence_id=NEW.evidence_id OR preparation_id=NEW.preparation_id"
        : table === "hindsight_current_verification_candidates" ? "candidate_id=NEW.candidate_id OR verification_id=NEW.verification_id"
          : table === "hindsight_current_native_invalidations" ? "invalidation_id=NEW.invalidation_id OR observation_key=NEW.observation_key"
          : "evidence_id=NEW.evidence_id OR (preparation_id=NEW.preparation_id AND snapshot_id=NEW.snapshot_id)"})
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_CURRENT_EVIDENCE_IMMUTABLE'); END;`).join("\n");

export const hindsightCurrentStateMigration039: Migration = {
  version: 39,
  sql: `
CREATE TABLE hindsight_current_captures (
 capture_id TEXT PRIMARY KEY CHECK(length(capture_id)=64),
 run_id TEXT NOT NULL REFERENCES hindsight_cutover_runs(run_id),
 manifest_id TEXT NOT NULL UNIQUE REFERENCES hindsight_local_coverage_manifests(manifest_id),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64), local_epoch_id TEXT NOT NULL,
 capture_json TEXT NOT NULL CHECK(json_valid(capture_json))
) STRICT;
CREATE TABLE hindsight_current_preparations (
 preparation_id TEXT PRIMARY KEY CHECK(length(preparation_id)=64),
 capture_id TEXT NOT NULL REFERENCES hindsight_current_captures(capture_id),
 operation_id TEXT NOT NULL UNIQUE CHECK(length(operation_id)=36),
 bank_id TEXT NOT NULL, source_bank_id TEXT NOT NULL, preparation_json TEXT NOT NULL CHECK(json_valid(preparation_json)),
 UNIQUE(capture_id,bank_id)
) STRICT;
CREATE TABLE hindsight_current_import_evidence (
 evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=64),
 preparation_id TEXT NOT NULL UNIQUE REFERENCES hindsight_current_preparations(preparation_id),
 result_hash TEXT NOT NULL CHECK(length(result_hash)=64), evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json))
) STRICT;
CREATE TABLE hindsight_current_verification_evidence (
 evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=64),
 preparation_id TEXT NOT NULL REFERENCES hindsight_current_preparations(preparation_id),
 certificate_hash TEXT NOT NULL CHECK(length(certificate_hash)=64),
 snapshot_id TEXT NOT NULL, manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)), UNIQUE(preparation_id,snapshot_id)
) STRICT;
CREATE TABLE hindsight_current_verification_candidates (
 candidate_id TEXT PRIMARY KEY CHECK(length(candidate_id)=64),
 verification_id TEXT NOT NULL UNIQUE CHECK(length(verification_id)=36),
 preparation_id TEXT NOT NULL REFERENCES hindsight_current_preparations(preparation_id),
 candidate_json TEXT NOT NULL CHECK(json_valid(candidate_json))
) STRICT;
CREATE TABLE hindsight_current_native_invalidations (
 invalidation_id TEXT PRIMARY KEY CHECK(length(invalidation_id)=64),
 observation_key TEXT NOT NULL UNIQUE CHECK(length(observation_key)=64),
 preparation_id TEXT NOT NULL REFERENCES hindsight_current_preparations(preparation_id),
 candidate_id TEXT REFERENCES hindsight_current_verification_candidates(candidate_id),
 scope TEXT NOT NULL CHECK(scope IN ('preparation','candidate')),
 observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
 CHECK(scope='preparation' OR candidate_id IS NOT NULL)
) STRICT;
CREATE INDEX hindsight_current_native_invalidations_preparation
 ON hindsight_current_native_invalidations(preparation_id,scope,candidate_id);
${immutable}
`,
};
