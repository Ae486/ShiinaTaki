/**
 * INPUT: trusted linked admissions, validated exact-Attempt proposals and completion dispositions
 * OUTPUT: durable child execution ownership and at most one parent continuation linkage
 * POS: core/db — delegation Run participant; RunRepo remains the terminal outcome authority
 */
import { ParentContinuationProposalSchema, SubagentProposalSchema, SubagentWorkTokenSchema,
  SubagentCompletionReasonSchema, SubagentPublicationSchema,
  type SubagentProposal, type ParentContinuationProposal, type SubagentWorkToken,
  type SubagentCompletionReason, type SubagentPublication, type SubagentWorkScope } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunLinkedAdmission, RunLinkedState } from "./run-linked-state.ts";
import { digestRunValue } from "./run-row-mappers.ts";
import { readRunById } from "./run-readers.ts";
import { latestWorkSeq, projectSubagentExecution, readSubagent, readSubagentExecution, readSubagentInput, readSubagentResult } from "./subagent-readers.ts";
import { settleSubagentTerminal } from "./subagent-terminal.ts";

export function createSubagentExecutionRepo(db: Database) {
  const linkedState = createLinkedState(db);
  return {
    linkedState,
    get: (runId: string) => projectSubagentExecution(readSubagentExecution(db, runId)),
    list(input: { subagentId: string; workInputId?: string; afterRunId?: string; limit?: number }) {
      return db.prepare(`SELECT * FROM subagent_executions WHERE subagent_id=:child AND (:work IS NULL OR work_input_id=:work)
        AND (:after IS NULL OR run_id>:after) ORDER BY run_id LIMIT :limit`)
        .all({ child: input.subagentId, work: input.workInputId ?? null, after: input.afterRunId ?? null,
          limit: Math.max(1, Math.min(input.limit ?? 50, 200)) }).map(projectSubagentExecution);
    },
    result: (runId: string) => readSubagentResult(db, runId),
    scope(runId: string): SubagentWorkScope | undefined {
      const row = db.prepare("SELECT * FROM subagent_executions WHERE run_id=:id OR parent_run_id=:id").get({ id: runId });
      if (!row) return undefined;
      return row.run_id === runId ? { kind: "subagent", subagentId: String(row.subagent_id), workInputId: String(row.work_input_id) }
        : { kind: "parent-continuation", completionId: String(row.run_id) };
    },
    token(runId: string): SubagentWorkToken {
      return SubagentWorkTokenSchema.parse(JSON.parse(String(readSubagentExecution(db, runId).work_token_json)));
    },
    recordProposal(input: { runId: string; attemptId: string; workToken: SubagentWorkToken; proposal: SubagentProposal; digest: string }) {
      recordChildProposal(db, input);
    },
    recordParentProposal(input: { runId: string; attemptId: string; proposal: ParentContinuationProposal; digest: string }) {
      recordParentProposal(db, input);
    },
    setCompletion(input: { completionId: string; state: "deferred" | "withheld"; reason: SubagentCompletionReason }) {
      const reason = SubagentCompletionReasonSchema.parse(input.reason);
      if ((input.state === "withheld") !== ["superseded", "source_retired", "expired"].includes(reason)) throw new Error("SUBAGENT_COMPLETION_REASON_MISMATCH");
      return db.prepare(`UPDATE subagent_executions SET completion_state=:state,completion_reason=:reason
        WHERE run_id=:id AND settled_at IS NOT NULL AND parent_run_id IS NULL AND completion_state IN ('pending','deferred')`)
        .run({ id: input.completionId, state: input.state, reason }).changes === 1;
    },
    pending(input: { afterId?: string; limit?: number } = {}) {
      return db.prepare(`SELECT run_id FROM subagent_executions WHERE completion_state IN ('pending','deferred')
        AND settled_at IS NOT NULL AND (:after IS NULL OR run_id>:after) ORDER BY run_id LIMIT :limit`)
        .all({ after: input.afterId ?? null, limit: Math.max(1, Math.min(input.limit ?? 50, 200)) })
        .map((row) => readSubagentResult(db, String(row.run_id)));
    },
    recordPublication(input: { completionId: string; parentResultDigest: string; publication: SubagentPublication }) {
      recordPublication(db, input);
    },
  };
}

