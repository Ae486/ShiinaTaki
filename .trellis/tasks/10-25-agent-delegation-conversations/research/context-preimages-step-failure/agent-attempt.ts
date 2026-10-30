/**
 * INPUT: captured turn context, SDK tools, private work/inbox ports and model Effect authority
 * OUTPUT: streamed text with complete durable step capture and actual-intent input witnesses
 * POS: core/agents — shared SDK request boundary; outer ChatAgent owns retry, final commit and lifetime
 */
import { ToolLoopAgent, isStepCount, isLoopFinished, type ModelMessage, type Telemetry } from "ai";
import type { ImageAttachment } from "@taki/shared";
import { fireDetachedTurnWrites, type ChatAgentDeps, type TurnAttempt, type TurnContext } from "./chat-agent.ts";
import { initiativeInstructions, initiativeReplay } from "./initiative-context.ts";
import { COSTUME_CHANGE_NOTICE } from "../avatar/costume-notice.ts";
import { renderCurrentTime, renderDayDate } from "../time/time-context.ts";
import { BASE_SYSTEM_PROMPT } from "./base-prompt.ts";
import { assembleTurnTools } from "./agent-tool-assembly.ts";
import { fireUsageReport } from "./turn-usage-report.ts";
import { measurePostTurnRequest, prepareOutgoingRequest } from "./request-preparation.ts";
import { createRunObservabilityModel } from "./run-observability-telemetry.ts";
import type { AutomaticMemoryRecall } from "../memory/automatic-memory-recall.ts";
import { createToolDisclosure } from "./tool-disclosure.ts";
import type { PreparedWorkStep, WorkContextEnvelope, WorkSegmentCheckpoint } from "./work-context.ts";
import { completedWorkerFrontier, retainedWorkerBytes, workerEnvelope } from "./worker-sdk-segment.ts";
import { retainStepToolSources } from "./source-context.ts";
import { createForegroundInboxProjection } from "./foreground-inbox.ts";

type PromptClock = { now: number; timezone?: string };
const DEFAULT_MAX_STEPS = 10;

