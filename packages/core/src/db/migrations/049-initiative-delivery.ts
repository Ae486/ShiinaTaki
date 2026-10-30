/** Additive delivery, bounded policy facts and existing User Timezone authority metadata. */
import type { Migration } from "../migration-runner.ts";
export const initiativeDeliveryMigration049: Migration = { version: 49, sql: `
CREATE TABLE run_deliveries (
 delivery_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
 attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id), character_id TEXT NOT NULL,
 delivery_class TEXT NOT NULL CHECK(delivery_class IN ('class_a','class_b')),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0), decision_json TEXT NOT NULL,
 expires_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN
 ('staged','held','dispatch_committed','sent','unknown','no_target','expired','suppressed')),
 continuation TEXT NOT NULL CHECK(continuation IN ('none','pending','waiting','running','completed','failed','unknown','expired')),
 primary_version INTEGER NOT NULL CHECK(primary_version >= 0), timeline_seq INTEGER UNIQUE REFERENCES timeline_messages(seq),
 charged_at TEXT, charge_timezone TEXT, created_at TEXT NOT NULL
) STRICT;
CREATE INDEX run_deliveries_budget ON run_deliveries(delivery_class,charged_at);
CREATE UNIQUE INDEX run_deliveries_one_held ON run_deliveries(character_id) WHERE state='held';
CREATE TABLE initiative_policy_facts (
 seq INTEGER PRIMARY KEY, character_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(reason IN
 ('disabled','busy','stale','expired','suppressed','budget','gap','accepted')), occurred_at TEXT NOT NULL
) STRICT;
CREATE INDEX initiative_policy_recent ON initiative_policy_facts(character_id,seq);
ALTER TABLE user_timezone ADD COLUMN mode TEXT NOT NULL DEFAULT 'fixed' CHECK(mode IN ('fixed','follow-primary-device'));
ALTER TABLE user_timezone ADD COLUMN authority_device_id TEXT;
ALTER TABLE user_timezone ADD COLUMN confirmed_at TEXT;
ALTER TABLE user_timezone ADD COLUMN source TEXT NOT NULL DEFAULT 'bootstrap' CHECK(source IN ('bootstrap','operator','device'));
ALTER TABLE user_timezone ADD COLUMN source_device_id TEXT;
` };
