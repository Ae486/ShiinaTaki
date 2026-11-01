/**
 * INPUT: exact linked work, private repositories, currentness and optional governed task summarization
 * OUTPUT: bounded private context, actual-intent receipts and complete durable action checkpoints
 * POS: core/agents — shared WorkContext; never writes relationship Timeline or Memory
 */
import type { ModelMessage, ToolSet, StopCondition } from "ai";
import type { PrivateMessage, SubagentInput, SubagentToolSelection, SubagentWorkScope, SubagentWorkToken } from "@taki/shared";
import type { SubagentRepo } from "../db/subagent-repo.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { RunMessageRepo } from "../db/run-message-repo.ts";
import type { SubagentContextSummaryRepo } from "../db/subagent-context-summary-repo.ts";
import type { SubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";
import type { ReplayProjection } from "./conversation-store.ts";
import type { PreparedWorkStep, WorkContext, WorkStepInput, WorkSegmentCheckpoint } from "./work-context.ts";
import { toEntryInput, toModelMessage } from "./turn-mapping.ts";
import { estimateMessagesTokens } from "../memory/token-estimator.ts";
import { resolveDelegationTools } from "../harness/delegation-tools.ts";
import type { ToolMaterialSink } from "../harness/subagent-tool-materials.ts";
import { renderContextMaterial } from "./source-context.ts";
import { preparePrivateTaskContext, type PrivateTaskContextInput } from "./private-task-context.ts";
import type { PrivateTaskSummarizer } from "./private-task-summarizer.ts";
import { createSubagentSelfHistoryTool } from "./subagent-self-history-tool.ts";
import type { CompletedWorkStep } from "./work-context.ts";
import type { EffectLifecycle } from "@taki/shared";

export interface RunMessageStoreInput {
  runId: string; scope: SubagentWorkScope; instructions: string; tools: ToolSet; stop?: StopCondition<ToolSet>;
  parentNames?: readonly string[]; selection?: SubagentToolSelection; historyBudget(): number;
  fixedExcludedNames?: readonly string[];
  children: SubagentRepo; inputs: SubagentInputRepo; executions: SubagentExecutionRepo; messages: RunMessageRepo;
  summaries?: SubagentContextSummaryRepo; summarize?: PrivateTaskSummarizer;
  toolResults?: SubagentToolResultRepo;
  materialSink: ToolMaterialSink;
  parentReplay?: () => ReplayProjection;
  transaction?(action: () => void): void;
  assertSafeFrontier?(): void;
  checkCurrent(token: SubagentWorkToken | undefined, phase: "model_intent" | "result"): void;
  onCompletedStep?(input: CompletedWorkStep): void;
  onModelIntent?(input: { step: PreparedWorkStep; effect: EffectLifecycle }): void;
  changed(): void;
}

export function createRunMessageStore(input: RunMessageStoreInput): WorkContext {
  const child = input.scope.kind === "subagent" ? input.children.get(input.scope.subagentId) : undefined;
  const intrinsic = child ? createSubagentSelfHistoryTool({ ...input, characterId: child.characterId, subagentId: child.subagentId }) : {};
  const initial = child?.initialContext.kind === "snapshot" ? [
    ...child.initialContext.messages.map(toModelMessage).filter((message): message is ModelMessage => message !== null),
    ...child.initialContext.materials.map((material) => ({ role: "user" as const, content: renderContextMaterial(material) })),
  ] : [];
  const state: { attempt?: string; prepared?: PreparedWorkStep } = {};
  const context = child && input.scope.kind === "subagent" ? { ...input, initial, subagentId: child.subagentId,
    workInputId: input.scope.workInputId, token: () => input.executions.token(input.runId), renderInput: renderSubagentInput,
    assertCurrent: (token: SubagentWorkToken) => input.checkCurrent(token, "model_intent") } satisfies PrivateTaskContextInput : undefined;
  const prepare = (step: WorkStepInput) => prepareWorkStep({ state, context, materialSink: input.materialSink }, step);
  return {
    scope: input.scope, instructions: input.instructions, tools: { ...input.tools, ...intrinsic }, stop: input.stop,
    inputBudget: input.historyBudget,
    selectTools: (tools) => ({ ...resolveDelegationTools({ tools, parentNames: input.parentNames ?? [...Object.keys(tools), ...input.fixedExcludedNames ?? []],
      scope: input.scope, selection: input.selection, fixedExcludedNames: input.fixedExcludedNames }), ...intrinsic }),
    project(attemptId) {
      state.attempt = attemptId; state.prepared = undefined;
      if (!context) {
        if (!input.parentReplay) throw new Error("SUBAGENT_PARENT_CONTEXT_REQUIRED");
        return input.parentReplay();
      }
      return initialProjection(initial);
    },
    prepareStep: prepare,
    commitModelInput(step, effect) {
      input.checkCurrent(step.token, "model_intent");
      input.assertSafeFrontier?.();
      if (effect.runId !== input.runId || effect.attemptId !== step.attemptId) throw new Error("SUBAGENT_MODEL_INTENT_MISMATCH");
      if (step.token) {
        input.messages.recordModelInputs({ effect, token: step.token, stepNumber: step.stepNumber, inputIds: step.inputIds });
        if (step.summary) input.summaries?.recordIntent({ effect, token: step.token, stepNumber: step.stepNumber, summary: step.summary });
      }
      input.onModelIntent?.({ step, effect });
    },
    recordCompletedStep: (step) => recordCompleted(input, step),
    checkpointSegment: (checkpoint) => checkpointWorkSegment(input, { context, prepare }, checkpoint),
    recordPartial(partial) {
      if (!partial.text) return;
      input.messages.stageTerminal({ runId: input.runId, attemptId: partial.attemptId,
        batch: { stepNumber: partial.stepNumber, entryKind: "partial", messages: [{ role: "assistant", content: partial.text }] } });
    },
  };
}

async function checkpointWorkSegment(input: RunMessageStoreInput, state: {
  context?: PrivateTaskContextInput; prepare(step: WorkStepInput): Promise<PreparedWorkStep>;
}, checkpoint: Parameters<NonNullable<WorkContext["checkpointSegment"]>>[0]): Promise<WorkSegmentCheckpoint> {
  if (!state.context || checkpoint.retainedBytes < Math.max(16_384, input.historyBudget() * 16)) return { kind: "continue" };
  if (!checkpoint.safeToRollover) throw new Error("SUBAGENT_CONTEXT_UNSAFE_FRONTIER");
  input.assertSafeFrontier?.();
  const next = await state.prepare({ attemptId: checkpoint.attemptId, stepNumber: checkpoint.stepNumber + 1,
    messages: [], envelope: checkpoint.envelope });
  return { kind: "context_rollover", messages: next.messages, summary: next.summary };
}

async function prepareWorkStep(input: {
  state: { attempt?: string; prepared?: PreparedWorkStep }; context?: PrivateTaskContextInput; materialSink: ToolMaterialSink;
}, step: WorkStepInput): Promise<PreparedWorkStep> {
  const { state, context } = input;
  if (state.attempt !== step.attemptId) throw new Error("SUBAGENT_ATTEMPT_CONTEXT_MISMATCH");
  if (state.prepared?.stepNumber === step.stepNumber && !step.envelope) return state.prepared;
  state.prepared = context ? await preparePrivateTaskContext(context, step)
    : { ...step, inputIds: [], messages: input.materialSink.render(step.attemptId, step.messages) };
  return state.prepared;
}

function recordCompleted(input: RunMessageStoreInput, step: CompletedWorkStep): void {
  const messages = input.materialSink.attach(step.attemptId, step.messages.map(toEntryInput).filter((entry) => entry !== null), step.stepNumber);
  const commit = () => {
    if (messages.length) input.messages.recordStep({ runId: input.runId, attemptId: step.attemptId,
      batch: { stepNumber: step.stepNumber, entryKind: "output", messages } });
    input.onCompletedStep?.(step);
  };
  if (input.transaction) input.transaction(commit); else commit();
  input.changed();
}

function initialProjection(messages: ModelMessage[]): ReplayProjection {
  return { messages, windowStartSeq: 1, measurement: { sourceRows: 0, liveRows: 0, selectedRows: 0,
    summaryTokens: 0, liveTokensBeforeFolds: 0, foldedTokensSaved: 0, historyTokens: estimateMessagesTokens(messages),
    tokenBoundaryHit: false, sourceBackstopHit: false } };
}

export function renderSubagentInput(input: SubagentInput): ModelMessage {
  return { role: "user", content: renderInputEntry(input).content };
}

function renderInputEntry(input: SubagentInput): PrivateMessage {
  const sender = input.sender.kind === "user" ? "the user addressing this child" : input.sender.kind === "parent" ? "the delegating Companion" : "the trusted work owner";
  const material = input.materials.map(renderContextMaterial).join("\n\n");
  return { role: "user", content: [`Core addressed work input from ${sender}. This is private work context, not a new main-conversation utterance.`,
    input.direction || "Continue this exact work under its original purpose.", material].filter(Boolean).join("\n\n") };
}
