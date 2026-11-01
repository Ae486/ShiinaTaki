/**
 * INPUT:  observed auxiliary provider-call starts, terminal outcomes, and bounded history filters
 * OUTPUT: idempotent call rows, boot interruption recovery, whole-filter aggregates and post-commit settlement notices
 * POS:    core/db — metadata-only auxiliary accounting; independent from canonical Run/Effect usage
 */
import { z } from "zod";
import {
  AuxiliaryModelCallSchema,
  AuxiliaryUsageCountsSchema,
  AuxiliaryUsageQuerySchema,
  AuxiliaryUsageResultSchema,
  type AuxiliaryCallSource,
  type AuxiliaryModelCall,
  type AuxiliaryModelCallStatus,
  type AuxiliaryUsageCounts,
  type AuxiliaryUsageQuery,
  type AuxiliaryUsageResult,
} from "@taki/shared";
import { toSafeInteger, type Database, type SqlRow, type SqlValue } from "./sqlite.ts";

export interface AuxiliaryUsageStart {
  callId: string;
  taskId: string | null;
  source: AuxiliaryCallSource;
  label: string;
  provider: string;
  modelId: string;
  startedAt: string;
}

export interface AuxiliaryUsageSettlement {
  callId: string;
  status: Exclude<AuxiliaryModelCallStatus, "started">;
  finishedAt: string | null;
  usage: AuxiliaryUsageCounts;
  responseId: string | null;
}

export interface AuxiliaryUsageRepo {
  start(input: AuxiliaryUsageStart): void;
  settle(input: AuxiliaryUsageSettlement): void;
  reconcileInterrupted(): number;
  query(params: AuxiliaryUsageQuery): AuxiliaryUsageResult;
}

const TerminalStatusSchema = z.enum(["completed", "failed", "cancelled", "interrupted"]);
const SettlementSchema = z.strictObject({
  callId: z.uuid(), status: TerminalStatusSchema,
  finishedAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString()).nullable(),
  usage: AuxiliaryUsageCountsSchema, responseId: z.string().trim().min(1).max(200).nullable(),
});
const COUNT_COLUMNS = {
  inputTokens: "input_tokens",
  noCacheTokens: "no_cache_tokens",
  cacheReadTokens: "cache_read_tokens",
  cacheWriteTokens: "cache_write_tokens",
  outputTokens: "output_tokens",
  reasoningTokens: "reasoning_tokens",
  totalTokens: "total_tokens",
} as const;

export function createAuxiliaryUsageRepo(db: Database, options: { onSettled?: () => void } = {}): AuxiliaryUsageRepo {
  return {
    start(input) { startCall(db, input); },
    settle(input) {
      db.transaction(() => { if (settleCall(db, input) && options.onSettled) db.afterCommit(options.onSettled); });
    },
    reconcileInterrupted() {
      let changed = 0;
      db.transaction(() => {
        changed = db.prepare(`UPDATE auxiliary_model_calls SET status='interrupted',updated_at=:updatedAt
          WHERE status='started'`).run({ updatedAt: new Date().toISOString() }).changes;
        if (changed > 0 && options.onSettled) db.afterCommit(options.onSettled);
      });
      return changed;
    },
    query(params) { return queryCalls(db, params); },
  };
}

function startCall(db: Database, input: AuxiliaryUsageStart): void {
  const usage = emptyUsage();
  const call = AuxiliaryModelCallSchema.parse({
    ...input, finishedAt: null, updatedAt: input.startedAt, status: "started", responseId: null, usage,
  });
  const existing = db.prepare("SELECT * FROM auxiliary_model_calls WHERE call_id=:callId").get({ callId: call.callId });
  if (existing) {
    const current = readCall(existing);
    if (sameStart(current, call)) return;
    throw new Error("AUXILIARY_USAGE_START_CONFLICT");
  }
  db.prepare(`INSERT INTO auxiliary_model_calls
    (call_id,task_id,source,label,provider,model_id,started_at,updated_at,status)
    VALUES (:callId,:taskId,:source,:label,:provider,:modelId,:startedAt,:updatedAt,'started')`).run({
    callId: call.callId, taskId: call.taskId, source: call.source, label: call.label, provider: call.provider,
    modelId: call.modelId, startedAt: call.startedAt, updatedAt: call.updatedAt,
  });
}

