/**
 * INPUT: T4 delegation lineage through migration 062 and immutable prior execution evidence
 * OUTPUT: additive work intervals, actual model-step witnesses and check-in sidecars
 * POS: core/db/migrations — no event backfill, historical count reconstruction, wake or effect replay
 */
import type { Migration } from "../migration-runner.ts";

export const subagentProgressMigration063: Migration = { version: 63, sql: `
CREATE TABLE subagent_work_progress (
 work_input_id TEXT PRIMARY KEY REFERENCES subagent_inputs(input_id),
 completed_steps INTEGER NOT NULL DEFAULT 0 CHECK(completed_steps>=0),
 interval_start_steps INTEGER NOT NULL DEFAULT 0 CHECK(interval_start_steps>=0),
 interval_steps INTEGER NOT NULL CHECK(interval_steps>0), parent_approval_limit INTEGER NOT NULL CHECK(parent_approval_limit>=0),
 consecutive_parent_approvals INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_parent_approvals>=0),
 tracking TEXT NOT NULL CHECK(tracking IN ('work_start','post_upgrade')),
 last_user_input_id TEXT REFERENCES subagent_inputs(input_id)
) STRICT;
CREATE TABLE subagent_task_steps (
 model_effect_id TEXT PRIMARY KEY REFERENCES run_effects(effect_id) DEFERRABLE INITIALLY DEFERRED,
 work_input_id TEXT NOT NULL REFERENCES subagent_work_progress(work_input_id),
 run_id TEXT NOT NULL REFERENCES runs(run_id), attempt_id TEXT NOT NULL REFERENCES run_attempts(attempt_id),
 step_number INTEGER NOT NULL CHECK(step_number>=0), completed_ordinal INTEGER,
 UNIQUE(work_input_id,completed_ordinal)
) STRICT;
CREATE UNIQUE INDEX subagent_completed_step_identity ON subagent_task_steps(run_id,attempt_id,step_number) WHERE completed_ordinal IS NOT NULL;
CREATE TABLE subagent_checkins (
 event_id TEXT PRIMARY KEY REFERENCES subagent_input_waits(event_id),
 work_input_id TEXT NOT NULL REFERENCES subagent_work_progress(work_input_id),
 interval_start_steps INTEGER NOT NULL, completed_steps INTEGER NOT NULL,
 model_effect_id TEXT NOT NULL REFERENCES subagent_task_steps(model_effect_id),
 checkin_json TEXT NOT NULL, UNIQUE(work_input_id,interval_start_steps)
) STRICT;
CREATE TRIGGER subagent_checkin_immutable BEFORE UPDATE ON subagent_checkins
 BEGIN SELECT RAISE(ABORT,'SUBAGENT_CHECKIN_IMMUTABLE'); END;
CREATE TABLE subagent_user_attention (
 event_id TEXT PRIMARY KEY REFERENCES subagent_events(event_id), resolved_input_id TEXT REFERENCES subagent_inputs(input_id)
) STRICT;
INSERT INTO subagent_user_attention(event_id)
 SELECT event_id FROM subagent_event_actions WHERE json_extract(action_json,'$.kind')='needs_user_input';
CREATE TABLE subagent_inbox_retry_failures (
 character_id TEXT PRIMARY KEY, failed_at TEXT NOT NULL
) STRICT;
` };
