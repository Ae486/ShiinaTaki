/**
 * INPUT:  chat/attachment input, SDK models, ConversationStore, Memory hooks, live User Timezone and Run bindings
 * OUTPUT: ordered live activity, text compatibility streaming, and atomic full-turn persistence after either ending
 * POS:    core/agents — the existing ToolLoopAgent boundary; owns abort/retract and one context-overflow retry,
 *         preserving day-stable instructions, volatile message-tail context, and detached memory writes
 */
import { ToolLoopAgent, isStepCount, type LanguageModel, type ModelMessage, type StopCondition, type Telemetry, type ToolSet } from "ai";
import { captureToolDisplayNames, type ChatSendParams, type ImageAttachment, type InitiativeSelectedContext, type RunMemoryReference, type TimelineEntry } from "@taki/shared";
import { initiativeInstructions, initiativeReplay, restrictInitiativeTools } from "./initiative-context.ts";
import type { HeartbeatDecisionCollector } from "./heartbeat-respond-tool.ts";
import type { ApprovalGate } from "../approval/approval-gate.ts";
import type { Connection } from "../server/connection-registry.ts";
import { COSTUME_CHANGE_NOTICE } from "../avatar/costume-notice.ts";
import type { AutoMemory } from "../memory/auto-memory.ts";
import type { MemoryEngine } from "../memory/memory-engine.ts";
import { renderCurrentTime, renderDayDate } from "../time/time-context.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import type { ConversationStore } from "./conversation-store.ts";
import { isContextOverflowError, observedTokensOf } from "./overflow-error.ts";
import { mergeToolSets } from "./tool-set-assembly.ts";
import { fireUsageReport, type TurnUsageReport } from "./turn-usage-report.ts";
import { estimateMessagesTokens, estimateTokens } from "../memory/token-estimator.ts";
import type { RequestMeasurement } from "./request-measurement.ts";
import { measurePostTurnRequest, prepareOutgoingRequest, type RequestPreparationDeps } from "./request-preparation.ts";
import type { UserImageInput } from "./turn-mapping.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import { createRunObservabilityModel, type ToolEffectObserver } from "./run-observability-telemetry.ts";
import type { ChatActivityAttempt, ChatTurnActivity } from "./chat-activity.ts";
import { createTurnRecording, type TurnRecording } from "./turn-recording.ts";
import type { AutomaticMemoryRecall } from "../memory/automatic-memory-recall.ts";
import type { PrimaryConversationCommit } from "../memory/canonical-ingestion-source.ts";
import type { ToolDisclosureSnapshot } from "../extensions/tool-disclosure-snapshot.ts";
import { bindCapturedSkillLoad, createToolDisclosure, type SkillToolBundle } from "./tool-disclosure.ts";
import { bindCapturedToolExecution } from "../governance/captured-tool-execution.ts";

