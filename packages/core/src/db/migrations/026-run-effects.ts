/**
 * INPUT: schema version 025 database
 * OUTPUT: additive Run-owned effect current state and authoritative model usage tables
 * POS:    core/db/migrations — Slice 3 durable effect identity and settlement foundation
 */
import type { Migration } from "../migration-runner.ts";

export const runEffectsMigration026: Migration = {
  version: 26,
  sql: `
    CREATE TABLE IF NOT EXISTS run_effects (
      effect_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id),
      schema_version TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      state_version INTEGER NOT NULL DEFAULT 0,
      source_ref_json TEXT NOT NULL,
      executor_ref_json TEXT,
      input_digest TEXT,
      replay_posture TEXT NOT NULL,
      captured_generation_ref TEXT,
      idempotency_key TEXT,
      reserved_result_ref TEXT,
      reserved_usage_ref TEXT,
      started_at TEXT,
      settled_at TEXT,
      outcome TEXT,
      error_code TEXT,
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(run_id, attempt_id, effect_id),
      UNIQUE(run_id, idempotency_key)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS run_effects_attempt_state_idx ON run_effects(run_id, attempt_id, state);
    CREATE TRIGGER IF NOT EXISTS run_effects_attempt_lineage
    BEFORE INSERT ON run_effects
    WHEN NOT EXISTS (SELECT 1 FROM run_attempts WHERE attempt_id=NEW.attempt_id AND run_id=NEW.run_id)
    BEGIN SELECT RAISE(ABORT, 'RUN_EFFECT_ATTEMPT_LINEAGE_MISMATCH'); END;
    CREATE TABLE IF NOT EXISTS run_usage (
      usage_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(run_id),
      attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id),
      effect_id TEXT NOT NULL UNIQUE REFERENCES run_effects(effect_id),
      schema_version TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      quality TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      recorded_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS run_usage_attempt_idx ON run_usage(run_id, attempt_id);
    CREATE TRIGGER IF NOT EXISTS run_usage_lineage
    BEFORE INSERT ON run_usage
    WHEN NOT EXISTS (
      SELECT 1 FROM run_effects WHERE effect_id=NEW.effect_id AND run_id=NEW.run_id AND attempt_id=NEW.attempt_id
    )
    BEGIN SELECT RAISE(ABORT, 'RUN_USAGE_EFFECT_LINEAGE_MISMATCH'); END;
  `,
};
