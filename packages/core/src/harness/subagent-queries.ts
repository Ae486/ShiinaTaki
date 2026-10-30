/**
 * INPUT: persisted child/work/message/result rows and current execution/delivery owners
 * OUTPUT: bounded navigation, paged private conversation and joined publication truth
 * POS: core/harness — disposable read projection; never reconstructs authority from descriptive data
 */
import { SubagentSummarySchema, SubagentHistoryResultSchema, SubagentListResultSchema, SubagentResultViewSchema,
  type SubagentSummary, type SubagentResultView } from "@taki/shared";
import type { SubagentState } from "./subagent-state.ts";
import { createSubagentEventRepo } from "../db/subagent-event-repo.ts";

export function subagentSummary(state: SubagentState, subagentId: string): SubagentSummary {
  const { deps } = state; const child = deps.children.get(subagentId);
  const latest = deps.db.prepare("SELECT work_input_id FROM subagent_inputs WHERE subagent_id=:id ORDER BY input_seq DESC LIMIT 1").get({ id: subagentId });
  const result = deps.db.prepare("SELECT run_id FROM subagent_executions WHERE subagent_id=:id AND settled_at IS NOT NULL ORDER BY settled_at DESC,run_id DESC LIMIT 1").get({ id: subagentId });
  const pending = deps.db.prepare(`SELECT i.input_id FROM subagent_inputs i WHERE i.subagent_id=:id AND i.input_kind='work'
    AND (SELECT max(work_seq) FROM subagent_inputs WHERE work_input_id=i.input_id)>
    COALESCE((SELECT max(through_work_seq) FROM subagent_executions WHERE work_input_id=i.input_id),0) LIMIT 1`).get({ id: subagentId });
  const run = child.activeRunId ? deps.runs.status(child.activeRunId).run : undefined;
  const request = deps.db.prepare(`SELECT work_input_id FROM subagent_input_waits WHERE state='open'
    AND work_input_id IN (SELECT input_id FROM subagent_inputs WHERE subagent_id=:child) ORDER BY rowid LIMIT 1`).get({ child: subagentId });
  const pendingRequest = request ? createSubagentEventRepo(deps.db).wait(String(request.work_input_id)) : null;
  const waiting = pending ? state.bindings.get(String(pending.input_id)) : undefined;
  const queueable = waiting && !waiting.deferred && (waiting.root.workValidity.kind === "until_cancelled"
    || Date.now() < Date.parse(waiting.root.workValidity.expiresAt));
  const phase = child.stopOrigin === "user" ? "blocked_user" : child.stopOrigin === "parent" ? "blocked_parent"
    : run ? run.state === "running" ? "running" : "deferred"
      : pendingRequest ? "needs_input" : pending ? queueable ? "queued" : "deferred" : "idle";
  return SubagentSummarySchema.parse({ subagentId, characterId: child.characterId, label: child.label, createdAt: child.createdAt,
    activeRunId: child.activeRunId, controlVersion: child.controlVersion, stopOrigin: child.stopOrigin, state: phase, pendingRequest,
    activeWorkInputId: child.activeRunId ? deps.executions.get(child.activeRunId).workInputId : null,
    latestWorkInputId: latest?.work_input_id ?? null, latestCompletionId: result?.run_id ?? null });
}

export function assertSubagentCharacter(state: SubagentState, characterId: string, subagentId: string): void {
  if (state.deps.children.get(subagentId).characterId !== characterId) throw new Error("SUBAGENT_CHARACTER_MISMATCH");
}

export function subagentResult(state: SubagentState, input: { characterId: string; completionId: string }): SubagentResultView {
  const result = state.deps.executions.result(input.completionId);
  if (!result) throw new Error("SUBAGENT_RESULT_NOT_FOUND");
  assertSubagentCharacter(state, input.characterId, result.child.subagentId);
  const delivery = result.publication?.runId ? state.deps.db.prepare("SELECT state FROM run_deliveries WHERE run_id=:id")
    .get({ id: result.publication.runId }) : undefined;
  return SubagentResultViewSchema.parse({ result, deliveryState: delivery?.state ?? null });
}

export function listSubagents(state: SubagentState, input: { characterId: string; afterId?: string; limit: number }) {
  const rows = state.deps.children.list({ characterId: input.characterId, afterId: input.afterId, limit: input.limit + 1 });
  const page = rows.slice(0, input.limit);
  return SubagentListResultSchema.parse({ entries: page.map((row) => subagentSummary(state, row.subagentId)),
    nextCursor: rows.length > input.limit ? page.at(-1)?.subagentId : null });
}

export function subagentHistory(state: SubagentState, input: { characterId: string; subagentId: string; workInputId?: string;
  runId?: string; afterSeq: number; inputAfterSeq: number; afterCompletionId?: string; limit: number }) {
  const { deps } = state;
  assertSubagentCharacter(state, input.characterId, input.subagentId);
  if (input.runId) {
    const scope = deps.executions.scope(input.runId);
    const child = scope?.kind === "subagent" ? scope.subagentId : scope?.kind === "parent-continuation" ? deps.executions.get(scope.completionId).subagentId : undefined;
    if (child !== input.subagentId) throw new Error("SUBAGENT_WORK_MISMATCH");
  }
  const inputs = deps.inputs.list({ ...input, afterSeq: input.inputAfterSeq, limit: input.limit + 1 });
  const messages = input.runId ? deps.messages.list({ runId: input.runId, afterSeq: input.afterSeq, limit: input.limit + 1 })
    : deps.messages.history({ ...input, limit: input.limit + 1 });
  const executions = deps.executions.list({ ...input, afterRunId: input.afterCompletionId, limit: input.limit + 1 });
  return SubagentHistoryResultSchema.parse({ conversation: subagentSummary(state, input.subagentId),
    inputs: inputs.slice(0, input.limit), messages: messages.slice(0, input.limit),
    results: executions.slice(0, input.limit).filter((row) => row.result).map((row) => subagentResult(state, { characterId: input.characterId, completionId: row.runId })),
    executions: executions.slice(0, input.limit).map((row) => ({ runId: row.runId, workInputId: row.workInputId,
      throughWorkSeq: row.throughWorkSeq, state: deps.runs.status(row.runId).run.state })),
    nextMessageSeq: messages.length > input.limit ? messages[input.limit - 1]?.seq : null,
    nextInputSeq: inputs.length > input.limit ? inputs[input.limit - 1]?.inputSeq : null,
    nextCompletionId: executions.length > input.limit ? executions[input.limit - 1]?.runId : null });
}
