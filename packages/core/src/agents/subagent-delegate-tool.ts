/**
 * INPUT: model-chosen task/context/tool subset and trusted current main execution
 * OUTPUT: durable independent-work acknowledgement, never the eventual child result
 * POS: core/agents — informational governed delegate tool; accepted work does not inherit the parent's abort signal
 */
import { tool, type ToolSet } from "ai";
import { SubagentDelegateToolSchema } from "@taki/shared";
import type { SubagentToolBinding } from "./subagent-tools.ts";
import { subagentToolRefusal, selectSubagentMaterials } from "./subagent-tools.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { WORK_COLLECTOR_TOOLS } from "../harness/delegation-tools.ts";
import { fenceUntrusted } from "./untrusted-fence.ts";
import { subagentControlModelOutput } from "./subagent-control-output.ts";

export function createSubagentDelegateTool(input: SubagentToolBinding): ToolSet {
  return { delegate_subagent: tool({
    description: "Delegate a focused job to an independently running worker, or reuse its exact subagentId. "
      + "Choose fresh context or an explicit selected summary snapshot; later main chat is not copied. "
      + "Use request_parent (the default) when the worker should report back: its reports, progress messages and blocking questions reach your inbox for follow-up. An inbox notification does not itself publish a reply to the user. "
      + "Use record_only only for silent work whose results and questions will be inspected explicitly; it sends no ordinary inbox notifications. Core progress check-ins still reach your inbox under either policy. "
      + "A worker's requested report format applies to the text in its result or question event; it need not send a separate plain assistant message. "
      + "Use null toolSelection to inherit permitted tools; allow lists and inherited exclusions narrow executable tools. Child Memory is always read-only. "
      + "Use null subagentId for a new worker. This returns an acknowledgement, not a completed result. Acknowledge pending work and continue useful foreground work. For request_parent, end the current reply when only worker results remain pending; workers continue independently and later inbox events let you finish the original request without another user message. Do not poll inspect_subagent just to wait for completion.",
    inputSchema: SubagentDelegateToolSchema,
    toModelOutput: subagentControlModelOutput,
    async execute(candidate, options) {
      try {
        const runId = input.turn.runId;
        if (!runId || !input.turn.attemptId || !input.turn.executableTools) throw new Error("SUBAGENT_PARENT_UNAVAILABLE");
        const names = Object.keys(input.turn.executableTools);
        const selected = candidate.toolSelection?.mode === "allow" ? candidate.toolSelection.names : candidate.toolSelection?.excludeNames;
        if (selected?.some((name) => !names.includes(name) && !(WORK_COLLECTOR_TOOLS as readonly string[]).includes(name))) throw new Error("SUBAGENT_TOOL_UNAVAILABLE");
        return await input.service.delegate({ parentRunId: runId, parentToolNames: names }, {
          characterId: input.characterId, operationKey: `delegate:${digestRunValue({ runId, toolCallId: options.toolCallId })}`,
          label: candidate.label, subagentId: candidate.subagentId ?? undefined, direction: candidate.direction,
          materials: selectSubagentMaterials(input, candidate.materials),
          initialContext: candidate.context.kind === "fresh" ? { kind: "fresh" } : { kind: "snapshot", materials: [],
            messages: [{ role: "user", content: "Core supplied a summary selected by the delegating Companion, not an original user quote.\n"
              + fenceUntrusted({ source: "parent-selected-summary", content: candidate.context.summary }) }] },
          completionPolicy: candidate.completionPolicy, toolSelection: candidate.toolSelection ?? undefined,
        }, { signal: options.abortSignal ?? input.turn.signal,
          onAccepted: async (work) => {
            input.turn.independentWorkAccepted = true;
            if (input.userEntry && candidate.completionPolicy === "request_parent") await input.captureReply?.(input, work);
          } });
      } catch (error) { return subagentToolRefusal(error); }
    },
  }) };
}
