/**
 * INPUT: bounded child/result/history selectors and trusted Character/private-work scope
 * OUTPUT: inspectable retained work, exact targeting versions and actual publication disposition
 * POS: core/agents — read-only informational tool; source/outcome metadata survives native tool results
 */
import { tool, type ToolSet } from "ai";
import { SubagentInspectToolSchema } from "@taki/shared";
import type { SubagentService } from "../harness/subagent-service.ts";

export function createSubagentInspectTool(input: { service: SubagentService; characterId: string; subagentId?: string }): ToolSet {
  return { inspect_subagent: tool({ description: "Read a retained child result (completionId), a paged private conversation (subagentId), or list this Character's workers (both null). "
    + "Results include actual outcomes and available source meaning; completion is not proof that a reply was published. afterSeq=0 starts history; use returned cursors for more.",
  inputSchema: SubagentInspectToolSchema,
  execute(params) {
    try {
      if (input.subagentId && params.subagentId !== input.subagentId && !params.completionId) throw new Error("SUBAGENT_WORK_MISMATCH");
      if (params.completionId) {
        const result = input.service.result({ characterId: input.characterId, completionId: params.completionId });
        if (input.subagentId && result.result.child.subagentId !== input.subagentId) throw new Error("SUBAGENT_WORK_MISMATCH");
        return result;
      }
      return params.subagentId ? input.service.history({ characterId: input.characterId, subagentId: params.subagentId,
        afterSeq: params.afterSeq, inputAfterSeq: 0, limit: params.limit }) : input.service.list({ characterId: input.characterId, limit: params.limit });
    } catch { return { ok: false, code: "SUBAGENT_READ_UNAVAILABLE", message: "The requested work could not be read in this scope." }; }
  } }) };
}
