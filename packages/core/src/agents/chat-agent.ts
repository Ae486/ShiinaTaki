/**
 * INPUT:  ChatSendParams (+optional attachments) + an injected LanguageModel (AI SDK v7), ConversationStore,
 *         MemoryEngine, optional AutoMemory/visionModel/attachment store/imageMemory hook
 * OUTPUT: createChatAgent({model, store, memory, ...}) -> ChatAgent whose stream() yields text deltas; persists the
 *         FULL turn (tool-calls + tool-results + text) after the loop; abort-aware, partial text never lost;
 *         a cancel before any output retracts the just-appended user row (deletes it + skips the memory writes)
 * POS:    core/agents — the streaming chat loop; base prompt + memory context + tools per turn; auto-writes detached
 */
import { ToolLoopAgent, isStepCount, type LanguageModel, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import type { ChatSendParams, ImageAttachment } from "@taki/shared";
import type { ApprovalGate } from "../approval/approval-gate.ts";
import { COSTUME_CHANGE_NOTICE } from "../avatar/costume-notice.ts";
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
  /** Fired when a cancel landed before the turn produced anything: the user row was retracted, so the pump closes
   *  with a retract error (restore the draft) instead of a normal complete. Absent = no retract handling (tests). */
  onRetract?: () => void;
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
  /** Vision model slot (TAKI_VLM_*, #17 decision 5); image-bearing turns route here. Absent = image turns rejected. */
  visionModel?: LanguageModel;
  /** Content-addressed attachment writer — a NARROW structural type (zero coupling to the media module). */
  attachments?: { save(dataBase64: string, mediaType: ImageAttachment["mediaType"]): { ref: string; bytes: number } };
  /** Detached post-turn image-description hook (mirrors autoMemory); fired void, only when the turn carried images (D28). */
  imageMemory?: { onImageTurn(input: { characterId: string; refs: string[]; caption: string }): void };
  /** Extra tools merged after memory tools each turn (skills load_skill + MCP tools); stable across turns. */
  extraTools?: ToolSet;
  /** Per-character tools built fresh each turn with the turn's characterId (avatar tools bind their publish target here). */
  characterTools?: (characterId: string) => ToolSet;
  /** Extra instructions appended after the assembled memory context (skills list + avatar vocabulary); "" contributes nothing. */
  instructionsExtra?: (characterId: string) => string;
  /** A one-shot costume-change flag for THIS turn (consumed = acknowledged): true → a COSTUME_CHANGE_NOTICE is prefixed
   *  onto the model-facing user message (never persisted) so the model adopts the freshly-reported avatar vocabulary
   *  (1f). Absent = no costume tracking (tests). */
  costumeChanged?: (characterId: string) => boolean;
  /** MCP tool-approval gate; only consulted when a TurnContext is present (its notify carries the ask). */
  approval?: ApprovalGate;
  /** Tool-loop step cap per turn (round-trips: call -> observe -> decide). Injected from AgentConfig; falls back to DEFAULT_MAX_STEPS. */
  maxSteps?: number;
  /** Extra stop conditions OR-composed into stopWhen after the step cap (e.g. the avatar presentation tail-stop, 1c). */
  stopConditions?: StopCondition<ToolSet>[];
}

// Fallback step cap when no caller injects one (tests). Production injects AgentConfig.maxSteps (env TAKI_MAX_STEPS, D11);
// a turn hitting the cap ends cleanly instead of looping forever.
const DEFAULT_MAX_STEPS = 10;
// Retrieval + intention gate look at the current message plus the last few turns.
const RECALL_WINDOW = 5;

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  return { stream: (params, turn) => runTurn(deps, params, turn) };
}