function recordChildProposal(db: Database, input: { runId: string; attemptId: string; workToken: SubagentWorkToken; proposal: SubagentProposal; digest: string }): void {
  const token = SubagentWorkTokenSchema.parse(input.workToken);
  const proposal = SubagentProposalSchema.parse(input.proposal);
  if (digestRunValue(proposal) !== input.digest) throw new Error("SUBAGENT_PROPOSAL_DIGEST_MISMATCH");
  db.transaction(() => {
    const row = readSubagentExecution(db, input.runId);
    assertActiveProposal(db, input);
    if (digestRunValue(token) !== digestRunValue(JSON.parse(String(row.work_token_json)))) throw new Error("SUBAGENT_WORK_TOKEN_CONFLICT");
    recordProposal(db, { ...input, proposal, tokenDigest: digestRunValue(token), prefix: "", completionId: input.runId });
  });
}

function recordParentProposal(db: Database, input: { runId: string; attemptId: string; proposal: ParentContinuationProposal; digest: string }): void {
  const proposal = ParentContinuationProposalSchema.parse(input.proposal);
  if (digestRunValue(proposal) !== input.digest) throw new Error("SUBAGENT_PROPOSAL_DIGEST_MISMATCH");
  db.transaction(() => {
    assertActiveProposal(db, input);
    const row = db.prepare("SELECT run_id FROM subagent_executions WHERE parent_run_id=:id").get({ id: input.runId });
    if (!row) throw new Error("SUBAGENT_PARENT_LINK_MISSING");
    recordProposal(db, { ...input, proposal, prefix: "parent_", completionId: String(row.run_id) });
  });
}

function recordPublication(db: Database, input: { completionId: string; parentResultDigest: string; publication: SubagentPublication }): void {
  const publication = SubagentPublicationSchema.parse(input.publication);
  const row = projectSubagentExecution(readSubagentExecution(db, input.completionId));
  if (row.parentResultDigest !== input.parentResultDigest || !row.parentResult) throw new Error("SUBAGENT_PARENT_RESULT_CONFLICT");
  if (digestRunValue(row.publication) === digestRunValue(publication)) return;
  if (row.parentResult.decision !== "reply" || row.parentResult.outcome !== "completed"
    || row.publication?.state === "recorded" || row.publication?.state === "refused") throw new Error("SUBAGENT_PUBLICATION_CONFLICT");
  db.prepare("UPDATE subagent_executions SET publication_json=:json WHERE run_id=:id")
    .run({ id: input.completionId, json: JSON.stringify(publication) });
}

function admitChild(db: Database, input: Parameters<RunLinkedState["onAdmitTx"]>[0], link: Extract<RunLinkedAdmission, { kind: "subagent" }>): void {
  const token = SubagentWorkTokenSchema.parse(link.token);
  const digest = digestRunValue({ kind: link.kind, token, triggerInputId: link.triggerInputId });
  if (input.reused) {
    if (readSubagentExecution(db, input.run.runId).admission_digest !== digest) throw new Error("SUBAGENT_ADMISSION_CONFLICT");
    return;
  }
  const child = readSubagent(db, token.subagentId);
  const root = readSubagentInput(db, token.workInputId);
  const trigger = readSubagentInput(db, link.triggerInputId);
  if (child.characterId !== input.run.characterId || root.subagentId !== child.subagentId || root.kind !== "work"
    || trigger.workInputId !== root.inputId || trigger.workSeq > token.throughWorkSeq) throw new Error("SUBAGENT_WORK_MISMATCH");
  if (child.stopOrigin) throw new Error("SUBAGENT_STOPPED");
  if (child.activeRunId || child.controlVersion !== token.controlVersion) throw new Error("SUBAGENT_CONTROL_CONFLICT");
  if (token.throughWorkSeq !== latestWorkSeq(db, root.inputId)) throw new Error("SUBAGENT_WORK_TOKEN_CONFLICT");
  validateWorkDeadline(root.workExpiresAt, input.run.deadlineAt);
  link.validateTx();
  const captured = { ...token, controlVersion: token.controlVersion + 1 };
  db.prepare(`INSERT INTO subagent_executions (run_id,subagent_id,work_input_id,trigger_input_id,admission_digest,
    completion_policy,through_work_seq,work_token_json,completion_state)
    VALUES (:run,:child,:work,:trigger,:digest,:policy,:through,:token,'not_requested')`)
    .run({ run: input.run.runId, child: child.subagentId, work: root.inputId, trigger: trigger.inputId,
      digest, policy: root.completionPolicy, through: token.throughWorkSeq, token: JSON.stringify(captured) });
  db.prepare("UPDATE subagent_conversations SET active_run_id=:run,control_version=control_version+1 WHERE subagent_id=:id")
    .run({ id: child.subagentId, run: input.run.runId });
}

