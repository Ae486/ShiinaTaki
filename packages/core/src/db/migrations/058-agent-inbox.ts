/**
 * INPUT: exact historical 056 private schema and immutable Run/Effect evidence
 * OUTPUT: continuing work validity, accepted events and real inbox consumer/action associations
 * POS: core/db/migrations — forward-only guarded T4 migration; no dispatch or historical effect replay
 */
import type { Migration, MigrationSchemaObject } from "../migration-runner.ts";
import { subagentConversationsMigration056 } from "./056-subagent-conversations.ts";

const replaced = ["subagent_inputs", "subagent_executions", "run_messages"];
const historical = subagentConversationsMigration056.sql.trim().split(/\n(?=CREATE )/);
const owned = historical.filter((sql) => {
  const table = sql.match(/^CREATE TABLE (\w+)/)?.[1]
    ?? sql.match(/\bON\s+(\w+)/)?.[1];
  return table !== undefined && replaced.includes(table);
});
const schema: MigrationSchemaObject[] = owned.map((sql) => {
  const match = sql.match(/^CREATE (TABLE|(?:UNIQUE )?INDEX|TRIGGER) (\w+)/);
  if (!match?.[1] || !match[2]) throw new Error("INVALID_HISTORICAL_SUBAGENT_SCHEMA");
  return { type: match[1] === "TABLE" ? "table" : match[1] === "TRIGGER" ? "trigger" : "index", name: match[2], sql };
});
const recreated = owned.join("\n").replace("work_expires_at TEXT NOT NULL", "work_expires_at TEXT");

