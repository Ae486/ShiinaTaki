/**
 * INPUT:  a Timeline append/delete sink plus optional post-commit append/remove observers
 * OUTPUT: createConversationWriter -> the names-only append/remove API shared by the store and per-turn custody writers
 * POS:    core/agents — the single mapping from turn messages to Timeline rows; observers fire only after each commit
 */
import type { TimelineEntry } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { toEntryInput, toUserEntryInput, type TurnEntryInput, type TurnMessage, type UserImageInput } from "./turn-mapping.ts";

export interface ConversationWriter {
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
  appendTurn(characterId: string, messages: TurnMessage[], onCommitted?: (entry: TimelineEntry) => void): void;
  /** Deletes one row by seq (cancel-retract) + fires onRemove; single Workspace/DB writer (invariant 2). */
  removeEntry(characterId: string, seq: number): void;
}

export interface ConversationWriterDeps {
  repo: Pick<TimelineRepo, "append" | "deleteEntry">;
  /** Fired after each committed append; the server fans it out as timeline.appended (write→event colocation). */
  onAppend?: (entry: TimelineEntry) => void;
  /** Fired after a retract delete; the server fans it out as timeline.removed (mirrors onAppend). */
  onRemove?: (ref: { characterId: string; seq: number }) => void;
}

export function createConversationWriter({ repo, onAppend, onRemove }: ConversationWriterDeps): ConversationWriter {
  const commit = (characterId: string, input: TurnEntryInput): TimelineEntry => {
    const entry = repo.append({ characterId, ...input });
    onAppend?.(entry);
    return entry;
  };
  return {
    // No images = toUserEntryInput returns the legacy `{role:"user", content}` row (byte-identical to before #17).
    appendUser: (characterId, text, images = []) => commit(characterId, toUserEntryInput(text, images)),
    appendAssistant: (characterId, text, onCommitted) => {
      const entry = commit(characterId, { role: "assistant", content: text });
      onCommitted?.(entry);
    },
    appendTurn: (characterId, messages, onCommitted) => {
      for (const message of messages) {
        const input = toEntryInput(message);
        if (input) { const entry = commit(characterId, input); onCommitted?.(entry); }
      }
    },
    removeEntry: (characterId, seq) => {
      repo.deleteEntry(characterId, seq);
      onRemove?.({ characterId, seq });
    },
  };
}
