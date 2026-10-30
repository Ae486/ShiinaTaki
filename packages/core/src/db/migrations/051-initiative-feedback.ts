/**
 * INPUT: migration 050 delivery and ordinary Timeline identity
 * OUTPUT: additive once-only presentation and bounded response-opportunity state
 * POS: core/db/migrations — durable facts only; live source leases never survive restart
 */
import type { Migration } from "../migration-runner.ts";

export const initiativeFeedbackMigration051: Migration = { version: 51, sql: `
CREATE TABLE delivery_presentations (
 delivery_id TEXT PRIMARY KEY REFERENCES run_deliveries(delivery_id),
 presented_at TEXT NOT NULL
) STRICT;
CREATE TABLE initiative_feedback (
 delivery_id TEXT PRIMARY KEY REFERENCES run_deliveries(delivery_id),
 timeline_seq INTEGER NOT NULL UNIQUE REFERENCES timeline_messages(seq),
 character_id TEXT NOT NULL,
 published_at TEXT NOT NULL,
 deadline_at TEXT NOT NULL CHECK(deadline_at > published_at),
 opportunity_ms INTEGER NOT NULL DEFAULT 0 CHECK(opportunity_ms BETWEEN 0 AND 120000),
 intervals_json TEXT NOT NULL DEFAULT '[]' CHECK(length(intervals_json) <= 16384 AND json_valid(intervals_json)),
 disposition TEXT CHECK(disposition IN ('engaged','weak_non_engagement','unknown')),
 settled_at TEXT,
 CHECK((disposition IS NULL AND settled_at IS NULL) OR (disposition IS NOT NULL AND settled_at IS NOT NULL))
) STRICT;
CREATE INDEX initiative_feedback_pending ON initiative_feedback(deadline_at) WHERE disposition IS NULL;
CREATE INDEX initiative_feedback_character ON initiative_feedback(character_id,published_at);
CREATE INDEX run_deliveries_feedback ON run_deliveries(delivery_class,charged_at,timeline_seq);
` };
