/**
 * INPUT:  n/a (static additive DDL over the existing conversation summary checkpoint)
 * OUTPUT: conversationCompactionLifecycleMigration032 — revisioned summaries plus fenced operation/event storage
 * POS:    core/db/migrations — Slice 3 durability for projection-only conversation compaction
 */
import type { Migration } from "../migration-runner.ts";

export const conversationCompactionLifecycleMigration032: Migration = {
  version: 32,
  sql: `
    ALTER TABLE conversation_summary
      ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1);
    ALTER TABLE conversation_summary
      ADD COLUMN last_operation_id TEXT CHECK(last_operation_id IS NULL OR length(last_operation_id) BETWEEN 1 AND 100);
    ALTER TABLE conversation_summary
      ADD COLUMN source_from_seq INTEGER CHECK(source_from_seq IS NULL OR source_from_seq >= 1);
    ALTER TABLE conversation_summary
      ADD COLUMN source_through_seq INTEGER CHECK(source_through_seq IS NULL OR source_through_seq >= 1);
    ALTER TABLE conversation_summary
      ADD COLUMN source_digest TEXT CHECK(source_digest IS NULL OR (
        length(source_digest) = 64 AND source_digest = lower(source_digest)
        AND source_digest NOT GLOB '*[^0-9a-f]*'
      ));
    ALTER TABLE conversation_summary
      ADD COLUMN captured_tail_seq INTEGER CHECK(captured_tail_seq IS NULL OR captured_tail_seq >= 1);

    CREATE TABLE conversation_compaction_operations (
      operation_id               TEXT PRIMARY KEY CHECK(length(operation_id) BETWEEN 1 AND 100),
      character_id               TEXT NOT NULL CHECK(length(character_id) BETWEEN 1 AND 64),
      run_id                     TEXT CHECK(run_id IS NULL OR length(run_id) BETWEEN 1 AND 100),
      attempt_id                 TEXT CHECK(attempt_id IS NULL OR length(attempt_id) BETWEEN 1 AND 100),
      reason                     TEXT NOT NULL CHECK(reason IN ('pressure')),
      state                      TEXT NOT NULL CHECK(state IN ('open','committed','failed','cancelled','abandoned')),
      attempt_no                 INTEGER NOT NULL CHECK(attempt_no >= 1),
      selected_from_seq          INTEGER NOT NULL CHECK(selected_from_seq >= 1),
      selected_through_seq       INTEGER NOT NULL CHECK(selected_through_seq >= selected_from_seq),
      captured_tail_seq          INTEGER NOT NULL CHECK(captured_tail_seq >= selected_through_seq),
      expected_summary_revision  INTEGER NOT NULL CHECK(expected_summary_revision >= 0),
      expected_summary_through   INTEGER NOT NULL CHECK(expected_summary_through >= 0),
      source_digest              TEXT NOT NULL CHECK(
        length(source_digest) = 64 AND source_digest = lower(source_digest)
        AND source_digest NOT GLOB '*[^0-9a-f]*'
      ),
      before_tokens              INTEGER NOT NULL CHECK(before_tokens >= 0),
      provider                   TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),
      model_id                   TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200),
      lease_owner                TEXT CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 100),
      lease_fence                INTEGER NOT NULL CHECK(lease_fence >= 1),
      lease_expires_at           TEXT,
      failure_code               TEXT CHECK(failure_code IS NULL OR failure_code IN (
        'LEGACY_FLUSH_FAILED','MEMORY_AUTHORITY_FENCED','MEMORY_FLUSH_INCOMPLETE','MEMORY_FLUSH_FAILED',
        'HINDSIGHT_RUNTIME_UNAVAILABLE','SUMMARY_GENERATION_FAILED','SUMMARY_EMPTY','SOURCE_STALE',
        'SUMMARY_CONFLICT','COMPACTION_INTERNAL_ERROR','LEASE_EXPIRED'
      )),
      committed_summary_revision INTEGER CHECK(committed_summary_revision IS NULL OR committed_summary_revision >= 1),
      started_at                 TEXT NOT NULL,
      updated_at                 TEXT NOT NULL,
      terminal_at                TEXT,
      CHECK(attempt_id IS NULL OR run_id IS NOT NULL),
      CHECK(selected_from_seq = expected_summary_through + 1),
      CHECK(
        (expected_summary_revision = 0 AND expected_summary_through = 0)
        OR
        (expected_summary_revision >= 1 AND expected_summary_through >= 1)
      ),
      CHECK(
        (state = 'open' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND terminal_at IS NULL)
        OR
        (state <> 'open' AND lease_owner IS NULL AND lease_expires_at IS NULL AND terminal_at IS NOT NULL)
      ),
      CHECK(
        (state = 'committed' AND committed_summary_revision IS NOT NULL AND failure_code IS NULL)
        OR
        (state <> 'committed' AND committed_summary_revision IS NULL)
      ),
      CHECK(
        (state IN ('failed','abandoned') AND failure_code IS NOT NULL)
        OR
        (state NOT IN ('failed','abandoned') AND failure_code IS NULL)
      )
    ) STRICT;

    CREATE UNIQUE INDEX conversation_compaction_one_open_per_character
      ON conversation_compaction_operations(character_id) WHERE state = 'open';
    CREATE INDEX conversation_compaction_operations_character_updated
      ON conversation_compaction_operations(character_id, updated_at DESC);

    CREATE TABLE conversation_compaction_events (
      event_id          INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id      TEXT NOT NULL REFERENCES conversation_compaction_operations(operation_id),
      operation_seq     INTEGER NOT NULL CHECK(operation_seq >= 1),
      character_id      TEXT NOT NULL CHECK(length(character_id) BETWEEN 1 AND 64),
      attempt_no        INTEGER NOT NULL CHECK(attempt_no >= 1),
      kind              TEXT NOT NULL CHECK(kind IN (
        'started','flush_completed','summary_generated','committed','failed','cancelled','abandoned'
      )),
      occurred_at       TEXT NOT NULL,
      selected_through  INTEGER NOT NULL CHECK(selected_through >= 1),
      before_tokens     INTEGER NOT NULL CHECK(before_tokens >= 0),
      summary_revision  INTEGER CHECK(summary_revision IS NULL OR summary_revision >= 1),
      flush_status      TEXT CHECK(flush_status IS NULL OR flush_status IN ('success','not_required')),
      writes            INTEGER CHECK(writes IS NULL OR writes >= 0),
      output_chars      INTEGER CHECK(output_chars IS NULL OR output_chars >= 0),
      failure_code      TEXT CHECK(failure_code IS NULL OR failure_code IN (
        'LEGACY_FLUSH_FAILED','MEMORY_AUTHORITY_FENCED','MEMORY_FLUSH_INCOMPLETE','MEMORY_FLUSH_FAILED',
        'HINDSIGHT_RUNTIME_UNAVAILABLE','SUMMARY_GENERATION_FAILED','SUMMARY_EMPTY','SOURCE_STALE',
        'SUMMARY_CONFLICT','COMPACTION_INTERNAL_ERROR','LEASE_EXPIRED'
      )),
      lease_fence       INTEGER NOT NULL CHECK(lease_fence >= 1),
      provider          TEXT NOT NULL CHECK(length(provider) BETWEEN 1 AND 100),
      model_id          TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 200),
      run_id            TEXT CHECK(run_id IS NULL OR length(run_id) BETWEEN 1 AND 100),
      attempt_id        TEXT CHECK(attempt_id IS NULL OR length(attempt_id) BETWEEN 1 AND 100),
      UNIQUE(operation_id, operation_seq),
      CHECK(attempt_id IS NULL OR run_id IS NOT NULL),
      CHECK((kind IN ('failed','abandoned') AND failure_code IS NOT NULL)
        OR (kind NOT IN ('failed','abandoned') AND failure_code IS NULL)),
      CHECK((kind = 'flush_completed' AND flush_status IS NOT NULL) OR (kind <> 'flush_completed' AND flush_status IS NULL)),
      CHECK((kind = 'summary_generated' AND output_chars IS NOT NULL) OR (kind <> 'summary_generated' AND output_chars IS NULL)),
      CHECK((kind = 'committed' AND summary_revision IS NOT NULL) OR (kind <> 'committed' AND summary_revision IS NULL))
    ) STRICT;

    CREATE TRIGGER conversation_compaction_events_no_update
      BEFORE UPDATE ON conversation_compaction_events
      BEGIN SELECT RAISE(ABORT, 'conversation compaction events are append-only'); END;
    CREATE TRIGGER conversation_compaction_events_no_delete
      BEFORE DELETE ON conversation_compaction_events
      BEGIN SELECT RAISE(ABORT, 'conversation compaction events are append-only'); END;
  `,
};
