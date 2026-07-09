/**
 * INPUT:  appendUser/appendAssistant(characterId, text) + an injected TimelineRepo and onAppend sink
 * OUTPUT: createConversationStore({repo, onAppend}) -> { appendUser, appendAssistant, history }
 * POS:    core/agents — SQLite-backed conversation store; persists each turn, emits committed entries, replays history
 */
import type { ModelMessage } from "ai";
import type { TimelineEntry, TimelineRole } from "@taki/shared";
import type { TimelineRepo } from "../db/timeline-repo.ts";

// The model receives the latest REPLAY_WINDOW messages; compaction/token-budgeting is a later concern (ADR 0005).
const REPLAY_WINDOW = 200;

export interface ConversationStore {
  appendUser(characterId: string, text: string): void;
  appendAssistant(characterId: string, text: string): void;
  /** The replay window as AI SDK messages, oldest-first. */
  history(characterId: string): ModelMessage[];
}

export interface ConversationStoreDeps {
  repo: TimelineRepo;
  /** Fired after each committed append; the server fans it out as timeline.appended (write→event colocation). */
  onAppend?: (entry: TimelineEntry) => void;
}

export function createConversationStore(deps: ConversationStoreDeps): ConversationStore {
  const { repo, onAppend } = deps;
  const commit = (characterId: string, role: TimelineRole, text: string): void => {
    const entry = repo.append({ characterId, role, content: text });
    onAppend?.(entry);
  };
  return {
    appendUser: (characterId, text) => commit(characterId, "user", text),
    appendAssistant: (characterId, text) => commit(characterId, "assistant", text),
    history: (characterId) => repo.latestAscending(characterId, REPLAY_WINDOW).map(toModelMessage),
  };
}

// Text-only reconstruction (design decision 1): lossless for chat; multi-part fidelity returns when tools land.
function toModelMessage(entry: TimelineEntry): ModelMessage {
  return entry.role === "user"
    ? { role: "user", content: entry.content }
    : { role: "assistant", content: entry.content };
}
