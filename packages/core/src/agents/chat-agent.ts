/**
 * INPUT:  ChatSendParams (+optional attachments) + an injected LanguageModel (AI SDK v7), ConversationStore,
 *         MemoryEngine, optional AutoMemory/visionModel/attachment store/imageMemory/onUsage hooks
 * OUTPUT: createChatAgent({model, store, memory, ...}) -> ChatAgent whose stream() yields text deltas; persists the
 *         FULL turn (tool-calls + tool-results + text) after the loop; abort-aware, partial text never lost;
 *         a cancel before any output retracts the just-appended user row (deletes it + skips the memory writes)
 * POS:    core/agents — the streaming chat loop; DAY-STABLE instructions (base prompt + day line + memory context)
 *         with the volatile <turn-context> tail riding the outgoing user message (Q4/ADR 0008); auto-writes detached;
 *         a classified context-overflow retries ONCE against the same captured Run extension context
 */
import { ToolLoopAgent, isStepCount, wrapLanguageModel, type LanguageModel, type ModelMessage, type StopCondition, type ToolSet } from "ai";
import type { ChatSendParams, ImageAttachment } from "@taki/shared";
import type { ApprovalGate } from "../approval/approval-gate.ts";
import type { Connection } from "../server/connection-registry.ts";
import { COSTUME_CHANGE_NOTICE } from "../avatar/costume-notice.ts";
import type { AutoMemory } from "../memory/auto-memory.ts";
import type { MemoryEngine } from "../memory/memory-engine.ts";
import { estimateMessagesTokens, estimateTokens } from "../memory/token-estimator.ts";
import { renderCurrentTime, renderDayDate } from "../time/time-context.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import type { ConversationStore } from "./conversation-store.ts";
import { isContextOverflowError, observedTokensOf } from "./overflow-error.ts";
import { mergeToolSets } from "./tool-set-assembly.ts";
import type { TurnMessage, UserImageInput } from "./turn-mapping.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createModelEffectMiddleware } from "./model-effect-middleware.ts";

/** Per-turn execution handle. Primary chat supplies a WS connection; unattended non-primary Runs omit it. */
export interface TurnContext {
  /** Exact physical operator socket that initiated this turn; Approval session authority is object-identity bound. */
  connection?: Connection;
  notify?: (method: string, params: unknown) => void;
  onClose?: (cb: () => void) => void;
  /** Aborts the in-flight model stream (chat.cancel / connection close); absent = uncancellable turn (tests). */
  signal?: AbortSignal;
  /** Fired when a cancel landed before the turn produced anything: the user row was retracted, so the pump closes
   *  with a retract error (restore the draft) instead of a normal complete. Absent = no retract handling (tests). */
  onRetract?: () => void;
  /** Durable Harness identity and input classification; omitted callers remain primary-compatible. */
  runId?: string;
  attemptId?: string;
  turnKind?: "primary" | "non-primary";
  controlInput?: string;
  /** Admission-captured runtime bindings reused by every model retry for this durable Run. */
  runContext?: AgentRunContext;
  /** Records a new durable Attempt immediately before the one supported overflow retry. */
  onRetry?: (reason: string) => boolean;
}

export interface ChatAgent {
  stream(params: ChatSendParams, turn?: TurnContext): AsyncIterable<string>;
}

// Activation swaps the advertised memory vocabulary as one bundle. Keeping the authority-specific variant next to
// the shared prompt prevents canonical Local from exposing retired Markdown tool names in a normal turn.
export const CANONICAL_MEMORY_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT
  .replaceAll("memory_search", "recall")
  .replaceAll("memory_write", "retain")
  .replaceAll("memory_archive", "invalidate_memory");

/** One committed turn's usage sample: the provider's post-hoc numbers + our estimate for the SAME request. */
export interface TurnUsageReport {
  inputTokens?: number;
  outputTokens?: number;
  /** estimateTokens(instructions) + estimateMessagesTokens(outgoing) — the calibration denominator (R1 tier 2). */
  estimatedInput: number;
}

