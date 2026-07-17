/**
 * INPUT:  appendUser(characterId, text, images?)/appendAssistant(characterId, text) + appendTurn(characterId, ModelMessage[]) +
 *         removeEntry(characterId, seq) + an injected TimelineRepo and onAppend/onRemove sinks
 * OUTPUT: createConversationStore({repo, onAppend, onRemove}) -> { appendUser, appendAssistant, appendTurn, removeEntry, history }
 * POS:    core/agents — SQLite-backed conversation store; persists each turn (full multi-part fidelity), replays history
 */
import type { ModelMessage } from "ai";
import type { TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { toEntryInput, toModelMessage, toUserEntryInput, type TurnEntryInput, type TurnMessage, type UserImageInput } from "./turn-mapping.ts";

// The model receives the latest REPLAY_WINDOW messages; compaction/token-budgeting is a later concern (ADR 0005).
// Exported as the single source: the pre-compaction flush (#7) treats this boundary AS the context edge.
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
}

export interface ConversationStoreDeps {
  repo: TimelineRepo;
  /** Fired after each committed append; the server fans it out as timeline.appended (write→event colocation). */
  onAppend?: (entry: TimelineEntry) => void;
  /** Fired after a retract delete; the server fans it out as timeline.removed (mirrors onAppend). */
  onRemove?: (ref: { characterId: string; seq: number }) => void;
}

export function createConversationStore(deps: ConversationStoreDeps): ConversationStore {
  const { repo, onAppend, onRemove } = deps;
  const commit = (characterId: string, input: TurnEntryInput): TimelineEntry => {
    const entry = repo.append({ characterId, ...input });
    onAppend?.(entry);
    return entry;
  };
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
    history: (characterId) => {
      const entries = repo.latestAscending(characterId, REPLAY_WINDOW);
      // The hard window cut can strand tool rows whose assistant tool-call fell outside the window; a leading
      // tool message is invalid replay input for providers, so drop rows until the first non-tool one.
      const first = entries.findIndex((entry) => entry.role !== "tool");
      return (first === -1 ? [] : entries.slice(first))
        .map(toModelMessage)
        .filter((message): message is ModelMessage => message !== null);
    },
  };
}
