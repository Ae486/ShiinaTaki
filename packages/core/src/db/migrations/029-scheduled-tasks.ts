/** Additive durable Scheduled Task definitions and content-bearing scheduler outbox. */
import type { Migration } from "../migration-runner.ts";
export const scheduledTasksMigration029: Migration = { version: 29, sql: `
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    task_id TEXT PRIMARY KEY, character_id TEXT NOT NULL, name TEXT NOT NULL, control_input TEXT NOT NULL,
    pattern_json TEXT NOT NULL, timezone_json TEXT NOT NULL, enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
    state TEXT NOT NULL CHECK (state IN ('active','paused','completed','deleted')), revision INTEGER NOT NULL CHECK (revision > 0),
    next_run_at TEXT, last_run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS scheduled_tasks_due_idx ON scheduled_tasks(state, enabled, next_run_at);
  CREATE INDEX IF NOT EXISTS scheduled_tasks_character_idx ON scheduled_tasks(character_id, state, updated_at);
  CREATE TABLE IF NOT EXISTS schedule_occurrences (
    task_id TEXT NOT NULL REFERENCES scheduled_tasks(task_id), scheduled_for TEXT NOT NULL, task_revision INTEGER NOT NULL,
    control_input TEXT, fired_at TEXT, late INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0,1)),
    state TEXT NOT NULL CHECK (state IN ('pending','admitted','terminal','missed')), run_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (task_id, scheduled_for), UNIQUE(run_id)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS schedule_occurrences_state_idx ON schedule_occurrences(state, updated_at);
  CREATE TABLE IF NOT EXISTS user_timezone (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id=1), timezone TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0), updated_at TEXT NOT NULL
  ) STRICT;
  INSERT INTO user_timezone (singleton_id,timezone,revision,updated_at) VALUES (1,'UTC',1,'1970-01-01T00:00:00.000Z');
` };
