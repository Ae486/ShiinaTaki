/**
 * INPUT:  appendUser(characterId, text, images?)/appendAssistant(characterId, text) + appendTurn(characterId, ModelMessage[]) +
 *         removeEntry(characterId, seq) + an injected TimelineRepo, onAppend/onRemove sinks and an optional window budget
 * OUTPUT: createConversationStore({repo, onAppend, onRemove, window}) -> { appendUser, appendAssistant, appendTurn, removeEntry, history, windowStart }
 * POS:    core/agents — SQLite-backed conversation store; persists each turn (full multi-part fidelity), replays the
 *         token-measured window (selectWindow — the flush shares windowStart as the SAME boundary, batch 6)
 */
import type { ModelMessage } from "ai";
import type { TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { selectWindow } from "./context-window.ts";
import { toEntryInput, toModelMessage, toUserEntryInput, type TurnEntryInput, type TurnMessage, type UserImageInput } from "./turn-mapping.ts";

// The HARD BACKSTOP on replayed messages (T5-R1: context is measured in tokens; a message count survives ONLY as
// the guard against a broken estimator). Without an injected window budget it is also the whole window (legacy).
export const REPLAY_WINDOW = 200;

export interface ConversationStore {
  /**
   * Persists the user turn and RETURNS the committed entry; images (#17) add image parts (mediaType + ref) — no
   * images = a legacy text-only row. The seq is returned so a cancel-before-reply can retract exactly this row.
   */
  appendUser(characterId: string, text: string, images?: UserImageInput[]): TimelineEntry;
  appendAssistant(characterId: string, text: string): void;
  /**
   * Persists a whole turn's response tail (assistant tool-call parts + tool-result messages + final text),
   * oldest-first, as returned by `result.responseMessages` — the fix for cross-turn tool-record loss (D1 #1).
   */
  appendTurn(characterId: string, messages: TurnMessage[]): void;
  /** Deletes one row by seq (cancel-retract) + fires onRemove; single Workspace/DB writer (invariant 2). */
  removeEntry(characterId: string, seq: number): void;
  /** The replay window as AI SDK messages, oldest-first (full multi-part fidelity when parts are present). */
  history(characterId: string): ModelMessage[];
  /**
   * Seq of the oldest entry history() still replays — every row below it has LEFT the model's window. The flush
   * computes "leaving the window" from THIS boundary (same selectWindow call: same slice, no drift — batch 6).
   */
  windowStart(characterId: string): number;
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
}

export function createConversationStore(deps: ConversationStoreDeps): ConversationStore {
  const { repo, onAppend, onRemove, window } = deps;
  const commit = (characterId: string, input: TurnEntryInput): TimelineEntry => {
    const entry = repo.append({ characterId, ...input });
    onAppend?.(entry);
    return entry;
  };
  // history() and windowStart() MUST go through this one call — a second boundary computation is how the flush
  // and the replay drift apart (prd coupling point 2).
  const select = (characterId: string) =>
    selectWindow(repo.latestAscending(characterId, REPLAY_WINDOW), window?.budget() ?? Number.POSITIVE_INFINITY, REPLAY_WINDOW);
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
    // Legacy text-only rows reconstruct via content; parts-carrying rows replay their full multi-part shape.
    history: (characterId) =>
      select(characterId)
        .entries.map(toModelMessage)
        .filter((message): message is ModelMessage => message !== null),
    windowStart: (characterId) => select(characterId).windowStartSeq,
  };
}
