/**
 * INPUT:  ascending TimelineEntry[] from the bounded source loader + a token budget in estimator units
 * OUTPUT: selectWindow(entries, budgetTokens) -> { entries, windowStartSeq, estimatedTokens }
 * POS:    core/agents — THE window boundary (T5-R1): history() replays exactly this selection and the flush treats
 *         windowStartSeq as the context edge (coupling point 2); pure — no repo, no clock, no config
 */
import type { TimelineEntry } from "@taki/shared";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { toModelMessage } from "./turn-mapping.ts";

type ReplayEntry = Pick<TimelineEntry, "seq" | "role" | "content" | "parts">;

export interface WindowSelection<T extends ReplayEntry = TimelineEntry> {
  /** The kept slice, ascending — what history() replays (after its ModelMessage projection). */
  entries: T[];
  /**
   * Seq of the oldest replayed entry; every row BELOW it has left the model's window (the flush boundary).
   * Empty input -> 1 (nothing exists, nothing has left); a fully-dropped window -> newest seq + 1 (everything left).
   */
  windowStartSeq: number;
  /** Estimator-unit cost of the kept entries; 0 under an infinite budget (legacy mode skips estimation). */
  estimatedTokens: number;
}

/**
 * Walk newest -> oldest by balanced tool-call/result units until the token budget. Source row bounding happens
 * earlier and emits its own explicit fact; this selector never silently applies another count boundary.
 */
export function selectWindow<T extends ReplayEntry>(entries: T[], budgetTokens: number): WindowSelection<T> {
  const measured = Number.isFinite(budgetTokens);
  const costs = entries.map((entry) => {
    if (!measured) return 0;
    const message = toModelMessage(entry);
    return message === null ? 0 : estimateMessageTokens(message);
  });
  const units = replayUnits(entries, costs);
  const selected = measured ? selectUnits(units, budgetTokens) : units.filter((unit) => unit.valid);
  const kept = selected.flatMap((unit) => entries.slice(unit.start, unit.end + 1));
  return {
    entries: kept,
    windowStartSeq: startSeqOf(kept, entries),
    estimatedTokens: selected.reduce((sum, unit) => sum + unit.cost, 0),
  };
}

/** A contiguous replay unit whose tool-call/result evidence must move together. */
export interface ReplayUnit { start: number; end: number; cost: number; valid: boolean }
interface ReplayIndex {
  resultIndexes: Map<string, number[]>;
  callIndexes: Map<string, number[]>;
  callNames: Map<string, Set<string>>;
  resultNames: Map<string, Set<string>>;
}

// Calls and all matching results are one atomic selection unit. A cut may drop the whole unit, never strand either
// side. The helper is shared by replay selection and compaction retirement so the two boundaries cannot disagree.
export function replayUnits(entries: ReplayEntry[], costs: number[]): ReplayUnit[] {
  const replayIndex = createReplayIndex(entries);
  const spans = entries.flatMap((entry, start) => {
    const calls = entry.parts?.filter((part) => part.type === "tool-call") ?? [];
    if (calls.length === 0) return [];
    const ends = calls.map((call) => {
      const matches = replayIndex.resultIndexes.get(call.toolCallId)?.filter((index) => index > start) ?? [];
      return matches.length > 0 ? Math.max(...matches) : undefined;
    });
    const matchedEnds = ends.filter((end): end is number => end !== undefined && end > start);
    // A partially matched assistant row is still one indivisible evidence span, but remains invalid for provider
    // replay. This preserves all call/result rows together while keeping the existing corrupt-row drop behavior.
    if (matchedEnds.length === 0) return [];
    return [{ start, end: Math.max(...matchedEnds), valid: matchedEnds.length === calls.length }];
  });
  const merged = mergeSpans(spans);
  const spanByStart = new Map(merged.map((span) => [span.start, span]));
  const units: ReplayUnit[] = [];
  for (let index = 0; index < entries.length;) {
    const span = spanByStart.get(index);
    const end = span?.end ?? index;
    const valid = span === undefined
      ? isReplayableEntry({ entries, index, replayIndex })
      : span.valid && rangeIsReplayable({ entries, start: index, end, replayIndex });
    units.push({ start: index, end, valid, cost: costs.slice(index, end + 1).reduce((sum, cost) => sum + cost, 0) });
    index = end + 1;
  }
  return units;
}

