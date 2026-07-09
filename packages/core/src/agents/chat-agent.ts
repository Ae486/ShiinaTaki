/**
 * INPUT:  ChatSendParams + an injected LanguageModel (AI SDK v7)
 * OUTPUT: createChatAgent({ model }) -> ChatAgent whose stream() yields text deltas; errors propagate
 * POS:    core/agents — the streaming chat loop; owns per-character history via conversation-store (no tools this slice)
 */
import { ToolLoopAgent, type LanguageModel } from "ai";
import type { ChatSendParams } from "@taki/shared";
import { createConversationStore } from "./conversation-store.ts";

export interface ChatAgent {
  stream(params: ChatSendParams): AsyncIterable<string>;
}

/** The model is injected so tests can supply a MockLanguageModelV4 (no network). */
export interface ChatAgentDeps {
  model: LanguageModel;
}

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  const store = createConversationStore();
  // No tools, no persona this slice; history is passed per call via `messages`.
  const agent = new ToolLoopAgent({ model: deps.model });

  return {
    async *stream({ characterId, message }: ChatSendParams): AsyncIterable<string> {
      store.append(characterId, [{ role: "user", content: message }]);
      const result = await agent.stream({ messages: store.history(characterId) });
      for await (const delta of result.textStream) {
        yield delta;
      }
      store.append(characterId, await result.responseMessages);
    },
  };
}
