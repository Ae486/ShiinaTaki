/**
 * INPUT:  ascending TimelineEntry[] (the backstop-capped fetch), a token budget in estimator units, maxMessages
 * OUTPUT: selectWindow(entries, budgetTokens, maxMessages) -> { entries, windowStartSeq, estimatedTokens }
 * POS:    core/agents — THE window boundary (T5-R1): history() replays exactly this selection and the flush treats
 *         windowStartSeq as the context edge (coupling point 2); pure — no repo, no clock, no config
 */
import type { TimelineEntry } from "@taki/shared";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { toModelMessage } from "./turn-mapping.ts";

export interface WindowSelection {
  /** The kept slice, ascending — what history() replays (after its ModelMessage projection). */
  entries: TimelineEntry[];
  /**
   * Seq of the oldest replayed entry; every row BELOW it has left the model's window (the flush boundary).
   * Empty input -> 1 (nothing exists, nothing has left); a fully-dropped window -> newest seq + 1 (everything left).
   */
  windowStartSeq: number;
  /** Estimator-unit cost of the kept entries; 0 under an infinite budget (legacy mode skips estimation). */
  estimatedTokens: number;
}

/**
 * Walk newest -> oldest accumulating estimateMessageTokens until the budget, cap at maxMessages (the R1 hard
 * backstop against a broken estimator), then apply the leading-tool-drop. An infinite budget degrades to the
 * legacy message-count window — same code path, no estimation cost.
 */
export function selectWindow(entries: TimelineEntry[], budgetTokens: number, maxMessages: number): WindowSelection {
  const backstop = entries.slice(Math.max(0, entries.length - maxMessages));
  const measured = Number.isFinite(budgetTokens);
  // A row whose model projection is null replays nothing, so it costs nothing (it still occupies a backstop slot).
  const costs = backstop.map((entry) => {
    if (!measured) return 0;
    const message = toModelMessage(entry);
    return message === null ? 0 : estimateMessageTokens(message);
  });
  const cut = measured ? tokenCut(costs, budgetTokens) : 0;
  // The hard window cut can strand tool rows whose assistant tool-call fell outside the window; a leading tool
  // message is invalid replay input for providers, so drop rows until the first non-tool one (D1 contract).
  const windowed = backstop.slice(cut);
  const firstNonTool = windowed.findIndex((entry) => entry.role !== "tool");
  const kept = firstNonTool === -1 ? [] : windowed.slice(firstNonTool);
  const dropped = firstNonTool === -1 ? windowed.length : firstNonTool;
  return {
    entries: kept,
    windowStartSeq: startSeqOf(kept, entries),
    estimatedTokens: costs.slice(cut + dropped).reduce((sum, cost) => sum + cost, 0),
  };
}

// Newest -> oldest accumulation; the newest entry is ALWAYS kept even when it alone exceeds the budget (an
// oversized single message degrades to a window of one, never an empty replay — fitToBudget's first-item rule).
function tokenCut(costs: number[], budget: number): number {
  let cut = costs.length;
  let used = 0;
  for (let i = costs.length - 1; i >= 0; i -= 1) {
    const cost = costs[i]!;
    if (used + cost > budget && cut < costs.length) break;
    used += cost;
    cut = i;
  }
  return cut;
}

function startSeqOf(kept: TimelineEntry[], entries: TimelineEntry[]): number {
  if (kept.length > 0) return kept[0]!.seq;
  if (entries.length > 0) return entries[entries.length - 1]!.seq + 1;
  return 1;
}
