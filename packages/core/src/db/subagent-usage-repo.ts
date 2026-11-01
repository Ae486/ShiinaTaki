/**
 * INPUT: child execution lineage and canonical model Effects with optional usage records
 * OUTPUT: cumulative per-field complete totals and explicitly partial known total
 * POS: core/db — read projection includes Utility models and excludes parent inbox overhead
 */
import { SubagentTokenUsageSchema } from "@taki/shared";
import type { Database } from "./sqlite.ts";

export function readSubagentTokenUsage(db: Database, subagentId: string) {
  const row = db.prepare(`SELECT count(*) AS effects,
    sum(CASE WHEN e.state<>'terminal' THEN 1 ELSE 0 END) AS inflight,
    sum(CASE WHEN u.usage_id IS NULL OR u.input_tokens IS NULL OR u.output_tokens IS NULL THEN 1 ELSE 0 END) AS missing,
    count(u.input_tokens) AS input_count,count(u.output_tokens) AS output_count,
    sum(u.input_tokens) AS input_total,sum(u.output_tokens) AS output_total,
    sum(CASE WHEN u.input_tokens IS NOT NULL AND u.output_tokens IS NOT NULL THEN u.input_tokens+u.output_tokens END) AS known_total
    FROM run_effects e JOIN subagent_executions x ON x.run_id=e.run_id
    LEFT JOIN run_usage u ON u.effect_id=e.effect_id WHERE x.subagent_id=:child AND e.kind='model'`).get({ child: subagentId });
  const modelEffects = Number(row?.effects ?? 0);
  const inflightEffects = Number(row?.inflight ?? 0);
  const missingUsageEffects = Number(row?.missing ?? 0);
  const inputTokens = inflightEffects === 0 && Number(row?.input_count ?? 0) === modelEffects ? Number(row?.input_total ?? 0) : null;
  const outputTokens = inflightEffects === 0 && Number(row?.output_count ?? 0) === modelEffects ? Number(row?.output_total ?? 0) : null;
  // Historical total_tokens can be a single-sided synthetic sum; only both canonical components establish a total.
  return SubagentTokenUsageSchema.parse({ modelEffects, inflightEffects, missingUsageEffects, inputTokens, outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    knownTotalTokens: modelEffects === 0 ? 0 : row?.known_total ?? null, complete: inflightEffects === 0 && missingUsageEffects === 0 });
}
