/**
 * INPUT: previously exercised T4 inbox 058 and canonical private source rows
 * OUTPUT: immutable conversation commit ordering, control history and public-text witnesses
 * POS: core/db/migrations — additive T4 continuation; no rewrite of applied 058 or automatic execution
 */
import type { Migration } from "../migration-runner.ts";

export const agentConversationOrderMigration060: Migration = {
  version: 60,
  sql: `
CREATE TABLE subagent_controls (
 control_id TEXT PRIMARY KEY, subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id),
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id), origin TEXT NOT NULL CHECK(origin IN ('user','parent')),
 action TEXT NOT NULL CHECK(action='stop'), control_version INTEGER NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE subagent_conversation_order (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id),
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('input','message','event','control')),
 source_id TEXT NOT NULL, created_at TEXT NOT NULL, historical_order INTEGER NOT NULL CHECK(historical_order IN (0,1)),
 UNIQUE(source_kind,source_id)
) STRICT;
CREATE INDEX subagent_conversation_page ON subagent_conversation_order(subagent_id,seq);
INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 SELECT subagent_id,work_input_id,kind,id,at,1 FROM (
 SELECT subagent_id,work_input_id,'input' AS kind,input_id AS id,created_at AS at FROM subagent_inputs
 UNION ALL SELECT e.subagent_id,e.work_input_id,'message',CAST(m.seq AS TEXT),m.created_at
 FROM run_messages m JOIN subagent_executions e ON e.run_id=m.run_id WHERE m.entry_kind<>'input'
 UNION ALL SELECT subagent_id,work_input_id,'event',event_id,accepted_at FROM subagent_events
 ) ORDER BY at,kind,id;
CREATE TRIGGER subagent_order_input AFTER INSERT ON subagent_inputs BEGIN
 INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 VALUES(NEW.subagent_id,NEW.work_input_id,'input',NEW.input_id,NEW.created_at,0); END;
CREATE TRIGGER subagent_order_message AFTER INSERT ON run_messages WHEN NEW.entry_kind<>'input' BEGIN
 INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 SELECT subagent_id,work_input_id,'message',CAST(NEW.seq AS TEXT),NEW.created_at,0 FROM subagent_executions WHERE run_id=NEW.run_id; END;
CREATE TRIGGER subagent_order_event AFTER INSERT ON subagent_events BEGIN
 INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 VALUES(NEW.subagent_id,NEW.work_input_id,'event',NEW.event_id,NEW.accepted_at,0); END;
CREATE TRIGGER subagent_order_control AFTER INSERT ON subagent_controls BEGIN
 INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 VALUES(NEW.subagent_id,NEW.work_input_id,'control',NEW.control_id,NEW.created_at,0); END;
CREATE TRIGGER subagent_order_immutable BEFORE UPDATE ON subagent_conversation_order BEGIN SELECT RAISE(ABORT,'SUBAGENT_ORDER_IMMUTABLE'); END;
CREATE TRIGGER subagent_control_immutable BEFORE UPDATE ON subagent_controls BEGIN SELECT RAISE(ABORT,'SUBAGENT_CONTROL_IMMUTABLE'); END;
CREATE TABLE subagent_primary_speech (
 consumer_id TEXT NOT NULL REFERENCES subagent_inbox_consumers(consumer_id),
 timeline_id TEXT NOT NULL REFERENCES timeline_messages(id), text_digest TEXT NOT NULL,
 PRIMARY KEY(consumer_id,timeline_id)
) STRICT;
CREATE TRIGGER subagent_primary_speech_immutable BEFORE UPDATE ON subagent_primary_speech BEGIN SELECT RAISE(ABORT,'SUBAGENT_SPEECH_IMMUTABLE'); END;
CREATE TABLE subagent_event_frontiers (
 event_id TEXT PRIMARY KEY REFERENCES subagent_events(event_id), through_work_seq INTEGER CHECK(through_work_seq>0)
) STRICT;
INSERT INTO subagent_event_frontiers(event_id,through_work_seq)
 SELECT event.event_id,CASE WHEN event.producer_key='terminal' THEN json_extract(e.result_json,'$.throughWorkSeq')
 ELSE (SELECT max(i.work_seq) FROM run_messages m JOIN subagent_inputs i ON i.input_id=m.input_id
 WHERE m.run_id=event.producer_run_id AND m.attempt_id=event.producer_attempt_id AND m.entry_kind='input'
 AND m.step_number<=CAST(substr(event.producer_key,13,instr(substr(event.producer_key,13),':')-1) AS INTEGER)) END
 FROM subagent_events event JOIN subagent_executions e ON e.run_id=event.producer_run_id;
CREATE TRIGGER subagent_event_frontier_immutable BEFORE UPDATE ON subagent_event_frontiers BEGIN SELECT RAISE(ABORT,'SUBAGENT_EVENT_FRONTIER_IMMUTABLE'); END;
`,
};
