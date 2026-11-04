/**
 * INPUT: exact displayed child/work target, main execution and explicit same-work continuation choice
 * OUTPUT: durable addressed message acknowledgement or typed refusal
 * POS: core/agents — informational governed message tool; parent cannot clear a user-stop latch
 */
import { tool, type ToolSet } from "ai";
import { SubagentMessageToolSchema, SubagentTargetSchema } from "@taki/shared";
import type { SubagentToolBinding } from "./subagent-tools.ts";
import { subagentToolRefusal, selectSubagentMaterials } from "./subagent-tools.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { subagentControlModelOutput } from "./subagent-control-output.ts";

export function createSubagentMessageTool(input: SubagentToolBinding): ToolSet {
  return { send_subagent_message: tool({ description: "Send direction to a child; omit/null workInputId for its current work, or supply an explicit work that must never be retargeted. Ordinary guidance uses continue=false and no replyToEventId; it does not answer a pending question or resume paused work. "
    + "For a question or check-in delivered in the current inbox, use handle_agent_event when available: answer_child answers the question and continue_child approves the check-in. For deliberately inspected or silent work, answer with direction, its eventId as replyToEventId, continue=false and the full current target; approve a check-in with continue=true. "
    + "To explicitly continue interrupted unfinished work with no pending request, keep its workInputId and full current target, use continue=true and replyToEventId=null. Ask it to finish the still-required report using its retained analysis; idle status or apparently complete prose alone is not accepted completion. "
    + "Copy the returned target/currentTarget unchanged, including null expectedRunId and the current expectedControlVersion; do not guess or increment a version. User-required check-ins and user Stop require direct user continuation.",
  inputSchema: SubagentMessageToolSchema,
  toModelOutput: subagentControlModelOutput,
  execute(candidate, options) {
    try {
      const runId = input.turn.runId;
      if (!runId) throw new Error("SUBAGENT_PARENT_UNAVAILABLE");
      const request = { characterId: input.characterId, target: candidate.target,
        operationKey: `message:${digestRunValue({ runId, toolCallId: options.toolCallId })}`, direction: candidate.direction,
        replyToEventId: candidate.replyToEventId ?? undefined,
        materials: selectSubagentMaterials(input, candidate.materials) };
      if (!candidate.continue && !candidate.replyToEventId) return input.service.sendCurrent({ ...request,
        subagentId: candidate.target.subagentId, workInputId: candidate.target.workInputId }, { kind: "parent", runId });
      const parsed = SubagentTargetSchema.safeParse(candidate.target);
      if (!parsed.success) throw new Error("SUBAGENT_EXACT_TARGET_REQUIRED");
      const exact = { ...request, target: parsed.data };
      return candidate.continue ? input.service.continue(exact, { kind: "parent", runId }) : input.service.send(exact, { kind: "parent", runId });
    } catch (error) { return subagentToolRefusal(error, { service: input.service, subagentId: candidate.target.subagentId, characterId: input.characterId }); }
  } }) };
}