async function* runTurn(deps: ChatAgentDeps, params: ChatSendParams, turn?: TurnContext): AsyncIterable<string> {
  const { store, memory, approval } = deps;
  const { characterId, message } = params;
  const attachments = params.attachments ?? [];
  // Image turns route to the vision slot (decision 5). A turn carrying images with no slot/store configured is rejected
  // BEFORE any persistence — the text model must never be handed an image (chat-send maps this throw to a structured
  // chat.error; the UI also disables attach). `vision` is null for a text turn, else the narrowed {model, store}.
  const vision = attachments.length > 0 ? requireVisionDeps(deps) : null;
  // Save the in-flight bytes to the content-addressed store; only the refs (mediaType + ref) persist on the timeline row.
  const images = vision
    ? attachments.map((a) => ({ mediaType: a.mediaType, ref: vision.store.save(a.dataBase64, a.mediaType).ref }))
    : [];
  // Capture the committed user row so a cancel-before-reply can retract exactly this seq (the retract seam below).
  const userEntry = store.appendUser(characterId, message, images);
  const history = store.history(characterId);
  // Per-turn construction: assembled instructions + characterId-bound tools (construction cost is trivial).
  const agent = new ToolLoopAgent({
    model: vision ? vision.model : deps.model,
    instructions: composeInstructions(deps, { characterId, history, message }),
    tools: { ...memory.createTools(characterId), ...(deps.extraTools ?? {}), ...(deps.characterTools?.(characterId) ?? {}) },
    stopWhen: [isStepCount(deps.maxSteps ?? DEFAULT_MAX_STEPS), ...(deps.stopConditions ?? [])],
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
  // The in-flight image bytes ride ONLY this turn's messages (a FilePart tail swap replacing the just-appended user
  // row's text projection); persistence + replay stay text (decision 6). A costume swap since the model's last turn
  // rides in-flight the same way (a one-shot note prefixed onto the user TEXT, 1f). BOTH are additive seams on the
  // D1-frozen turn — `history` (the persisted projection) is NEVER mutated; text-turn/no-notice stays byte-identical.
  // consumeCostumeChanged fires here even if the turn is later cancelled/retracted (baseline advances anyway → a rare
  // skipped notice, backstopped by the 1e enum; accepted narrow edge).
  const outgoing = buildOutgoing({ history, isImageTurn: vision !== null, message, attachments, changed: deps.costumeChanged?.(characterId) ?? false });
  // abortSignal is per-call by SDK design (not a constructor setting). A cancel ends the stream by EITHER a graceful
  // `abort` part or a THROWN reason (see retractIfCancelledSilent) — the retract seam below handles both endings.
  const result = await agent.stream({ messages: outgoing, abortSignal: turn?.signal });

  // pendingStepText holds ONLY the in-flight step's text: finish-step clears it because that step's text is then
  // inside its recorded response messages (persisting both would duplicate it).
  let pendingStepText = "";
  let streamEnded = false;
  try {
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
  } catch (error) {
    // Throw ending of a cancel: the transport rejects the read with our string reason (fails isAbortError), so the
    // SDK errors the stream — same retract rule as the graceful ending (see retractIfCancelledSilent); else propagate.
    if (await retractIfCancelledSilent(store, { characterId, userSeq: userEntry.seq, result, pendingStepText, turn })) return;
    throw error;
  }
  // Graceful ending (the SDK emitted an `abort` part then closed): the same retract check on the clean path.
  if (await retractIfCancelledSilent(store, { characterId, userSeq: userEntry.seq, result, pendingStepText, turn })) return;
  fireDetachedTurnWrites(deps, { characterId, imageRefs: images.map((img) => img.ref), message });
}

// The detached post-turn writes: the auto-memory pass + the image-description hook. Fired void so they never add
// latency to the user-facing turn (prd §3), and ONLY on the committed path — a retracted turn skips them (it never
// entered model memory), and a throw ending never reaches here (it rethrew or already retracted).
function fireDetachedTurnWrites(deps: ChatAgentDeps, ctx: { characterId: string; imageRefs: string[]; message: string }): void {
  void deps.autoMemory?.onTurnCompleted(ctx.characterId);
  // An image turn's authoritative cross-turn record is the vision model's TEXT description (decision 6).
  if (ctx.imageRefs.length > 0) {
    void deps.imageMemory?.onImageTurn({ characterId: ctx.characterId, refs: ctx.imageRefs, caption: ctx.message });
  }
}

interface RetractInput {
  characterId: string;
  userSeq: number;
  result: { responseMessages: PromiseLike<TurnMessage[]> };
  pendingStepText: string;
  turn?: TurnContext;
}

// The cancel-before-reply retract, ENDING-AGNOSTIC. A cancel reaches runTurn's post-loop code by either SDK ending:
// (a) GRACEFUL — the model read resolves (or rejects with an AbortError-shaped error) and the SDK emits an `abort`
// stream part then closes; (b) THROW — the transport rejects the read with our PLAIN-STRING abort reason, which
// fails provider-utils `isAbortError` (an Error/DOMException named AbortError/ResponseAborted/TimeoutError), so the
// SDK errors the stream and the for-await throws the reason. In BOTH, "produced nothing" == aborted with no completed
// step (responseMessages settles to [] / rejects — verified it does NOT hang after the error ending) and no partial
// text. On retract: delete exactly the appended user row (DB + timeline.removed) and signal the pump to restore the
// draft; the message never enters memory. Attachments are NOT restored client-side (bytes stay until TTL GC).
async function retractIfCancelledSilent(store: ConversationStore, input: RetractInput): Promise<boolean> {
  if (!(input.turn?.signal?.aborted ?? false) || input.pendingStepText.length > 0) return false;
  if ((await Promise.resolve(input.result.responseMessages).then((m) => m.length, () => 0)) !== 0) return false;
  store.removeEntry(input.characterId, input.userSeq);
  input.turn?.onRetract?.();
  return true;
}

// Image turns need BOTH the vision slot and the attachment store; a turn with images but either missing is rejected
// (the guard). Returns the narrowed non-optional pair so the save + model-pick sites carry no `undefined` (decision 5).
function requireVisionDeps(deps: ChatAgentDeps): { model: LanguageModel; store: NonNullable<ChatAgentDeps["attachments"]> } {
  if (!deps.visionModel || !deps.attachments) {
    throw new Error("Image attachments require a configured vision model (TAKI_VLM_*)");
  }
  return { model: deps.visionModel, store: deps.attachments };
}

// This turn's model-facing messages. A plain text turn sends `history` unchanged (byte-identical to the pre-1f/pre-image
// path); an image turn swaps a FilePart tail for the last user row (bytes in-flight only, decision 6); a costume swap
// prefixes a one-shot note onto the user TEXT (1f). All additive — `history` (the persisted projection) is never
// mutated; a text turn's history tail is {role:"user", content:message}, so rebuilding it with the prefixed text is faithful.
function buildOutgoing(args: {
  history: ModelMessage[];
  isImageTurn: boolean;
  message: string;
  attachments: ImageAttachment[];
  changed: boolean;
}): ModelMessage[] {
  const modelText = args.changed ? `${COSTUME_CHANGE_NOTICE}\n\n${args.message}` : args.message;
  if (args.isImageTurn) return [...args.history.slice(0, -1), buildMultimodalUser(modelText, args.attachments)];
  if (args.changed) return [...args.history.slice(0, -1), { role: "user", content: modelText }];
  return args.history;
}

// The canonical v7 multimodal user message: a FilePart per attachment (ImagePart is @deprecated in v7), `data` = RAW
// base64 (a tagged data-URL throws InvalidDataContentError — research r1). This message rides one turn and is never persisted.
function buildMultimodalUser(text: string, attachments: ImageAttachment[]): ModelMessage {
  const fileParts = attachments.map((a) => ({ type: "file" as const, mediaType: a.mediaType, data: a.dataBase64 }));
  return { role: "user", content: text.length > 0 ? [{ type: "text" as const, text }, ...fileParts] : fileParts };
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
  return [BASE_SYSTEM_PROMPT, assembled, deps.instructionsExtra?.(turn.characterId) ?? ""]
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