/** Immutable-by-contract resources captured once before a Run's first model attempt and shared by every retry. */
export interface AgentRunContext {
  readonly tools?: ToolSet;
  /** Memory authority tool closures captured at Admission so a queued Run cannot switch epochs before execution. */
  readonly memoryTools?: ToolSet;
  readonly instructions?: string;
  dispose?(): void;
}

/** model + store + memory are injected so tests supply a MockLanguageModelV4 and a tmp-workspace engine (no network/disk deps). */
export interface ChatAgentDeps {
  model: LanguageModel;
  store: ConversationStore;
  memory: MemoryEngine;
  /** Authority-selected memory procedure prompt; canonical Local must not advertise retired Markdown tool names. */
  memoryPrompt?: string | (() => string);
  /** Optional auto-write orchestrator; when present, fired detached after each turn (existing tests omit it). */
  autoMemory?: AutoMemory;
  /** Vision model slot (TAKI_VLM_*, #17 decision 5); image-bearing turns route here. Absent = image turns rejected. */
  visionModel?: LanguageModel;
  /** Content-addressed attachment writer — a NARROW structural type (zero coupling to the media module). */
  attachments?: { save(dataBase64: string, mediaType: ImageAttachment["mediaType"]): { ref: string; bytes: number } };
  /** Detached post-turn image-description hook (mirrors autoMemory); fired void, only when the turn carried images (D28). */
  imageMemory?: { onImageTurn(input: { characterId: string; refs: string[]; caption: string }): void };
  /** Adapter-governed tools merged after Core governance (Skill/MCP/Host); stable across turns. */
  extraTools?: ToolSet;
  /** Connection-bound adapter tools built per turn (MCP); preferred over static extraTools for interactive authority. */
  turnTools?: (turn: TurnContext & { connection: Connection }) => ToolSet;
  /** Host/extension snapshot captured once per Run; an overflow retry reuses this exact value. */
  runContext?: (turn?: TurnContext) => AgentRunContext;
  /** Stable Core-local tools included with memory/avatar tools before the Core adapter runs. */
  coreTools?: ToolSet;
  /** Wraps only the Core-local per-turn ToolSet with trusted bindings; absent in focused agent tests. */
  coreToolGovernance?: { wrap(tools: ToolSet, interactive?: { connection: Connection; signal?: AbortSignal; runId?: string; attemptId?: string; effects?: EffectLifecycleService }): ToolSet };
  /** Per-character tools built fresh each turn with the turn's characterId (avatar tools bind their publish target here). */
  characterTools?: (characterId: string) => ToolSet;
  /** Extra instructions appended after the assembled memory context (skills list + avatar vocabulary); "" contributes nothing. */
  instructionsExtra?: (characterId: string) => string;
  /** Volatile per-turn context (perception activity/screen, fenced upstream) carried INSIDE the <turn-context> tail
   *  on the outgoing user message — in-flight only, never persisted (Q4/ADR 0008). Absent/blank = a time-only tail. */
  volatileContext?: (now: number) => string;
  /** A one-shot costume-change flag for THIS turn (consumed = acknowledged): true → a COSTUME_CHANGE_NOTICE is prefixed
   *  onto the model-facing user message (never persisted) so the model adopts the freshly-reported avatar vocabulary
   *  (1f). Absent = no costume tracking (tests). */
  costumeChanged?: (characterId: string) => boolean;
  /** MCP tool-approval gate; a missing notify channel makes ask fail closed for unattended turns. */
  approval?: ApprovalGate;
  /** Tool-loop step cap per turn (round-trips: call -> observe -> decide). Injected from AgentConfig; falls back to DEFAULT_MAX_STEPS. */
  maxSteps?: number;
  /** Extra stop conditions OR-composed into stopWhen after the step cap (e.g. the avatar presentation tail-stop, 1c). */
  stopConditions?: StopCondition<ToolSet>[];
  /** Usage-capture seam (batch 6, R1 tier 2): fired DETACHED on committed turns only, alongside the auto-memory
   *  fire (same never-adds-latency contract); a retract or a thrown ending fires nothing. Absent = today's behavior. */
  onUsage?: (report: TurnUsageReport) => void;
  /** R2 overflow seam (batch 6): fired ONCE per turn, right before the single classified retry, with the observed
   *  input tokens (parsed from the provider error body, else our own estimate of the same request). main.ts wires
   *  the window calibrator's onOverflow + the counts-only warn. Absent = no retry, today's propagation. */
  onOverflow?: (observedInput: number) => void;
  /** Optional Core-owned effect boundary; omitted by focused legacy callers. */
  effectLifecycle?: EffectLifecycleService;
}

