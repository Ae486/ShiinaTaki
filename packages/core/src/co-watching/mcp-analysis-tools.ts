/**
 * INPUT: currently selected MCP catalog descriptors, with their generation guards
 * OUTPUT: complete native analysis tool bundles without creating or probing another connection
 * POS: core/co-watching — admission discovery only; execution uses captured governed Run closures
 */
import type { CoWatchingAnalysisTools } from "./runtime-types.ts";

export function selectCoWatchingAnalysisTools(catalog: ReadonlyArray<{
  serverId: string; ref: { toolName: string }; toolKey: string; isCurrent(): boolean;
}>): CoWatchingAnalysisTools[] {
  const result: CoWatchingAnalysisTools[] = [];
  for (const serverId of new Set(catalog.map((entry) => entry.serverId))) {
    const names = ["submit_analysis", "lookup_request", "get_status", "read_result"];
    const tools = names.map((name) => catalog.find((entry) => entry.serverId === serverId && entry.ref.toolName === `bilinote_${name}`));
    const [submit, lookup, status, read] = tools;
    if (!submit || !lookup || !status || !read) continue;
    result.push({ serverId, submit: submit.toolKey, lookup: lookup.toolKey, status: status.toolKey, result: read.toolKey,
      isCurrent: () => tools.every((entry) => entry?.isCurrent() === true) });
  }
  return result;
}
