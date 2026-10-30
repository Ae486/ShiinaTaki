/**
 * INPUT: exact child/work control target and trusted main-Companion execution
 * OUTPUT: parent-origin durable pause and exact child cancellation acknowledgement
 * POS: core/agents — informational governed control; preserves stronger user stop and retained context
 */
import { tool, type ToolSet } from "ai";
import { SubagentTargetSchema } from "@taki/shared";
import type { SubagentToolBinding } from "./subagent-tools.ts";
import { subagentToolRefusal } from "./subagent-tools.ts";

export function createSubagentStopTool(input: SubagentToolBinding): ToolSet {
  return { stop_subagent: tool({ description: "Pause only the addressed child work using its current control version. "
    + "This preserves its context. A later parent continuation may clear this parent-origin pause, but never a user-origin pause.",
  inputSchema: SubagentTargetSchema,
  execute(target) {
    try { return input.service.stop({ characterId: input.characterId, target }, "parent"); }
    catch (error) { return subagentToolRefusal(error); }
  } }) };
}
