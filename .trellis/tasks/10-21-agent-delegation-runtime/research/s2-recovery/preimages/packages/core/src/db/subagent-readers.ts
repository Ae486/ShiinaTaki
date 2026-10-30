/**
 * INPUT: canonical delegation SQLite rows
 * OUTPUT: validated private conversation/input/result projections and exact ownership reads
 * POS: core/db — shared read boundary for delegation repositories, without lifecycle mutation
 */
import { SubagentConversationSchema, SubagentInputSchema, SubagentResultGroupSchema, SubagentExecutionSchema, type SubagentExecution,
  type SubagentConversation, type SubagentInput, type SubagentResultGroup } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";

export function readSubagent(db: Database, subagentId: string): SubagentConversation {
  const row = db.prepare("SELECT * FROM subagent_conversations WHERE subagent_id=:subagentId").get({ subagentId });
  if (!row) throw new Error("SUBAGENT_NOT_FOUND");
  return SubagentConversationSchema.parse({ subagentId: row.subagent_id, characterId: row.character_id,
    createdByRunId: row.created_by_run_id, label: row.label, createdAt: row.created_at,
    initialContext: JSON.parse(String(row.initial_context_json)), initialContextDigest: row.initial_context_digest,
    stopOrigin: row.stop_origin, controlVersion: row.control_version, nextInputSeq: row.next_input_seq, activeRunId: row.active_run_id });
}

export function readSubagentInput(db: Database, inputId: string): SubagentInput {
  const row = db.prepare("SELECT * FROM subagent_inputs WHERE input_id=:inputId").get({ inputId });
  if (!row) throw new Error("SUBAGENT_INPUT_NOT_FOUND");
  return mapSubagentInput(row);
}

export function mapSubagentInput(row: SqlRow): SubagentInput {
  const sender = row.sender_kind === "parent" ? { kind: "parent", runId: row.sender_run_id }
    : row.sender_kind === "core" ? { kind: "core", ownerRef: row.sender_owner_ref } : { kind: "user" };
  return SubagentInputSchema.parse({ inputId: row.input_id, subagentId: row.subagent_id, inputSeq: row.input_seq,
    workInputId: row.work_input_id, workSeq: row.work_seq, operationKey: row.operation_key, requestDigest: row.request_digest,
    kind: row.input_kind, sender, direction: row.direction_text, materials: JSON.parse(String(row.materials_json)),
    toolSelection: row.tool_selection_json === null ? null : JSON.parse(String(row.tool_selection_json)),
    createdAt: row.created_at, completionPolicy: row.completion_policy, workExpiresAt: row.work_expires_at,
    consumed: row.consumed_run_id === null ? null : { runId: row.consumed_run_id, attemptId: row.consumed_attempt_id,
      step: row.consumed_step, effectId: row.consumed_effect_id },
    replyAcceptance: row.reply_acceptance_json === null ? null : JSON.parse(String(row.reply_acceptance_json)),
  });
}

export function readSubagentExecution(db: Database, runId: string): SqlRow {
  const row = db.prepare("SELECT * FROM subagent_executions WHERE run_id=:runId").get({ runId });
  if (!row) throw new Error("SUBAGENT_EXECUTION_NOT_FOUND");
  return row;
}

export function projectSubagentExecution(row: SqlRow): SubagentExecution {
  const json = (key: string): unknown => row[key] === null ? null : JSON.parse(String(row[key]));
  return SubagentExecutionSchema.parse({ runId: row.run_id, subagentId: row.subagent_id, workInputId: row.work_input_id,
    triggerInputId: row.trigger_input_id, completionPolicy: row.completion_policy, throughWorkSeq: row.through_work_seq,
    workToken: json("work_token_json"), proposal: json("proposal_json"), proposalAttemptId: row.proposal_attempt_id,
    proposalDigest: row.proposal_digest, proposalTokenDigest: row.proposal_token_digest,
    result: json("result_json"), resultDigest: row.result_digest, settledAt: row.settled_at,
    completionState: row.completion_state, completionReason: row.completion_reason, parentRunId: row.parent_run_id,
    parentProposal: json("parent_proposal_json"), parentProposalAttemptId: row.parent_proposal_attempt_id,
    parentProposalDigest: row.parent_proposal_digest, parentResult: json("parent_result_json"), parentResultDigest: row.parent_result_digest,
    parentSettledAt: row.parent_settled_at, publication: json("publication_json") });
}

export function readSubagentResult(db: Database, runId: string): SubagentResultGroup | null {
  const row = readSubagentExecution(db, runId);
  if (row.result_json === null) return null;
  return SubagentResultGroupSchema.parse({ completionId: row.run_id, child: JSON.parse(String(row.result_json)),
    childDigest: row.result_digest, completionState: row.completion_state, completionReason: row.completion_reason,
    parentRunId: row.parent_run_id, parent: row.parent_result_json === null ? null : JSON.parse(String(row.parent_result_json)),
    parentDigest: row.parent_result_digest,
    publication: row.publication_json === null ? null : JSON.parse(String(row.publication_json)) });
}

export function latestWorkSeq(db: Database, workInputId: string): number {
  return Number(db.prepare("SELECT max(work_seq) AS n FROM subagent_inputs WHERE work_input_id=:workInputId").get({ workInputId })?.n ?? 0);
}
