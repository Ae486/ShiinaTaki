/** Additive immutable Run lifecycle evidence ledger. */
import type { Migration } from "../migration-runner.ts";
export const runEventsMigration025: Migration = { version: 25, sql: `
CREATE TABLE IF NOT EXISTS run_events (
 event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(run_id), attempt_id TEXT,
 seq INTEGER NOT NULL, schema_version TEXT NOT NULL, category TEXT NOT NULL, kind TEXT NOT NULL,
 occurred_at TEXT NOT NULL, source TEXT NOT NULL, correlation_json TEXT, payload_json TEXT NOT NULL,
 UNIQUE(run_id, seq), FOREIGN KEY(attempt_id) REFERENCES run_attempts(attempt_id)
) STRICT;
CREATE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events(run_id, seq);
CREATE INDEX IF NOT EXISTS run_events_attempt_idx ON run_events(attempt_id, seq);
CREATE TRIGGER IF NOT EXISTS run_events_immutable_update
BEFORE UPDATE ON run_events
BEGIN
 SELECT RAISE(ABORT, 'RUN_EVENT_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS run_events_immutable_delete
BEFORE DELETE ON run_events
BEGIN
 SELECT RAISE(ABORT, 'RUN_EVENT_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS run_events_attempt_lineage
BEFORE INSERT ON run_events
WHEN NEW.attempt_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM run_attempts WHERE attempt_id=NEW.attempt_id AND run_id=NEW.run_id
)
BEGIN
 SELECT RAISE(ABORT, 'RUN_EVENT_ATTEMPT_LINEAGE_MISMATCH');
END;
` };
