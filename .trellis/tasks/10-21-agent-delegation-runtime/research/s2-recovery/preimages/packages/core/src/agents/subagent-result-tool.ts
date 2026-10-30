/**
 * INPUT: exact child Run/Attempt, selected real materials and completed SDK tool-result witnesses
 * OUTPUT: one validated child result proposal and structural loop stop
 * POS: core/agents — informational result collector; no publication, parent dispatch or Memory mutation
 */
import { tool, type StopCondition, type ToolSet } from "ai";
import { SubagentResultToolSchema, SubagentProposalSchema, type SubagentProposal, type SubagentWorkToken } from "@taki/shared";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { MaterialSelection } from "../harness/subagent-tool-materials.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import type { TurnMessage } from "./turn-mapping.ts";

export interface SubagentResultCollector {
  tools: ToolSet; stop: StopCondition<ToolSet>;
  commit(input: { attemptId: string; messages: TurnMessage[] }): void;
}

export function createSubagentResultCollector(input: {
  runId: string; attemptId(): string; token(): SubagentWorkToken; current(): boolean;
  executions: SubagentExecutionRepo; materials: MaterialSelection;
}): SubagentResultCollector {
  let pending: { callId: string; attemptId: string; proposal: SubagentProposal } | undefined;
  let committed = false;
  return {
    tools: { complete_subagent: tool({
      description: "Finish this delegated work with a useful result and references to material actually supplied or acquired. "
        + "Use an empty materials array when none applies. This records private work; it does not speak or write Memory.",
      inputSchema: SubagentResultToolSchema,
      execute(candidate, options) {
        if (!input.current()) return { ok: false, code: "SUBAGENT_RESULT_STALE" };
        const proposal = SubagentProposalSchema.parse({ text: candidate.text,
          sourceContext: { materials: input.materials.resolve(candidate.materials) } });
        if (pending && pending.attemptId === input.attemptId() && digestRunValue(pending.proposal) !== digestRunValue(proposal)) {
          return { ok: false, code: "SUBAGENT_RESULT_CONFLICT" };
        }
        pending = { callId: options.toolCallId, attemptId: input.attemptId(), proposal };
        return { ok: true, accepted: true };
      },
    }) },
    stop: () => committed,
    commit(step) {
      if (!pending || pending.attemptId !== step.attemptId || !hasCollectorResult(step.messages, pending.callId, "complete_subagent")) return;
      input.executions.recordProposal({ runId: input.runId, attemptId: step.attemptId, workToken: input.token(),
        proposal: pending.proposal, digest: digestRunValue(pending.proposal) });
      committed = true;
    },
  };
}

export function hasCollectorResult(messages: TurnMessage[], callId: string, name: string): boolean {
  return messages.some((message) => message.role === "tool" && message.content.some((part) =>
    part.type === "tool-result" && part.toolCallId === callId && part.toolName === name
    && part.output.type === "json" && typeof part.output.value === "object" && part.output.value !== null
    && "accepted" in part.output.value && part.output.value.accepted === true));
}