function createReplayIndex(entries: ReplayEntry[]): ReplayIndex {
  const replayIndex: ReplayIndex = {
    resultIndexes: new Map(),
    callIndexes: new Map(),
    callNames: new Map(),
    resultNames: new Map(),
  };
  entries.forEach((entry, index) => entry.parts?.forEach((part) => {
    if (part.type === "tool-result") {
      const indexes = replayIndex.resultIndexes.get(part.toolCallId) ?? [];
      indexes.push(index);
      replayIndex.resultIndexes.set(part.toolCallId, indexes);
      const names = replayIndex.resultNames.get(part.toolCallId) ?? new Set<string>();
      names.add(part.toolName);
      replayIndex.resultNames.set(part.toolCallId, names);
    } else if (part.type === "tool-call") {
      const indexes = replayIndex.callIndexes.get(part.toolCallId) ?? [];
      indexes.push(index);
      replayIndex.callIndexes.set(part.toolCallId, indexes);
      const names = replayIndex.callNames.get(part.toolCallId) ?? new Set<string>();
      names.add(part.toolName);
      replayIndex.callNames.set(part.toolCallId, names);
    }
  }));
  return replayIndex;
}

function rangeIsReplayable(input: { entries: ReplayEntry[]; start: number; end: number; replayIndex: ReplayIndex }): boolean {
  for (let index = input.start; index <= input.end; index += 1) {
    if (!isReplayableEntry({ entries: input.entries, index, replayIndex: input.replayIndex })) return false;
  }
  return true;
}

function isReplayableEntry(input: { entries: ReplayEntry[]; index: number; replayIndex: ReplayIndex }): boolean {
  const { entries, index, replayIndex } = input;
  const entry = entries[index];
  if (entry === undefined) return false;
  const parts = entry.parts ?? [];
  if (entry.role === "tool") {
    return parts.length > 0 && parts.every((part) =>
      part.type === "tool-result"
      && (replayIndex.callIndexes.get(part.toolCallId) ?? []).some((callIndex) => callIndex < index)
      && (replayIndex.resultIndexes.get(part.toolCallId) ?? []).length === 1
      && replayIndex.callNames.get(part.toolCallId)?.has(part.toolName) === true,
    );
  }
  if (entry.role !== "assistant") return true;
  const calls = parts.filter((part) => part.type === "tool-call");
  return calls.every((call) =>
    ((replayIndex.resultIndexes.get(call.toolCallId) ?? []).length === 0
      && replayIndex.resultIndexes.size === 0
      && (replayIndex.callIndexes.get(call.toolCallId) ?? []).length === 1)
    || ((replayIndex.callIndexes.get(call.toolCallId) ?? []).length === 1
      && (replayIndex.resultIndexes.get(call.toolCallId) ?? []).some((resultIndex) => resultIndex > index)
      && replayIndex.resultNames.get(call.toolCallId)?.has(call.toolName) === true),
  );
}

function mergeSpans(spans: Array<{ start: number; end: number; valid: boolean }>): Array<{ start: number; end: number; valid: boolean }> {
  const merged: Array<{ start: number; end: number; valid: boolean }> = [];
  for (const span of spans.sort((left, right) => left.start - right.start)) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      last.valid &&= span.valid;
    } else merged.push({ ...span });
  }
  return merged;
}

// Newest -> oldest by atomic units; the newest valid unit is always kept even when oversized.
function selectUnits(units: ReplayUnit[], budget: number): ReplayUnit[] {
  const selected: ReplayUnit[] = [];
  let used = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    if (!unit.valid) continue;
    if (used + unit.cost > budget && selected.length > 0) break;
    selected.unshift(unit);
    used += unit.cost;
  }
  return selected;
}

function startSeqOf(kept: ReplayEntry[], entries: ReplayEntry[]): number {
  if (kept.length > 0) return kept[0]!.seq;
  if (entries.length > 0) return entries[entries.length - 1]!.seq + 1;
  return 1;
}
