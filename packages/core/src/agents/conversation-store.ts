/**
 * INPUT:  TimelineRepo, captured turn metadata, post-commit sinks, and optional Replay View policies
 * OUTPUT: atomic turn/append/remove APIs and one project() source for all Replay View consumers
 * POS:    core/agents — one conversational writer and Character-scoped canonical Replay View boundary (ADR 0008)
 */
import type { ModelMessage } from "ai";
import type { TimelineCommitted, TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { selectWindow } from "./context-window.ts";
import { foldUnderPressure } from "./replay-folds.ts";
import { loadReplaySource, REPLAY_SOURCE_BACKSTOP, type ReplaySource } from "./replay-source-loader.ts";
import { toModelMessage, toUserEntryInput, type TurnEntryInput, type TurnMessage, type UserImageInput } from "./turn-mapping.ts";
import { commitConversationTurn, type TurnCommitInput } from "./conversation-turn-writer.ts";

// Legacy no-budget compatibility only. Measured production replay uses the separately observable source backstop.
export const REPLAY_WINDOW = 200;

export interface ReplayMeasurement {
  sourceRows: number;
  liveRows: number;
  selectedRows: number;
  summaryTokens: number;
  liveTokensBeforeFolds: number;
  foldedTokensSaved: number;
  historyTokens: number;
  tokenBoundaryHit: boolean;
  sourceBackstopHit: boolean;
}

export interface ReplayProjection {
  messages: ModelMessage[];
  windowStartSeq: number;
  measurement: ReplayMeasurement;
}

/** The compaction summary's read seam (summary-repo satisfies it); null = the character was never compacted. */
export interface SummaryReader {
  get(characterId: string): { throughSeq: number; text: string } | null;
}

/** Counts-only wall-hit report: the emergency cut dropped rows the summary had not retired (R5's accepted trade). */
export interface WallHit {
  characterId: string;
  /** First seq still replayed after the cut. */
  windowStartSeq: number;
  /** The summary's coverage boundary at cut time (0 = no summary). */
  throughSeq: number;
  /** Live (non-retired) rows the cut dropped. */
  dropped: number;
}

export interface SourceBackstopHit {
  characterId: string;
  loadedRows: number;
  limit: number;
  throughSeq: number;
  oldestLoadedSeq?: number;
  newestLoadedSeq?: number;
}

export interface ConversationStore {
  /**
   * Persists the user turn and RETURNS the committed entry; images (#17) add image parts (mediaType + ref) — no
   * images = a legacy text-only row. The seq is returned so a cancel-before-reply can retract exactly this row.
   */
  appendUser(characterId: string, text: string, images?: UserImageInput[]): TimelineEntry;
  appendAssistant(characterId: string, text: string): void;
  /**
   * Persists a whole turn's response tail (names-only assistant tool-call parts + tool-result messages + final text),
   * oldest-first, as returned by `result.responseMessages` — the fix for cross-turn tool-record loss (D1 #1).
   */
  appendTurn(characterId: string, messages: TurnMessage[], toolDisplayNames?: Readonly<Record<string, string>>): void;
  commitTurn(input: TurnCommitInput): TimelineEntry[];
  /** Deletes one row by seq (cancel-retract) + fires onRemove; single Workspace/DB writer (invariant 2). */
  removeEntry(characterId: string, seq: number): void;
  /** The replay window as AI SDK messages, oldest-first (summary head first when one is substituted — R3). */
  history(characterId: string): ModelMessage[];
  /**
   * Seq of the oldest entry history() still replays — every row below it has LEFT the model's window (rows the
   * summary retired included). The flush computes "leaving the window" from THIS boundary (same select call:
   * same slice, no drift — batch 6); safe because the compactor flushes BEFORE advancing through_seq (batch 7).
   */
  windowStart(characterId: string): number;
  /** Estimator-unit size of the current replay view (summary head + kept rows) — the compaction trigger's input. */
  estimatedTokens(characterId: string): number;
  /** One immutable Replay View result for request construction and pressure/summary measurement. */
  project(characterId: string): ReplayProjection;
}

export interface ConversationStoreDeps {
  repo: TimelineRepo;
  /** Fired after each committed append; the server fans it out as timeline.appended (write→event colocation). */
  onAppend?: (entry: TimelineEntry) => void;
  /** One complete foreground batch, emitted only after every canonical row commits. */
  onCommit?: (batch: TimelineCommitted) => void;
  /** Fired after a retract delete; the server fans it out as timeline.removed (mirrors onAppend). */
  onRemove?: (ref: { characterId: string; seq: number }) => void;
  /**
   * Token budget (estimator units) for replayed history; production wires calibrator.effectiveWindow ×
   * historyRatio. Absent = legacy REPLAY_WINDOW-only behavior (message-count window, byte-identical).
   */
  window?: { budget(): number };
  /** The rolling-summary record (R3); absent (or no row) = no substitution, legacy view byte-identical. */
  summaries?: SummaryReader;
  /**
   * Fired when the emergency cut drops rows the summary has not retired — the compactor is being outrun (R5).
   * Deduped per advancing cut boundary so a sustained overrun warns once, not once per render.
   */
  onWallHit?: (hit: WallHit) => void;
  /** Explicit degraded-source fact; distinct from ordinary token exhaustion. */
  onSourceBackstopHit?: (hit: SourceBackstopHit) => void;
  /** Focused-test override; production uses the documented local policy. */
  source?: { maxRows?: number; pageSize?: number };
}

export function createConversationStore(deps: ConversationStoreDeps): ConversationStore {
  const { repo, onAppend, onRemove, window, summaries, onWallHit, onSourceBackstopHit, source } = deps;
  const commit = (characterId: string, input: TurnEntryInput): TimelineEntry => {
    const entry = repo.append({ characterId, ...input });
    onAppend?.(entry);
    return entry;
  };
  const wallWarnedAt = new Map<string, number>();
  const reportWallHit = (hit: WallHit): void => {
    if (!onWallHit || (wallWarnedAt.get(hit.characterId) ?? 0) >= hit.windowStartSeq) return;
    wallWarnedAt.set(hit.characterId, hit.windowStartSeq);
    onWallHit(hit);
  };
  const sourceWarnedAt = new Map<string, number>();
  const reportSourceBackstopHit = (hit: SourceBackstopHit): void => {
    if (!onSourceBackstopHit || (sourceWarnedAt.get(hit.characterId) ?? 0) >= (hit.newestLoadedSeq ?? 0)) return;
    sourceWarnedAt.set(hit.characterId, hit.newestLoadedSeq ?? 0);
    onSourceBackstopHit(hit);
  };
  // history(), windowStart(), pressure measurement and request construction all derive from this one projection.
  const project = (characterId: string): ReplayProjection => {
    const view = selectView({ repo, window, summaries, reportWallHit, reportSourceBackstopHit, source }, characterId);
    const messages = view.entries.map(toModelMessage).filter((message): message is ModelMessage => message !== null);
    return { messages: view.head === null ? messages : [view.head, ...messages], windowStartSeq: view.windowStartSeq, measurement: view.measurement };
  };
  return {
    // No images = toUserEntryInput returns the legacy `{role:"user", content}` row (byte-identical to before #17).
    appendUser: (characterId, text, images = []) => commit(characterId, toUserEntryInput(text, images)),
    appendAssistant: (characterId, text) => void commit(characterId, { role: "assistant", content: text }),
    appendTurn: (characterId, messages, toolDisplayNames) => void commitConversationTurn(deps, { characterId, messages, toolDisplayNames }),
    commitTurn: (input) => commitConversationTurn(deps, input),
    removeEntry: (characterId, seq) => {
      repo.deleteEntry(characterId, seq);
      onRemove?.({ characterId, seq });
    },
    // Legacy text-only rows reconstruct via content; tool calls replay with empty input placeholders, never raw args.
    history: (characterId) => {
      return project(characterId).messages;
    },
    windowStart: (characterId) => project(characterId).windowStartSeq,
    estimatedTokens: (characterId) => project(characterId).measurement.historyTokens,
    project,
  };
}

interface ViewContext {
  repo: TimelineRepo;
  window?: { budget(): number };
  summaries?: SummaryReader;
  reportWallHit: (hit: WallHit) => void;
  reportSourceBackstopHit?: (hit: SourceBackstopHit) => void;
  source?: { maxRows?: number; pageSize?: number };
}

// The Replay View pipeline (ADR 0008): summary substitution → R4 folds under pressure → the emergency token cut.
// Every stage is pure, so re-rendering the view from the same rows reproduces it byte-for-byte.
function selectView(ctx: ViewContext, characterId: string) {
  const summary = ctx.summaries?.get(characterId) ?? null;
  const through = summary?.throughSeq ?? 0;
  const measured = ctx.window !== undefined;
  const budget = ctx.window?.budget() ?? Number.POSITIVE_INFINITY;
  const source = measured
    ? loadReplaySource({ repo: ctx.repo, characterId, throughSeq: through, candidateBudget: budget, ...ctx.source })
    : legacySource(ctx.repo, characterId, through);
  if (source.backstopHit) ctx.reportSourceBackstopHit?.({ characterId, loadedRows: source.loadedRows,
    limit: ctx.source?.maxRows ?? REPLAY_SOURCE_BACKSTOP, throughSeq: through,
    oldestLoadedSeq: source.oldestLoadedSeq, newestLoadedSeq: source.newestLoadedSeq });
  const live = source.entries;
  // The head renders only while the view still reaches covered territory: if the backstop fetch already starts
  // past through_seq, the summary bridges nothing (rows fell off UNsummarized) and pretending continuity would lie.
  const head = summary !== null && source.summaryBridgeReached ? summaryHead(summary.text) : null;
  // The head occupies the same budget the rows compete for; unmeasured mode keeps the 0-cost convention.
  const headCost = head !== null && Number.isFinite(budget) ? estimateMessageTokens(head) : 0;
  const entryBudget = budget - headCost;
  const liveTokensBeforeFolds = measured ? estimateEntries(live) : 0;
  const folded = foldUnderPressure(live, entryBudget);
  const selection = selectWindow(folded.entries, entryBudget);
  const cutDropped = folded.entries.length - selection.entries.length;
  const tokenBoundaryHit = cutDropped > 0 && folded.estimatedTokens > entryBudget;
  // The wall (R5): every fold applied and the live rows STILL exceed the budget — the cut is now dropping
  // un-retired rows (hard truncation, the accepted fallback; the warn is what makes it observable).
  if (tokenBoundaryHit)
    ctx.reportWallHit({ characterId, windowStartSeq: selection.windowStartSeq, throughSeq: through, dropped: cutDropped });
  return {
    entries: selection.entries,
    head,
    // Substitution can retire every loaded row; then everything through `through` has left the window.
    windowStartSeq: live.length === 0 && head !== null ? through + 1 : selection.windowStartSeq,
    measurement: {
      sourceRows: source.loadedRows,
      liveRows: live.length,
      selectedRows: selection.entries.length,
      summaryTokens: headCost,
      liveTokensBeforeFolds,
      foldedTokensSaved: Math.max(0, liveTokensBeforeFolds - folded.estimatedTokens),
      historyTokens: selection.estimatedTokens + headCost,
      tokenBoundaryHit,
      sourceBackstopHit: source.backstopHit,
    },
  };
}

function legacySource(repo: TimelineRepo, characterId: string, throughSeq: number): ReplaySource {
  const rows = repo.latestAscending(characterId, REPLAY_WINDOW);
  const entries = throughSeq > 0 ? rows.filter((entry) => entry.seq > throughSeq) : rows;
  return { entries, summaryBridgeReached: throughSeq > 0 && entries.length < rows.length, backstopHit: false,
    loadedRows: rows.length, oldestLoadedSeq: rows[0]?.seq, newestLoadedSeq: rows.at(-1)?.seq };
}

function estimateEntries(entries: TimelineEntry[]): number {
  return entries.reduce((sum, entry) => {
    const message = toModelMessage(entry);
    return sum + (message === null ? 0 : estimateMessageTokens(message));
  }, 0);
}

// The head message is PROJECTION ONLY — never persisted, never a timeline row (R3; the user must never see a
// machine summary in scroll-back). role:"user" per the surveyed precedents (Claude Code / Codex / Letta legacy
// all re-enter the summary as a user-side message); the base prompt teaches the tag (batch 7b).
function summaryHead(text: string): ModelMessage {
  return { role: "user", content: `<conversation-summary>\n${text}\n</conversation-summary>` };
}