// Fallback step cap when no caller injects one (tests). Production injects AgentConfig.maxSteps (env TAKI_MAX_STEPS, D11);
// a turn hitting the cap ends cleanly instead of looping forever.
const DEFAULT_MAX_STEPS = 10;

export function createChatAgent(deps: ChatAgentDeps): ChatAgent {
  return { stream: (params, turn) => runTurn(deps, params, turn) };
}

// Narrowed vision pair (decision 5): model + attachment store, present iff the turn carries images.
type VisionDeps = { model: LanguageModel; store: NonNullable<ChatAgentDeps["attachments"]> };

/** The per-turn stable inputs each attempt replays; `state` is re-created per attempt (the R2 retry reads it). */
interface TurnAttempt {
  characterId: string;
  message: string;
  attachments: ImageAttachment[];
  images: UserImageInput[];
  vision: VisionDeps | null;
  userSeq?: number;
  primary: boolean;
  runContext?: AgentRunContext;
  state: AttemptState;
}

/** What an attempt exposes to the R2 classifier: the composed request (lazy estimate fallback) + step completion. */
interface AttemptState {
  instructions: string;
  outgoing: ModelMessage[];
  stepEnded: boolean;
}

async function* runTurn(deps: ChatAgentDeps, params: ChatSendParams, turn?: TurnContext): AsyncIterable<string> {
  const { store, approval } = deps;
  const { characterId, message } = params;
  const attachments = params.attachments ?? [];
  // Image turns route to the vision slot (decision 5). A turn carrying images with no slot/store configured is rejected
  // BEFORE any persistence — the text model must never be handed an image (chat-send maps this throw to a structured
  // chat.error; the UI also disables attach). `vision` is null for a text turn, else the narrowed {model, store}.
  const vision = attachments.length > 0 ? requireVisionDeps(deps) : null;
  // Save the in-flight bytes to the content-addressed store; only the refs (mediaType + ref) persist on the timeline row.
  const primary = (turn?.turnKind ?? "primary") === "primary";
  const images = primary && vision
    ? attachments.map((a) => ({ mediaType: a.mediaType, ref: vision.store.save(a.dataBase64, a.mediaType).ref }))
    : [];
  // Capture the committed user row so a cancel-before-reply can retract exactly this seq (the retract seam in the
  // attempt). Appended ONCE — an R2 retry replays the same committed row, never a second one.
  const userEntry = primary ? store.appendUser(characterId, message, images) : undefined;
  if (approval && turn) wireApprovalDenial(approval, turn);
  const runContext = turn?.runContext ?? deps.runContext?.(turn);
  const ownsRunContext = turn?.runContext === undefined;
  const base = { characterId, message, attachments, images, vision, userSeq: userEntry?.seq, primary, runContext };
  // R2 retry seam (batch 6): ONE overflow-classified retry around the whole attempt. Retry ONLY when the failed
  // attempt was provably side-effect-free — zero text yielded (nothing user-visible lost) AND zero completed steps
  // (no tool can have acted; re-running the model after a completed tool step could act twice — the error-handling
  // spec's never-blind-retry rule). Unrecognized errors and second failures propagate as today (fail-open), and an
  // absent onOverflow seam disables the retry entirely (nothing would have recalibrated the window). NEVER any
  // compaction/summarization here — batch 7 owns that (R2).
  try {
    for (let attempt = 0; ; attempt += 1) {
      const state: AttemptState = { instructions: "", outgoing: [], stepEnded: false };
      let yielded = false;
      try {
        for await (const delta of runAttempt(deps, { ...base, state }, turn)) {
          yielded = true;
          yield delta;
        }
        return;
      } catch (error) {
        const onOverflow = deps.onOverflow;
        const clean = !yielded && !state.stepEnded;
        if (attempt > 0 || !clean || onOverflow === undefined || !isContextOverflowError(error)) throw error;
        if (turn?.onRetry?.("context_overflow") === false) throw error;
        // Observed = the provider-reported request size when the body names one, else our own estimate of the SAME
        // request (computed only here, off every hot path). The calibrator persists the shrunken window, so the
        // retry's fresh history() pull re-windows through the store's budget closure.
        onOverflow(observedTokensOf(error) ?? estimateTokens(state.instructions) + estimateMessagesTokens(state.outgoing));
      }
    }
  } finally {
    if (ownsRunContext) runContext?.dispose?.();
  }
}

