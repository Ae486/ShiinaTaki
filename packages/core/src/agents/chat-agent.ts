/**
 * INPUT:  ChatSendParams + an injected LanguageModel (AI SDK v7), ConversationStore, MemoryEngine, optional AutoMemory
 * OUTPUT: createChatAgent({model, store, memory, ...}) -> ChatAgent whose stream() yields text deltas; persists the
 *         FULL turn (tool-calls + tool-results + text) after the loop; abort-aware, partial text never lost
 * POS:    core/agents — the streaming chat loop; base prompt + memory context + tools per turn; auto-writes detached
 */
import { ToolLoopAgent, isStepCount, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import type { ChatSendParams } from "@taki/shared";
import type { ApprovalGate } from "../approval/approval-gate.ts";
import type { AutoMemory } from "../memory/auto-memory.ts";
import type { MemoryEngine } from "../memory/memory-engine.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import type { ConversationStore } from "./conversation-store.ts";
import type { TurnMessage } from "./turn-mapping.ts";

/** Per-turn WS handle: notify pushes to the asking operator socket; onClose denies pending approvals on disconnect. */
export interface TurnContext {
  notify: (method: string, params: unknown) => void;
  onClose: (cb: () => void) => void;
  /** Aborts the in-flight model stream (chat.cancel / connection close); absent = uncancellable turn (tests). */
  signal?: AbortSignal;
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
  return { stream: (params, turn) => runTurn(deps, params, turn) };
}

async function* runTurn(deps: ChatAgentDeps, params: ChatSendParams, turn?: TurnContext): AsyncIterable<string> {
  const { store, memory, approval } = deps;
  const { characterId, message } = params;
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
  if (approval && turn) {
    // A disconnect mid-turn denies every pending approval immediately (fail-closed, ruling 3); so does an abort —
    // a cancelled turn stuck awaiting an approval must resolve now, not when the operator eventually answers.
    turn.onClose(() => approval.denyPending("connection closed"));
    turn.signal?.addEventListener("abort", () => approval.denyPending("turn cancelled"), { once: true });
  }
  // abortSignal is per-call by SDK design (not a constructor setting); abort ends the stream gracefully.
  const result = await agent.stream({ messages: history, abortSignal: turn?.signal });

  // pendingStepText holds ONLY the in-flight step's text: finish-step clears it because that step's text is then
  // inside its recorded response messages (persisting both would duplicate it).
  let pendingStepText = "";
  let streamEnded = false;
  try {
    // Iterate result.stream (not textStream) so a provider failure surfaces as an error part rather than being
    // swallowed. Tool/approval/abort parts flow by here — the assembled turn is persisted from responseMessages.
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        pendingStepText += part.text;
        yield part.text;
      } else if (part.type === "finish-step") {
        pendingStepText = "";
      } else if (part.type === "error") {
        throw part.error;
      }
    }
    streamEnded = true;
  } finally {
    // Persist whatever the turn produced — completed steps AND partial text — even on abort/error (D1 #1/#5).
    await persistTurn(store, characterId, { result, pendingStepText, streamEnded });
  }
  // Detached, never awaited: the auto-write pass must not add latency to the user-facing turn (prd §3 failure policy).
  void deps.autoMemory?.onTurnCompleted(characterId);
}

interface TurnOutcome {
  result: { responseMessages: PromiseLike<TurnMessage[]> };
  pendingStepText: string;
  streamEnded: boolean;
}

// On a clean end (including a graceful abort) the stream was fully consumed, so responseMessages settles: it
// resolves with every COMPLETED step's messages, or rejects when none completed (abort during step 0). After a
// THROWN error the loop exited early — the pipeline may never flush its promises, so they are not awaited.
async function persistTurn(store: ConversationStore, characterId: string, outcome: TurnOutcome): Promise<void> {
  if (outcome.streamEnded) {
    const completed = await Promise.resolve(outcome.result.responseMessages).then(
      (messages) => messages,
      () => [] as TurnMessage[],
    );
    if (completed.length > 0) store.appendTurn(characterId, completed);
  }
  // The interrupted step's partial text exists only in our accumulator (the SDK never finalizes that step); the
  // transcript must never lose what the user already saw — on abort AND on a thrown mid-stream error (D1 #5).
  // A clean completion cleared it at the final finish-step, so this only fires for interrupted turns.
  if (outcome.pendingStepText.length > 0) store.appendAssistant(characterId, outcome.pendingStepText);
}

// Instructions = the stable base prompt (identity + the "never claim a tool ran without a tool-result" floor,
// D1 #2), then the assembled memory context, then any extra section (skills list); blank sections dropped. The
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
  return [BASE_SYSTEM_PROMPT, assembled, deps.instructionsExtra?.() ?? ""]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

// The recall query: the last RECALL_WINDOW messages' text, joined (tool messages contribute nothing).
function recentText(history: ModelMessage[]): string {
  return history.slice(-RECALL_WINDOW).map(messageText).filter((text) => text.length > 0).join(" ");
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
}
