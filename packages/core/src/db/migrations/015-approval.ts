/**
 * INPUT:  n/a (static DDL)
 * OUTPUT: approvalMigration015 — Approval lineage singleton and canonical durable allow table
 * POS:    core/db/migrations — migration 15; stores normalized authority metadata only, never pending input
 */
import type { Migration } from "../migration-runner.ts";

export const approvalMigration015: Migration = {
  version: 15,
  sql: `
    CREATE TABLE approval_state (
      singleton_id                 INTEGER PRIMARY KEY CHECK (singleton_id = 1),
      approval_generation          INTEGER NOT NULL CHECK (approval_generation > 0),
      governance_registry_revision INTEGER NOT NULL CHECK (governance_registry_revision > 0),
      disclosure_revision          INTEGER NOT NULL CHECK (disclosure_revision > 0),
      updated_at                   TEXT NOT NULL
    ) STRICT;

    CREATE TABLE approval_decisions (
      decision_id           TEXT PRIMARY KEY,
      binding_revision      INTEGER NOT NULL CHECK (binding_revision > 0),
      binding_digest        TEXT NOT NULL UNIQUE
                            CHECK (length(binding_digest) = 64 AND binding_digest = lower(binding_digest)
                                   AND binding_digest NOT GLOB '*[^0-9a-f]*'),
      capability_id         TEXT NOT NULL,
      owner_host_id         TEXT NOT NULL,
      subject_id            TEXT,
      subject_revision      TEXT,
      descriptor_revision   INTEGER NOT NULL CHECK (descriptor_revision > 0),
      classifier_id         TEXT NOT NULL,
      classifier_revision   INTEGER NOT NULL CHECK (classifier_revision > 0),
      cell_key               TEXT NOT NULL,
      decision_scope_digest TEXT NOT NULL
                            CHECK (length(decision_scope_digest) = 64
                                   AND decision_scope_digest = lower(decision_scope_digest)
                                   AND decision_scope_digest NOT GLOB '*[^0-9a-f]*'),
      disclosure_revision   INTEGER NOT NULL CHECK (disclosure_revision > 0),
      provenance            TEXT NOT NULL CHECK (provenance IN ('operator', 'legacy-reconfirmation')),
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      CHECK ((subject_id IS NULL) = (subject_revision IS NULL))
    ) STRICT;

    INSERT INTO approval_state (
      singleton_id, approval_generation, governance_registry_revision, disclosure_revision, updated_at
    ) VALUES (1, 1, 1, 1, '1970-01-01T00:00:00.000Z');
  `,
};
