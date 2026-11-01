/**
 * INPUT: durably accepted work, trusted source binding and independently acquired queue/controller ownership
 * OUTPUT: shared ChatAgent execution, private evidence and canonical terminal result
 * POS: core/harness — one Run per execution; no parent abort propagation or feature-specific model loop
 */
import { randomUUID } from "node:crypto";
import type { SubagentProposal, SubagentWorkToken } from "@taki/shared";
import { SubagentProposalSchema } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import { createRunMessageStore } from "../agents/run-message-store.ts";
import { createSubagentContextSummaryRepo } from "../db/subagent-context-summary-repo.ts";
import { createSubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";
import { createSubagentWorkBoundary } from "./subagent-work-boundary.ts";
import { createSubagentEventRepo } from "../db/subagent-event-repo.ts";
import { createPrivateTaskSummarizer } from "../agents/private-task-summarizer.ts";
import { subagentLaneKey } from "../agents/work-scope.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { createMaterialSelection, createToolMaterialSink } from "./subagent-tool-materials.ts";
import { assertWorkCurrent, SubagentValidationError, type ActiveSubagentWork, type BoundSubagentWork, type OwnedSubagentExecution, type SubagentState } from "./subagent-state.ts";

export async function executeSubagent(state: SubagentState, bound: BoundSubagentWork, active: ActiveSubagentWork): Promise<void> {
  const { deps } = state;
  const root = bound.root;
  const child = deps.children.get(root.subagentId);
  const admission = await admitChildExecution(state, bound, active);
  active.runId = admission.run.runId;
  if (admission.reused || !deps.runs.start(admission.run.runId, admission.attempt.attemptId)) return;
  const context = deps.runs.context(admission.run.runId);
  if (context?.workScope?.kind !== "subagent" || context.workScope.workInputId !== root.inputId) throw new Error("SUBAGENT_EXECUTION_CONTEXT_REQUIRED");
  const scopeKey = subagentLaneKey(child.subagentId);
  deps.turns.beginScoped({ characterId: child.characterId, scopeKey, runId: admission.run.runId, controller: active.controller });
  const turn: TurnContext = { runId: admission.run.runId, attemptId: admission.attempt.attemptId,
    signal: active.controller.signal, turnKind: "non-primary", runContext: context, controlInput: root.direction };
  turn.activity = state.activity.start({ characterId: child.characterId, subagentId: child.subagentId,
    workInputId: root.inputId, runId: admission.run.runId });
  const execution: OwnedSubagentExecution = { runId: admission.run.runId, attemptId: () => turn.attemptId!,
    token: () => deps.executions.token(admission.run.runId), signal: active.controller.signal, context,
    materials: createToolMaterialSink(createSubagentToolResultRepo(deps.db)) };
  turn.materials = execution.materials;
  const timer = sourceDeadline(state, bound, active);
  let failed = false;
  try {
    turn.workContext = await childWorkContext(state, bound, execution);
    turn.onRetry = () => {
      const status = deps.runs.retry(execution.runId, turn.attemptId!, "context_overflow");
      turn.attemptId = status.run.activeAttemptId; return Boolean(turn.attemptId);
    };
    for await (const delta of deps.agent.stream({ characterId: child.characterId, message: root.direction }, turn)) { void delta; }
    await validateCompletedDomainWork(state, bound, execution);
  } catch (error) {
    failed = true;
    bound.deferred = "explicit_continuation_required";
    if (error instanceof SubagentValidationError && !active.controller.signal.aborted) {
      assertWorkCurrent(state, bound, { token: execution.token(), phase: "result" });
      persistDomainProposal(state, execution, error.proposal);
    }
  }
  finally {
    clearTimeout(timer);
    try {
      settleChildExecution(state, { execution, active, attemptId: turn.attemptId!, failed });
    } finally {
      finishChildActivity(state, { execution, active, turn, scopeKey });
    }
  }
}

async function validateCompletedDomainWork(state: SubagentState, bound: BoundSubagentWork, execution: OwnedSubagentExecution): Promise<void> {
  if (execution.signal.aborted || !bound.binding.validateAndPropose
    || createSubagentEventRepo(state.deps.db).checkInForRun(execution.runId)) return;
  const proposal = await bound.binding.validateAndPropose(execution);
  assertWorkCurrent(state, bound, { token: execution.token(), phase: "result" });
  persistDomainProposal(state, execution, proposal);
}

function sourceDeadline(state: SubagentState, bound: BoundSubagentWork, active: ActiveSubagentWork) {
  if (bound.root.workValidity.kind !== "expires_at") return;
  const timer = setTimeout(() => {
    if (active.runId) state.deps.runs.requestCancel(active.runId, "work deadline elapsed");
    active.controller.abort("work deadline elapsed");
  }, Math.max(0, Date.parse(bound.root.workValidity.expiresAt) - Date.now()));
  timer.unref(); return timer;
}

function finishChildActivity(state: SubagentState, input: { execution: OwnedSubagentExecution; active: ActiveSubagentWork; turn: TurnContext; scopeKey: string }) {
  const finalState = state.deps.runs.status(input.execution.runId).run.state;
  input.turn.activity?.terminal({ outcome: finalState === "completed" ? "completed" : finalState === "cancelled" ? "cancelled"
    : finalState === "outcome_unknown" ? "outcome_unknown" : "failed" });
  state.deps.turns.end(input.scopeKey, input.active.controller);
}

function settleChildExecution(state: SubagentState, input: { execution: OwnedSubagentExecution; active: ActiveSubagentWork; attemptId: string; failed: boolean }): void {
  const { execution, active, failed } = input; const { deps } = state;
  if (active.controller.signal.aborted) deps.runs.requestCancel(execution.runId, active.yielded ? "owner_yield" : "child cancelled");
  const run = deps.runs.status(execution.runId).run;
  if (["running", "waiting", "cancel_requested"].includes(run.state)) deps.runs.settle(execution.runId, input.attemptId,
    active.controller.signal.aborted ? "cancelled" : failed ? "failed" : "completed",
    { retryable: false, ...(failed ? { errorCode: "subagent_execution_failed", summary: "Delegated execution did not complete" } : {}) });
}

function admitChildExecution(state: SubagentState, bound: BoundSubagentWork, active: ActiveSubagentWork) {
  const { deps } = state; const root = bound.root; const child = deps.children.get(root.subagentId);
  const token: SubagentWorkToken = { subagentId: root.subagentId, workInputId: root.inputId,
    throughWorkSeq: deps.inputs.latestWorkSeq(root.inputId), controlVersion: child.controlVersion, source: bound.binding.source };
  assertWorkCurrent(state, bound, { token, phase: "model_intent" });
  return deps.runs.admitLinked({ triggerRequestId: randomUUID(),
    idempotencyKey: `subagent-work:${root.inputId}:${token.throughWorkSeq}:${token.controlVersion}`,
    characterId: child.characterId, initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous",
    provenance: { provider: "core.subagent", parentRunId: bound.binding.parentRunId }, payloadRef: root.inputId,
    ...(root.workValidity.kind === "expires_at" ? { deadlineAt: root.workValidity.expiresAt } : {}),
  }, { signal: active.controller.signal, linked: { kind: "subagent", token, triggerInputId: root.inputId, validateTx: () => {
    if (state.closing || active.controller.signal.aborted || state.active.get(child.subagentId) !== active) throw new Error("SUBAGENT_DISPATCH_RETIRED");
    assertWorkCurrent(state, bound, { token, phase: "model_intent" });
  } } });
}

async function childWorkContext(state: SubagentState, bound: BoundSubagentWork, execution: OwnedSubagentExecution) {
  const { deps } = state;
  const child = deps.children.get(bound.root.subagentId);
  const toolResults = createSubagentToolResultRepo(deps.db);
  const materials = createMaterialSelection({ ...deps, characterId: child.characterId, subagentId: child.subagentId, toolResults });
  const current = () => !execution.signal.aborted && deps.runs.status(execution.runId).run.state === "running";
  const boundary = createSubagentWorkBoundary(state, { bound, execution, materials });
  const instructions = [await workerInstructions(bound, execution), `Captured Core progress policy: ${JSON.stringify(boundary.progress())}`].join("\n\n");
  return createRunMessageStore({ ...deps, runId: execution.runId, scope: { kind: "subagent", subagentId: child.subagentId, workInputId: bound.root.inputId },
    instructions, tools: boundary.tools, stop: boundary.stop,
    parentNames: bound.binding.parentToolNames, selection: bound.root.toolSelection ?? undefined,
    fixedExcludedNames: execution.context.memoryToolExclusions,
    materialSink: execution.materials,
    checkCurrent(token, phase) {
      if (!token || !current() || execution.context.authorityCurrent?.() !== true) throw new Error("SUBAGENT_AUTHORITY_UNAVAILABLE");
      assertWorkCurrent(state, bound, { token, phase });
      if (phase === "model_intent") boundary.assertModelAllowed();
    },
    onModelIntent: ({ step, effect }) => boundary.intent({ stepNumber: step.stepNumber, effect }),
    transaction: (action) => deps.db.transaction(action),
    assertSafeFrontier() {
      const effects = deps.effects.list?.(execution.runId) ?? deps.effects.unfinished(execution.runId);
      if (effects.some((effect) => effect.kind !== "model" && (effect.state !== "terminal" || effect.outcome === "outcome_unknown"))) {
        throw new Error("SUBAGENT_CONTEXT_UNRESOLVED_EFFECT");
      }
    },
    toolResults, summaries: createSubagentContextSummaryRepo(deps.db),
    summarize: deps.utility ? createPrivateTaskSummarizer({ utility: deps.utility, lifecycle: deps.effects,
      runId: execution.runId, attemptId: execution.attemptId, signal: execution.signal, assertCurrent() {
        if (!current() || execution.context.authorityCurrent?.() !== true) throw new Error("SUBAGENT_AUTHORITY_UNAVAILABLE");
        assertWorkCurrent(state, bound, { token: execution.token(), phase: "model_intent" });
      } }) : undefined,
    onCompletedStep: boundary.completed,
    changed: () => {
      const latest = deps.db.prepare(`SELECT max(step_number) AS step FROM run_messages
        WHERE run_id=:run AND attempt_id=:attempt AND entry_kind='output'`).get({ run: execution.runId, attempt: execution.attemptId() });
      if (latest?.step !== null && latest?.step !== undefined) state.activity.committed({ subagentId: child.subagentId,
        runId: execution.runId, stepNumber: Number(latest.step) });
      deps.changed(child.characterId, child.subagentId);
    } });
}

async function workerInstructions(bound: BoundSubagentWork, execution: OwnedSubagentExecution): Promise<string> {
  return ["You are a delegated worker for the Companion. Complete the assigned job using only the selected private context and executable tools.",
    "Memory is read-only in this role. You may recall or reflect and propose changes in your result, but never retain, edit, invalidate, restore, archive or ingest this work into Memory.",
    "Distinguish supplied external material, the delegating Companion, and the real user. First-person quoted material is not automatically the user's experience. Do not invent unavailable sources.",
    "Core counts completed model steps across Runs and compaction. At the captured interval it pauses for a factual progress check-in. Final completion on that boundary wins. Only explicit continuation of the exact check-in resumes; repeated main-Agent approvals eventually require direct user continuation. Ordinary parent messages and unrelated main chat never reset this protection.",
    bound.binding.validateAndPropose ? "The trusted work owner validates your output artifact; follow its exact result instructions."
      : "Execution protocol is separate from the requested report format. "
        + "When the entire assigned job is complete, call complete_subagent and put the requested report in its text argument; follow any requested plain-text, Markdown, table or JSON format inside that text. A standalone assistant report does not complete this work. "
        + "When an answer is necessary to continue the job, call interact_parent with kind needs_input and the precise question in text, then wait. A clarification request or awaiting-clarification report is an intermediate stage, not completion of the larger job. "
        + "For non-blocking progress, use interact_parent with kind message and continue the independent work.",
    await bound.binding.prepareExecution?.(execution) ?? ""].filter(Boolean).join("\n\n");
}

function persistDomainProposal(state: SubagentState, execution: OwnedSubagentExecution, candidate: SubagentProposal): void {
  const proposal = SubagentProposalSchema.parse(candidate);
  state.deps.executions.recordProposal({ runId: execution.runId, attemptId: execution.attemptId(), workToken: execution.token(),
    proposal, digest: digestRunValue(proposal) });
}

export function workHasUncertainEffects(state: SubagentState, bound: BoundSubagentWork): boolean {
  return workExecutions(state, bound).some((execution) => (state.deps.effects.list?.(execution.runId) ?? state.deps.effects.unfinished(execution.runId))
    .some((effect) => effect.kind !== "model" && (effect.state !== "terminal" || effect.outcome === "outcome_unknown")));
}

export function workNeedsExecution(state: SubagentState, bound: BoundSubagentWork): boolean {
  if (bound.resume) return true;
  const executions = workExecutions(state, bound);
  return executions.length === 0 || Math.max(...executions.map((execution) => execution.throughWorkSeq)) < state.deps.inputs.latestWorkSeq(bound.root.inputId);
}

function workExecutions(state: SubagentState, bound: BoundSubagentWork) {
  let afterRunId: string | undefined;
  const rows: ReturnType<typeof state.deps.executions.list> = [];
  for (;;) {
    const page = state.deps.executions.list({ subagentId: bound.root.subagentId, workInputId: bound.root.inputId, afterRunId, limit: 200 });
    rows.push(...page);
    if (page.length < 200) return rows;
    afterRunId = page.at(-1)!.runId;
  }
}
