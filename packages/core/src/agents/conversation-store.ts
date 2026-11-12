/**
 * INPUT:  TimelineRepo, captured turn metadata, exact commit receipts, post-commit sinks, and optional Replay View policies
 * OUTPUT: atomic turn/append/remove APIs and one project() source for all Replay View consumers
 * POS:    core/agents — one conversational writer and Character-scoped canonical Replay View boundary (ADR 0008)
 */
/* eslint max-lines-per-function: ["error", { "max": 55, "skipBlankLines": true, "skipComments": true }] -- The factory keeps per-store replay diagnostic closures and thin source writer adapters together. */
import type { ModelMessage } from "ai";
import type { SourceContext, TimelineCommitted, TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { PrimaryConversationSourceRepo } from "../db/primary-conversation-source-repo.ts";
import type { PrimaryTurnPersistence } from "./primary-persistence.ts";
import { estimateMessageTokens, estimateMessagesTokens } from "../memory/token-estimator.ts";
import { selectWindow } from "./context-window.ts";
import { foldUnderPressure } from "./replay-folds.ts";
import { loadReplaySource, REPLAY_SOURCE_BACKSTOP, type ReplaySource } from "./replay-source-loader.ts";
import { toUserEntryInput, type TurnEntryInput, type TurnMessage, type UserImageInput } from "./turn-mapping.ts";
import { nativeReplayMessages, replayImageSnapshot, type ImageReplayReader } from "./native-image-replay.ts";
import { contextText, retainContextText } from "./context-attribution.ts";
import { beginPrimaryConversation, commitConversationTurn, publishTurnCommit, retractPrimaryConversation,
  type PrimaryBeginInput, type TurnCommitInput, type TurnWriterDeps } from "./conversation-turn-writer.ts";

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
  /** Bind trusted custody enrollment into the same atomic source/Timeline writer for one primary turn. */
  withPrimaryWriter(persistence: PrimaryTurnPersistence): ConversationStore;
  beginPrimary(input: PrimaryBeginInput): {
    userEntry: TimelineEntry; sourceId?: string;
  };
  retractPrimary(sourceId: string): void;
  /** Called only within the owning delivery transaction; the caller publishes after the outer commit. */
  appendDelivery(characterId: string, text: string, sourceContext?: SourceContext): TimelineEntry;
  /**
   * Persists the user turn and RETURNS the committed entry; images (#17) add image parts (mediaType + ref) — no
   * images = a legacy text-only row. The seq is returned so a cancel-before-reply can retract exactly this row.
   */
  appendUser(characterId: string, text: string, images?: UserImageInput[]): TimelineEntry;
  appendAssistant(characterId: string, text: string, onCommitted?: (entry: TimelineEntry) => void): void;
  /**
   * Persists a whole turn's response tail (names-only assistant tool-call parts + tool-result messages + final text),
   * oldest-first, as returned by `result.responseMessages` — the fix for cross-turn tool-record loss (D1 #1).
   */
  appendTurn(characterId: string, messages: TurnMessage[], options?: Readonly<Record<string, string>> | ((entry: TimelineEntry) => void)): void;
  commitTurn(input: TurnCommitInput): TimelineEntry[];
  /** Deletes one row by seq (cancel-retract) + fires onRemove; single Workspace/DB writer (invariant 2). */
  removeEntry(characterId: string, seq: number): void;
  /** The replay window as AI SDK messages, oldest-first (summary head first when one is substituted — R3). */
  history(characterId: string): ModelMessage[];
  /**
   * Seq of the oldest entry history() still replays; earlier rows have left the Replay View. Legacy flush uses
   * this same projection boundary; canonical ingestion tracks its independent durable source coverage.
   */
  windowStart(characterId: string): number;
  /** Estimator-unit size of the current replay view (summary head + kept rows) — the compaction trigger's input. */
  estimatedTokens(characterId: string): number;
  /** One immutable Replay View result for request construction and pressure/summary measurement. */
  project(characterId: string, budget?: number): ReplayProjection;
}

