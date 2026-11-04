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
export function subagentToolRefusal(error: unknown, input?: { service: SubagentService; subagentId: string; characterId: string }) {
  let current;
  try {
    const summary = input?.service.summary(input.subagentId);
    current = summary?.characterId === input?.characterId ? summary : undefined;
  } catch { current = undefined; }
  return { ok: false, code: error instanceof Error && /^SUBAGENT_[A-Z_]+$/.test(error.message) ? error.message : "SUBAGENT_UNAVAILABLE",
    message: "The work operation was refused; no accepted action can be assumed.", current,
    currentTarget: current ? { subagentId: current.subagentId, workInputId: current.pendingRequest?.workInputId ?? current.activeWorkInputId ?? current.latestWorkInputId,
      expectedRunId: current.activeRunId, expectedControlVersion: current.controlVersion } : null,
    nextAction: current?.stopOrigin === "user" || current?.pendingRequest?.checkIn?.requiredActor === "user" ? "Ask the user to Continue this exact work."
      : current?.pendingRequest?.reason === "question"
        ? "If this question is delivered in the current inbox, use handle_agent_event with intent=answer_child, its eventId, the answer in text and currentTarget copied unchanged. For inspected or silent work, use send_subagent_message with pendingRequest.eventId as replyToEventId, continue=false and the answer in direction. Ordinary messages do not resolve this wait."
        : current?.pendingRequest
          ? "For a check-in delivered in the current inbox, use handle_agent_event with intent=continue_child and its exact event and currentTarget. For inspected work, use send_subagent_message with pendingRequest.eventId as replyToEventId and continue=true."
        : "Send an ordinary message by child ID, or refresh the exact target before Stop/Continue." };
}
