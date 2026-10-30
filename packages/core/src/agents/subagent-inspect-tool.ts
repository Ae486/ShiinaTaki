/**
 * INPUT: bounded child/result/history selectors and trusted Character/private-work scope
 * OUTPUT: inspectable retained work, exact targeting versions and actual publication disposition
 * POS: core/agents — read-only informational tool; source/outcome metadata survives native tool results
 */
import { tool, type ToolSet } from "ai";
import { SubagentInspectToolSchema, SubagentListParamsSchema } from "@taki/shared";
import type { SubagentService } from "../harness/subagent-service.ts";
import { readSubagentSelfHistory } from "./subagent-self-history-tool.ts";
import { createSubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";

export function createSubagentInspectTool(input: { service: SubagentService; characterId: string; subagentId?: string }): ToolSet {
  return { inspect_subagent: tool({ description: "Read a retained child result (completionId), a paged private conversation (subagentId), or list this Character's workers (both null). "
    + "Choose one category: messages, inputs, results or materials. cursor=null starts; pass nextCursor unchanged for every page, including body pages. "
    + "With no child, workers lists one page. Completion is not proof of public speech.",
  inputSchema: SubagentInspectToolSchema,
  execute(params) {
    try {
      if (input.subagentId && params.subagentId !== input.subagentId && !params.completionId) throw new Error("SUBAGENT_WORK_MISMATCH");
      if (params.completionId) {
        const result = input.service.result({ characterId: input.characterId, completionId: params.completionId });
        if (input.subagentId && result.result.child.subagentId !== input.subagentId) throw new Error("SUBAGENT_WORK_MISMATCH");
        return result;
      }
      if (!params.subagentId) return input.service.list(SubagentListParamsSchema.parse({ characterId: input.characterId,
        afterId: params.cursor ?? undefined, limit: params.limit }));
      if (params.category === "workers") throw new Error("SUBAGENT_CATEGORY_MISMATCH");
      return readSubagentSelfHistory({ ...input.service.state.deps, characterId: input.characterId, subagentId: params.subagentId,
        toolResults: createSubagentToolResultRepo(input.service.state.deps.db) },
      { category: params.category ?? "messages", cursor: params.cursor ?? null, limit: Math.min(params.limit, 20) });
    } catch { return { ok: false, code: "SUBAGENT_READ_UNAVAILABLE", message: "The requested work could not be read in this scope." }; }
  } }) };
}
