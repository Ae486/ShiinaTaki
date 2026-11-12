/**
 * INPUT:  AI SDK v4 usage metadata, including optional OpenAI-compatible raw counters
 * OUTPUT: nullable, safe-integer AuxiliaryUsageCounts without retaining raw provider metadata
 * POS:    core/observability — pure provider-usage normalization for durable auxiliary accounting
 */
import type { AuxiliaryUsageCounts } from "@taki/shared";

type UnknownRecord = Record<string, unknown>;

export function normalizeAuxiliaryUsage(usage: unknown): AuxiliaryUsageCounts {
  const normalized = record(usage);
  const raw = record(normalized?.raw);
  if (raw && isOpenAiUsage(raw)) return normalizeOpenAiUsage(raw);

  const input = record(normalized?.inputTokens);
  const output = record(normalized?.outputTokens);
  const inputTokens = count(input?.total);
  const outputTokens = count(output?.total);
  return {
    inputTokens,
    noCacheTokens: count(input?.noCache),
    cacheReadTokens: boundedSubset(count(input?.cacheRead), inputTokens),
    cacheWriteTokens: count(input?.cacheWrite),
    outputTokens,
    reasoningTokens: boundedSubset(count(output?.reasoning), outputTokens),
    totalTokens: sumIfKnown(inputTokens, outputTokens),
  };
}

export function unknownAuxiliaryUsage(): AuxiliaryUsageCounts {
  return {
    inputTokens: null,
    noCacheTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  };
}

function normalizeOpenAiUsage(raw: UnknownRecord): AuxiliaryUsageCounts {
  const inputTokens = ownCount(raw, "prompt_tokens");
  const outputTokens = ownCount(raw, "completion_tokens");
  const cacheReadTokens = boundedSubset(consistentCounts([
    nestedObservedCount(raw, "prompt_tokens_details", "cached_tokens"),
    observedCount(raw, "prompt_cache_hit_tokens"),
  ]), inputTokens);
  const explicitNoCache = observedCount(raw, "prompt_cache_miss_tokens");
  const noCacheTokens = explicitNoCache.present
    ? validNoCache(explicitNoCache.value, inputTokens, cacheReadTokens)
    : subtractIfKnown(inputTokens, cacheReadTokens);
  const reasoning = nestedObservedCount(raw, "completion_tokens_details", "reasoning_tokens");
  const reasoningTokens = boundedSubset(
    reasoning.present ? reasoning.value : null,
    outputTokens,
  );
  return {
    inputTokens,
    noCacheTokens,
    cacheReadTokens,
    cacheWriteTokens: null,
    outputTokens,
    reasoningTokens,
    totalTokens: ownCount(raw, "total_tokens"),
  };
}

function isOpenAiUsage(raw: UnknownRecord): boolean {
  return ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_tokens_details",
    "completion_tokens_details", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens"]
    .some((key) => Object.hasOwn(raw, key));
}

function ownCount(value: UnknownRecord, key: string): number | null {
  return Object.hasOwn(value, key) ? count(value[key]) : null;
}

function nestedObservedCount(value: UnknownRecord, parent: string, key: string): ObservedCount {
  if (!Object.hasOwn(value, parent)) return { present: false, value: null };
  const nested = record(value[parent]);
  if (!nested || !Object.hasOwn(nested, key)) return { present: false, value: null };
  return { present: true, value: count(nested[key]) };
}

interface ObservedCount { present: boolean; value: number | null }

function observedCount(value: UnknownRecord, key: string): ObservedCount {
  return Object.hasOwn(value, key) ? { present: true, value: count(value[key]) } : { present: false, value: null };
}

function consistentCounts(values: ObservedCount[]): number | null {
  const present = values.filter((value) => value.present);
  if (present.some((value) => value.value === null)) return null;
  const known = present.map((value) => value.value as number);
  return known.length > 0 && known.every((value) => value === known[0]) ? known[0]! : null;
}

function boundedSubset(value: number | null, total: number | null): number | null {
  return value !== null && (total === null || value <= total) ? value : null;
}

function subtractIfKnown(total: number | null, part: number | null): number | null {
  return total !== null && part !== null && part <= total ? total - part : null;
}

function validNoCache(value: number | null, total: number | null, cacheRead: number | null): number | null {
  if (value === null || (total !== null && value > total)) return null;
  if (total !== null && cacheRead !== null && value + cacheRead !== total) return null;
  return value;
}

function sumIfKnown(left: number | null, right: number | null): number | null {
  if (left === null || right === null) return null;
  const total = left + right;
  return Number.isSafeInteger(total) ? total : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}