export interface ConversationStoreDeps {
  repo: TimelineRepo;
  /** Native image hydration uses the same read snapshot for source loading, folds, selection and projection. */
  attachments?: ImageReplayReader;
  primarySources?: NonNullable<TurnWriterDeps["primarySources"]> & {
    forTimeline?(timeline: TimelineRepo): PrimaryConversationSourceRepo;
  };
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
    publishTurnCommit(deps, () => onAppend?.(entry));
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
  const project = (characterId: string, budget?: number): ReplayProjection => {
    const attachments = replayImageSnapshot(deps.attachments);
    const view = selectView({ repo, window: budget === undefined ? window : { budget: () => budget }, summaries, reportWallHit, reportSourceBackstopHit, source, attachments }, characterId);
    const messages = view.entries.flatMap((entry) => nativeReplayMessages(entry, attachments));
    return { messages: view.head === null ? messages : [view.head, ...messages], windowStartSeq: view.windowStartSeq, measurement: view.measurement };
  };
  return {
    withPrimaryWriter: (persistence) => createConversationStore(primaryWriterDeps(deps, persistence)),
    beginPrimary: (input) => beginPrimaryConversation(deps, input),
    retractPrimary: (sourceId) => retractPrimaryConversation(deps, sourceId),
    appendDelivery: (characterId, text, sourceContext) => repo.append({ characterId, role: "assistant", content: text,
      ...(sourceContext === undefined ? {} : { sourceContext }) }),
    // No images = toUserEntryInput returns the legacy `{role:"user", content}` row (byte-identical to before #17).
    appendUser: (characterId, text, images = []) => commit(characterId, toUserEntryInput(text, images)),
      appendAssistant: (characterId, text, onCommitted) => {
        const entry = commit(characterId, { role: "assistant", content: text });
        onCommitted?.(entry);
      },
      appendTurn: (characterId, messages, options) => {
        const entries = commitConversationTurn(deps, { characterId, messages,
          ...(typeof options === "function" ? {} : { toolDisplayNames: options }) });
        if (typeof options === "function") for (const entry of entries) options(entry);
      },
      commitTurn: (input) => commitConversationTurn(deps, input),
    removeEntry: (characterId, seq) => {
      repo.deleteEntry(characterId, seq);
      publishTurnCommit(deps, () => onRemove?.({ characterId, seq }));
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

function primaryWriterDeps(deps: ConversationStoreDeps, persistence: PrimaryTurnPersistence): ConversationStoreDeps {
  const repo: TimelineRepo = { ...deps.repo, ...persistence.repo,
    appendBatch: (rows) => {
      const entries: TimelineEntry[] = [];
      persistence.atomic(() => { for (const row of rows) entries.push(persistence.repo.append(row)); });
      return entries;
    } };
  const sources = deps.primarySources;
  const forTimeline = sources?.forTimeline;
  if (sources && !forTimeline) throw new Error("PRIMARY_SOURCE_CUSTODY_BINDING_MISSING");
  return { ...deps, repo,
    onAppend: persistence.onAppend ?? deps.onAppend, onRemove: persistence.onRemove ?? deps.onRemove,
    primarySources: sources && forTimeline ? { ...sources, repo: forTimeline(repo) } : undefined };
}

interface ViewContext {
  repo: TimelineRepo;
  window?: { budget(): number };
  summaries?: SummaryReader;
  reportWallHit: (hit: WallHit) => void;
  reportSourceBackstopHit?: (hit: SourceBackstopHit) => void;
  source?: { maxRows?: number; pageSize?: number };
  attachments?: ImageReplayReader;
}

// The Replay View pipeline (ADR 0008): summary substitution → R4 folds under pressure → the emergency token cut.
// Every stage is pure, so re-rendering the view from the same rows reproduces it byte-for-byte.
function selectView(ctx: ViewContext, characterId: string) {
  const summary = ctx.summaries?.get(characterId) ?? null;
  const through = summary?.throughSeq ?? 0;
  const measured = ctx.window !== undefined;
  const budget = ctx.window?.budget() ?? Number.POSITIVE_INFINITY;
  const entryCost = (entry: TimelineEntry) => estimateMessagesTokens(nativeReplayMessages(entry, ctx.attachments));
  const source = measured
    ? loadReplaySource({ repo: ctx.repo, characterId, throughSeq: through, candidateBudget: budget, entryCost, ...ctx.source })
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
  const liveTokensBeforeFolds = measured ? live.reduce((sum, entry) => sum + entryCost(entry), 0) : 0;
  const folded = foldUnderPressure(live, entryBudget, entryCost);
  const selection = selectWindow(folded.entries, entryBudget, entryCost);
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

// The head message is PROJECTION ONLY — never persisted, never a timeline row (R3; the user must never see a
// machine summary in scroll-back). role:"user" per the surveyed precedents (Claude Code / Codex / Letta legacy
// all re-enter the summary as a user-side message); the base prompt teaches the tag (batch 7b).
function summaryHead(text: string): ModelMessage {
  const content = `<conversation-summary>\n${text}\n</conversation-summary>`;
  return retainContextText({ role: "user" as const, content }, contextText(content, "summary"));
}
