/**
 * INPUT:  ChatSendParams + an injected LanguageModel (AI SDK v7), ConversationStore, and MemoryEngine
 * OUTPUT: createChatAgent({model, store, memory}) -> ChatAgent whose stream() yields text deltas; errors propagate
 * POS:    core/agents — the streaming chat loop; per turn: assemble memory context + bind tools, persist each turn
 */
import { ToolLoopAgent, isStepCount, type LanguageModel, type ModelMessage } from "ai";
import type { ChatSendParams } from "@taki/shared";
import type { MemoryEngine } from "../memory/memory-engine.ts";
import type { ConversationStore } from "./conversation-store.ts";

export interface ChatAgent {
  stream(params: ChatSendParams): AsyncIterable<string>;
}

/** model + store + memory are injected so tests supply a MockLanguageModelV4 and a tmp-workspace engine (no network/disk deps). */
export interface ChatAgentDeps {
  model: LanguageModel;
  store: ConversationStore;
  memory: MemoryEngine;
}

// Memory tools take a few steps at most; cap the loop low (a runaway tool loop just ends the turn cleanly).
const MAX_STEPS = 5;
// Retrieval + intention gate look at the current message plus the last few turns.
const RECALL_WINDOW = 5;

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  const { store, memory } = deps;

  return {
    async *stream({ characterId, message }: ChatSendParams): AsyncIterable<string> {
      store.appendUser(characterId, message);
      const history = store.history(characterId);
      // Per-turn construction: assembled instructions + characterId-bound tools (construction cost is trivial).
      const agent = new ToolLoopAgent({
        model: deps.model,
        instructions: memory.assemble({ characterId, queryText: recentText(history), currentMessage: message }),
        tools: memory.createTools(characterId),
        stopWhen: isStepCount(MAX_STEPS),
      });
      const result = await agent.stream({ messages: history });

      let assistantText = "";
      // Iterate result.stream (not textStream) so a provider failure surfaces as an error part rather than being
      // swallowed (#3 research addendum). Tool parts are ignored on purpose — the streamed text is the persisted
      // truth, and accumulating ALL steps' text-deltas equals exactly what the user saw (leader ruling 3).
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

// The recall query: the last RECALL_WINDOW messages' text, joined (our store is text-only, but stay defensive).
function recentText(history: ModelMessage[]): string {
  return history.slice(-RECALL_WINDOW).map(messageText).join(" ");
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
}
