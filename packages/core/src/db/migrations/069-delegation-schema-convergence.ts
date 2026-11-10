/**
 * INPUT: exact early/current T4 058 context and 060 frontier groups after the 068 tail
 * OUTPUT: missing private delegation tables/guards and provable historical event frontiers
 * POS: core/db/migrations — additive compatibility only; no receipt rewrite, dispatch or Stop change
 */
import type { Migration } from "../migration-runner.ts";
import { delegationAnchors069, delegationContextSchema069, delegationFrontierSchema069 } from "./069-delegation-schema.ts";

// The old 060 ELSE cast also treated checkin/unknown keys as step zero. Only canonical
// interaction keys and an exact terminal result prove a boundary; other evidence stays unknown.
const frontierBackfill = `
INSERT INTO subagent_event_frontiers(event_id,through_work_seq)
WITH event_keys AS (
 SELECT event.*,substr(producer_key,13,instr(substr(producer_key,13),':')-1) AS step_text,
 substr(producer_key,13+instr(substr(producer_key,13),':')) AS call_id
 FROM subagent_events event
)
SELECT event.event_id,CASE
 WHEN event.producer_key='terminal' AND event.kind IN ('final','interrupted')
 AND execution.settled_at IS NOT NULL
 AND json_extract(execution.result_json,'$.runId')=event.producer_run_id
 AND json_extract(execution.result_json,'$.attemptId')=event.producer_attempt_id
 AND json_extract(execution.result_json,'$.subagentId')=event.subagent_id
 AND json_extract(execution.result_json,'$.workInputId')=event.work_input_id
 AND json_type(execution.result_json,'$.throughWorkSeq')='integer'
 AND json_extract(execution.result_json,'$.throughWorkSeq') BETWEEN 1 AND 9007199254740991
 THEN json_extract(execution.result_json,'$.throughWorkSeq')
 WHEN execution.run_id IS NOT NULL AND event.kind IN ('message','needs_input')
 AND substr(event.producer_key,1,12)='interaction:'
 AND instr(substr(event.producer_key,13),':')>1 AND length(event.call_id)>0
 AND event.step_text NOT GLOB '*[^0-9]*'
 AND CAST(CAST(event.step_text AS INTEGER) AS TEXT)=event.step_text
 AND CAST(event.step_text AS INTEGER) BETWEEN 0 AND 9007199254740991
 THEN (SELECT max(input.work_seq) FROM run_messages message JOIN subagent_inputs input ON input.input_id=message.input_id
 WHERE message.run_id=event.producer_run_id AND message.attempt_id=event.producer_attempt_id
 AND message.entry_kind='input' AND message.step_number<=CAST(event.step_text AS INTEGER)
 AND input.work_input_id=event.work_input_id AND input.subagent_id=event.subagent_id)
 ELSE NULL END
FROM event_keys event LEFT JOIN subagent_executions execution ON execution.run_id=event.producer_run_id
 AND execution.subagent_id=event.subagent_id AND execution.work_input_id=event.work_input_id;
`;

export const delegationSchemaConvergenceMigration069: Migration = {
  version: 69,
  sql: "SELECT 1;",
  schemaBranches: [
    { name: "early-058-early-060", context: false, frontier: false },
    { name: "early-058-current-060", context: false, frontier: true },
    { name: "current-058-early-060", context: true, frontier: false },
    { name: "current-058-current-060", context: true, frontier: true },
  ].map(({ name, context, frontier }) => ({
    name,
    schema: [...delegationAnchors069, ...context ? delegationContextSchema069 : [], ...frontier ? delegationFrontierSchema069 : []],
    absentObjects: [...context ? [] : delegationContextSchema069.map(({ name: object }) => object),
      ...frontier ? [] : delegationFrontierSchema069.map(({ name: object }) => object)],
    sql: [...context ? [] : delegationContextSchema069.map(({ sql }) => sql),
      ...frontier ? [] : [...delegationFrontierSchema069.map(({ sql }) => sql), frontierBackfill], "SELECT 1;"].join("\n"),
  })),
};
