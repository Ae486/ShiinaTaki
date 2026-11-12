/**
 * INPUT: fixed child/Character repository bindings and one explicit history category/cursor
 * OUTPUT: bounded exact private history pages, including continuations within a large body
 * POS: core/agents — intrinsic read-only recovery; never accepts a model-selected sibling or grants action authority
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { SubagentSelfHistoryRequestSchema, SubagentSelfHistoryResultSchema,
  type SubagentSelfHistoryRequest, type SubagentSelfHistoryResult } from "@taki/shared";
import type { SubagentRepo } from "../db/subagent-repo.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { RunMessageRepo } from "../db/run-message-repo.ts";
import type { SubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";

export const SELF_HISTORY_TOOL_NAME = "read_self_history";
const CursorSchema = z.strictObject({ child: z.string(), category: z.enum(["messages", "inputs", "results", "materials"]),
  after: z.union([z.number().int().nonnegative(), z.string()]), through: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(), recordId: z.string().nullable() });
type Cursor = z.infer<typeof CursorSchema>;
export interface SelfHistoryInput {
  characterId: string; subagentId: string; children: SubagentRepo; inputs: SubagentInputRepo;
  executions: SubagentExecutionRepo; messages: RunMessageRepo;
  toolResults?: SubagentToolResultRepo;
}

export function createSubagentSelfHistoryTool(input: SelfHistoryInput): ToolSet {
  return { [SELF_HISTORY_TOOL_NAME]: tool({
    description: "Read exact retained history of this worker only. Choose messages, inputs (with actual sender), results, or materials (full raw tool results). "
      + "Start with cursor=null, then pass nextCursor unchanged. A large record continues on subsequent body pages; "
      + "complete=false means this is not its whole body. Reads do not resume work or mark it completed.",
    inputSchema: SubagentSelfHistoryRequestSchema,
    execute: (request) => readSubagentSelfHistory(input, request),
  }) };
}

export function readSubagentSelfHistory(input: SelfHistoryInput, request: SubagentSelfHistoryRequest): SubagentSelfHistoryResult {
  const base = { subagentId: input.subagentId, category: request.category, records: [], nextCursor: null, hasMore: false };
  let cursor: Cursor;
  try {
    cursor = request.cursor ? CursorSchema.parse(JSON.parse(request.cursor)) : { child: input.subagentId,
      category: request.category, after: request.category === "results" ? "" : 0, through: null, offset: 0, recordId: null };
    if (cursor.child !== input.subagentId || cursor.category !== request.category) throw new Error("CURSOR_SCOPE_MISMATCH");
    if ((cursor.category === "results") !== (typeof cursor.after === "string")) throw new Error("CURSOR_TYPE_MISMATCH");
    if ((cursor.offset > 0) !== (cursor.recordId !== null)) throw new Error("CURSOR_BODY_MISMATCH");
    if (request.cursor && (cursor.category === "results") !== (cursor.through === null)) throw new Error("CURSOR_WATERMARK_MISMATCH");
  } catch { return { ...base, status: "invalid_cursor", message: "This cursor does not address the selected worker and category. Start with cursor=null." }; }
  try {
    if (input.children.get(input.subagentId).characterId !== input.characterId) {
      return { ...base, status: "unavailable", message: "This private worker is unavailable in the captured Character scope." };
    }
    if (request.category === "materials" && !input.toolResults) return { ...base, status: "unavailable",
      message: "The full raw tool-result repository is unavailable for this execution." };
    if (!request.cursor) cursor.through = historyWatermark(input, cursor.category);
    return page(input, { request, cursor });
  } catch { return { ...base, status: "failed", message: "The retained history read failed. No empty-history or completion conclusion can be drawn." }; }
}

function page(input: SelfHistoryInput, state: { request: SubagentSelfHistoryRequest; cursor: Cursor }): SubagentSelfHistoryResult {
  const { request } = state;
  let cursor = state.cursor;
  const records: SubagentSelfHistoryResult["records"] = [];
  let remaining = 3_000;
  while (records.length < request.limit && remaining > 0) {
    const row = nextRecord(input, cursor);
    if (!row) { if (cursor.recordId) return invalidPage(input, request); break; }
    if (cursor.recordId && row.id !== cursor.recordId) return invalidPage(input, request);
    const text = JSON.stringify(row.value);
    if (cursor.offset > text.length) return invalidPage(input, request);
    let end = Math.min(text.length, cursor.offset + remaining);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text.charAt(end - 1))) end -= 1;
    const body = text.slice(cursor.offset, end);
    records.push({ id: row.id, body, offset: cursor.offset, complete: end === text.length });
    remaining -= body.length;
    cursor = end < text.length ? { ...cursor, offset: end, recordId: row.id }
      : { ...cursor, after: row.after, offset: 0, recordId: null };
    if (end < text.length) break;
  }
  const hasMore = cursor.offset > 0 || nextRecord(input, cursor) !== undefined;
  return SubagentSelfHistoryResultSchema.parse({ subagentId: input.subagentId, category: request.category,
    status: records.length ? "available" : "empty", records, hasMore, nextCursor: hasMore ? JSON.stringify(cursor) : null,
    message: hasMore ? "Exact retained content continues at nextCursor." : "This category has no further retained records." });
}

function nextRecord(input: SelfHistoryInput, cursor: Cursor): { id: string; after: string | number; value: unknown } | undefined {
  const record = nextUnboundedRecord(input, cursor);
  if (record && typeof record.after === "number" && cursor.through !== null && record.after > cursor.through) return undefined;
  return record;
}

function historyWatermark(input: SelfHistoryInput, category: Cursor["category"]): number | null {
  if (category === "messages") return input.messages.history({ subagentId: input.subagentId, newest: true, limit: 1 })[0]?.seq ?? 0;
  if (category === "inputs") return input.children.get(input.subagentId).nextInputSeq - 1;
  if (category === "materials") return input.toolResults?.latestSequence(input.subagentId) ?? 0;
  // A worker's active Run cannot admit another execution during its own tool loop.
  return null;
}

function nextUnboundedRecord(input: SelfHistoryInput, cursor: Cursor): { id: string; after: string | number; value: unknown } | undefined {
  if (cursor.category === "materials") {
    if (typeof cursor.after !== "number") throw new Error("INVALID_CURSOR");
    const row = input.toolResults?.next({ subagentId: input.subagentId, afterSeq: cursor.after });
    return row ? { id: String(row.seq), after: row.seq, value: row.result } : undefined;
  }
  if (cursor.category === "messages") {
    if (typeof cursor.after !== "number") throw new Error("INVALID_CURSOR");
    const row = input.messages.history({ subagentId: input.subagentId, afterSeq: cursor.after, limit: 1 })[0];
    return row ? { id: String(row.seq), after: row.seq, value: row } : undefined;
  }
  if (cursor.category === "inputs") {
    if (typeof cursor.after !== "number") throw new Error("INVALID_CURSOR");
    const row = input.inputs.list({ subagentId: input.subagentId, afterSeq: cursor.after, limit: 1 })[0];
    return row ? { id: row.inputId, after: row.inputSeq, value: row } : undefined;
  }
  if (typeof cursor.after !== "string") throw new Error("INVALID_CURSOR");
  const row = input.executions.list({ subagentId: input.subagentId, afterRunId: cursor.after || undefined, limit: 1 })[0];
  return row ? { id: row.runId, after: row.runId, value: { runId: row.runId, workInputId: row.workInputId,
    result: input.executions.result(row.runId) ?? null } } : undefined;
}

function invalidPage(input: SelfHistoryInput, request: SubagentSelfHistoryRequest): SubagentSelfHistoryResult {
  return { subagentId: input.subagentId, category: request.category, status: "invalid_cursor", records: [],
    nextCursor: null, hasMore: false, message: "The body continuation no longer matches the retained record. Start with cursor=null." };
}