/** Per-turn execution handle. Primary chat supplies a WS connection; unattended non-primary Runs omit it. */
export interface TurnContext {
  /** Trusted synchronous fence and opportunity charge inside each model Effect intent transaction. */
  onCommitModelIntent?: () => void;
  /** Final SDK step text after authoritative settlement; unattended delivery must not publish intermediate deltas. */
  onSettledText?: (text: string) => void;
  /** Trusted caller's optional tool subset for this execution; narrows existing governed tools without granting any. */
  allowedToolNames?: readonly string[];
  decisionCollector?: HeartbeatDecisionCollector;
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
  toolObserver?: ToolEffectObserver;
  /** Disposable foreground presentation; the accepted send identity and terminal notification are server-owned. */
  activity?: ChatTurnActivity;
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
export type { TurnUsageReport } from "./turn-usage-report.ts";

/** Immutable-by-contract resources captured once before a Run's first model attempt and shared by every retry. */
export interface AgentRunContext {
  readonly toolDisclosure?: ToolDisclosureSnapshot;
  readonly selectedContext?: InitiativeSelectedContext;
  readonly tools?: ToolSet;
  /** Presentation only; copied before the first attempt so injected mutable tables cannot rename a finished turn. */
  readonly toolDisplayNames?: Readonly<Record<string, string>>;
  /** Memory authority tool closures captured at Admission so a queued Run cannot switch epochs before execution. */
  readonly memoryTools?: ToolSet;
  readonly memorySnapshot?: RunMemoryReference;
  readonly automaticMemoryRecall?: AutomaticMemoryRecall;
  readonly memoryPrompt?: string;
  readonly assembleMemory?: (currentMessage: string) => string;
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
  /** Exact committed primary rows, never a queried seq range. The composition root persists source witnesses. */
  onPrimaryCommitted?: (input: PrimaryConversationCommit) => void;
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
  coreTools?: ToolSet | ((primary: boolean, characterId: string) => ToolSet);
  /** Primary-only domain tools bind the exact committed input, never a later query for the newest user row. */
  primaryTools?: (input: { characterId: string; userEntry: TimelineEntry; turn?: TurnContext }) => ToolSet;
  /** Trusted integration registration; only a successful current-generation Skill load discloses its tools. */
  skillTools?: (input: { characterId: string; userEntry?: TimelineEntry; turn?: TurnContext }) => readonly SkillToolBundle[];
  /** Wraps only the Core-local per-turn ToolSet with trusted bindings; absent in focused agent tests. */
  coreToolGovernance?: { wrap(tools: ToolSet, interactive?: { connection?: Connection; signal?: AbortSignal; runId?: string; attemptId?: string; effects?: EffectLifecycleService; toolObserver?: ToolEffectObserver }): ToolSet };
  /** Per-character tools built fresh each turn with the turn's characterId (avatar tools bind their publish target here). */
  characterTools?: (characterId: string) => ToolSet;
  /** Extra instructions appended after the assembled memory context (skills list + avatar vocabulary); "" contributes nothing. */
  instructionsExtra?: (characterId: string) => string;
  /** Live User Timezone authority; captured once per attempt for its day/time lines. Omitted = legacy local time. */
  userTimezone?: () => string;
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
   *  fire (same never-adds-latency contract); a retract, cancellation or thrown ending fires nothing. */
  onUsage?: (report: TurnUsageReport) => void;
  /** The configured non-history share of the calibrated context window; actual stable costs consume it first. */
  requestEnvelopeReserve?: () => number;
  /** Production enables provider usage as the complete-envelope calibration anchor. */
  useProviderUsage?: boolean;
  /** Captures primary relationship pressure before detached maintenance; ephemeral controls never replace it. */
  onRequestMeasured?: (characterId: string, measurement: RequestMeasurement) => void;
  /** Applies only safe typed reductions to the admitted request and returns the valid reduced projection. */
  requestReduction?: RequestPreparationDeps["requestReduction"];
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

type PromptClock = { now: number; timezone?: string };

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
  userEntry?: TimelineEntry;
  primary: boolean;
  runContext?: AgentRunContext;
  toolDisplayNames?: Readonly<Record<string, string>>;
  recall: { result?: Promise<string> };
  state: AttemptState;
}

/** What an attempt exposes to the R2 classifier: the composed request (lazy estimate fallback) + step completion. */
interface AttemptState {
  instructions: string;
  outgoing: ModelMessage[];
  stepEnded: boolean;
  recording: TurnRecording;
  activity?: ChatActivityAttempt;
  afterCommit?: () => void;
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
  const base = { characterId, message, attachments, images, vision, userSeq: userEntry?.seq, userEntry, primary, runContext, recall: {},
    toolDisplayNames: captureToolDisplayNames(runContext?.toolDisplayNames) };
  try {
    yield* executeAttempts(deps, base, turn);
  } finally {
    if (ownsRunContext) runContext?.dispose?.();
  }
}

async function* executeAttempts(deps: ChatAgentDeps, base: Omit<TurnAttempt, "state">, turn?: TurnContext): AsyncIterable<string> {
  for (let ordinal = 0; ; ordinal += 1) {
    const state: AttemptState = { instructions: "", outgoing: [], stepEnded: false, recording: createTurnRecording() };
    let yielded = false;
    let failure: { error: unknown } | undefined;
    let retrying = false;
    let retracted = false;
    try {
      try {
        for await (const delta of runAttempt(deps, { ...base, state }, turn)) { yielded = true; yield delta; }
      } catch (error) {
        const clean = !yielded && !state.stepEnded;
        if (ordinal === 0 && clean && deps.onOverflow && isContextOverflowError(error)
          && turn?.onRetry?.("context_overflow") !== false) {
          deps.onOverflow(observedTokensOf(error) ?? estimateTokens(state.instructions) + estimateMessagesTokens(state.outgoing));
          retrying = true;
          continue;
        }
        failure = { error };
      }
    } finally {
      state.activity?.close(turn?.signal?.aborted ?? false);
      // Includes iterator.return(): delivered partial text survives even when a direct consumer stops reading.
      // A failed transaction is outside the stream catch and therefore cannot retry or append a second batch.
      if (!retrying) retracted = finishRecordedTurn(deps, { ...base, state }, turn);
    }
    if (retracted) return;
    if (failure) throw failure.error;
    // A cancelled turn keeps its committed source witness but starts no post-turn maintenance.
    if (!turn?.signal?.aborted) state.afterCommit?.();
    return;
  }
}

function finishRecordedTurn(deps: ChatAgentDeps, attempt: TurnAttempt, turn?: TurnContext): boolean {
  const { store } = deps;
  if (!attempt.primary) return false;
  const { recording, activity } = attempt.state;
  const retract = (turn?.signal?.aborted ?? false) && !recording.hasProduced() && attempt.userSeq !== undefined;
  if (retract && attempt.userSeq !== undefined) {
    store.removeEntry(attempt.characterId, attempt.userSeq);
    turn?.onRetract?.();
  }
  const entries = recording.commit({ store, characterId: attempt.characterId, toolDisplayNames: attempt.toolDisplayNames,
    activity: turn?.activity, attempt: activity });
  // The atomic writer returns the exact committed rows, including presentation metadata. Witness only
  // this primary source, after commit and on exceptional/iterator-close endings as well as normal completion.
  // A clean overflow retry never reaches this guard; a retracted user row must never become ingestion input.
  if (!retract && attempt.userEntry) deps.onPrimaryCommitted?.({ characterId: attempt.characterId,
    entries: [attempt.userEntry, ...entries], runId: turn?.runId });
  return retract;
}

// Each attempt rebuilds the calibrated Replay View and captures actual SDK material. The outer turn alone decides
// retry/retraction and commits the captured batch before detached maintenance sees the updated relationship history.
// eslint-disable-next-line max-lines-per-function
async function* runAttempt(deps: ChatAgentDeps, attempt: TurnAttempt, turn?: TurnContext): AsyncIterable<string> {
  const { store, approval } = deps;
  const { characterId, message, attachments, images, vision, primary, state } = attempt;
  state.activity = turn?.activity?.beginAttempt(turn.attemptId);
  const selected = attempt.runContext?.selectedContext;
  // An admitted opportunity may acquire governed evidence before reasoning. Append that ephemeral result
  // without replacing the original selected instructions, source manifest or immutable context binding.
  const controlMessage = selected ? [selected.controlInput, turn?.controlInput].filter(Boolean).join("\n\n")
    : turn?.controlInput ?? message;
  const replay = selected ? initiativeReplay() : store.project(characterId); const history = replay.messages;
  // Capture the clock and user zone together: awaited recall must not split the day/time lines across settings.
  const now = Date.now();
  const clock = { now, timezone: selected ? undefined : deps.userTimezone?.() };
  const memoryContext = selected ? "" : attempt.runContext?.assembleMemory?.(controlMessage) ?? deps.memory.assemble({ characterId, currentMessage: controlMessage });
  const instructions = selected ? initiativeInstructions(selected) : composeInstructions(deps, { characterId, memoryContext, memoryPrompt: attempt.runContext?.memoryPrompt, runInstructions: attempt.runContext?.instructions }, clock);
  const selectedModel = vision ? vision.model : deps.model;
  const { model, observability } = createRunObservabilityModel({
    model: selectedModel, lifecycle: deps.effectLifecycle, runId: turn?.runId, attemptId: turn?.attemptId,
    onCommitModelIntent: turn?.onCommitModelIntent,
    toolDisplayNames: attempt.toolDisplayNames,
    activity: state.activity?.observer,
  });
  if (turn && observability) turn.toolObserver = observability.tools;
  const { tools, bundles } = assembleTurnTools(deps, attempt, turn);
  const disclosure = createToolDisclosure({ tools, bundles, snapshot: attempt.runContext?.toolDisclosure });
  const visibleTools = disclosure.initialTools;
  const toolOrder = Object.keys(tools).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  let preparedTools: ReadonlyArray<Record<string, unknown>> | undefined;
  const requestTelemetry: Telemetry = { onLanguageModelCallStart: (event) => { preparedTools = event.tools ?? []; } };
  const agent = new ToolLoopAgent({
    model,
    instructions,
    tools,
    toolOrder,
    prepareCall: (settings) => ({ ...settings,
      // The SDK fallback prints raw provider exceptions. Core handles the unchanged public error part.
      onError: () => undefined }),
    prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) }),
    telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false,
      integrations: observability ? [observability.telemetry, requestTelemetry] : [requestTelemetry] },
    stopWhen: [isStepCount(deps.maxSteps ?? DEFAULT_MAX_STEPS), ...(turn?.decisionCollector ? [turn.decisionCollector.stop] : deps.stopConditions ?? [])],
    // Compatibility seam for focused tests and pre-Slice-3 callers. Production Batch 1 leaves this absent because
    // MCP execution is already guarded by its canonical adapter and `ask` fails closed before the raw closure.
    toolApproval: approval ? ({ toolCall }) => approval.decide(toolCall, turn?.notify) : undefined,
    // Capture each completed step before a later request can fail and reject the aggregate response promise.
    // The same completed-step fact preserves the existing prohibition on retrying completed tool effects.
    onStepEnd: (event) => {
      // SDK 7.0.148 also emits onStepEnd for an error-only provider response before the public error part.
      // That failed request must retain the one clean overflow retry; completed tools still fence replay.
      state.stepEnded ||= event.finishReason !== "error" || event.content.length > 0;
      state.recording.capture(event.stepNumber, event.response.messages);
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
  attempt.recall.result ??= recallMemory(attempt, { query: message, visibleContext: memoryContext, now, signal: turn?.signal });
  const recalled = await attempt.recall.result;
  const initialOutgoing = buildOutgoing({ history, isImageTurn: vision !== null, message: controlMessage, attachments, changed: primary ? (deps.costumeChanged?.(characterId) ?? false) : false, tail: selected ? "" : buildTurnTail(clock, deps.volatileContext, recalled), primary });
  // Provider maintenance may still be pending when an autonomous Run starts. Its ephemeral control envelope must
  // not replace the last primary pressure snapshot used to decide whether the relationship Timeline needs compaction.
  const preparationDeps = primary ? deps : { ...deps, onRequestMeasured: undefined };
  const prepared = await prepareOutgoingRequest(preparationDeps, { characterId, instructions, outgoing: initialOutgoing, replay: replay.measurement, tools: visibleTools, toolOrder });
  const outgoing = prepared.messages;
  // Exposed for the R2 estimate fallback — read only on the retry path, never on the hot path.
  state.instructions = instructions;
  state.outgoing = outgoing;
  // abortSignal is per-call by SDK design. The outer capture/commit finally covers graceful abort and thrown reasons.
  const result = await agent.stream({ messages: outgoing, abortSignal: turn?.signal });

  // The public stream owns presentation order. Completed steps were captured independently before a later throw.
  for await (const part of result.stream) {
    state.recording.observe(part);
    observability?.observeStreamPart(part);
    if (observability) state.activity?.observe(part, observability.invocations);
    if (part.type === "text-delta") yield part.text;
    else if (part.type === "error") throw part.error;
  }
  observability?.assertHealthy();
  if (!primary && turn?.onSettledText && !turn.signal?.aborted) turn.onSettledText(await result.text);
  state.afterCommit = () => {
    if (!primary) return;
    measurePostTurnRequest(deps, { characterId, instructions, tools: visibleTools, toolOrder, toolSchemaTokens: prepared.toolSchemaTokens, store });
    fireDetachedTurnWrites(deps, { characterId, imageRefs: images.map((img) => img.ref), message });
    fireUsageReport(deps, { characterId, usage: result.usage, instructions, outgoing, tools: visibleTools, toolOrder, preparedTools, replay: replay.measurement });
  };
}

