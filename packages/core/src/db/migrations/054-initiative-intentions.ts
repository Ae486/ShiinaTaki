/**
 * INPUT: existing primary source witnesses and the canonical Run ledger
 * OUTPUT: finite Intention state, immutable source-opportunity identities and exact claim bindings
 * POS: core/db/migrations — additive domain storage; no Memory authority or execution ledger
 */
import type { Migration } from "../migration-runner.ts";

export const initiativeIntentionsMigration054: Migration = { version: 54, sql: `
CREATE TABLE initiative_intentions (
 intention_id TEXT PRIMARY KEY CHECK(length(intention_id) BETWEEN 1 AND 200),
 character_id TEXT NOT NULL CHECK(length(character_id) BETWEEN 1 AND 200),
 source_key TEXT NOT NULL UNIQUE CHECK(length(source_key)=64),
 source_json TEXT NOT NULL CHECK(json_valid(source_json) AND length(source_json)<=4096),
 source_run_id TEXT NOT NULL REFERENCES runs(run_id),
 purpose TEXT CHECK(purpose IS NULL OR length(purpose) BETWEEN 1 AND 1000),
 reported_event_time TEXT CHECK(reported_event_time IS NULL OR length(reported_event_time) BETWEEN 1 AND 200),
 not_before TEXT NOT NULL,
 expires_at TEXT NOT NULL CHECK(expires_at>not_before),
 state TEXT NOT NULL CHECK(state IN ('active','claimed','terminal')),
 canonical_run_key TEXT CHECK(canonical_run_key IS NULL OR length(canonical_run_key) BETWEEN 1 AND 256),
 run_id TEXT REFERENCES runs(run_id),
 disposition TEXT CHECK(disposition IN ('silent','express','speak','completed','failed','cancelled','expired','source_invalidated','unknown')),
 created_at TEXT NOT NULL,
 terminal_at TEXT,
 CHECK((state='terminal' AND disposition IS NOT NULL AND terminal_at IS NOT NULL AND purpose IS NULL AND reported_event_time IS NULL)
   OR (state<>'terminal' AND disposition IS NULL AND terminal_at IS NULL AND purpose IS NOT NULL)),
 CHECK(state<>'claimed' OR canonical_run_key IS NOT NULL),
 CHECK(state<>'active' OR (canonical_run_key IS NULL AND run_id IS NULL)),
 CHECK(run_id IS NULL OR canonical_run_key IS NOT NULL)
) STRICT;
CREATE INDEX initiative_intentions_due ON initiative_intentions(character_id,state,not_before,expires_at);
CREATE INDEX initiative_intentions_expiry ON initiative_intentions(state,expires_at);
CREATE INDEX initiative_intentions_claim ON initiative_intentions(canonical_run_key);
CREATE TRIGGER initiative_intention_identity_immutable BEFORE UPDATE OF
 intention_id,character_id,source_key,source_json,source_run_id,not_before,expires_at,created_at ON initiative_intentions
 BEGIN SELECT RAISE(ABORT,'immutable Intention source opportunity'); END;
CREATE TRIGGER initiative_intention_terminal_immutable BEFORE UPDATE ON initiative_intentions
 WHEN OLD.state='terminal'
 BEGIN SELECT RAISE(ABORT,'terminal Intention cannot be rearmed'); END;
CREATE TRIGGER initiative_intention_source_scope BEFORE INSERT ON initiative_intentions
 WHEN NOT EXISTS(SELECT 1 FROM runs WHERE run_id=NEW.source_run_id
   AND character_id=NEW.character_id AND initiator='primary')
 BEGIN SELECT RAISE(ABORT,'foreign Intention source Run'); END;
CREATE TRIGGER initiative_intention_insert_run_scope BEFORE INSERT ON initiative_intentions
 WHEN NEW.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM runs
   WHERE run_id=NEW.run_id AND character_id=NEW.character_id AND initiator='heartbeat'
     AND idempotency_key=NEW.canonical_run_key)
 BEGIN SELECT RAISE(ABORT,'foreign Intention Run'); END;
CREATE TRIGGER initiative_intention_run_scope BEFORE UPDATE OF run_id ON initiative_intentions
 WHEN NEW.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM runs
   WHERE run_id=NEW.run_id AND character_id=NEW.character_id AND initiator='heartbeat'
     AND idempotency_key=NEW.canonical_run_key)
 BEGIN SELECT RAISE(ABORT,'foreign Intention Run'); END;
` };
