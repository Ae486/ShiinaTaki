/**
 * INPUT: trusted admitted main execution, actual tool lookup and optional original primary witness
 * OUTPUT: governed thin delegate/message/stop/inspect tool composition
 * POS: core/agents — main-to-child tool surface; child creation never grants publication authority
 */
import type { ToolSet } from "ai";
import type { SubagentInput, TimelineEntry, MaterialRef } from "@taki/shared";
import type { TurnContext } from "./chat-agent.ts";
import type { SubagentService } from "../harness/subagent-service.ts";
import { createSubagentDelegateTool } from "./subagent-delegate-tool.ts";
import { createSubagentMessageTool } from "./subagent-message-tool.ts";
import { createSubagentStopTool } from "./subagent-stop-tool.ts";
import { createSubagentInspectTool } from "./subagent-inspect-tool.ts";

export interface SubagentToolBinding {
  service: SubagentService; characterId: string; turn: TurnContext; userEntry?: TimelineEntry;
  captureReply?(binding: SubagentToolBinding, work: SubagentInput): Promise<void>;
}
export function createSubagentTools(input: SubagentToolBinding): ToolSet {
  return { ...createSubagentDelegateTool(input), ...createSubagentMessageTool(input), ...createSubagentStopTool(input),
    ...createSubagentInspectTool({ service: input.service, characterId: input.characterId }) };
}
export function selectSubagentMaterials(input: SubagentToolBinding, refs: MaterialRef[]) {
  return refs.map((ref, index) => {
    const material = input.turn.materials?.select(ref) ?? input.service.selectMaterials(input.characterId, [ref])[0];
    if (!material) throw new Error("SUBAGENT_MATERIAL_NOT_FOUND");
    return { ...material, key: `selected:${index}` };
  });
}
export function subagentToolRefusal(error: unknown) {
  return { ok: false, code: error instanceof Error && /^SUBAGENT_[A-Z_]+$/.test(error.message) ? error.message : "SUBAGENT_UNAVAILABLE",
    message: "The work operation was refused. Inspect the child for its current state; do not assume it executed." };
}
