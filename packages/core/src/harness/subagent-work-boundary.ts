/**
 * INPUT: actual task-model completion, collector witnesses and captured work policy
 * OUTPUT: ordered completion/question/check-in decisions with atomic durable progress
 * POS: core/harness — shared worker boundary coordinator; pressure rollover runs only after it continues
 */
import type { CompletedWorkStep } from "../agents/work-context.ts";
import { createSubagentProgressRepo } from "../db/subagent-progress-repo.ts";
import { acceptDueSubagentCheckIn } from "../db/subagent-checkin-repo.ts";
import { createSubagentEventRepo } from "../db/subagent-event-repo.ts";
import { createSubagentResultCollector } from "../agents/subagent-result-tool.ts";
import { createSubagentInteractCollector, createSubagentTerminalChoice } from "../agents/subagent-interact-tool.ts";
import type { BoundSubagentWork, OwnedSubagentExecution, SubagentState } from "./subagent-state.ts";
import type { MaterialSelection } from "./subagent-tool-materials.ts";

export function createSubagentWorkBoundary(state: SubagentState, input: {
  bound: BoundSubagentWork; execution: OwnedSubagentExecution; materials: MaterialSelection;
}) {
  const { deps } = state; const { bound, execution, materials } = input;
  const current = () => !execution.signal.aborted && deps.runs.status(execution.runId).run.state === "running";
  const terminal = createSubagentTerminalChoice();
  const collector = createSubagentResultCollector({ runId: execution.runId, attemptId: execution.attemptId,
    token: execution.token, current, executions: deps.executions, materials, terminal,
    canCommit: () => current() && deps.inputs.latestWorkSeq(bound.root.inputId) === execution.token().throughWorkSeq });
  const interactions = createSubagentInteractCollector({ runId: execution.runId, attemptId: execution.attemptId,
    token: execution.token, current, events: createSubagentEventRepo(deps.db), terminal });
  const progress = createSubagentProgressRepo(deps.db);
  let checkedIn = false;
  return {
    tools: bound.binding.validateAndPropose ? {} : { ...collector.tools, ...interactions.tools },
    stop: async (options: Parameters<typeof collector.stop>[0]) => await collector.stop(options) || interactions.stop() || checkedIn,
    progress: () => progress.get(bound.root.inputId),
    assertModelAllowed() {
      const row = progress.get(bound.root.inputId);
      if (row && row.completedSteps - row.intervalStartSteps >= row.intervalSteps) {
        throw new Error("SUBAGENT_CHECKIN_REQUIRED");
      }
    },
    intent: (step: { stepNumber: number; effect: Parameters<typeof progress.intent>[0]["effect"] }) =>
      progress.intent({ ...step, workInputId: bound.root.inputId }),
    completed(step: CompletedWorkStep) {
      if (step.completed === false) return;
      const completed = progress.complete({ runId: execution.runId, attemptId: step.attemptId,
        stepNumber: step.stepNumber, modelEffectId: step.modelEffectId });
      // Source-owned completion is the existing natural SDK end plus owner validation after drain.
      // A continuing file-write tool frontier is not an accepted domain completion.
      if (bound.binding.validateAndPropose && step.naturalFinish) return;
      if (!bound.binding.validateAndPropose) collector.commit(step);
      const acceptedInteraction = !bound.binding.validateAndPropose && interactions.commit(step);
      const final = deps.db.prepare("SELECT proposal_json FROM subagent_executions WHERE run_id=:run").get({ run: execution.runId });
      if (completed && !final?.proposal_json && current() && step.safeFrontier !== false) {
        const unsafe = (deps.effects.list?.(execution.runId) ?? deps.effects.unfinished(execution.runId))
          .some((effect) => effect.kind !== "model" && (effect.state !== "terminal" || effect.outcome === "outcome_unknown"));
        if (!unsafe) checkedIn ||= Boolean(acceptDueSubagentCheckIn(deps.db, bound.root.inputId));
      }
      if (checkedIn || (acceptedInteraction && bound.root.completionPolicy === "request_parent")) {
        deps.db.afterCommit(() => state.inboxOpportunity(deps.children.get(bound.root.subagentId).characterId));
      }
      deps.db.afterCommit(() => state.completionHint());
    },
  };
}