// ONE model attempt — request composition, streaming, persistence, retract, detached fires — extracted so the R2
// retry can re-run it under the recalibrated window (batch-6 design §3.1's named-fn relief; the machinery below is
// the pre-batch-6 runTurn body, moved verbatim). The fresh per-attempt history() pull is the point: the retry's
// window is computed under the budget the calibrator just shrank.
// eslint-disable-next-line max-lines-per-function
async function* runAttempt(deps: ChatAgentDeps, attempt: TurnAttempt, turn?: TurnContext): AsyncIterable<string> {
  const { store, approval } = deps;
  const { characterId, message, attachments, images, vision, userSeq, primary, state } = attempt;
  const controlMessage = turn?.controlInput ?? message;
  const history = store.history(characterId);
  // ONE clock read per attempt: the instructions' day line and the tail's time line must agree (Q4).
  const now = Date.now();
  // Hoisted so the batch-6 usage seam can estimate the SAME instructions string the request carries.
  const instructions = composeInstructions(deps, { characterId, message: controlMessage, runInstructions: attempt.runContext?.instructions }, now);
  // Per-turn construction: assembled instructions + characterId-bound tools (construction cost is trivial).
  const selectedModel = vision ? vision.model : deps.model;
  const model = deps.effectLifecycle && turn?.runId && turn.attemptId
    ? wrapLanguageModel({ model: selectedModel as Parameters<typeof wrapLanguageModel>[0]["model"], middleware: createModelEffectMiddleware({ lifecycle: deps.effectLifecycle, runId: turn.runId, attemptId: turn.attemptId }) })
    : selectedModel;
  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools: assembleTurnTools(deps, attempt, turn),
    stopWhen: [isStepCount(deps.maxSteps ?? DEFAULT_MAX_STEPS), ...(deps.stopConditions ?? [])],
    // Compatibility seam for focused tests and pre-Slice-3 callers. Production Batch 1 leaves this absent because
    // MCP execution is already guarded by its canonical adapter and `ask` fails closed before the raw closure.
    toolApproval: approval ? ({ toolCall }) => approval.decide(toolCall, turn?.notify) : undefined,
    // A completed step disqualifies the R2 retry (see runTurn's seam comment); construction-level on purpose so the
    // frozen stream loop body below stays byte-identical (`onStepFinish` is this callback's deprecated alias).
    onStepEnd: () => {
      state.stepEnded = true;
    },
  });
  // THREE additive seams ride ONLY this turn's outgoing copy of the last user row (the D1-frozen turn is otherwise
  // untouched): the in-flight image bytes as a FilePart tail swap (decision 6), a one-shot costume note prefixed onto
  // the user TEXT (1f), and the <turn-context> tail suffixed onto it (Q4 — time line + volatile perception ride the
  // REQUEST, never the store). `history` (the persisted projection) is NEVER mutated; the tail always exists, so every
  // turn rebuilds its last user row (the old text-turn "history unchanged" fast path is superseded).
  // consumeCostumeChanged fires here even if the turn is later cancelled/retracted or R2-retried (baseline advances
  // anyway, and a retry attempt carries no second notice → a rare skipped notice, backstopped by the 1e enum;
  // accepted narrow edge).
  const outgoing = buildOutgoing({ history, isImageTurn: vision !== null, message: controlMessage, attachments, changed: primary ? (deps.costumeChanged?.(characterId) ?? false) : false, tail: buildTurnTail(now, deps.volatileContext), primary });
  // Exposed for the R2 estimate fallback — read only on the retry path, never on the hot path.
  state.instructions = instructions;
  state.outgoing = outgoing;
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
      if (primary) await persistTurn(store, characterId, { result, pendingStepText, streamEnded });
    }
  } catch (error) {
    // Throw ending of a cancel: the transport rejects the read with our string reason (fails isAbortError), so the
    // SDK errors the stream — same retract rule as the graceful ending (see retractIfCancelledSilent); else propagate.
    if (primary && userSeq !== undefined && await retractIfCancelledSilent(store, { characterId, userSeq, result, pendingStepText, turn })) return;
    throw error;
  }
  // Graceful ending (the SDK emitted an `abort` part then closed): the same retract check on the clean path.
  if (primary && userSeq !== undefined && await retractIfCancelledSilent(store, { characterId, userSeq, result, pendingStepText, turn })) return;
  if (primary) fireDetachedTurnWrites(deps, { characterId, imageRefs: images.map((img) => img.ref), message });
  if (primary) fireUsageReport(deps, { usage: result.usage, instructions, outgoing });
}

