/**
 * INPUT: exact continuation Run, actual retained materials and optional trusted reply availability
 * OUTPUT: private internal/no-action/reply proposal committed only with a matching SDK result
 * POS: core/agents — main-Companion decision collector; speech remains the bound publication owner's action
 */
import { tool, type StopCondition, type ToolSet } from "ai";
import { ParentContinuationToolSchema, ParentContinuationProposalSchema, type ParentContinuationProposal } from "@taki/shared";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { MaterialSelection } from "../harness/subagent-tool-materials.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { hasCollectorResult } from "./subagent-result-tool.ts";
import type { TurnMessage } from "./turn-mapping.ts";

export function createParentContinuationCollector(input: {
  runId: string; attemptId(): string; current(): boolean; canReply(): boolean;
  executions: SubagentExecutionRepo; materials: MaterialSelection;
}): { tools: ToolSet; stop: StopCondition<ToolSet>; commit(step: { attemptId: string; messages: TurnMessage[] }): void } {
  let pending: { callId: string; attemptId: string; proposal: ParentContinuationProposal } | undefined;
  let committed = false;
  return {
    tools: { finish_parent_continuation: tool({
      description: "Finish processing the delegated result: internal_result retains useful synthesis; no_action records why nothing follows; "
        + "reply proposes one delayed answer only when Core supplied real reply authority. Supply empty text/reason/materials when unused. Recording does not send it.",
      inputSchema: ParentContinuationToolSchema,
      execute(candidate, options) {
        if (!input.current()) return { ok: false, code: "SUBAGENT_RESULT_STALE" };
        if (candidate.decision === "reply" && !input.canReply()) return { ok: false, code: "SUBAGENT_REPLY_UNAVAILABLE" };
        const sourceContext = { materials: input.materials.resolve(candidate.materials) };
        const parsed = ParentContinuationProposalSchema.safeParse({ decision: candidate.decision, text: candidate.text,
          sourceContext, ...(candidate.decision === "no_action" ? { reason: candidate.reason } : {}) });
        if (!parsed.success) return { ok: false, code: "SUBAGENT_RESULT_INVALID" };
        if (pending && pending.attemptId === input.attemptId() && digestRunValue(pending.proposal) !== digestRunValue(parsed.data)) {
          return { ok: false, code: "SUBAGENT_RESULT_CONFLICT" };
        }
        pending = { callId: options.toolCallId, attemptId: input.attemptId(), proposal: parsed.data };
        return { ok: true, accepted: true };
      },
    }) },
    stop: () => committed,
    commit(step) {
      if (!pending || pending.attemptId !== step.attemptId || !hasCollectorResult(step.messages, pending.callId, "finish_parent_continuation")) return;
      input.executions.recordParentProposal({ runId: input.runId, attemptId: step.attemptId,
        proposal: pending.proposal, digest: digestRunValue(pending.proposal) });
      committed = true;
    },
  };
}