// Each attempt rebuilds the calibrated Replay View and captures actual SDK material. The outer turn alone decides
// retry/retraction and commits the captured batch before detached maintenance sees the updated relationship history.
// eslint-disable-next-line max-lines-per-function
export async function* runAttempt(deps: ChatAgentDeps, attempt: TurnAttempt, turn?: TurnContext): AsyncIterable<string> {
  const { store, approval } = deps;
  const { characterId, message, attachments, images, vision, primary, state } = attempt;
  state.activity = turn?.activity?.beginAttempt(turn.attemptId);
  if (primary && turn?.runId && turn.attemptId) {
    state.inbox = deps.foregroundInbox?.({ characterId, runId: turn.runId, attemptId: turn.attemptId,
      actualInvocation: () => turn.toolObserver?.currentInvocation?.() });
  }
  const inboxProjection = createForegroundInboxProjection(state.inbox?.tools ?? {});
  let stepNumber = 0;
  const selected = attempt.runContext?.selectedContext;
  const work = turn?.workContext;
  if (work && (!turn?.runId || !turn.attemptId || selected)) throw new Error("SUBAGENT_EXECUTION_CONTEXT_REQUIRED");
  const child = work?.scope.kind === "subagent";
  let preparedWork: PreparedWorkStep | undefined;
  let envelope: WorkContextEnvelope | undefined;
  let segmentOffset = 0;
  let segmentSteps = 0;
  let retainedBytes = 0;
  const segment: { rollover: WorkSegmentCheckpoint } = { rollover: { kind: "continue" } };
  // An admitted opportunity may acquire governed evidence before reasoning. Append that ephemeral result
  // without replacing the original selected instructions, source manifest or immutable context binding.
  const controlMessage = selected ? [selected.controlInput, turn?.controlInput].filter(Boolean).join("\n\n")
    : turn?.controlInput ?? message;
  const replay = work ? work.project(turn!.attemptId!) : selected ? initiativeReplay() : store.project(characterId); const history = replay.messages;
  // Capture the clock and user zone together: awaited recall must not split the day/time lines across settings.
  const now = Date.now();
  const clock = { now, timezone: selected ? undefined : deps.userTimezone?.() };
  const memoryContext = selected || child ? "" : attempt.runContext?.assembleMemory?.(controlMessage) ?? deps.memory.assemble({ characterId, currentMessage: controlMessage });
  const baseInstructions = child ? [work.instructions, attempt.runContext?.instructions, renderDayDate(clock.now, clock.timezone)].filter(Boolean).join("\n\n")
    : selected ? initiativeInstructions(selected) : composeInstructions(deps, { characterId, memoryContext, memoryPrompt: attempt.runContext?.memoryPrompt,
    runInstructions: [attempt.runContext?.instructions, work?.instructions].filter(Boolean).join("\n\n") }, clock);
  let instructions = [baseInstructions, state.inbox?.instructions].filter(Boolean).join("\n\n");
  const selectedModel = vision ? vision.model : deps.model;
  const { model, observability } = createRunObservabilityModel({
    model: selectedModel, lifecycle: deps.effectLifecycle, runId: turn?.runId, attemptId: turn?.attemptId,
    onCommitModelIntent: (effect) => {
      turn?.onCommitModelIntent?.(effect);
      state.inbox?.commitModelIntent(effect, stepNumber);
      if (work) {
        if (!preparedWork) throw new Error("SUBAGENT_MODEL_INPUT_UNPREPARED");
        work.commitModelInput(preparedWork, effect);
      }
    },
    toolDisplayNames: attempt.toolDisplayNames,
    activity: inboxProjection.activity(state.activity?.observer),
  });
  if (turn && observability) turn.toolObserver = observability.tools;
  const { tools, bundles } = assembleTurnTools(deps, { ...attempt, inbox: state.inbox }, turn);
  if (turn) turn.executableTools = tools;
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
    prepareStep: async ({ steps, messages, stepNumber: currentStep }) => {
      stepNumber = segmentOffset + currentStep;
      state.inbox?.prepareStep?.();
      if (state.inbox) {
        instructions = [baseInstructions, state.inbox.instructions].filter(Boolean).join("\n\n");
        state.instructions = instructions;
      }
      const activeTools = disclosure.activeTools(steps).filter((toolName) =>
        !inboxProjection.isPrivate({ toolName }) || Boolean(state.inbox?.instructions));
      if (child) envelope = await workerEnvelope({ deps, work, instructions, tools, activeTools, signal: turn?.signal });
      if (work) preparedWork = await work.prepareStep({ messages, stepNumber, attemptId: turn!.attemptId!, envelope });
      const selectedMessages = preparedWork?.messages ?? (turn?.attemptId ? turn.materials?.render(turn.attemptId, messages) : undefined);
      if (selectedMessages) state.outgoing = selectedMessages;
      return { activeTools, ...(state.inbox ? { instructions } : {}), ...(selectedMessages ? { messages: selectedMessages } : {}) };
    },
    telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false,
      integrations: observability ? [observability.telemetry, requestTelemetry] : [requestTelemetry] },
    stopWhen: child ? [isLoopFinished(), async (options) => {
      if (await work.stop?.(options)) return true;
      const last = options.steps.at(-1);
      if (!last || !work.checkpointSegment || turn?.signal?.aborted) return false;
      segment.rollover = await work.checkpointSegment({ attemptId: turn!.attemptId!, stepNumber,
        retainedBytes, safeToRollover: completedWorkerFrontier(last), envelope });
      return segment.rollover.kind === "context_rollover";
    }] : [isStepCount(deps.maxSteps ?? DEFAULT_MAX_STEPS), ...(work?.stop ? [work.stop] : turn?.decisionCollector ? [turn.decisionCollector.stop] : deps.stopConditions ?? [])],
    // Compatibility seam for focused tests and pre-Slice-3 callers. Production Batch 1 leaves this absent because
    // MCP execution is already guarded by its canonical adapter and `ask` fails closed before the raw closure.
    toolApproval: approval ? ({ toolCall }) => approval.decide(toolCall, turn?.notify) : undefined,
    // Capture each completed step before a later request can fail and reject the aggregate response promise.
    // The same completed-step fact preserves the existing prohibition on retrying completed tool effects.
    onStepEnd: (event) => {
      // SDK 7.0.148 also emits onStepEnd for an error-only provider response before the public error part.
      // That failed request must retain the one clean overflow retry; completed tools still fence replay.
      state.stepEnded ||= event.finishReason !== "error" || event.content.length > 0;
      const globalStep = segmentOffset + event.stepNumber;
      segmentSteps = event.stepNumber + 1;
      if (child) retainedBytes += retainedWorkerBytes({ messages: event.response.messages, results: event.toolResults,
        prepared: preparedWork?.messages ?? [] });
      const recorded = retainStepToolSources(event.response.messages, event.toolResults);
      const partition = inboxProjection.split(recorded);
      state.recording.capture(globalStep, partition.publicMessages,
        state.inbox?.hasIntent() ? state.inbox.sourceContext : undefined);
      if (partition.privateMessages.length && turn?.attemptId) state.inbox?.recordCompletedStep({
        attemptId: turn.attemptId, stepNumber: globalStep, messages: partition.privateMessages,
      });
      if (turn?.runId && turn.attemptId) turn.materials?.capture({ runId: turn.runId, attemptId: turn.attemptId,
        stepNumber: globalStep, results: event.toolResults });
      if (work) work.recordCompletedStep({ attemptId: turn!.attemptId!, stepNumber: globalStep, messages: recorded });
      // A loader may be the final step of this SDK call. Preserve only its successful activation names.
      if (child) disclosure.activeTools([event]);
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
  if (child) envelope = await workerEnvelope({ deps, work, instructions, tools,
    activeTools: disclosure.activeTools([]), signal: turn?.signal });
  if (work) preparedWork = await work.prepareStep({ messages: history, attemptId: turn!.attemptId!, stepNumber: 0, envelope });
  const initialOutgoing = preparedWork?.messages ?? buildOutgoing({ history, isImageTurn: vision !== null, message: controlMessage, attachments, changed: primary ? (deps.costumeChanged?.(characterId) ?? false) : false, tail: selected ? "" : buildTurnTail(clock, deps.volatileContext, recalled), primary });
  // Provider maintenance may still be pending when an autonomous Run starts. Its ephemeral control envelope must
  // not replace the last primary pressure snapshot used to decide whether the relationship Timeline needs compaction.
  const preparationDeps = primary ? deps : { ...deps, onRequestMeasured: undefined, ...(child ? { requestReduction: undefined } : {}) };
  const prepared = await prepareOutgoingRequest(preparationDeps, { characterId, instructions, outgoing: initialOutgoing, replay: replay.measurement, tools: visibleTools, toolOrder });
  let outgoing = prepared.messages;
  // Exposed for the R2 estimate fallback — read only on the retry path, never on the hot path.
  state.instructions = instructions;
  state.outgoing = outgoing;
  // abortSignal is per-call by SDK design. The outer capture/commit finally covers graceful abort and thrown reasons.
  for (;;) {
    turn?.signal?.throwIfAborted();
    const result = await agent.stream({ messages: outgoing, abortSignal: turn?.signal });
    // Drain one SDK call before releasing any alias/material referenced by its buffered stream.
    for await (const part of result.stream) {
      state.recording.observe(part);
      observability?.observeStreamPart(part);
      if (observability && !("toolName" in part && inboxProjection.isPrivate(part))) {
        state.activity?.observe(part, observability.invocations);
      }
      if (part.type === "text-delta") yield part.text;
      else if (part.type === "error") throw part.error;
    }
    observability?.assertHealthy();
    if (segment.rollover.kind === "context_rollover") {
      turn?.signal?.throwIfAborted();
      outgoing = segment.rollover.messages;
      state.outgoing = outgoing;
      state.recording.releaseThrough(segmentOffset + segmentSteps - 1);
      state.activity?.releaseThrough?.(segmentOffset + segmentSteps - 1);
      turn?.materials?.release?.({ attemptId: turn.attemptId!, throughStep: segmentOffset + segmentSteps - 1 });
      observability?.releaseCompleted();
      segmentOffset += segmentSteps;
      segmentSteps = 0; retainedBytes = 0; segment.rollover = { kind: "continue" };
      continue;
    }
    if (!primary && turn?.onSettledText && !turn.signal?.aborted) turn.onSettledText(await result.text);
    if (primary) state.afterCommit = () => {
      measurePostTurnRequest(deps, { characterId, instructions, tools: visibleTools, toolOrder, toolSchemaTokens: prepared.toolSchemaTokens, store });
      fireDetachedTurnWrites(deps, { characterId, imageRefs: images.map((img) => img.ref), message });
      fireUsageReport(deps, { characterId, usage: result.usage, instructions, outgoing, tools: visibleTools, toolOrder, preparedTools, replay: replay.measurement });
    };
    return;
  }
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
