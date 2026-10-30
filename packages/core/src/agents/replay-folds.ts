/**
 * INPUT:  post-substitution live TimelineEntry[] (ascending) + the token budget those entries must fit into
 * OUTPUT: foldUnderPressure(entries, budget) -> { entries, estimatedTokens } — fold-projected COPIES; stored rows
 *         and the input array's originals are never mutated
 * POS:    core/agents — T5-R4's under-pressure folds inside the replay view (ADR 0008: pure, idempotent,
 *         projection-only); conversation-store composes it between summary substitution and the emergency cut
 */
import type { TimelineEntry, TimelinePart, TimelineToolOutput } from "@taki/shared";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { toModelMessage } from "./turn-mapping.ts";

type ToolResultPart = Extract<TimelinePart, { type: "tool-result" }>;
type ToolCallPart = Extract<TimelinePart, { type: "tool-call" }>;

/**
 * Newest results per toolName whose payload survives folding (rb P2: every surveyed precedent keeps a byte-stable
 * recent WINDOW — OpenClaw 3 turns, Anthropic keep:3 — so the fold boundary lags the cache-hot tail, never rides it).
 */
export const SNAPSHOT_KEEP_WINDOW = 3;

// LOCAL (batch-7 design §6, in-code number): tool-call args below this many JSON chars stay readable — the
// stage-c fold only pays off on genuinely large payloads.
export const ARGS_FOLD_FLOOR_CHARS = 200;

interface FoldPoint {
  entryIndex: number;
  partIndex: number;
}

export interface FoldResult {
  entries: TimelineEntry[];
  /** Estimator-unit cost of the returned entries — same cost model the emergency cut applies after this stage. */
  estimatedTokens: number;
}

/**
 * T5-R4: only under pressure (under budget = zero folds, byte-identical projection), oldest-first within each
 * stage, stopping as soon as the view fits. Assistant prose and the user's own words are NEVER folded in v1 —
 * they degrade only via summary retirement or the emergency cut (design §2.2 gradient-to-mechanism mapping).
 */
export function foldUnderPressure(entries: TimelineEntry[], budget: number): FoldResult {
  // Infinite budget = the legacy unmeasured mode: skip estimation entirely (selectWindow's 0-cost convention).
  if (!Number.isFinite(budget)) return { entries, estimatedTokens: 0 };
  const costs = entries.map(entryTokens);
  let total = costs.reduce((sum, cost) => sum + cost, 0);
  if (total <= budget) return { entries, estimatedTokens: total };

  const working = [...entries];
  // Candidates are computed ONCE from the pristine input, so a folded part can never become a candidate again
  // (a trace-of-a-trace) and the projection stays idempotent.
  for (const point of foldCandidates(entries)) {
    const folded = foldAt(working[point.entryIndex]!, point.partIndex);
    if (folded === null) continue;
    working[point.entryIndex] = folded;
    const cost = entryTokens(folded);
    total += cost - costs[point.entryIndex]!;
    costs[point.entryIndex] = cost;
    if (total <= budget) break;
  }
  return { entries: working, estimatedTokens: total };
}

// Stage order = the R4 gradient restricted to v1's mechanisms: (a) state-snapshot results beyond the keep
// window (the Q5 capturedAt marker is the class test), (b) fact-class results, (c) oversized tool-call args.
function foldCandidates(entries: TimelineEntry[]): FoldPoint[] {
  return [
    ...snapshotCandidates(entries),
    ...resultCandidates(entries, (output) => capturedAtOf(output) === undefined),
    ...argsCandidates(entries),
  ];
}

// All snapshot-class results EXCEPT the newest SNAPSHOT_KEEP_WINDOW per toolName, oldest first across tools.
function snapshotCandidates(entries: TimelineEntry[]): FoldPoint[] {
  const byTool = new Map<string, FoldPoint[]>();
  entries.forEach((entry, entryIndex) => {
    entry.parts?.forEach((part, partIndex) => {
      if (part.type !== "tool-result" || capturedAtOf(part.output) === undefined) return;
      const list = byTool.get(part.toolName) ?? [];
      list.push({ entryIndex, partIndex });
      byTool.set(part.toolName, list);
    });
  });
  return [...byTool.values()]
    .flatMap((list) => list.slice(0, Math.max(0, list.length - SNAPSHOT_KEEP_WINDOW)))
    .sort((a, b) => a.entryIndex - b.entryIndex || a.partIndex - b.partIndex);
}