function settleCall(db: Database, candidate: AuxiliaryUsageSettlement): boolean {
  const input = SettlementSchema.parse(candidate);
  const row = db.prepare("SELECT * FROM auxiliary_model_calls WHERE call_id=:callId").get({ callId: input.callId });
  if (!row) throw new Error("AUXILIARY_USAGE_CALL_NOT_FOUND");
  const current = readCall(row);
  if (current.status !== "started") {
    if (sameSettlement(current, input)) return false;
    throw new Error("AUXILIARY_USAGE_SETTLEMENT_CONFLICT");
  }
  const changed = db.prepare(`UPDATE auxiliary_model_calls SET
    status=:status,finished_at=:finishedAt,updated_at=:updatedAt,response_id=:responseId,
    input_tokens=:inputTokens,no_cache_tokens=:noCacheTokens,cache_read_tokens=:cacheReadTokens,
    cache_write_tokens=:cacheWriteTokens,output_tokens=:outputTokens,reasoning_tokens=:reasoningTokens,
    total_tokens=:totalTokens WHERE call_id=:callId AND status='started'`).run({
    callId: input.callId, status: input.status, finishedAt: input.finishedAt, updatedAt: new Date().toISOString(),
    responseId: input.responseId, ...input.usage,
  });
  if (changed.changes !== 1) throw new Error("AUXILIARY_USAGE_SETTLEMENT_CONFLICT");
  return true;
}

function queryCalls(db: Database, candidate: AuxiliaryUsageQuery): AuxiliaryUsageResult {
  const query = AuxiliaryUsageQuerySchema.parse(candidate);
  const filter = buildFilter(query);
  const pageFilter = [...filter.predicates]; const pageParams = { ...filter.params };
  if (query.cursor) {
    pageFilter.push("(started_at<:cursorStarted OR (started_at=:cursorStarted AND call_id<:cursorCall))");
    pageParams.cursorStarted = query.cursor.startedAt; pageParams.cursorCall = query.cursor.callId;
  }
  pageParams.pageLimit = query.limit + 1;
  const candidates = db.prepare(`SELECT * FROM auxiliary_model_calls WHERE ${pageFilter.join(" AND ")}
    ORDER BY started_at DESC,call_id DESC LIMIT :pageLimit`).all(pageParams);
  const rows = candidates.slice(0, query.limit).map(readCall);
  const nextCursor = candidates.length > query.limit && rows.length > 0
    ? { startedAt: rows.at(-1)!.startedAt, callId: rows.at(-1)!.callId }
    : null;
  const aggregate = readAggregate(db, filter.predicates.join(" AND "), filter.params);
  return AuxiliaryUsageResultSchema.parse({
    scope: "observed-auxiliary", rows, nextCursor, ...aggregate,
  });
}

function buildFilter(query: AuxiliaryUsageQuery): { predicates: string[]; params: Record<string, SqlValue> } {
  const predicates = ["started_at>=:from", "started_at<:to"];
  const params: Record<string, SqlValue> = { from: query.from, to: query.to };
  for (const [field, column] of [["source", "source"], ["label", "label"], ["provider", "provider"], ["modelId", "model_id"]] as const) {
    const value = query[field];
    if (value !== undefined) { predicates.push(`${column}=:${field}`); params[field] = value; }
  }
  return { predicates, params };
}