function assembleTurnTools(deps: ChatAgentDeps, attempt: TurnAttempt, turn?: TurnContext) {
  const bundles = (deps.skillTools?.({ characterId: attempt.characterId, userEntry: attempt.userEntry, turn }) ?? [])
    .filter((bundle) => attempt.runContext?.toolDisclosure?.skills[bundle.skillName] !== undefined);
  const coreTools = mergeToolSets(
    attempt.runContext?.memoryTools ?? deps.memory.createTools(attempt.characterId),
    typeof deps.coreTools === "function" ? deps.coreTools(attempt.primary, attempt.characterId) : deps.coreTools ?? {},
    attempt.primary && attempt.userEntry
      ? deps.primaryTools?.({ characterId: attempt.characterId, userEntry: attempt.userEntry, turn }) ?? {} : {},
    attempt.runContext?.selectedContext ? turn?.decisionCollector?.tools ?? {} : deps.characterTools?.(attempt.characterId) ?? {},
    ...bundles.map((bundle) => bundle.tools),
  );
  const interactive = turn && (turn.connection || (turn.runId && turn.attemptId && deps.effectLifecycle))
    ? { connection: turn.connection, signal: turn.signal, runId: turn.runId, attemptId: turn.attemptId, effects: deps.effectLifecycle, toolObserver: turn.toolObserver }
    : undefined;
  const extra = turn?.connection && deps.turnTools
    ? deps.turnTools({ ...turn, connection: turn.connection })
    : deps.extraTools ?? {};
  const capturedTools = turn?.runId && turn.attemptId && deps.effectLifecycle
    ? bindCapturedToolExecution(attempt.runContext?.tools ?? {}, { runId: turn.runId, attemptId: turn.attemptId,
      effects: deps.effectLifecycle, signal: turn.signal, toolObserver: turn.toolObserver })
    : attempt.runContext?.tools ?? {};
  const tools = mergeToolSets(
    deps.coreToolGovernance?.wrap(coreTools, interactive) ?? coreTools,
    extra,
    capturedTools,
  );
  const captured = bindCapturedSkillLoad({ tools, snapshot: attempt.runContext?.toolDisclosure, capturedTools });
  const eligible = attempt.runContext?.selectedContext ? restrictInitiativeTools(captured, attempt.runContext.selectedContext) : captured;
  // Apply before disclosure and SDK construction so neither a later Skill load nor an unsolicited model call
  // can restore an omitted tool. Original captured closures remain available to their trusted Run owner.
  return { tools: turn?.allowedToolNames === undefined ? eligible
    : Object.fromEntries(Object.entries(eligible).filter(([name]) => turn.allowedToolNames?.includes(name))), bundles };
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
function buildTurnTail(clock: PromptClock, volatileContext?: (now: number) => string, recalled = ""): string {
  const volatile = volatileContext?.(clock.now) ?? "";
  const body = [renderCurrentTime(clock.now, clock.timezone), volatile, recalled].filter((part) => part.length > 0).join("\n\n");
  return `<turn-context>\n${body}\n</turn-context>`;
}

async function recallMemory(attempt: TurnAttempt, input: Parameters<AutomaticMemoryRecall>[0]): Promise<string> {
  if (!attempt.primary) return "";
  try { return await attempt.runContext?.automaticMemoryRecall?.(input) ?? ""; }
  catch { return ""; } // A failed optional read must not prevent the foreground response.
}

// The canonical v7 multimodal user message: a FilePart per attachment (ImagePart is @deprecated in v7), `data` = RAW
// base64 (a tagged data-URL throws InvalidDataContentError — research r1). This message rides one turn and is never persisted.
function buildMultimodalUser(text: string, attachments: ImageAttachment[]): ModelMessage {
  const fileParts = attachments.map((a) => ({ type: "file" as const, mediaType: a.mediaType, data: a.dataBase64 }));
  return { role: "user", content: text.length > 0 ? [{ type: "text" as const, text }, ...fileParts] : fileParts };
}


// Instructions = the stable base prompt (identity + the "never claim a tool ran without a tool-result" floor, D1 #2),
// the day-date line (byte-stable for a calendar day), the assembled memory context, then any extra section (skills
// list + avatar vocabulary — boot/costume-stable). DAY-STABLE by construction (Q4, rb §A5): nothing minute-granular
// remains here — the time line and perception moved to the turn-context tail — so on a breakpoint-less prefix cache
// the byte-stable instructions AND the whole replayed history stay cached across same-day turns. Blank sections
// dropped; the skills list enters HERE, never through the memory assembler (module boundary, ruling 10).
function composeInstructions(
  deps: ChatAgentDeps,
  turn: { characterId: string; memoryContext: string; memoryPrompt?: string; runInstructions?: string },
  clock: PromptClock,
): string {
  return [
    turn.memoryPrompt ?? resolveMemoryPrompt(deps.memoryPrompt),
    renderDayDate(clock.now, clock.timezone),
    clock.timezone ? `User timezone: ${clock.timezone}.` : "",
    turn.memoryContext,
    deps.instructionsExtra?.(turn.characterId) ?? "",
    turn.runInstructions ?? "",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function resolveMemoryPrompt(prompt: ChatAgentDeps["memoryPrompt"]): string {
  return typeof prompt === "function" ? prompt() : prompt ?? BASE_SYSTEM_PROMPT;
}
