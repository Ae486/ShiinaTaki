/**
 * INPUT:  (characterId, ModelMessage[]) appends
 * OUTPUT: createConversationStore() -> { history, append }; an in-memory Map per characterId
 * POS:    core/agents — multi-turn history; lost on restart (SQLite timeline #5 replaces behind this interface)
 */
import type { ModelMessage } from "ai";

export interface ConversationStore {
  history(characterId: string): ModelMessage[];
  append(characterId: string, messages: ModelMessage[]): void;
}

export function createConversationStore(): ConversationStore {
  const conversations = new Map<string, ModelMessage[]>();

  return {
    history(characterId) {
      return conversations.get(characterId) ?? [];
    },
    append(characterId, messages) {
      const existing = conversations.get(characterId) ?? [];
      conversations.set(characterId, [...existing, ...messages]);
    },
  };
}
