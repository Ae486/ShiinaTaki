/**
 * INPUT: complete canonical T4 068 delegation definitions, without application rows
 * OUTPUT: frozen schema signatures and CREATE-only DDL for additive migration 069
 * POS: core/db/migrations — exact historical compatibility; never replays older migrations or their data writes
 */
import type { MigrationSchemaObject } from "../migration-runner.ts";

export const delegationAnchors069: readonly MigrationSchemaObject[] = [
  { type: "table", name: "subagent_inputs", sql: `CREATE TABLE subagent_inputs (
 input_id TEXT PRIMARY KEY,
 subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id) ON DELETE CASCADE,
 input_seq INTEGER NOT NULL CHECK(input_seq>0),
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id) ON DELETE CASCADE,
 work_seq INTEGER NOT NULL CHECK(work_seq>0),
 operation_key TEXT NOT NULL,
 request_digest TEXT NOT NULL,
 input_kind TEXT NOT NULL CHECK(input_kind IN ('work','message','continue')),
 sender_kind TEXT NOT NULL CHECK(sender_kind IN ('parent','user','core')),
 sender_run_id TEXT REFERENCES runs(run_id),
 sender_owner_ref TEXT,
 direction_text TEXT NOT NULL,
 materials_json TEXT NOT NULL CHECK(json_valid(materials_json)),
 tool_selection_json TEXT CHECK(tool_selection_json IS NULL OR json_valid(tool_selection_json)),
 completion_policy TEXT NOT NULL CHECK(completion_policy IN ('record_only','request_parent')),
 work_expires_at TEXT,
 consumed_run_id TEXT REFERENCES runs(run_id),
 consumed_attempt_id TEXT REFERENCES run_attempts(attempt_id),
 consumed_step INTEGER CHECK(consumed_step>=0),
 consumed_effect_id TEXT REFERENCES run_effects(effect_id) DEFERRABLE INITIALLY DEFERRED,
 reply_acceptance_json TEXT CHECK(reply_acceptance_json IS NULL OR json_valid(reply_acceptance_json)),
 created_at TEXT NOT NULL, validity_json TEXT CHECK(validity_json IS NULL OR json_valid(validity_json)), reply_to_event_id TEXT,
 UNIQUE(subagent_id,input_seq), UNIQUE(work_input_id,work_seq), UNIQUE(subagent_id,operation_key),
 CHECK((input_kind='work' AND work_input_id=input_id AND work_seq=1)
   OR (input_kind<>'work' AND work_input_id<>input_id AND work_seq>1 AND tool_selection_json IS NULL AND reply_acceptance_json IS NULL)),
 CHECK((sender_kind='user' AND sender_run_id IS NULL AND sender_owner_ref IS NULL)
   OR (sender_kind='parent' AND sender_run_id IS NOT NULL AND sender_owner_ref IS NULL)
   OR (sender_kind='core' AND sender_run_id IS NULL AND sender_owner_ref IS NOT NULL)),
 CHECK((consumed_run_id IS NULL AND consumed_attempt_id IS NULL AND consumed_step IS NULL AND consumed_effect_id IS NULL)
   OR (consumed_run_id IS NOT NULL AND consumed_attempt_id IS NOT NULL AND consumed_step IS NOT NULL AND consumed_effect_id IS NOT NULL))
) STRICT;` },
  { type: "table", name: "subagent_executions", sql: `CREATE TABLE subagent_executions (
 run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
 subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id) ON DELETE CASCADE,
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id) ON DELETE CASCADE,
 trigger_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id),
 admission_digest TEXT NOT NULL,
 completion_policy TEXT NOT NULL CHECK(completion_policy IN ('record_only','request_parent')),
 through_work_seq INTEGER NOT NULL CHECK(through_work_seq>0),
 work_token_json TEXT NOT NULL CHECK(json_valid(work_token_json)),
 proposal_json TEXT CHECK(proposal_json IS NULL OR json_valid(proposal_json)),
 proposal_attempt_id TEXT REFERENCES run_attempts(attempt_id),
 proposal_digest TEXT,
 proposal_token_digest TEXT,
 terminal_messages_json TEXT CHECK(terminal_messages_json IS NULL OR json_valid(terminal_messages_json)),
 terminal_messages_attempt_id TEXT REFERENCES run_attempts(attempt_id),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
 result_digest TEXT,
 settled_at TEXT,
 completion_state TEXT NOT NULL CHECK(completion_state IN ('not_requested','pending','deferred','admitted','withheld')),
 completion_reason TEXT CHECK(completion_reason IN ('foreground_busy','source_unavailable','authority_unavailable','superseded','source_retired','expired')),
 parent_run_id TEXT UNIQUE REFERENCES runs(run_id),
 parent_admission_digest TEXT,
 parent_proposal_json TEXT CHECK(parent_proposal_json IS NULL OR json_valid(parent_proposal_json)),
 parent_proposal_attempt_id TEXT REFERENCES run_attempts(attempt_id),
 parent_proposal_digest TEXT,
 parent_terminal_messages_json TEXT CHECK(parent_terminal_messages_json IS NULL OR json_valid(parent_terminal_messages_json)),
 parent_terminal_messages_attempt_id TEXT REFERENCES run_attempts(attempt_id),
 parent_result_json TEXT CHECK(parent_result_json IS NULL OR json_valid(parent_result_json)),
 parent_result_digest TEXT,
 parent_settled_at TEXT,
 publication_json TEXT CHECK(publication_json IS NULL OR json_valid(publication_json)),
 CHECK((result_json IS NULL AND result_digest IS NULL AND settled_at IS NULL)
   OR (result_json IS NOT NULL AND result_digest IS NOT NULL AND settled_at IS NOT NULL)),
 CHECK((parent_result_json IS NULL AND parent_result_digest IS NULL AND parent_settled_at IS NULL)
   OR (parent_result_json IS NOT NULL AND parent_result_digest IS NOT NULL AND parent_settled_at IS NOT NULL)),
 CHECK(parent_run_id IS NULL OR completion_state='admitted')
) STRICT;` },
  { type: "index", name: "subagent_one_active_execution", sql: `CREATE UNIQUE INDEX subagent_one_active_execution ON subagent_executions(subagent_id) WHERE settled_at IS NULL;` },
  { type: "index", name: "subagent_completion_queue", sql: `CREATE INDEX subagent_completion_queue ON subagent_executions(completion_state,settled_at,run_id);` },
  { type: "index", name: "subagent_work_executions", sql: `CREATE INDEX subagent_work_executions ON subagent_executions(work_input_id,settled_at,run_id);` },
  { type: "table", name: "run_messages", sql: `CREATE TABLE run_messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
 attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id),
 step_number INTEGER NOT NULL CHECK(step_number>=0),
 message_index INTEGER NOT NULL CHECK(message_index>=0),
 entry_kind TEXT NOT NULL CHECK(entry_kind IN ('input','output','partial')),
 role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
 content TEXT NOT NULL,
 parts_json TEXT CHECK(parts_json IS NULL OR json_valid(parts_json)),
 source_context_json TEXT CHECK(source_context_json IS NULL OR json_valid(source_context_json)),
 input_id TEXT REFERENCES subagent_inputs(input_id) ON DELETE CASCADE,
 model_effect_id TEXT REFERENCES run_effects(effect_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
 model_input_digest TEXT,
 batch_digest TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK((entry_kind='input' AND input_id IS NOT NULL AND model_effect_id IS NOT NULL AND model_input_digest IS NOT NULL)
   OR (entry_kind<>'input' AND input_id IS NULL AND model_effect_id IS NULL AND model_input_digest IS NULL)),
 CHECK(entry_kind<>'partial' OR (role='assistant' AND parts_json IS NULL))
) STRICT;` },
  { type: "index", name: "run_message_output_identity", sql: `CREATE UNIQUE INDEX run_message_output_identity ON run_messages(run_id,attempt_id,step_number,entry_kind,message_index) WHERE entry_kind<>'input';` },
  { type: "index", name: "run_message_input_receipt", sql: `CREATE UNIQUE INDEX run_message_input_receipt ON run_messages(model_effect_id,input_id) WHERE entry_kind='input';` },
  { type: "index", name: "run_message_order", sql: `CREATE INDEX run_message_order ON run_messages(run_id,seq);` },
  { type: "trigger", name: "subagent_input_immutable", sql: `CREATE TRIGGER subagent_input_immutable BEFORE UPDATE OF input_id,subagent_id,input_seq,work_input_id,work_seq,operation_key,request_digest,input_kind,sender_kind,sender_run_id,sender_owner_ref,direction_text,materials_json,tool_selection_json,completion_policy,work_expires_at,created_at
 ON subagent_inputs BEGIN SELECT RAISE(ABORT,'SUBAGENT_INPUT_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_first_receipt_immutable", sql: `CREATE TRIGGER subagent_first_receipt_immutable BEFORE UPDATE OF consumed_run_id,consumed_attempt_id,consumed_step,consumed_effect_id
 ON subagent_inputs WHEN OLD.consumed_run_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'SUBAGENT_RECEIPT_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_reply_binding_immutable", sql: `CREATE TRIGGER subagent_reply_binding_immutable BEFORE UPDATE OF reply_acceptance_json
 ON subagent_inputs WHEN OLD.reply_acceptance_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'SUBAGENT_REPLY_BINDING_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_execution_identity_immutable", sql: `CREATE TRIGGER subagent_execution_identity_immutable BEFORE UPDATE OF run_id,subagent_id,work_input_id,trigger_input_id,admission_digest,completion_policy
 ON subagent_executions BEGIN SELECT RAISE(ABORT,'SUBAGENT_EXECUTION_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_parent_link_immutable", sql: `CREATE TRIGGER subagent_parent_link_immutable BEFORE UPDATE OF parent_run_id,parent_admission_digest
 ON subagent_executions WHEN OLD.parent_run_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'SUBAGENT_PARENT_LINK_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_child_result_immutable", sql: `CREATE TRIGGER subagent_child_result_immutable BEFORE UPDATE OF result_json,result_digest,settled_at
 ON subagent_executions WHEN OLD.settled_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'SUBAGENT_RESULT_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_parent_result_immutable", sql: `CREATE TRIGGER subagent_parent_result_immutable BEFORE UPDATE OF parent_result_json,parent_result_digest,parent_settled_at
 ON subagent_executions WHEN OLD.parent_settled_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'SUBAGENT_RESULT_IMMUTABLE'); END;` },
  { type: "trigger", name: "run_messages_immutable", sql: `CREATE TRIGGER run_messages_immutable BEFORE UPDATE ON run_messages BEGIN SELECT RAISE(ABORT,'RUN_MESSAGE_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_validity_immutable", sql: `CREATE TRIGGER subagent_validity_immutable BEFORE UPDATE OF validity_json,reply_to_event_id ON subagent_inputs
 BEGIN SELECT RAISE(ABORT,'SUBAGENT_INPUT_IMMUTABLE'); END;` },
  { type: "table", name: "subagent_events", sql: `CREATE TABLE subagent_events (
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
) STRICT;` },
  { type: "index", name: "subagent_event_fifo", sql: `CREATE INDEX subagent_event_fifo ON subagent_events(character_id,seq);` },
  { type: "trigger", name: "subagent_event_immutable", sql: `CREATE TRIGGER subagent_event_immutable BEFORE UPDATE ON subagent_events BEGIN SELECT RAISE(ABORT,'SUBAGENT_EVENT_IMMUTABLE'); END;` },
  { type: "table", name: "subagent_conversation_order", sql: `CREATE TABLE subagent_conversation_order (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id),
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('input','message','event','control')),
 source_id TEXT NOT NULL, created_at TEXT NOT NULL, historical_order INTEGER NOT NULL CHECK(historical_order IN (0,1)),
 UNIQUE(source_kind,source_id)
) STRICT;` },
  { type: "index", name: "subagent_conversation_page", sql: `CREATE INDEX subagent_conversation_page ON subagent_conversation_order(subagent_id,seq);` },
  { type: "trigger", name: "subagent_order_input", sql: `CREATE TRIGGER subagent_order_input AFTER INSERT ON subagent_inputs BEGIN
 INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 VALUES(NEW.subagent_id,NEW.work_input_id,'input',NEW.input_id,NEW.created_at,0); END;` },
  { type: "trigger", name: "subagent_order_message", sql: `CREATE TRIGGER subagent_order_message AFTER INSERT ON run_messages WHEN NEW.entry_kind<>'input' BEGIN
 INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 SELECT subagent_id,work_input_id,'message',CAST(NEW.seq AS TEXT),NEW.created_at,0 FROM subagent_executions WHERE run_id=NEW.run_id; END;` },
  { type: "trigger", name: "subagent_order_event", sql: `CREATE TRIGGER subagent_order_event AFTER INSERT ON subagent_events BEGIN
 INSERT INTO subagent_conversation_order(subagent_id,work_input_id,source_kind,source_id,created_at,historical_order)
 VALUES(NEW.subagent_id,NEW.work_input_id,'event',NEW.event_id,NEW.accepted_at,0); END;` },
  { type: "trigger", name: "subagent_order_immutable", sql: `CREATE TRIGGER subagent_order_immutable BEFORE UPDATE ON subagent_conversation_order BEGIN SELECT RAISE(ABORT,'SUBAGENT_ORDER_IMMUTABLE'); END;` },
];

export const delegationContextSchema069: readonly MigrationSchemaObject[] = [
  { type: "table", name: "subagent_speech_publications", sql: `CREATE TABLE subagent_speech_publications (
 event_id TEXT PRIMARY KEY REFERENCES subagent_event_actions(event_id), action_id TEXT NOT NULL,
 result_json TEXT NOT NULL CHECK(json_valid(result_json))
) STRICT;` },
  { type: "table", name: "subagent_context_summaries", sql: `CREATE TABLE subagent_context_summaries (
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id), revision INTEGER NOT NULL,
 subagent_id TEXT NOT NULL REFERENCES subagent_conversations(subagent_id), source_from_seq INTEGER NOT NULL,
 through_seq INTEGER NOT NULL, source_digest TEXT NOT NULL, summary_text TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(run_id), attempt_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(work_input_id,revision)
) STRICT;` },
  { type: "table", name: "subagent_context_summary_intents", sql: `CREATE TABLE subagent_context_summary_intents (
 effect_id TEXT PRIMARY KEY REFERENCES run_effects(effect_id) DEFERRABLE INITIALLY DEFERRED,
 work_input_id TEXT NOT NULL, revision INTEGER NOT NULL, source_digest TEXT NOT NULL, step_number INTEGER NOT NULL,
 FOREIGN KEY(work_input_id,revision) REFERENCES subagent_context_summaries(work_input_id,revision)
) STRICT;` },
  { type: "table", name: "subagent_context_summary_failures", sql: `CREATE TABLE subagent_context_summary_failures (
 work_input_id TEXT NOT NULL REFERENCES subagent_inputs(input_id), revision INTEGER NOT NULL,
 source_digest TEXT NOT NULL, code TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(work_input_id,revision,source_digest)
) STRICT;` },
  { type: "trigger", name: "subagent_summary_immutable", sql: `CREATE TRIGGER subagent_summary_immutable BEFORE UPDATE ON subagent_context_summaries BEGIN SELECT RAISE(ABORT,'SUBAGENT_SUMMARY_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_summary_intent_immutable", sql: `CREATE TRIGGER subagent_summary_intent_immutable BEFORE UPDATE ON subagent_context_summary_intents BEGIN SELECT RAISE(ABORT,'SUBAGENT_SUMMARY_INTENT_IMMUTABLE'); END;` },
  { type: "trigger", name: "subagent_summary_failure_immutable", sql: `CREATE TRIGGER subagent_summary_failure_immutable BEFORE UPDATE ON subagent_context_summary_failures BEGIN SELECT RAISE(ABORT,'SUBAGENT_SUMMARY_FAILURE_IMMUTABLE'); END;` },
  { type: "table", name: "subagent_tool_results", sql: `CREATE TABLE subagent_tool_results (
 run_id TEXT NOT NULL REFERENCES runs(run_id), attempt_id TEXT NOT NULL, step_number INTEGER NOT NULL,
 tool_call_id TEXT NOT NULL, tool_name TEXT NOT NULL, output_json TEXT NOT NULL, materials_json TEXT NOT NULL,
 PRIMARY KEY(run_id,attempt_id,step_number,tool_call_id)
) STRICT;` },
  { type: "trigger", name: "subagent_tool_result_immutable", sql: `CREATE TRIGGER subagent_tool_result_immutable BEFORE UPDATE ON subagent_tool_results BEGIN SELECT RAISE(ABORT,'SUBAGENT_TOOL_RESULT_IMMUTABLE'); END;` },
];

export const delegationFrontierSchema069: readonly MigrationSchemaObject[] = [
  { type: "table", name: "subagent_event_frontiers", sql: `CREATE TABLE subagent_event_frontiers (
 event_id TEXT PRIMARY KEY REFERENCES subagent_events(event_id), through_work_seq INTEGER CHECK(through_work_seq>0)
) STRICT;` },
  { type: "trigger", name: "subagent_event_frontier_immutable", sql: `CREATE TRIGGER subagent_event_frontier_immutable BEFORE UPDATE ON subagent_event_frontiers BEGIN SELECT RAISE(ABORT,'SUBAGENT_EVENT_FRONTIER_IMMUTABLE'); END;` },
];
