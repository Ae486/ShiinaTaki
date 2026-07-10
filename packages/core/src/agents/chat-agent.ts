/**
 * INPUT:  ChatSendParams + an injected LanguageModel (AI SDK v7), ConversationStore, MemoryEngine, optional AutoMemory
 * OUTPUT: createChatAgent({model, store, memory, autoMemory?}) -> ChatAgent whose stream() yields text deltas; errors propagate
 * POS:    core/agents — the streaming chat loop; per turn: assemble memory context + bind tools, persist, fire auto-writes detached
 */
import { ToolLoopAgent, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { ChatSendParams } from "@taki/shared";
import type { ApprovalGate } from "../approval/approval-gate.ts";
import type { AutoMemory } from "../memory/auto-memory.ts";
import type { MemoryEngine } from "../memory/memory-engine.ts";
import type { ConversationStore } from "./conversation-store.ts";

/** Per-turn WS handle: notify pushes to the asking operator socket; onClose denies pending approvals on disconnect. */
export interface TurnContext {
  notify: (method: string, params: unknown) => void;
  onClose: (cb: () => void) => void;
}

export interface ChatAgent {
  stream(params: ChatSendParams, turn?: TurnContext): AsyncIterable<string>;
}

/** model + store + memory are injected so tests supply a MockLanguageModelV4 and a tmp-workspace engine (no network/disk deps). */
export interface ChatAgentDeps {
  model: LanguageModel;
  store: ConversationStore;
  memory: MemoryEngine;
  /** Optional auto-write orchestrator; when present, fired detached after each turn (existing tests omit it). */
  autoMemory?: AutoMemory;
  /** Extra tools merged after memory tools each turn (skills load_skill + MCP tools); stable across turns. */
  extraTools?: ToolSet;
  /** Extra instructions appended after the assembled memory context (e.g. the skills list); "" contributes nothing. */
  instructionsExtra?: () => string;
  /** MCP tool-approval gate; only consulted when a TurnContext is present (its notify carries the ask). */
  approval?: ApprovalGate;
}

// Memory tools take a few steps at most; cap the loop low (a runaway tool loop just ends the turn cleanly).
const MAX_STEPS = 5;
// Retrieval + intention gate look at the current message plus the last few turns.
const RECALL_WINDOW = 5;

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  const { store, memory, approval } = deps;

  return {
    async *stream({ characterId, message }: ChatSendParams, turn?: TurnContext): AsyncIterable<string> {
      store.appendUser(characterId, message);
      const history = store.history(characterId);
      // Per-turn construction: assembled instructions + characterId-bound tools (construction cost is trivial).
      const agent = new ToolLoopAgent({
        model: deps.model,
        instructions: composeInstructions(deps, { characterId, history, message }),
        tools: { ...memory.createTools(characterId), ...(deps.extraTools ?? {}) },
        stopWhen: isStepCount(MAX_STEPS),
        // MCP tool calls await the operator's decision inside the loop; internal tools return not-applicable (ruling 5).
        // The gate is installed whenever it is configured — without a turn (no notify sink) it denies unremembered
        // MCP tools instead of coming off (fail-closed: a turn without an operator must not bypass approval).
        toolApproval: approval ? ({ toolCall }) => approval.decide(toolCall, turn?.notify) : undefined,
      });
      // A disconnect mid-turn denies every pending approval immediately (fail-closed, ruling 3).
      if (approval && turn) turn.onClose(() => approval.denyPending("connection closed"));
      const result = await agent.stream({ messages: history });

      let assistantText = "";
      // Iterate result.stream (not textStream) so a provider failure surfaces as an error part rather than being
      // swallowed (#3 research addendum). Tool + approval parts are ignored on purpose — the streamed text is the
      // persisted truth, and accumulating ALL steps' text-deltas equals exactly what the user saw (leader ruling 3).
      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          assistantText += part.text;
          yield part.text;
        } else if (part.type === "error") {
          throw part.error;
        }
      }
      store.appendAssistant(characterId, assistantText);
      // Detached, never awaited: the auto-write pass must not add latency to the user-facing turn (prd §3 failure policy).
      void deps.autoMemory?.onTurnCompleted(characterId);
    },
  };
}

// Instructions = assembled memory context, then any extra section (skills list), blank sections dropped. The
// skills list enters HERE, never through the memory assembler (module boundary, ruling 10).
function composeInstructions(
  deps: ChatAgentDeps,
  turn: { characterId: string; history: ModelMessage[]; message: string },
): string {
  const assembled = deps.memory.assemble({
    characterId: turn.characterId,
    queryText: recentText(turn.history),
    currentMessage: turn.message,
  });
  return [assembled, deps.instructionsExtra?.() ?? ""].filter((section) => section.length > 0).join("\n\n");
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