export const agentInboxMigration058: Migration = {
  version: 58,
  schemaBranches: [{ name: "t4-private-056", schema, replacedTables: replaced,
    absentObjects: ["subagent_events", "subagent_inbox_consumers", "subagent_input_waits"],
    sql: `
CREATE TEMP TABLE inbox_old_inputs AS SELECT * FROM subagent_inputs;
CREATE TEMP TABLE inbox_old_executions AS SELECT * FROM subagent_executions;
CREATE TEMP TABLE inbox_old_messages AS SELECT * FROM run_messages;
CREATE TEMP TABLE inbox_old_sequence AS SELECT seq FROM sqlite_sequence WHERE name='run_messages';
DROP TABLE run_messages;
DROP TABLE subagent_executions;
DROP TABLE subagent_inputs;
${recreated}
INSERT INTO subagent_inputs SELECT * FROM inbox_old_inputs ORDER BY input_seq;
INSERT INTO subagent_executions SELECT * FROM inbox_old_executions;
INSERT INTO run_messages SELECT * FROM inbox_old_messages ORDER BY seq;
UPDATE sqlite_sequence SET seq=max(seq,COALESCE((SELECT seq FROM inbox_old_sequence),0)) WHERE name='run_messages';
INSERT INTO sqlite_sequence(name,seq) SELECT 'run_messages',seq FROM inbox_old_sequence
 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='run_messages');
DROP TABLE inbox_old_messages;
DROP TABLE inbox_old_executions;
DROP TABLE inbox_old_inputs;
DROP TABLE inbox_old_sequence;
` }],
  sql: `
ALTER TABLE subagent_inputs ADD COLUMN validity_json TEXT CHECK(validity_json IS NULL OR json_valid(validity_json));
ALTER TABLE subagent_inputs ADD COLUMN reply_to_event_id TEXT;
UPDATE subagent_inputs SET validity_json=CASE WHEN sender_kind='core' OR EXISTS (
 SELECT 1 FROM subagent_executions e WHERE e.work_input_id=subagent_inputs.work_input_id
 AND json_type(e.work_token_json,'$.source')='object')
 THEN json_object('kind','expires_at','expiresAt',work_expires_at)
 ELSE json_object('kind','until_cancelled') END;
CREATE TRIGGER subagent_validity_immutable BEFORE UPDATE OF validity_json,reply_to_event_id ON subagent_inputs
 BEGIN SELECT RAISE(ABORT,'SUBAGENT_INPUT_IMMUTABLE'); END;
CREATE TABLE subagent_work_routes (
 work_input_id TEXT PRIMARY KEY REFERENCES subagent_inputs(input_id),
 parent_run_id TEXT NOT NULL REFERENCES runs(run_id),
 route_kind TEXT NOT NULL CHECK(route_kind IN ('generic','source_owned')),
 parent_tools_json TEXT CHECK(parent_tools_json IS NULL OR json_valid(parent_tools_json))
) STRICT;
INSERT INTO subagent_work_routes SELECT i.input_id,c.created_by_run_id,
 CASE WHEN json_extract(i.validity_json,'$.kind')='expires_at' THEN 'source_owned' ELSE 'generic' END,NULL
 FROM subagent_inputs i JOIN subagent_conversations c USING(subagent_id) WHERE i.input_kind='work';
CREATE TRIGGER subagent_route_immutable BEFORE UPDATE ON subagent_work_routes BEGIN SELECT RAISE(ABORT,'SUBAGENT_ROUTE_IMMUTABLE'); END;
CREATE TABLE subagent_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 event_id TEXT NOT NULL UNIQUE,
 character_id TEXT NOT NULL,
 subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id),
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id),
 kind TEXT NOT NULL CHECK(kind IN ('message','needs_input','final','interrupted')),
 producer_run_id TEXT NOT NULL REFERENCES runs(run_id),
 producer_attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id),
 producer_key TEXT NOT NULL,
 body TEXT,
 body_digest TEXT NOT NULL,
 source_context_json TEXT NOT NULL CHECK(json_valid(source_context_json)),
 eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 suppression_reason TEXT,
 accepted_at TEXT NOT NULL,
 UNIQUE(producer_run_id,producer_attempt_id,producer_key),
 CHECK((eligible=1 AND suppression_reason IS NULL) OR (eligible=0 AND suppression_reason IS NOT NULL))
) STRICT;
CREATE INDEX subagent_event_fifo ON subagent_events(character_id,seq);
CREATE TRIGGER subagent_event_immutable BEFORE UPDATE ON subagent_events BEGIN SELECT RAISE(ABORT,'SUBAGENT_EVENT_IMMUTABLE'); END;
CREATE TABLE subagent_input_waits (
 event_id TEXT PRIMARY KEY REFERENCES subagent_events(event_id),
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id),
 state TEXT NOT NULL CHECK(state IN ('open','answered')),
 answer_input_id TEXT UNIQUE REFERENCES subagent_inputs(input_id),
 CHECK((state='open' AND answer_input_id IS NULL) OR (state='answered' AND answer_input_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX subagent_one_open_wait ON subagent_input_waits(work_input_id) WHERE state='open';
CREATE TRIGGER subagent_answer_immutable BEFORE UPDATE ON subagent_input_waits WHEN OLD.state='answered'
 BEGIN SELECT RAISE(ABORT,'SUBAGENT_ANSWER_IMMUTABLE'); END;
CREATE TABLE subagent_inbox_consumers (
 consumer_id TEXT PRIMARY KEY,
 character_id TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(run_id),
 attempt_id TEXT NOT NULL UNIQUE REFERENCES run_attempts(attempt_id),
 mode TEXT NOT NULL CHECK(mode IN ('foreground','idle')),
 state TEXT NOT NULL CHECK(state IN ('claimed','delivered','reconciliation_needed','settled','released')),
 projection_json TEXT NOT NULL CHECK(json_valid(projection_json)),
 projection_digest TEXT NOT NULL,
 terminal_messages_json TEXT CHECK(terminal_messages_json IS NULL OR json_valid(terminal_messages_json)),
 created_at TEXT NOT NULL,
 settled_at TEXT
) STRICT;
CREATE TABLE subagent_inbox_members (
 consumer_id TEXT NOT NULL REFERENCES subagent_inbox_consumers(consumer_id),
 event_id TEXT NOT NULL REFERENCES subagent_events(event_id),
 event_digest TEXT NOT NULL,
 PRIMARY KEY(consumer_id,event_id)
) STRICT;
CREATE TABLE subagent_inbox_deliveries (
 consumer_id TEXT NOT NULL REFERENCES subagent_inbox_consumers(consumer_id),
 model_effect_id TEXT NOT NULL REFERENCES run_effects(effect_id) DEFERRABLE INITIALLY DEFERRED,
 model_input_digest TEXT NOT NULL,
 step_number INTEGER NOT NULL CHECK(step_number>=0),
 projection_digest TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(consumer_id,model_effect_id)
) STRICT;
CREATE TABLE subagent_event_actions (
 event_id TEXT PRIMARY KEY REFERENCES subagent_events(event_id),
 operation_key TEXT NOT NULL,
 consumer_id TEXT NOT NULL REFERENCES subagent_inbox_consumers(consumer_id),
 model_effect_id TEXT NOT NULL REFERENCES run_effects(effect_id),
 invocation_id TEXT NOT NULL,
 tool_call_id TEXT NOT NULL,
 action_json TEXT NOT NULL CHECK(json_valid(action_json)),
 action_digest TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at TEXT NOT NULL,
 UNIQUE(consumer_id,operation_key)
) STRICT;
CREATE TRIGGER subagent_consumer_identity_immutable BEFORE UPDATE OF consumer_id,character_id,run_id,attempt_id,mode,projection_json,projection_digest,created_at
 ON subagent_inbox_consumers BEGIN SELECT RAISE(ABORT,'SUBAGENT_CONSUMER_IMMUTABLE'); END;
CREATE TRIGGER subagent_member_immutable BEFORE UPDATE ON subagent_inbox_members BEGIN SELECT RAISE(ABORT,'SUBAGENT_MEMBER_IMMUTABLE'); END;
CREATE TRIGGER subagent_delivery_immutable BEFORE UPDATE ON subagent_inbox_deliveries BEGIN SELECT RAISE(ABORT,'SUBAGENT_DELIVERY_IMMUTABLE'); END;
CREATE TRIGGER subagent_action_immutable BEFORE UPDATE ON subagent_event_actions BEGIN SELECT RAISE(ABORT,'SUBAGENT_ACTION_IMMUTABLE'); END;
CREATE TABLE subagent_speech_publications (
 event_id TEXT PRIMARY KEY REFERENCES subagent_event_actions(event_id), action_id TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json))
) STRICT;
CREATE TABLE subagent_context_summaries (
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id), revision INTEGER NOT NULL,
 subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id), source_from_seq INTEGER NOT NULL,
 through_seq INTEGER NOT NULL, source_digest TEXT NOT NULL, summary_text TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(run_id), attempt_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(work_input_id,revision)
) STRICT;
CREATE TABLE subagent_context_summary_intents (
 effect_id TEXT PRIMARY KEY REFERENCES run_effects(effect_id) DEFERRABLE INITIALLY DEFERRED,
 work_input_id TEXT NOT NULL, revision INTEGER NOT NULL, source_digest TEXT NOT NULL, step_number INTEGER NOT NULL,
 FOREIGN KEY(work_input_id,revision) REFERENCES subagent_context_summaries(work_input_id,revision)
) STRICT;
CREATE TABLE subagent_context_summary_failures (
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id), revision INTEGER NOT NULL,
 source_digest TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(work_input_id,revision,source_digest)
) STRICT;
CREATE TRIGGER subagent_summary_immutable BEFORE UPDATE ON subagent_context_summaries BEGIN SELECT RAISE(ABORT,'SUBAGENT_SUMMARY_IMMUTABLE'); END;
CREATE TRIGGER subagent_summary_intent_immutable BEFORE UPDATE ON subagent_context_summary_intents BEGIN SELECT RAISE(ABORT,'SUBAGENT_SUMMARY_INTENT_IMMUTABLE'); END;
CREATE TRIGGER subagent_summary_failure_immutable BEFORE UPDATE ON subagent_context_summary_failures BEGIN SELECT RAISE(ABORT,'SUBAGENT_SUMMARY_FAILURE_IMMUTABLE'); END;
CREATE TABLE subagent_tool_results (
 run_id TEXT NOT NULL REFERENCES runs(run_id), attempt_id TEXT NOT NULL, step_number INTEGER NOT NULL,
 tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, output_json TEXT NOT NULL, materials_json TEXT NOT NULL,
 PRIMARY KEY(run_id,attempt_id,step_number,tool_call_id)
) STRICT;
CREATE TRIGGER subagent_tool_result_immutable BEFORE UPDATE ON subagent_tool_results BEGIN SELECT RAISE(ABORT,'SUBAGENT_TOOL_RESULT_IMMUTABLE'); END;
INSERT INTO subagent_events(event_id,character_id,subagent_id,work_input_id,kind,producer_run_id,producer_attempt_id,producer_key,
 body,body_digest,source_context_json,eligible,suppression_reason,accepted_at)
 SELECT 'legacy:'||e.run_id,c.character_id,e.subagent_id,e.work_input_id,
 CASE WHEN json_extract(e.result_json,'$.outputKind')='validated' THEN 'final' ELSE 'interrupted' END,
 e.run_id,json_extract(e.result_json,'$.attemptId'),'terminal',json_extract(e.result_json,'$.body'),e.result_digest,
 COALESCE(json_extract(e.result_json,'$.sourceContext'),'{}'),1,NULL,e.settled_at
 FROM subagent_executions e JOIN subagent_conversations c USING(subagent_id)
 WHERE e.completion_policy='request_parent' AND e.completion_state IN ('pending','deferred')
 AND e.parent_run_id IS NULL AND e.settled_at IS NOT NULL AND c.stop_origin IS NOT 'user'
 ORDER BY e.settled_at,e.run_id;
`,
};
