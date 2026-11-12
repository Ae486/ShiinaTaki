/**
 * INPUT: completed private SDK tool outputs and exact Run/Attempt/task-step invocation coordinates
 * OUTPUT: immutable full raw result bodies before model-output projection, with scope-readable material metadata
 * POS: core/db — private tool evidence only; no replay, publication or execution authority
 */
import { ToolSourceMaterialSchema, type ToolSourceMaterial } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export interface PrivateToolResult {
  runId: string; attemptId: string; stepNumber: number; toolCallId: string; toolName: string;
  text: string; materials: ToolSourceMaterial[];
}
export function createSubagentToolResultRepo(db: Database) {
  return {
    latestSequence(subagentId: string): number {
      const row = db.prepare(`SELECT max(r.rowid) AS seq FROM subagent_tool_results r
        JOIN subagent_executions e ON e.run_id=r.run_id WHERE e.subagent_id=:child`).get({ child: subagentId });
      return Number(row?.seq ?? 0);
    },
    persist(input: PrivateToolResult): void {
      const params = { run: input.runId, attempt: input.attemptId, step: input.stepNumber, call: input.toolCallId };
      const previous = db.prepare(`SELECT * FROM subagent_tool_results WHERE run_id=:run AND attempt_id=:attempt
        AND step_number=:step AND tool_call_id=:call`).get(params);
      const materials = JSON.stringify(input.materials);
      if (previous) {
        if (previous.tool_name !== input.toolName || previous.output_json !== input.text || previous.materials_json !== materials) {
          throw new Error("SUBAGENT_TOOL_RESULT_CONFLICT");
        }
        return;
      }
      db.prepare(`INSERT INTO subagent_tool_results(run_id,attempt_id,step_number,tool_call_id,tool_name,output_json,materials_json)
        VALUES(:run,:attempt,:step,:call,:name,:output,:materials)`)
        .run({ ...params, name: input.toolName, output: input.text, materials });
    },
    read(input: Pick<PrivateToolResult, "runId" | "attemptId" | "stepNumber" | "toolCallId">): PrivateToolResult | undefined {
      const row = db.prepare(`SELECT * FROM subagent_tool_results WHERE run_id=:run AND attempt_id=:attempt
        AND step_number=:step AND tool_call_id=:call`).get({ run: input.runId, attempt: input.attemptId,
        step: input.stepNumber, call: input.toolCallId });
      return row ? { ...input, toolName: String(row.tool_name), text: String(row.output_json),
        materials: ToolSourceMaterialSchema.array().parse(JSON.parse(String(row.materials_json))) } : undefined;
    },
    next(input: { subagentId: string; afterSeq: number }): { seq: number; result: PrivateToolResult } | undefined {
      const row = db.prepare(`SELECT r.rowid AS seq,r.* FROM subagent_tool_results r JOIN subagent_executions e ON e.run_id=r.run_id
        WHERE e.subagent_id=:child AND r.rowid>:after ORDER BY r.rowid LIMIT 1`).get({ child: input.subagentId, after: input.afterSeq });
      return row ? { seq: Number(row.seq), result: { runId: String(row.run_id), attemptId: String(row.attempt_id),
        stepNumber: Number(row.step_number), toolCallId: String(row.tool_call_id), toolName: String(row.tool_name),
        text: String(row.output_json), materials: ToolSourceMaterialSchema.array().parse(JSON.parse(String(row.materials_json))) } } : undefined;
    },
  };
}
export type SubagentToolResultRepo = ReturnType<typeof createSubagentToolResultRepo>;