function assembleTurnTools(deps: ChatAgentDeps, attempt: TurnAttempt, turn?: TurnContext): ToolSet {
  const coreTools = mergeToolSets(
    attempt.runContext?.memoryTools ?? deps.memory.createTools(attempt.characterId),
    deps.coreTools ?? {},
    deps.characterTools?.(attempt.characterId) ?? {},
  );
  const interactive = turn?.connection ? { connection: turn.connection, signal: turn.signal, runId: turn.runId, attemptId: turn.attemptId, effects: deps.effectLifecycle } : undefined;
  const extra = turn?.connection && deps.turnTools
    ? deps.turnTools({ ...turn, connection: turn.connection })
    : deps.extraTools ?? {};
  return mergeToolSets(
    deps.coreToolGovernance?.wrap(coreTools, interactive) ?? coreTools,
    extra,
    attempt.runContext?.tools ?? {},
  );
}

// A disconnect mid-turn denies every pending approval immediately (fail-closed, ruling 3); so does an abort —
// a cancelled turn stuck awaiting an approval must resolve now, not when the operator eventually answers.
// (Pure move out of runTurn: the batch-6 usage seam pushed it past the 50-line fn cap — the design's named-fn
// relief clause.)
function wireApprovalDenial(approval: ApprovalGate, turn: TurnContext): void {
  turn.onClose?.(() => approval.denyPending("connection closed"));
  turn.signal?.addEventListener("abort", () => approval.denyPending("turn cancelled"), { once: true });
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

// Batch-6 usage-capture seam (R1 tier 2), committed path only: `result.usage` is a PromiseLike settled after stream
// end (the all-steps sum, verified against ai@7.0.17 dist). Fired void with the rejection swallowed — a usage
// promise that rejects (abort during step 0) reports nothing; no sample beats a fabricated one. The estimate is
// computed HERE (off the turn's critical path) from the exact strings/messages the request carried; tool schemas
// deliberately ride the historyRatio reserve instead of the estimate (batch-6 design §2.1).
function fireUsageReport(
  deps: ChatAgentDeps,
  ctx: { usage: PromiseLike<{ inputTokens: number | undefined; outputTokens: number | undefined }>; instructions: string; outgoing: ModelMessage[] },
): void {
  const report = deps.onUsage;
  if (!report) return;
  const estimatedInput = estimateTokens(ctx.instructions) + estimateMessagesTokens(ctx.outgoing);
  void Promise.resolve(ctx.usage).then(
    (usage) => report({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimatedInput }),
    () => undefined,
  );
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
function requireVisionDeps(deps: ChatAgentDeps): VisionDeps {
  if (!deps.visionModel || !deps.attachments) {
    throw new Error("Image attachments require a configured vision model (TAKI_VLM_*)");
  }
  return { model: deps.visionModel, store: deps.attachments };
}

// This turn's model-facing messages: history with its last user row REBUILT as the outgoing copy — costume notice
// prefix (1f), the current message, then the turn-context tail suffix (Q4); an image turn carries that text as the
// text part before its FileParts (bytes in-flight only, decision 6). All in-flight: `history` (the persisted
// projection) is never mutated, so replay never accumulates notices or tails.
function buildOutgoing(args: {
  history: ModelMessage[];
  isImageTurn: boolean;
  message: string;
  attachments: ImageAttachment[];
  changed: boolean;
  tail: string;
  primary: boolean;
}): ModelMessage[] {
  const modelText = [args.changed ? COSTUME_CHANGE_NOTICE : "", args.message, args.tail]
    .filter((part) => part.length > 0)
    .join("\n\n");
  const prefix = args.primary && args.history.at(-1)?.role === "user" ? args.history.slice(0, -1) : args.history;
  if (args.isImageTurn) return [...prefix, buildMultimodalUser(modelText, args.attachments)];
  return [...prefix, { role: "user", content: modelText }];
}

// The volatile tail (Q4/ADR 0008): every minute-granular item — the wall-clock line first, unconditionally, then
// whatever volatile context the composition root wires (perception activity/screen, fenced upstream) — inside ONE
// <turn-context> block appended to the outgoing user message. The wrapper conveys "app-appended, not user-typed";
// an <untrusted-observation> fence inside it keeps conveying "data, never instructions" — two orthogonal contracts,
// two tags. The tag NAME is a LOCAL choice (grep-verified unused in-tree); the PATTERN is Claude Code's
// <system-reminder> / Codex's <environment_context> (rb §P1 verdict).
function buildTurnTail(now: number, volatileContext?: (now: number) => string): string {
  const volatile = volatileContext?.(now) ?? "";
  const body = volatile.length > 0 ? `${renderCurrentTime(now)}\n\n${volatile}` : renderCurrentTime(now);
  return `<turn-context>\n${body}\n</turn-context>`;
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

// Instructions = the stable base prompt (identity + the "never claim a tool ran without a tool-result" floor, D1 #2),
// the day-date line (byte-stable for a calendar day), the assembled memory context, then any extra section (skills
// list + avatar vocabulary — boot/costume-stable). DAY-STABLE by construction (Q4, rb §A5): nothing minute-granular
// remains here — the time line and perception moved to the turn-context tail — so on a breakpoint-less prefix cache
// the byte-stable instructions AND the whole replayed history stay cached across same-day turns. Blank sections
// dropped; the skills list enters HERE, never through the memory assembler (module boundary, ruling 10).
function composeInstructions(
  deps: ChatAgentDeps,
  turn: { characterId: string; message: string; runInstructions?: string },
  now: number,
): string {
  const assembled = deps.memory.assemble({ characterId: turn.characterId, currentMessage: turn.message });
  return [
    resolveMemoryPrompt(deps.memoryPrompt),
    renderDayDate(now),
    assembled,
    deps.instructionsExtra?.(turn.characterId) ?? "",
    turn.runInstructions ?? "",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function resolveMemoryPrompt(prompt: ChatAgentDeps["memoryPrompt"]): string {
  return typeof prompt === "function" ? prompt() : prompt ?? BASE_SYSTEM_PROMPT;
}
