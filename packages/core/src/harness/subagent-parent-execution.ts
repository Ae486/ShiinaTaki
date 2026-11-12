/**
 * INPUT: one committed child result, fresh parent admission and the normal Character lane
 * OUTPUT: inspectable shared-Agent synthesis and an explicit terminal decision
 * POS: core/harness — parent continuation uses main Memory authority; publication is a separate owner
 */
import type { SubagentResultGroup } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import { createParentContinuationCollector } from "../agents/parent-continuation-result-tool.ts";
import { createRunMessageStore } from "../agents/run-message-store.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { renderSourceContext } from "../agents/source-context.ts";
import { createMaterialSelection, createToolMaterialSink } from "./subagent-tool-materials.ts";
import { assertWorkCurrent, type BoundSubagentWork, type SubagentState } from "./subagent-state.ts";

export async function executeParentContinuation(state: SubagentState, bound: BoundSubagentWork,
  input: { result: SubagentResultGroup; runId: string; attemptId: string; controller: AbortController }): Promise<void> {
  const { deps } = state; const { runId, controller, result } = input;
  const characterId = deps.children.get(result.child.subagentId).characterId;
  const context = deps.runs.context(runId);
  if (context?.workScope?.kind !== "parent-continuation") throw new Error("SUBAGENT_PARENT_CONTEXT_REQUIRED");
  const turn: TurnContext = { runId, attemptId: input.attemptId, turnKind: "non-primary", signal: controller.signal,
    runContext: context, controlInput: bound.root.direction, materials: createToolMaterialSink() };
  turn.workContext = parentWorkContext(state, bound, { result, turn, controller });
  turn.onRetry = () => {
    const status = deps.runs.retry(runId, turn.attemptId!, "context_overflow");
    turn.attemptId = status.run.activeAttemptId; return Boolean(turn.attemptId);
  };
  deps.turns.begin(characterId, controller, runId);
  const timer = bound.root.workValidity.kind === "expires_at" ? setTimeout(() => { deps.runs.requestCancel(runId, "work deadline elapsed"); controller.abort("work deadline elapsed"); },
    Math.max(0, Date.parse(bound.root.workValidity.expiresAt) - Date.now())) : undefined; timer?.unref?.();
  let failed = false;
  try { for await (const delta of deps.agent.stream({ characterId, message: bound.root.direction }, turn)) { void delta; } }
  catch { failed = true; }
  finally {
    clearTimeout(timer);
    try {
      if (controller.signal.aborted) deps.runs.requestCancel(runId, "parent continuation cancelled");
      const run = deps.runs.status(runId).run;
      if (["running", "waiting", "cancel_requested"].includes(run.state)) deps.runs.settle(runId, turn.attemptId!,
        controller.signal.aborted ? "cancelled" : failed ? "failed" : "completed", { retryable: false,
          ...(failed ? { errorCode: "subagent_parent_execution_failed", summary: "Delegated result processing did not complete" } : {}) });
    } finally { deps.turns.end(characterId, controller); }
  }
}

function parentWorkContext(state: SubagentState, bound: BoundSubagentWork, input: { result: SubagentResultGroup; turn: TurnContext; controller: AbortController }) {
  const { deps } = state; const { result, turn, controller } = input; const runId = turn.runId!;
  const characterId = deps.children.get(result.child.subagentId).characterId;
  const context = deps.runs.context(runId)!;
  if (!context.workScope) throw new Error("SUBAGENT_PARENT_CONTEXT_REQUIRED");
  const current = () => !controller.signal.aborted && deps.runs.status(runId).run.state === "running"
    && context.authorityCurrent?.() === true;
  const collector = createParentContinuationCollector({ runId, attemptId: () => turn.attemptId!, current,
    canReply: () => deps.reports?.canReply(bound.root.inputId) === true, executions: deps.executions,
    materials: createMaterialSelection({ ...deps, characterId, subagentId: result.child.subagentId }) });
  const tools = { ...deps.mainTools?.(characterId, turn), ...collector.tools };
  return createRunMessageStore({ ...deps, runId, scope: context.workScope,
    instructions: "You are the main Companion processing a retained worker outcome. This is internal work, not a new user utterance. "
      + "A failed, cancelled or unknown result is not proof of success. Use finish_parent_continuation to retain an internal result, choose no_action, "
      + "or propose a reply only when Core has supplied reply authority. Inference and plain text do not send speech. "
      + `Reply authority is ${deps.reports?.canReply(bound.root.inputId) === true ? "available for this original request only" : "unavailable"}.`,
    tools, stop: collector.stop, materialSink: turn.materials!,
    parentReplay: () => {
      const replay = deps.store.project(characterId);
      return { ...replay, messages: [...replay.messages, { role: "user", content:
        "Core retained delegation report. The worker and external speakers are distinct from the real user.\n"
        + renderSourceContext(result.child.sourceContext) + "\n"
        + fenceUntrusted({ source: "delegated-result", content: JSON.stringify({ completionId: result.completionId,
          childDigest: result.childDigest, task: bound.root.direction, result: result.child }) }) }] };
    },
    checkCurrent() {
      if (!current()) throw new Error("SUBAGENT_AUTHORITY_UNAVAILABLE");
      assertWorkCurrent(state, bound, { token: deps.executions.token(result.completionId), phase: "parent_admission" });
    },
    onCompletedStep: collector.commit, changed: () => deps.changed(characterId, result.child.subagentId) });
}
