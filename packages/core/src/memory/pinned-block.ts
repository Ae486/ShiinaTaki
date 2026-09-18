/**
 * INPUT:  active pinned-eligible candidate rows + a token budget
 * OUTPUT: selectPinned(rows, budget) -> the kept rows, render-ordered (layer order, then chronological);
 *         isPinnedEligible(row) — the shared always-visible predicate
 * POS:    core/memory — the pinned-block policy: non-truncatable layers survive budget pressure; oldest truncatable drop first
 */
import type { MemoryEntryRow } from "../db/memory-repo.ts";
import type { TakiMemoryPolicyProjection } from "@taki/shared";
import { getLayer, V1_MEMORY_LAYERS } from "./layer-registry.ts";
import { estimateTokens } from "./token-estimator.ts";

const LAYER_ORDER = new Map(V1_MEMORY_LAYERS.map((layer, index) => [layer.id, index]));
type VisibilityRow = MemoryEntryRow & { visibility?: TakiMemoryPolicyProjection["visibility"] };

/**
 * Pick the pinned block under `budget`. The never-truncate guarantee is a data field, not a special case:
 * rows in a `truncatable: false` layer (relationship = promises/rules) are ALWAYS kept, even if they alone
 * exceed the budget; overflow is absorbed by dropping the OLDEST rows of truncatable layers first (AC 4).
 */
export function selectPinned<T extends VisibilityRow>(rows: T[], budget: number): T[] {
  const eligible = rows.filter(isPinnedEligible);
  const nonTruncatable = eligible.filter((row) => getLayer(row.layer)?.truncatable === false);
  const truncatable = eligible.filter((row) => getLayer(row.layer)?.truncatable !== false).sort(byCreatedAsc);

  let used = sumTokens(nonTruncatable) + sumTokens(truncatable);
  while (used > budget && truncatable.length > 0) {
    const dropped = truncatable.shift();
    if (!dropped) break;
    used -= estimateTokens(dropped.content);
  }
  return [...nonTruncatable, ...truncatable].sort(byRenderOrder);
}

// A retrieved layer contributes to the pinned block only for entries at/above its threshold (profile: >= 9).
// Exported for the tidy report: a pinned-visible row is never "stale" (it needs no recall), and that judgement
// must be THIS rule, not a drifted copy.
export function isPinnedEligible(row: Pick<VisibilityRow, "layer" | "importance" | "visibility">): boolean {
  if (row.visibility === "hidden" || row.visibility === "mood-gated") return false;
  if (row.visibility === "pinned") return true;
  const layer = getLayer(row.layer);
  if (!layer) return false;
  if (layer.recallPolicy === "pinned") return row.visibility === undefined;
  // The canonical migration's ordinary profile projection remains "retrieved" even at T5's deliberate
  // importance threshold. Preserve that promotion, while explicit hidden/mood-gated policy above wins.
  if (layer.pinnedImportanceThreshold !== undefined) return row.importance >= layer.pinnedImportanceThreshold;
  return false;
}

function sumTokens(rows: MemoryEntryRow[]): number {
  return rows.reduce((total, row) => total + estimateTokens(row.content), 0);
}

function byCreatedAsc(a: MemoryEntryRow, b: MemoryEntryRow): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

function byRenderOrder(a: MemoryEntryRow, b: MemoryEntryRow): number {
  const orderA = LAYER_ORDER.get(a.layer) ?? Number.MAX_SAFE_INTEGER;
  const orderB = LAYER_ORDER.get(b.layer) ?? Number.MAX_SAFE_INTEGER;
  return orderA !== orderB ? orderA - orderB : byCreatedAsc(a, b);
}