function readAggregate(db: Database, where: string, params: Record<string, SqlValue>) {
  const tokenSql = Object.values(COUNT_COLUMNS).flatMap((column) => [
    `SUM(${column}) AS ${column}_sum`, `COUNT(${column}) AS ${column}_known`,
  ]).join(",");
  const row = db.prepare(`SELECT COUNT(*) AS total_calls,
    COUNT(CASE WHEN status='started' THEN 1 END) AS state_started,
    COUNT(CASE WHEN status='completed' THEN 1 END) AS state_completed,
    COUNT(CASE WHEN status='failed' THEN 1 END) AS state_failed,
    COUNT(CASE WHEN status='cancelled' THEN 1 END) AS state_cancelled,
    COUNT(CASE WHEN status='interrupted' THEN 1 END) AS state_interrupted,
    ${tokenSql},
    COUNT(CASE WHEN input_tokens IS NOT NULL AND cache_read_tokens IS NOT NULL THEN 1 END) AS paired_count,
    SUM(CASE WHEN input_tokens IS NOT NULL AND cache_read_tokens IS NOT NULL THEN input_tokens END) AS paired_input,
    SUM(CASE WHEN input_tokens IS NOT NULL AND cache_read_tokens IS NOT NULL THEN cache_read_tokens END) AS paired_cache
    FROM auxiliary_model_calls WHERE ${where}`).get(params);
  if (!row) throw new Error("AUXILIARY_USAGE_AGGREGATE_MISSING");
  const tokenCounts = Object.fromEntries(Object.entries(COUNT_COLUMNS).map(([field, column]) => [field, {
    sum: nullableInteger(row[`${column}_sum`]), knownCount: integer(row[`${column}_known`]),
  }]));
  const pairedCount = integer(row.paired_count);
  const inputTokens = nullableInteger(row.paired_input);
  const cacheReadTokens = nullableInteger(row.paired_cache);
  return {
    totalCalls: integer(row.total_calls),
    stateCounts: {
      started: integer(row.state_started), completed: integer(row.state_completed), failed: integer(row.state_failed),
      cancelled: integer(row.state_cancelled), interrupted: integer(row.state_interrupted),
    },
    tokenCounts,
    cacheRead: {
      pairedCount, inputTokens, cacheReadTokens,
      ratio: inputTokens !== null && inputTokens > 0 && cacheReadTokens !== null ? cacheReadTokens / inputTokens : null,
    },
  };
}

function readCall(row: SqlRow): AuxiliaryModelCall {
  return AuxiliaryModelCallSchema.parse({
    callId: row.call_id, taskId: row.task_id, source: row.source, label: row.label, provider: row.provider,
    modelId: row.model_id, startedAt: row.started_at, finishedAt: row.finished_at, updatedAt: row.updated_at,
    status: row.status, responseId: row.response_id,
    usage: Object.fromEntries(Object.entries(COUNT_COLUMNS).map(([field, column]) => [field, nullableInteger(row[column])])),
  });
}

function sameStart(left: AuxiliaryModelCall, right: AuxiliaryModelCall): boolean {
  return left.callId === right.callId && left.taskId === right.taskId && left.source === right.source &&
    left.label === right.label && left.provider === right.provider && left.modelId === right.modelId &&
    left.startedAt === right.startedAt;
}

function sameSettlement(call: AuxiliaryModelCall, input: z.infer<typeof SettlementSchema>): boolean {
  return call.status === input.status && call.finishedAt === input.finishedAt && call.responseId === input.responseId &&
    Object.keys(COUNT_COLUMNS).every((field) => call.usage[field as keyof AuxiliaryUsageCounts] === input.usage[field as keyof AuxiliaryUsageCounts]);
}

function emptyUsage(): AuxiliaryUsageCounts {
  return { inputTokens: null, noCacheTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
    outputTokens: null, reasoningTokens: null, totalTokens: null };
}

function integer(value: SqlValue | undefined): number {
  if (typeof value !== "number" && typeof value !== "bigint") throw new Error("AUXILIARY_USAGE_INVALID_COUNT");
  return z.int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(toSafeInteger(value));
}

function nullableInteger(value: SqlValue | undefined): number | null {
  return value === null ? null : integer(value);
}
