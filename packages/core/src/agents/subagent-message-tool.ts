/**
 * INPUT: exact displayed child/work target, main execution and explicit same-work continuation choice
 * OUTPUT: durable addressed message acknowledgement or typed refusal
 * POS: core/agents — informational governed message tool; parent cannot clear a user-stop latch
 */
import { tool, type ToolSet } from "ai";
import { SubagentMessageToolSchema } from "@taki/shared";
import type { SubagentToolBinding } from "./subagent-tools.ts";
import { subagentToolRefusal, selectSubagentMaterials } from "./subagent-tools.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { subagentControlModelOutput } from "./subagent-control-output.ts";

export function createSubagentMessageTool(input: SubagentToolBinding): ToolSet {
  return { send_subagent_message: tool({ description: "Send selected direction to the exact child work at its next step. "
    + "Set continue=true only to resume a parent-interrupted child; a user-stopped child requires the user's Continue action. Read current controlVersion first.",
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
      return candidate.continue ? input.service.continue(request, { kind: "parent", runId }) : input.service.send(request, { kind: "parent", runId });
    } catch (error) { return subagentToolRefusal(error); }
  } }) };
}
