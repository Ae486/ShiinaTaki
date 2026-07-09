/**
 * INPUT:  ChatSendParams + an injected LanguageModel (AI SDK v7) and ConversationStore
 * OUTPUT: createChatAgent({ model, store }) -> ChatAgent whose stream() yields text deltas; errors propagate
 * POS:    core/agents — the streaming chat loop; persists each turn via the injected store (no tools this slice)
 */
import { ToolLoopAgent, type LanguageModel } from "ai";
import type { ChatSendParams } from "@taki/shared";
import type { ConversationStore } from "./conversation-store.ts";

export interface ChatAgent {
  stream(params: ChatSendParams): AsyncIterable<string>;
}

/** model + store are injected so tests supply a MockLanguageModelV4 and a :memory: store (no network, no disk). */
export interface ChatAgentDeps {
  model: LanguageModel;
  store: ConversationStore;
}

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  const { store } = deps;
  // No tools, no persona this slice; history is passed per call via `messages`.
  const agent = new ToolLoopAgent({ model: deps.model });

  return {
    async *stream({ characterId, message }: ChatSendParams): AsyncIterable<string> {
      store.appendUser(characterId, message);
      const result = await agent.stream({ messages: store.history(characterId) });
      let assistantText = "";
      // result.stream (not textStream) so a provider failure surfaces as an error part rather
      // than being swallowed (verified: textStream drops error parts in ai@7.0.17 — see the
      // #3 research addendum); deltas ARE the truth for text-only chat. `fullStream` is a
      // deprecated alias of `stream`, so we use the canonical name.
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          assistantText += part.text;
          yield part.text;
        } else if (part.type === "error") {
          throw part.error;
        }
      }
      store.appendAssistant(characterId, assistantText);
    },
  };
}
