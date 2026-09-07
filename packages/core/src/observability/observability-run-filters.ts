/**
 * INPUT:  an authorized Run summary and validated semantic list filters
 * OUTPUT: bounded existence checks over canonical event fields, with literal text matching
 * POS:    core/observability — filters scan in SQLite without fetching full event ledgers or raw payloads
 */
import type { RunMonitorListParams, RunMonitorSummary } from "@taki/shared";
import type { Database, SqlRow } from "../db/sqlite.ts";

interface FilterItem { db: Database; raw: SqlRow; run: RunMonitorSummary }
interface Predicate { sql: string; params: SqlRow }

export function matchesRunFilters(item: FilterItem, filter: RunMonitorListParams): boolean {
  const run = item.run;
  if (filter.initiators && !filter.initiators.includes(run.initiator)) return false;
  if (filter.states && !filter.states.includes(run.state)) return false;
  if (filter.outcomes && (!run.outcome || !filter.outcomes.includes(run.outcome))) return false;
  if (filter.deliveryClasses && !filter.deliveryClasses.includes(run.deliveryClass)) return false;
  if (filter.taskId && item.raw.task_id !== filter.taskId) return false;
  if (filter.parentRunId && item.raw.parent_run_id !== filter.parentRunId) return false;
  if (filter.from && run.queuedAt < filter.from) return false;
  if (filter.to && run.queuedAt > filter.to) return false;
  if (filter.hasRetry !== undefined && (run.retryCount > 0) !== filter.hasRetry) return false;
  if (filter.hasFailure !== undefined && (run.failureCount > 0) !== filter.hasFailure) return false;
  const predicates = eventPredicates(run, filter);
  return predicates.every((predicate) => Boolean(item.db.prepare(`SELECT EXISTS(
    SELECT 1 FROM run_events WHERE run_id=:runId AND (${predicate.sql}) LIMIT 1) AS matched`)
    .get({ runId: run.key, ...predicate.params })?.matched));
}

function eventPredicates(run: RunMonitorSummary, filter: RunMonitorListParams): Predicate[] {
  const predicates: Predicate[] = [];
  if (filter.provider && filter.provider !== run.provider) predicates.push(modelIdentity("provider", filter.provider));
  if (filter.modelId && filter.modelId !== run.modelId) predicates.push(modelIdentity("modelId", filter.modelId));
  if (filter.toolName) predicates.push({
    sql: "kind IN ('tool.call.started','tool.result.settled') AND json_extract(payload_json,'$.toolName')=:value",
    params: { value: filter.toolName },
  });
  if (filter.errorCode) predicates.push({ sql: "json_extract(payload_json,'$.errorCode')=:value", params: { value: filter.errorCode } });
  if (filter.categories) predicates.push(inList("category", filter.categories));
  if (filter.kinds) predicates.push(inList("kind", filter.kinds));
  const text = filter.text?.toLowerCase();
  if (text && ![run.title, run.triggerLabel, run.summary ?? ""].join(" ").toLowerCase().includes(text)) {
    predicates.push(textPredicate(text));
  }
  return predicates;
}

function modelIdentity(key: "provider" | "modelId", value: string): Predicate {
  return {
    sql: `kind IN ('model.request.started','model.response.settled') AND json_extract(payload_json,'$.${key}')=:value`,
    params: { value },
  };
}

function inList(column: "category" | "kind", values: readonly string[]): Predicate {
  if (values.length === 0) return { sql: "0", params: {} };
  return {
    sql: `${column} IN (${values.map((_, index) => `:v${index}`).join(",")})`,
    params: Object.fromEntries(values.map((value, index) => [`v${index}`, value])),
  };
}

function textPredicate(text: string): Predicate {
  // Concatenate only the same bounded safe fields as the prior projection. Wildcards remain literal data.
  const fields = ["summary", "errorCode", "provider", "modelId", "toolName", "displayName"];
  const textFields = ["kind", "category", ...fields.map((field) => `coalesce(json_extract(payload_json,'$.${field}'),'')`)];
  return { sql: `instr(lower(${textFields.join(" || ' ' || ")}),:text)>0`, params: { text } };
}
