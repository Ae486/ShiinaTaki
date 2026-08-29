/**
 * INPUT:  ascending TimelineEntry candidates, a priced recent-tail budget, and a minimum-tail row guard
 * OUTPUT: selectRetirementRange(...) -> a balanced retirement boundary or null
 * POS:    core/agents — pure token-priced compaction range selection shared with the Replay View pairing rules
 */
import type { TimelineEntry } from "@taki/shared";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { toModelMessage } from "./turn-mapping.ts";
import { replayUnits, type ReplayUnit } from "./context-window.ts";

/** DSH's checked default: retain a small, token-priced verbatim tail after pressure compaction. */
export const COMPACTION_RETAIN_RATIO = 0.16;

export interface RetirementSelection {
  /** Inclusive Timeline seq boundary: rows through this seq may be summarized. */
  newThroughSeq: number;
  /** The suffix retained verbatim by the compaction policy. */
  retainedEntries: TimelineEntry[];
  /** Estimator-unit cost of that retained suffix. */
  retainedTokens: number;
}

/**
 * Select a head-anchored retirement range while retaining a priced recent tail.
 *
 * The token target is the ordinary policy. `minimumTailRows` is deliberately a
 * separate compatibility guard: it prevents a very cheap/zero-cost estimate
 * from leaving an implausibly small tail, but it never chooses the normal
 * boundary by itself. Replay units are contiguous, so a cut cannot split a
 * multi-call assistant row, any matching result rows, or an overlapping span.
 */
export function selectRetirementRange(
  entries: TimelineEntry[],
  retainTokens: number,
  minimumTailRows: number,
): RetirementSelection | null {
  if (entries.length === 0) return null;

  const costs = entries.map(entryCost);
  const units = replayUnits(entries, costs);
  const target = finiteNonNegative(retainTokens);
  const minimumRows = positiveInteger(minimumTailRows, 1);

  let keepFromUnit = units.length;
  let retainedRows = 0;
  let retainedTokens = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    keepFromUnit = index;
    retainedRows += unitRows(unit);
    retainedTokens += unit.cost;
    if (retainedTokens >= target && retainedRows >= minimumRows) break;
  }

  // No older unit exists to summarize. Keep the newest unit even when it is
  // oversized, matching the Replay View's first-item safety rule.
  if (keepFromUnit <= 0) return null;

  const keepFromEntry = units[keepFromUnit]!.start;
  return {
    newThroughSeq: entries[keepFromEntry]!.seq - 1,
    retainedEntries: entries.slice(keepFromEntry),
    retainedTokens: costs.slice(keepFromEntry).reduce((sum, cost) => sum + cost, 0),
  };
}

function entryCost(entry: TimelineEntry): number {
  const message = toModelMessage(entry);
  return message === null ? 0 : estimateMessageTokens(message);
}

function unitRows(unit: ReplayUnit): number {
  return unit.end - unit.start + 1;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
