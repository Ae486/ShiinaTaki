/**
 * INPUT:  Character-scoped TimelineRepo pages, summary coverage, and an emergency row ceiling
 * OUTPUT: loadReplaySource(input) -> ascending live candidates + summary-bridge/backstop facts
 * POS:    core/agents — bounded durable source loader before the pure Replay View projection
 */
import { TIMELINE_HISTORY_LIMIT_MAX, type TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { toModelMessage } from "./turn-mapping.ts";

/** Existing protocol page size; reusing it keeps one tested SQLite paging shape. */
export const REPLAY_SOURCE_PAGE_SIZE = TIMELINE_HISTORY_LIMIT_MAX;

/**
 * LOCAL policy: 50 existing 200-row Timeline pages. This is 50x the retired source cliff while matching the
 * repository's established 10,000-item bounded-work convention. Repeated deterministic Node 24/in-memory SQLite probes
 * on 2026-08-29 loaded the 10,000-row source in under 100 ms (latest run ~76 ms) and reported the 10,001st row as a
 * backstop hit. This remains an
 * emergency database/estimator guard, never the ordinary context boundary; callers must surface `backstopHit`.
 */
export const REPLAY_SOURCE_BACKSTOP = 10_000;

export interface ReplaySource {
  entries: TimelineEntry[];
  summaryBridgeReached: boolean;
  backstopHit: boolean;
  loadedRows: number;
  oldestLoadedSeq?: number;
  newestLoadedSeq?: number;
}

export interface ReplaySourceInput {
  repo: TimelineRepo;
  characterId: string;
  throughSeq: number;
  /** Normal estimator budget for the candidate source; omitted means load until the explicit row guard/end. */
  candidateBudget?: number;
  /** Minimum newest-row suffix to load; configured callers also receive one row beyond the token crossing. */
  minimumRows?: number;
  maxRows?: number;
  pageSize?: number;
  entryCost?: (entry: TimelineEntry) => number;
}

export function loadReplaySource(input: ReplaySourceInput): ReplaySource {
  const maxRows = positiveInteger(input.maxRows, REPLAY_SOURCE_BACKSTOP);
  const pageSize = Math.min(positiveInteger(input.pageSize, REPLAY_SOURCE_PAGE_SIZE), REPLAY_SOURCE_PAGE_SIZE);
  const minimumRows = nonNegativeInteger(input.minimumRows);
  const newestFirst: TimelineEntry[] = [];
  let before: number | undefined;
  let summaryBridgeReached = false;
  let exhausted = false;
  let budgetReached = false;
  let budgetReachedAt: number | undefined;
  let estimated = 0;

  while (newestFirst.length < maxRows && !summaryBridgeReached && !exhausted
    && (!budgetReached || hasUnresolvedResult(newestFirst) || newestFirst.length < minimumRows)) {
    const limit = Math.min(pageSize, maxRows - newestFirst.length);
    const page = input.repo.pageBefore({ characterId: input.characterId, before, limit });
    for (const entry of page.entries) {
      if (input.throughSeq > 0 && entry.seq <= input.throughSeq) {
        summaryBridgeReached = true;
        break;
      }
      newestFirst.push(entry);
      estimated += (input.entryCost ?? entryCost)(entry);
      if (!budgetReached && reachesBudget(estimated, input.candidateBudget)) {
        budgetReached = true;
        budgetReachedAt = newestFirst.length;
      }
      // The page query may over-fetch, but the source contract stops adding rows as soon as the token candidate
      // is complete. A result whose call is older than the current suffix is the one exception: continue paging
      // until that pair is resolved or the explicit emergency ceiling/end-of-history is reached.
      // When a summary exists, consume the current page so a nearby through_seq can still be reached and the
      // summary head remains truthful. A distant summary still stops at the first token-sufficient page; no extra
      // page is scanned just to discover that an old checkpoint is stale.
      if (budgetReached && !hasUnresolvedResult(newestFirst) && input.throughSeq === 0
        && newestFirst.length >= minimumRows
        && (minimumRows === 0 || newestFirst.length > (budgetReachedAt ?? 0))) break;
    }
    exhausted = page.nextBefore === null;
    before = page.nextBefore ?? undefined;
  }

  const entries = newestFirst.reverse();
  const unresolvedResult = hasUnresolvedResult(newestFirst);
  return {
    entries,
    summaryBridgeReached,
    backstopHit: newestFirst.length >= maxRows && !summaryBridgeReached && !exhausted
      && (!budgetReached || unresolvedResult || newestFirst.length < minimumRows),
    loadedRows: newestFirst.length,
    oldestLoadedSeq: entries[0]?.seq,
    newestLoadedSeq: entries.at(-1)?.seq,
  };
}

function reachesBudget(estimated: number, budget: number | undefined): boolean {
  if (budget === undefined || !Number.isFinite(budget) || estimated <= 0) return false;
  return estimated >= budget;
}

function entryCost(entry: TimelineEntry): number {
  const message = toModelMessage(entry);
  return message === null ? 0 : estimateMessageTokens(message);
}

function hasUnresolvedResult(entries: TimelineEntry[]): boolean {
  const callIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const entry of entries) {
    for (const part of entry.parts ?? []) {
      if (part.type === "tool-call") callIds.add(part.toolCallId);
      if (part.type === "tool-result") resultIds.add(part.toolCallId);
    }
  }
  return [...resultIds].some((id) => !callIds.has(id));
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