function admitParent(db: Database, input: Parameters<RunLinkedState["onAdmitTx"]>[0], link: Extract<RunLinkedAdmission, { kind: "parent-continuation" }>): void {
  const row = readSubagentExecution(db, link.completionId);
  const digest = digestRunValue({ kind: link.kind, completionId: link.completionId, resultDigest: link.resultDigest });
  if (input.reused) {
    if (row.parent_run_id !== input.run.runId || row.parent_admission_digest !== digest) throw new Error("SUBAGENT_ADMISSION_CONFLICT");
    return;
  }
  if (input.request.idempotencyKey !== `subagent-completion:${link.completionId}`
    || input.request.provenance.provider !== "core.subagent-completion" || input.request.payloadRef !== link.completionId
    || input.run.characterId !== readSubagent(db, String(row.subagent_id)).characterId) throw new Error("SUBAGENT_INVALID_RUN_SCOPE");
  if (row.parent_run_id !== null || !["pending", "deferred"].includes(String(row.completion_state))
    || row.result_digest !== link.resultDigest || row.settled_at === null) throw new Error("SUBAGENT_COMPLETION_NOT_ADMISSIBLE");
  if (Number(row.through_work_seq) !== latestWorkSeq(db, String(row.work_input_id))) throw new Error("SUBAGENT_WORK_SUPERSEDED");
  validateWorkDeadline(readSubagentInput(db, String(row.work_input_id)).workExpiresAt, input.run.deadlineAt);
  link.validateTx();
  db.prepare(`UPDATE subagent_executions SET parent_run_id=:parent,parent_admission_digest=:digest,
    completion_state='admitted',completion_reason=NULL WHERE run_id=:id`)
    .run({ parent: input.run.runId, digest, id: link.completionId });
}

function validateWorkDeadline(workExpiresAt: string, deadlineAt?: string): void {
  if (Date.parse(workExpiresAt) <= Date.now()) throw new Error("SUBAGENT_WORK_EXPIRED");
  if (!deadlineAt || Date.parse(deadlineAt) > Date.parse(workExpiresAt)) throw new Error("SUBAGENT_WORK_DEADLINE_MISMATCH");
}

function assertActiveProposal(db: Database, input: { runId: string; attemptId: string }): void {
  const run = readRunById(db, input.runId);
  if (run.activeAttemptId !== input.attemptId || run.state !== "running") throw new Error("SUBAGENT_PROPOSAL_STALE");
}

function recordProposal(db: Database, input: { completionId: string; attemptId: string; prefix: "" | "parent_";
  proposal: SubagentProposal | ParentContinuationProposal; digest: string; tokenDigest?: string }): void {
  const row = readSubagentExecution(db, input.completionId);
  const key = `${input.prefix}proposal_json`;
  const sameIdentity = row[`${input.prefix}proposal_attempt_id`] === input.attemptId
    && (input.prefix === "parent_" || row.proposal_token_digest === input.tokenDigest);
  if (row[key] !== null && sameIdentity) {
    if (row[`${input.prefix}proposal_digest`] !== input.digest) {
      throw new Error("SUBAGENT_PROPOSAL_CONFLICT");
    }
    return;
  }
  // Only the already-validated active Attempt/current token reaches here. An older proposal is no longer authoritative.
  const tokenAssignment = input.prefix === "" ? ",proposal_token_digest=:token" : "";
  db.prepare(`UPDATE subagent_executions SET ${key}=:json,${input.prefix}proposal_digest=:digest,
    ${input.prefix}proposal_attempt_id=:attempt ${tokenAssignment} WHERE run_id=:id`)
    .run({ id: input.completionId, json: JSON.stringify(input.proposal), digest: input.digest, attempt: input.attemptId,
      ...(input.prefix === "" ? { token: input.tokenDigest ?? null } : {}) });
}
export type SubagentExecutionRepo = ReturnType<typeof createSubagentExecutionRepo>;

function createLinkedState(db: Database): RunLinkedState {
  return {
    onAdmitTx(input) {
      const linked = db.prepare("SELECT run_id FROM subagent_executions WHERE run_id=:id OR parent_run_id=:id").get({ id: input.run.runId });
      if (!input.link) {
        if (linked) throw new Error("SUBAGENT_LINK_REQUIRED");
        return;
      }
      if (input.request.initiator !== "subagent" || input.request.deliveryClass !== "internal"
        || input.snapshot.contextMode !== "autonomous") throw new Error("SUBAGENT_INVALID_RUN_SCOPE");
      if (input.link.kind === "subagent") admitChild(db, input, input.link);
      else admitParent(db, input, input.link);
    },
    onTerminalTx: (fact) => settleSubagentTerminal(db, fact),
  };
}
