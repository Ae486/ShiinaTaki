/** Backfill immutable Character ownership for occurrences without mutating migration 029. */
import type { Migration } from "../migration-runner.ts";
export const scheduledOccurrenceCharacterMigration030: Migration = { version: 30, sql: `
  ALTER TABLE schedule_occurrences ADD COLUMN character_id TEXT NOT NULL DEFAULT '';
  UPDATE schedule_occurrences
  SET character_id = (SELECT character_id FROM scheduled_tasks WHERE scheduled_tasks.task_id = schedule_occurrences.task_id)
  WHERE character_id = '';
  CREATE INDEX IF NOT EXISTS schedule_occurrences_character_idx ON schedule_occurrences(character_id, state, updated_at);
` };
