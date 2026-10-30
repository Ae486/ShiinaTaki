/**
 * INPUT:  converged canonical Local, B2, and B4 schemas
 * OUTPUT: immutable versioned Local coverage manifests and lease-owned run selection
 * POS:    core/db/migrations — additive B4 evidence; no foreign key from current sources to the B2 source ledger
 */
import type { Migration } from "../migration-runner.ts";

export const hindsightLocalCoverageMigration037: Migration = {
  version: 37,
  sql: `
CREATE TABLE hindsight_local_coverage_manifests (
 manifest_id TEXT PRIMARY KEY CHECK(length(manifest_id) BETWEEN 1 AND 256),
 run_id TEXT NOT NULL REFERENCES hindsight_cutover_runs(run_id),
 local_epoch_id TEXT NOT NULL REFERENCES canonical_memory_authority_epochs(epoch_id),
 manifest_version INTEGER NOT NULL CHECK(manifest_version>=1),
 schema_version INTEGER NOT NULL CHECK(schema_version=1),
 captured_at TEXT NOT NULL,
 content_digest TEXT NOT NULL CHECK(length(content_digest)=64 AND content_digest NOT GLOB '*[^a-f0-9]*'),
 source_revision_fence TEXT NOT NULL CHECK(length(source_revision_fence)=64 AND source_revision_fence NOT GLOB '*[^a-f0-9]*'),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64 AND manifest_digest NOT GLOB '*[^a-f0-9]*'),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND json_type(manifest_json)='object'
   AND json_array_length(manifest_json,'$.records')<=100000 AND json_array_length(manifest_json,'$.catchUp')<=100000),
 UNIQUE(run_id,manifest_version), UNIQUE(run_id,manifest_id),
 UNIQUE(run_id,captured_at,content_digest)
) STRICT;
CREATE TRIGGER hindsight_local_coverage_immutable_insert
 BEFORE INSERT ON hindsight_local_coverage_manifests
 WHEN EXISTS (SELECT 1 FROM hindsight_local_coverage_manifests old
   WHERE old.manifest_id=NEW.manifest_id
     OR (old.run_id=NEW.run_id AND old.manifest_version=NEW.manifest_version)
     OR (old.run_id=NEW.run_id AND old.captured_at=NEW.captured_at AND old.content_digest=NEW.content_digest))
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_LOCAL_COVERAGE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_local_coverage_immutable_update
 BEFORE UPDATE ON hindsight_local_coverage_manifests
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_LOCAL_COVERAGE_IMMUTABLE'); END;
CREATE TRIGGER hindsight_local_coverage_immutable_delete
 BEFORE DELETE ON hindsight_local_coverage_manifests
 BEGIN SELECT RAISE(ABORT,'HINDSIGHT_LOCAL_COVERAGE_IMMUTABLE'); END;
CREATE TABLE hindsight_cutover_local_coverage (
 run_id TEXT PRIMARY KEY REFERENCES hindsight_cutover_runs(run_id),
 manifest_id TEXT NOT NULL,
 selection_lease_fence INTEGER NOT NULL CHECK(selection_lease_fence>=0),
 selected_at TEXT NOT NULL,
 ready_manifest_id TEXT,
 FOREIGN KEY(run_id,manifest_id) REFERENCES hindsight_local_coverage_manifests(run_id,manifest_id),
 FOREIGN KEY(run_id,ready_manifest_id) REFERENCES hindsight_local_coverage_manifests(run_id,manifest_id),
 CHECK(ready_manifest_id IS NULL OR ready_manifest_id=manifest_id)
) STRICT;
`,
};