function resultCandidates(entries: TimelineEntry[], matches: (output: TimelineToolOutput) => boolean): FoldPoint[] {
  const points: FoldPoint[] = [];
  entries.forEach((entry, entryIndex) => {
    entry.parts?.forEach((part, partIndex) => {
      if (part.type === "tool-result" && matches(part.output)) points.push({ entryIndex, partIndex });
    });
  });
  return points;
}

function argsCandidates(entries: TimelineEntry[]): FoldPoint[] {
  const points: FoldPoint[] = [];
  entries.forEach((entry, entryIndex) => {
    entry.parts?.forEach((part, partIndex) => {
      if (part.type === "tool-call" && safeStringify(part.input).length > ARGS_FOLD_FLOOR_CHARS)
        points.push({ entryIndex, partIndex });
    });
  });
  return points;
}

// Copy-on-fold: the returned entry shares everything except the folded part (repo rows stay untouched).
function foldAt(entry: TimelineEntry, partIndex: number): TimelineEntry | null {
  const part = entry.parts?.[partIndex];
  if (part === undefined) return null;
  const replacement =
    part.type === "tool-result" ? foldResultPart(part) : part.type === "tool-call" ? foldCallPart(part) : null;
  if (replacement === null) return null;
  const parts = [...(entry.parts ?? [])];
  parts[partIndex] = replacement;
  return { ...entry, parts };
}

// Hermes-style one-line trace: the call stays visible (she knows she already looked — R4), the payload goes.
// Content-derived, so re-rendering the projection reproduces it byte-for-byte.
function foldResultPart(part: ToolResultPart): TimelinePart | null {
  const chars = payloadChars(part.output);
  const time = timeOf(capturedAtOf(part.output));
  const trace =
    time === undefined
      ? `[${part.toolName}] result folded — ${chars} chars`
      : `[${part.toolName}] result folded — captured ${time}, ${chars} chars`;
  // A fold that does not shrink the payload is pure information loss — skip it (LOCAL guard).
  if (chars <= trace.length) return null;
  if (part.output.type === "execution-denied") return { ...part, output: { ...part.output, reason: trace } };
  const failed = part.output.type === "error-text" || part.output.type === "error-json";
  return { ...part, output: { type: failed ? "error-text" : "text", value: trace } };
}

function foldCallPart(part: ToolCallPart): TimelinePart {
  const chars = safeStringify(part.input).length;
  return { ...part, input: `[${part.toolName}] called (args folded, ${chars} chars)` };
}

/** The Q5 class marker: a state-snapshot result embeds its capture moment as `capturedAt` at creation. */
function capturedAtOf(output: TimelineToolOutput): string | undefined {
  const value = output.value;
  if (typeof value !== "object" || value === null) return undefined;
  const stamp = (value as { capturedAt?: unknown }).capturedAt;
  return typeof stamp === "string" ? stamp : undefined;
}

// HH:MM straight from the ISO stamp — deterministic (no locale/timezone math inside a byte-stable projection).
function timeOf(stamp: string | undefined): string | undefined {
  return stamp === undefined ? undefined : /T(\d{2}:\d{2})/.exec(stamp)?.[1];
}

function payloadChars(output: TimelineToolOutput): number {
  if (typeof output.value === "string") return output.value.length;
  return safeStringify(output.value ?? output).length;
}

// Must mirror context-window.ts's cost model exactly — a fold measured differently from the cut would fold
// too little (cut still fires) or too much (information lost for nothing).
function entryTokens(entry: TimelineEntry): number {
  const message = toModelMessage(entry);
  return message === null ? 0 : estimateMessageTokens(message);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
