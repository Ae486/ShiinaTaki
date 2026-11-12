/**
 * INPUT: bounded child/result/history selectors and trusted Character/private-work scope
 * OUTPUT: inspectable retained work, exact targeting versions and actual publication disposition
 * POS: core/agents — read-only informational tool; source/outcome metadata survives native tool results
 */
import { tool, type ToolSet } from "ai";
import { SubagentInspectToolSchema, SubagentListParamsSchema, SubagentListResultSchema } from "@taki/shared";
import type { SubagentService } from "../harness/subagent-service.ts";
import { readSubagentSelfHistory } from "./subagent-self-history-tool.ts";
import { createSubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";
import { subagentEvidencePage, subagentHistoryEvidence, subagentResultEvidence, subagentInspectionPage } from "./subagent-evidence-output.ts";
import { subagentToolRefusal } from "./subagent-tools.ts";
import { readSubagentEventInspection } from "./subagent-event-inspection.ts";
import { subagentScopedModelState, subagentWorkerModelState } from "./subagent-model-state.ts";

export function createSubagentInspectTool(input: { service: SubagentService; characterId: string; subagentId?: string }): ToolSet {
  return { inspect_subagent: tool({ description: "Read a retained child result (completionId), a paged private conversation (subagentId), or list this Character's workers (both null). "
    + "Choose one category: messages, inputs, results, materials or events. Events exposes accepted questions/reports, including record_only workers; use it to read a pending request's question before answering its exact event and target. "
    + "Inspect for a concrete need: missing evidence, a relevant user request, guidance/correction, or silent record_only work. For an already delivered inbox preview, use read_agent_inbox if its detail is needed. An empty result is a snapshot; do not repeat the call just to wait for request_parent completion. End the current reply if only notified worker results remain pending; later inbox events resume the work. "
    + "cursor=null starts; pass nextCursor unchanged for every page, including body pages. Reading events does not deliver or handle an inbox event. "
    + "With no child, workers or null/default category lists compact state and exact targets; diagnostics explicitly requests full progress/usage. readStatus and bodyComplete describe retrieval, not task completion; resultStatus=not_recorded means no terminal report is recorded. Completion is not proof of public speech.",
  inputSchema: SubagentInspectToolSchema,
  toModelOutput({ input: params, output }) {
    const page = !params.subagentId && !params.completionId && params.category !== "diagnostics"
      ? SubagentListResultSchema.safeParse(output) : undefined;
    const value = page?.success ? { entries: page.data.entries.map(subagentWorkerModelState), nextCursor: page.data.nextCursor }
      : subagentInspectionPage(subagentScopedModelState(output));
    return { type: "json", value: JSON.parse(JSON.stringify(value)) };
  },
  execute(params) {
    try {
      if (input.subagentId && params.subagentId !== input.subagentId && !params.completionId) throw new Error("SUBAGENT_WORK_MISMATCH");
      if (params.completionId) {
        const result = input.service.result({ characterId: input.characterId, completionId: params.completionId });
        if (input.subagentId && result.result.child.subagentId !== input.subagentId) throw new Error("SUBAGENT_WORK_MISMATCH");
        return subagentEvidencePage({ completionId: params.completionId, cursor: params.cursor ?? null,
          value: { result: subagentResultEvidence(result.result), deliveryState: result.deliveryState } });
      }
      if (!params.subagentId) return input.service.list(SubagentListParamsSchema.parse({ characterId: input.characterId,
        afterId: params.cursor ?? undefined, limit: params.limit }));
      if (params.category === "workers" || params.category === "diagnostics") throw new Error("SUBAGENT_CATEGORY_MISMATCH");
      if (params.category === "events") return readSubagentEventInspection(input.service.state, {
        characterId: input.characterId, subagentId: params.subagentId, cursor: params.cursor ?? null, limit: params.limit });
      return readSubagentSelfHistory({ ...input.service.state.deps, characterId: input.characterId, subagentId: params.subagentId,
        projectRecord: subagentHistoryEvidence,
        toolResults: createSubagentToolResultRepo(input.service.state.deps.db) },
      { category: params.category ?? "messages", cursor: params.cursor ?? null, limit: Math.min(params.limit, 20) });
    } catch (error) { return subagentToolRefusal(error, params.subagentId ? { service: input.service, subagentId: params.subagentId, characterId: input.characterId } : undefined); }
  } }) };
}
