/**
 * INPUT:  an authorized Run identity and its validated append-only event ledger
 * OUTPUT: SQL-aggregated counts and complete-only usage buckets without loading event payloads into JavaScript
 * POS:    core/db — read projection over existing tables; no counters, migration, or secondary authority
 */
import type { RunMonitorSummary } from "@taki/shared";
import type { Database, SqlRow } from "./sqlite.ts";

type Counts = Pick<RunMonitorSummary, "effectCount" | "modelRequestCount" | "toolCallCount" | "toolResultCount"
  | "toolSuccessCount" | "toolFailureCount" | "failureCount" | "retryCount">;

export function aggregateRunEvents(db: Database, runId: string): Counts & { usage: RunMonitorSummary["usage"] } {
  const row = db.prepare(`SELECT
    count(DISTINCT CASE WHEN kind IN ('effect.intent_committed','effect.waiting','effect.settled')
      THEN json_extract(payload_json,'$.effectId') END) AS effect_count,
    count(*) FILTER (WHERE kind='model.request.started') AS model_count,
    count(*) FILTER (WHERE kind='tool.call.started') AS tool_call_count,
    count(*) FILTER (WHERE kind='tool.result.settled') AS tool_result_count,
    count(*) FILTER (WHERE kind='tool.result.settled' AND json_extract(payload_json,'$.outcome')='completed') AS tool_success_count,
    count(*) FILTER (WHERE kind='model.response.settled' AND json_extract(payload_json,'$.outcome')!='completed') AS model_failure_count,
    count(*) FILTER (WHERE kind='run.retry') AS retry_count
    FROM run_events WHERE run_id=:runId`).get({ runId })!;
  const toolFailureCount = Number(row.tool_result_count) - Number(row.tool_success_count);
  return {
    effectCount: Number(row.effect_count), modelRequestCount: Number(row.model_count),
    toolCallCount: Number(row.tool_call_count), toolResultCount: Number(row.tool_result_count),
    toolSuccessCount: Number(row.tool_success_count), toolFailureCount,
    failureCount: Number(row.model_failure_count) + toolFailureCount, retryCount: Number(row.retry_count),
    usage: aggregateUsage(db, runId),
  };
}

const USAGE_FIELDS = [
  ["input_tokens", "inputTokens"], ["no_cache_tokens", "inputTokenDetails.noCacheTokens"],
  ["cache_read_tokens", "inputTokenDetails.cacheReadTokens"], ["cache_write_tokens", "inputTokenDetails.cacheWriteTokens"],
  ["output_tokens", "outputTokens"], ["text_tokens", "outputTokenDetails.textTokens"],
  ["reasoning_tokens", "outputTokenDetails.reasoningTokens"], ["total_tokens", "totalTokens"],
] as const;

function aggregateUsage(db: Database, runId: string): RunMonitorSummary["usage"] {
  // SUM alone skips NULL. count(expr) must cover every contributor, including a supplied zero.
  const buckets = USAGE_FIELDS.map(([column, path]) => `CASE
    WHEN count(*)=count(json_extract(payload_json,'$.${path}'))
    THEN sum(json_extract(payload_json,'$.${path}')) END AS ${column}`).join(",");
  const row = db.prepare(`SELECT ${buckets}, count(*) AS contributors,
    CASE WHEN count(*)=0 THEN NULL
      WHEN max(json_extract(payload_json,'$.quality')='unknown') THEN 'unknown'
      WHEN max(json_extract(payload_json,'$.quality')='estimated') THEN 'estimated'
      ELSE 'reported' END AS quality
    FROM run_events WHERE run_id=:runId AND kind='usage.settled'`).get({ runId })!;
  if (Number(row.contributors) === 0) return {};
  return {
    ...knownNumbers(row, { inputTokens: "input_tokens", outputTokens: "output_tokens", totalTokens: "total_tokens" }),
    ...optionalDetails("inputTokenDetails", knownNumbers(row, {
      noCacheTokens: "no_cache_tokens", cacheReadTokens: "cache_read_tokens", cacheWriteTokens: "cache_write_tokens",
    })),
    ...optionalDetails("outputTokenDetails", knownNumbers(row, { textTokens: "text_tokens", reasoningTokens: "reasoning_tokens" })),
    quality: row.quality as "reported" | "estimated" | "unknown",
  };
}

function knownNumbers<T extends string>(row: SqlRow, fields: Record<T, string>): Partial<Record<T, number>> {
  const values: Partial<Record<T, number>> = {};
  for (const key of Object.keys(fields) as T[]) {
    const value = row[fields[key]];
    if (value !== null && value !== undefined) values[key] = Number(value);
  }
  return values;
}

function optionalDetails<K extends string, T extends Record<string, number>>(key: K, values: T): Partial<Record<K, T>> {
  return Object.keys(values).length > 0 ? { [key]: values } as Record<K, T> : {};
}
