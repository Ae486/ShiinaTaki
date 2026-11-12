/**
 * INPUT: canonical cancellation/deadline-adjusted Run terminal fact inside its owning transaction
 * OUTPUT: atomic private tail, truthful child/parent terminal report, outbox and exact pointer release
 * POS: core/db — required delegation settlement participant; no IO, dispatch or publication
 */
import { ParentContinuationProposalSchema, ParentContinuationResultSchema, RunMessageBatchSchema,
  SubagentProposalSchema, SubagentResultSchema, type SourceContext, type RunMessageBatch } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";
import type { RunTerminalFact } from "./run-linked-state.ts";
import { latestWorkSeq, readSubagentInput } from "./subagent-readers.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { appendRunMessageBatch } from "./run-message-repo.ts";

export function settleSubagentTerminal(db: Database, fact: RunTerminalFact): void {
  const row = db.prepare("SELECT * FROM subagent_executions WHERE run_id=:id OR parent_run_id=:id").get({ id: fact.run.runId });
  if (!row) return;
  const child = row.run_id === fact.run.runId;
  const prefix = child ? "" : "parent_";
  if (row[`${prefix}settled_at`] !== null) throw new Error("SUBAGENT_TERMINAL_CONFLICT");
  const tail = row[`${prefix}terminal_messages_json`];
  if (tail !== null && row[`${prefix}terminal_messages_attempt_id`] === fact.attempt.attemptId) {
    appendRunMessageBatch(db, { runId: fact.run.runId, attemptId: fact.attempt.attemptId,
      batch: RunMessageBatchSchema.parse(JSON.parse(String(tail))) satisfies RunMessageBatch });
  }
  if (child) settleChild(db, row, fact);
  else settleParent(db, row, fact);
}

function settleChild(db: Database, row: SqlRow, fact: RunTerminalFact): void {
  const proposal = row.proposal_json !== null && row.proposal_attempt_id === fact.attempt.attemptId
    && row.proposal_token_digest === digestRunValue(JSON.parse(String(row.work_token_json)))
    ? SubagentProposalSchema.parse(JSON.parse(String(row.proposal_json))) : null;
  const body = proposal?.text ?? visibleText(db, fact);
  const current = Number(row.through_work_seq) === latestWorkSeq(db, String(row.work_input_id));
  const accepted = fact.finalOutcome === "completed" && current && proposal !== null;
  const result = SubagentResultSchema.parse({ runId: fact.run.runId, attemptId: fact.attempt.attemptId,
    subagentId: row.subagent_id, workInputId: row.work_input_id, throughWorkSeq: row.through_work_seq,
    workExpiresAt: readSubagentInput(db, String(row.work_input_id)).workExpiresAt,
    outcome: fact.finalOutcome, body, outputKind: accepted ? "validated" : outputKind(fact, body),
    currentness: current ? "current" : "superseded", sourceContext: sourceContext(fact, proposal?.sourceContext, String(row.subagent_id)),
    ...(accepted && proposal.artifact ? { artifact: proposal.artifact } : {}), receiptId: fact.receiptId, settledAt: fact.at });
  const state = row.completion_policy === "record_only" ? "not_requested" : current ? "pending" : "withheld";
  db.prepare(`UPDATE subagent_executions SET result_json=:json,result_digest=:digest,settled_at=:at,
    completion_state=:state,completion_reason=:reason WHERE run_id=:id AND settled_at IS NULL`)
    .run({ id: fact.run.runId, json: JSON.stringify(result), digest: digestRunValue(result), at: fact.at,
      state, reason: state === "withheld" ? "superseded" : null });
  const released = db.prepare(`UPDATE subagent_conversations SET active_run_id=NULL,control_version=control_version+1
    WHERE subagent_id=:child AND active_run_id=:run`).run({ child: String(row.subagent_id), run: fact.run.runId });
  if (released.changes !== 1) throw new Error("SUBAGENT_ACTIVE_RUN_CONFLICT");
}

function settleParent(db: Database, row: SqlRow, fact: RunTerminalFact): void {
  const proposal = row.parent_proposal_json !== null && row.parent_proposal_attempt_id === fact.attempt.attemptId
    ? ParentContinuationProposalSchema.parse(JSON.parse(String(row.parent_proposal_json))) : null;
  const current = Number(row.through_work_seq) === latestWorkSeq(db, String(row.work_input_id));
  const accepted = fact.finalOutcome === "completed" && current && proposal !== null;
  const body = proposal?.text ?? visibleText(db, fact);
  const result = ParentContinuationResultSchema.parse({ runId: fact.run.runId, attemptId: fact.attempt.attemptId,
    outcome: fact.finalOutcome, body, outputKind: accepted ? "validated" : outputKind(fact, body),
    decision: accepted ? proposal.decision : body === null ? "none" : "unstructured",
    ...(accepted && proposal.decision === "no_action" ? { reason: proposal.reason } : {}),
    sourceContext: sourceContext(fact, proposal?.sourceContext), receiptId: fact.receiptId, settledAt: fact.at });
  const publication = result.decision === "reply" ? { state: "pending" }
    : result.decision === "no_action" ? { state: "no_action" } : { state: "internal_only" };
  db.prepare(`UPDATE subagent_executions SET parent_result_json=:json,parent_result_digest=:digest,
    parent_settled_at=:at,publication_json=:publication WHERE run_id=:id AND parent_settled_at IS NULL`)
    .run({ id: String(row.run_id), json: JSON.stringify(result), digest: digestRunValue(result), at: fact.at, publication: JSON.stringify(publication) });
}

function visibleText(db: Database, fact: RunTerminalFact): string | null {
  const rows = db.prepare(`SELECT content FROM run_messages m WHERE run_id=:run AND attempt_id=:attempt
    AND role='assistant' AND entry_kind IN ('output','partial') AND length(content)>0
    AND seq>COALESCE((SELECT max(receipt.seq) FROM run_messages receipt WHERE receipt.run_id=m.run_id
      AND receipt.attempt_id=m.attempt_id AND receipt.entry_kind='input'),0)
    AND (entry_kind<>'partial' OR NOT EXISTS (SELECT 1 FROM run_messages completed
      WHERE completed.run_id=m.run_id AND completed.attempt_id=m.attempt_id AND completed.step_number=m.step_number AND completed.entry_kind='output'))
    ORDER BY seq DESC LIMIT 1`).all({ run: fact.run.runId, attempt: fact.attempt.attemptId });
  // Without a collector, the last visible segment is a bounded unstructured report; the complete transcript remains queryable.
  return rows[0] ? String(rows[0].content) : null;
}

function outputKind(fact: RunTerminalFact, body: string | null): "none" | "unstructured" | "partial" {
  return body === null ? "none" : fact.finalOutcome === "completed" ? "unstructured" : "partial";
}

function sourceContext(fact: RunTerminalFact, source?: SourceContext, subagentId?: string): SourceContext {
  return { ...source, generatedBy: { runId: fact.run.runId, attemptId: fact.attempt.attemptId, ...(subagentId ? { subagentId } : {}) } };
}
