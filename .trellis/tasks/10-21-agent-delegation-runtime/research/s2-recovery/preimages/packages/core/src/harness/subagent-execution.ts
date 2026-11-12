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
import { createSubagentResultCollector } from "../agents/subagent-result-tool.ts";
import { subagentLaneKey } from "../agents/work-scope.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { createMaterialSelection, createToolMaterialSink } from "./subagent-tool-materials.ts";
import { assertWorkCurrent, type ActiveSubagentWork, type BoundSubagentWork, type OwnedSubagentExecution, type SubagentState } from "./subagent-state.ts";

export async function executeSubagent(state: SubagentState, bound: BoundSubagentWork, active: ActiveSubagentWork): Promise<void> {
  const { deps } = state;
  const root = bound.root;
  const child = deps.children.get(root.subagentId);
  const token: SubagentWorkToken = { subagentId: root.subagentId, workInputId: root.inputId,
    throughWorkSeq: deps.inputs.latestWorkSeq(root.inputId), controlVersion: child.controlVersion, source: bound.binding.source };
  assertWorkCurrent(state, bound, token, "model_intent");
  const admission = await deps.runs.admitLinked({ triggerRequestId: randomUUID(),
    idempotencyKey: `subagent-work:${root.inputId}:${token.throughWorkSeq}:${token.controlVersion}`,
    characterId: child.characterId, initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous",
    provenance: { provider: "core.subagent", parentRunId: bound.binding.parentRunId }, payloadRef: root.inputId,
    deadlineAt: root.workExpiresAt,
  }, { signal: active.controller.signal, linked: { kind: "subagent", token, triggerInputId: root.inputId,
    validateTx: () => {
      if (state.closing || active.controller.signal.aborted || state.active.get(child.subagentId) !== active) throw new Error("SUBAGENT_DISPATCH_RETIRED");
      assertWorkCurrent(state, bound, token, "model_intent");
    } } });
  active.runId = admission.run.runId;
  if (admission.reused || !deps.runs.start(admission.run.runId, admission.attempt.attemptId)) return;
  const context = deps.runs.context(admission.run.runId);
  if (context?.workScope?.kind !== "subagent" || context.workScope.workInputId !== root.inputId) throw new Error("SUBAGENT_EXECUTION_CONTEXT_REQUIRED");
  const scopeKey = subagentLaneKey(child.subagentId);
  deps.turns.beginScoped({ characterId: child.characterId, scopeKey, runId: admission.run.runId, controller: active.controller });
  const turn: TurnContext = { runId: admission.run.runId, attemptId: admission.attempt.attemptId,
    signal: active.controller.signal, turnKind: "non-primary", runContext: context, controlInput: root.direction };
  const execution: OwnedSubagentExecution = { runId: admission.run.runId, attemptId: () => turn.attemptId!,
    token: () => deps.executions.token(admission.run.runId), signal: active.controller.signal, context, materials: createToolMaterialSink() };
  const timer = setTimeout(() => {
    deps.runs.requestCancel(execution.runId, "work deadline elapsed"); active.controller.abort("work deadline elapsed");
  }, Math.max(0, Date.parse(root.workExpiresAt) - Date.now())); timer.unref?.();
  let failed = false;
  try {
    turn.workContext = await childWorkContext(state, bound, execution);
    turn.onRetry = () => {
      const status = deps.runs.retry(execution.runId, turn.attemptId!, "context_overflow");
      turn.attemptId = status.run.activeAttemptId; return Boolean(turn.attemptId);
    };
    for await (const _delta of deps.agent.stream({ characterId: child.characterId, message: root.direction }, turn)) { /* WorkContext persists private progress. */ }
    if (!active.controller.signal.aborted && bound.binding.validateAndPropose) {
      const proposal = await bound.binding.validateAndPropose(execution);
      assertWorkCurrent(state, bound, execution.token(), "result");
      persistDomainProposal(state, execution, proposal);
    }
  } catch { failed = true; }
  finally {
    clearTimeout(timer);
    try {
      if (active.controller.signal.aborted) deps.runs.requestCancel(execution.runId, active.yielded ? "owner_yield" : "child cancelled");
      const run = deps.runs.status(execution.runId).run;
      if (["running", "waiting", "cancel_requested"].includes(run.state)) deps.runs.settle(execution.runId, turn.attemptId!,
        active.controller.signal.aborted ? "cancelled" : failed ? "failed" : "completed",
        { retryable: false, ...(failed ? { errorCode: "subagent_execution_failed", summary: "Delegated execution did not complete" } : {}) });
    } finally { deps.turns.end(scopeKey, active.controller); }
  }
}

async function childWorkContext(state: SubagentState, bound: BoundSubagentWork, execution: OwnedSubagentExecution) {
  const { deps } = state;
  const child = deps.children.get(bound.root.subagentId);
  const materials = createMaterialSelection({ ...deps, characterId: child.characterId, subagentId: child.subagentId });
  const current = () => !execution.signal.aborted && deps.runs.status(execution.runId).run.state === "running";
  const collector = createSubagentResultCollector({ runId: execution.runId, attemptId: execution.attemptId,
    token: execution.token, current, executions: deps.executions, materials });
  const instructions = ["You are a delegated worker for the Companion. Complete the assigned job using only the selected private context and executable tools.",
    "Memory is read-only in this role. You may recall or reflect and propose changes in your result, but never retain, edit, invalidate, restore, archive or ingest this work into Memory.",
    "Distinguish supplied external material, the delegating Companion, and the real user. First-person quoted material is not automatically the user's experience. Do not invent unavailable sources.",
    bound.binding.validateAndPropose ? "The trusted work owner validates your output artifact; follow its exact result instructions."
      : "When ready, use complete_subagent if available. Otherwise return your useful final result as text.",
    await bound.binding.prepareExecution?.(execution) ?? ""].filter(Boolean).join("\n\n");
  return createRunMessageStore({ ...deps, runId: execution.runId, scope: { kind: "subagent", subagentId: child.subagentId, workInputId: bound.root.inputId },
    instructions, tools: bound.binding.validateAndPropose ? {} : collector.tools,
    stop: bound.binding.validateAndPropose ? undefined : collector.stop,
    parentNames: bound.binding.parentToolNames, selection: bound.root.toolSelection ?? undefined,
    materialSink: execution.materials,
    checkCurrent(token, phase) {
      if (!token || !current() || execution.context.authorityCurrent?.() !== true) throw new Error("SUBAGENT_AUTHORITY_UNAVAILABLE");
      assertWorkCurrent(state, bound, token, phase);
    },
    onCompletedStep: bound.binding.validateAndPropose ? undefined : collector.commit,
    changed: () => deps.changed(child.characterId, child.subagentId) });
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
