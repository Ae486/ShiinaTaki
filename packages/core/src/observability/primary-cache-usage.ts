/**
 * INPUT:  SDK provider usage with transient raw cache counters and an optional reported input total
 * OUTPUT: trusted cache-read count/provenance for new primary UsageRecords
 * POS:    core/observability — reuses auxiliary normalization; does not retain payloads or change lifecycle outcomes
 */
import { normalizeAuxiliaryUsage } from "./auxiliary-usage-normalization.ts";

export function primaryCacheUsage(usage: unknown, inputTokens: number | undefined): {
  cacheReadTokens: number | undefined;
  cacheReadObserved: boolean;
} {
  const cache = normalizeAuxiliaryUsage(usage).cacheReadTokens;
  const valid = cache !== null && (inputTokens === undefined || cache <= inputTokens);
  return { cacheReadTokens: valid ? cache : undefined, cacheReadObserved: valid };
}
