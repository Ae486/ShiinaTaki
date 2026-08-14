/**
 * INPUT:  appendUser(characterId, text, images?)/appendAssistant(characterId, text) + appendTurn(characterId, ModelMessage[]) +
 *         removeEntry(characterId, seq) + an injected TimelineRepo, onAppend/onRemove sinks, an optional window budget,
 *         an optional SummaryReader (R3) and an optional wall-hit sink (R5)
 * OUTPUT: createConversationStore(deps) -> { appendUser, appendAssistant, appendTurn, removeEntry, history, windowStart,
 *         estimatedTokens }
 * POS:    core/agents — SQLite-backed conversation store; persists safe turn projections (tool calls are names-only), replays the
 *         Replay View (ADR 0008: summary substitution → R4 folds → emergency token cut, all inside the ONE select
 *         closure the flush boundary also rides — batch 6/7)
 */
import type { ModelMessage } from "ai";
import type { TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { estimateMessageTokens } from "../memory/token-estimator.ts";
import { selectWindow } from "./context-window.ts";
import { foldUnderPressure } from "./replay-folds.ts";
import { toEntryInput, toModelMessage, toUserEntryInput, type TurnEntryInput, type TurnMessage, type UserImageInput } from "./turn-mapping.ts";

// The HARD BACKSTOP on replayed messages (T5-R1: context is measured in tokens; a message count survives ONLY as
// the guard against a broken estimator). Without an injected window budget it is also the whole window (legacy).
export const REPLAY_WINDOW = 200;

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
  appendTurn(characterId: string, messages: TurnMessage[]): void;
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
}

export interface ConversationStoreDeps {
  repo: TimelineRepo;
  /** Fired after each committed append; the server fans it out as timeline.appended (write→event colocation). */
  onAppend?: (entry: TimelineEntry) => void;
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
}

export function createConversationStore(deps: ConversationStoreDeps): ConversationStore {
  const { repo, onAppend, onRemove, window, summaries, onWallHit } = deps;
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
  // history(), windowStart() and estimatedTokens() MUST go through this one call — a second boundary computation
  // is how the flush and the replay drift apart (prd coupling point 2).
  const select = (characterId: string) => selectView({ repo, window, summaries, reportWallHit }, characterId);
  return {
    // No images = toUserEntryInput returns the legacy `{role:"user", content}` row (byte-identical to before #17).
    appendUser: (characterId, text, images = []) => commit(characterId, toUserEntryInput(text, images)),
    appendAssistant: (characterId, text) => void commit(characterId, { role: "assistant", content: text }),
    appendTurn: (characterId, messages) => {
      for (const message of messages) {
        const input = toEntryInput(message);
        if (input) commit(characterId, input);
      }
    },
    removeEntry: (characterId, seq) => {
      repo.deleteEntry(characterId, seq);
      onRemove?.({ characterId, seq });
    },
    // Legacy text-only rows reconstruct via content; tool calls replay with empty input placeholders, never raw args.
    history: (characterId) => {
      const view = select(characterId);
      const messages = view.entries
        .map(toModelMessage)
        .filter((message): message is ModelMessage => message !== null);
      return view.head === null ? messages : [view.head, ...messages];
    },
    windowStart: (characterId) => select(characterId).windowStartSeq,
    estimatedTokens: (characterId) => select(characterId).estimatedTokens,
  };
}

interface ViewContext {
  repo: TimelineRepo;
  window?: { budget(): number };
  summaries?: SummaryReader;
  reportWallHit: (hit: WallHit) => void;
}

// The Replay View pipeline (ADR 0008): summary substitution → R4 folds under pressure → the emergency token cut.
// Every stage is pure, so re-rendering the view from the same rows reproduces it byte-for-byte.
function selectView(ctx: ViewContext, characterId: string) {
  const rows = ctx.repo.latestAscending(characterId, REPLAY_WINDOW);
  const summary = ctx.summaries?.get(characterId) ?? null;
  const through = summary?.throughSeq ?? 0;
  const live = through > 0 ? rows.filter((entry) => entry.seq > through) : rows;
  // The head renders only while the view still reaches covered territory: if the backstop fetch already starts
  // past through_seq, the summary bridges nothing (rows fell off UNsummarized) and pretending continuity would lie.
  const head = summary !== null && live.length < rows.length ? summaryHead(summary.text) : null;
  const budget = ctx.window?.budget() ?? Number.POSITIVE_INFINITY;
  // The head occupies the same budget the rows compete for; unmeasured mode keeps the 0-cost convention.
  const headCost = head !== null && Number.isFinite(budget) ? estimateMessageTokens(head) : 0;
  const entryBudget = budget - headCost;
  const folded = foldUnderPressure(live, entryBudget);
  const selection = selectWindow(folded.entries, entryBudget, REPLAY_WINDOW);
  const cutDropped = folded.entries.length - selection.entries.length;
  // The wall (R5): every fold applied and the live rows STILL exceed the budget — the cut is now dropping
  // un-retired rows (hard truncation, the accepted fallback; the warn is what makes it observable).
  if (cutDropped > 0 && folded.estimatedTokens > entryBudget)
    ctx.reportWallHit({ characterId, windowStartSeq: selection.windowStartSeq, throughSeq: through, dropped: cutDropped });
  return {
    entries: selection.entries,
    head,
    // Substitution can retire every loaded row; then everything through `through` has left the window.
    windowStartSeq: live.length === 0 && head !== null ? through + 1 : selection.windowStartSeq,
    estimatedTokens: selection.estimatedTokens + headCost,
  };
}

// The head message is PROJECTION ONLY — never persisted, never a timeline row (R3; the user must never see a
// machine summary in scroll-back). role:"user" per the surveyed precedents (Claude Code / Codex / Letta legacy
// all re-enter the summary as a user-side message); the base prompt teaches the tag (batch 7b).
function summaryHead(text: string): ModelMessage {
  return { role: "user", content: `<conversation-summary>\n${text}\n</conversation-summary>` };
}
