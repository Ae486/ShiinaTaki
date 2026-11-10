/**
 * INPUT:  one visible review batch, the shared model, its independent budgets and shutdown signal
 * OUTPUT: actual steps/effects and explicit accepted completion or a closed failure
 * POS:    core/memory — SDK execution; coverage and attempt persistence belong to their owners
 */
import { ToolLoopAgent, hasToolCall, isStepCount, InvalidToolInputError, NoSuchToolError,
  type LanguageModel, type StepResult, type ToolSet } from "ai";
import { MemoryErrorCodeSchema, MemoryTidyToolNameSchema, type MemoryTidyFailureReason, type MemoryTidyIssue } from "@taki/shared";
import type { TidyEngineView } from "./memory-engine.ts";
import type { TidyLogger } from "./tidy-pass.ts";
import { TIDY_INPUT_FRAMING, TIDY_SYSTEM_PROMPT } from "./tidy-prompt.ts";
import { FINISH_TOOL_NAME } from "./tidy-tools.ts";

export interface TidyBatchRun {
  edits: number; steps: number; issues: MemoryTidyIssue[]; issueCount: number;
  reason?: MemoryTidyFailureReason; recoveredIssues: number; skippedIssues: number;
  usage?: { inputTokens: number | undefined; outputTokens: number | undefined };
}

export async function runTidyAgent(input: {
  view: TidyEngineView; characterId: string; report: string; model: LanguageModel; logger: TidyLogger;
  maxSteps: number; totalMs: number; onStep: (steps: number, edits: number) => void;
  tools?: ToolSet; signal?: AbortSignal;
}): Promise<TidyBatchRun> {
  const progress: TidyBatchRun = { edits: 0, steps: 0, issues: [], issueCount: 0, recoveredIssues: 0, skippedIssues: 0 };
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(input.totalMs)));
  try {
    const finishCalled = hasToolCall(FINISH_TOOL_NAME);
    const agent = new ToolLoopAgent({
      model: input.model, instructions: TIDY_SYSTEM_PROMPT, tools: input.tools ?? input.view.createTools(input.characterId),
      toolCallConcurrency: 1, maxRetries: 0,
      prepareStep: () => ({ instructions: [TIDY_SYSTEM_PROMPT, input.view.reviewReminder?.()].filter(Boolean).join("\n\n") }),
      onStepEnd: (step) => {
        progress.steps += 1;
        progress.edits += countEdits(step.toolResults);
        recordStepIssues(step, { progress, view: input.view, logger: input.logger });
        progress.edits = input.view.reviewOutcome?.().edits ?? progress.edits;
        input.onStep(progress.steps, progress.edits);
      },
      stopWhen: [(options) => input.view.reviewOutcome
        ? input.view.reviewOutcome().complete || input.view.reviewBlocked?.() === true : finishCalled(options), isStepCount(input.maxSteps)],
    });
    const result = await agent.generate({ prompt: `<system-reminder>\n${TIDY_INPUT_FRAMING}\n</system-reminder>\n\n${input.report}`,
      abortSignal: input.signal ? AbortSignal.any([timeout, input.signal]) : timeout, timeout: { totalMs: input.totalMs } });
    progress.usage = { inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens };
  } catch (error) {
    progress.reason = input.signal?.aborted ? "unfinished"
      : timeout.aborted || error instanceof Error && error.name === "TimeoutError" ? "timeout" : "execution-failed";
  }
  const review = input.view.reviewOutcome?.();
  if (review) {
    progress.edits = review.edits;
    progress.issues = review.issues;
    progress.issueCount = review.issueCount;
    progress.recoveredIssues = review.recoveredIssues ?? 0;
    progress.skippedIssues = review.skippedIssues ?? 0;
    if (!review.complete && review.reason !== "unfinished" && progress.reason !== "timeout") progress.reason = review.reason;
    else if (!review.complete && progress.reason === undefined) progress.reason = "unfinished";
  } else if (input.view.reviewHealthy?.() === false) progress.reason ??= "review-stale";
  return progress;
}

function recordStepIssues(step: StepResult<ToolSet>, input: { progress: TidyBatchRun; view: TidyEngineView; logger: TidyLogger }): void {
  for (const part of step.content) {
    if (part.type === "tool-error") {
      const invalid = step.toolCalls.some((call) => call.toolCallId === part.toolCallId && "invalid" in call && call.invalid === true);
      const code = invalid || InvalidToolInputError.isInstance(part.error) || NoSuchToolError.isInstance(part.error)
        ? "MEMORY_INVALID_REQUEST" : "MEMORY_INTERNAL_ERROR";
      const issue = safeIssue(part.toolName, code);
      input.view.recordIssue?.({ ...issue, callId: part.toolCallId,
        stage: code === "MEMORY_INVALID_REQUEST" ? "input" : "write", field: "unknown" });
      if (!input.view.recordIssue) {
        input.progress.issueCount += 1;
        if (input.progress.issues.length < 20) input.progress.issues.push(issue);
      }
      safeToolLog(input.logger, issue);
    } else if (part.type === "tool-result" && typeof part.output === "object" && part.output !== null
      && "ok" in part.output && part.output.ok === false) {
      safeToolLog(input.logger, safeIssue(part.toolName, "code" in part.output ? part.output.code : undefined));
    }
  }
}

function safeIssue(toolName: string, code: unknown): MemoryTidyIssue {
  const tool = MemoryTidyToolNameSchema.safeParse(toolName);
  const error = MemoryErrorCodeSchema.safeParse(code);
  return { toolName: tool.success ? tool.data : "unknown", code: error.success ? error.data : "MEMORY_INTERNAL_ERROR" };
}

function safeToolLog(logger: TidyLogger, issue: MemoryTidyIssue): void {
  try { logger.warn(issue, "tidy tool was not applied"); }
  catch { /* Optional diagnostics cannot change committed effects or cause another provider request. */ }
}

function countEdits(results: Array<{ toolName: string; output: unknown }>): number {
  return results.filter(({ toolName, output }) => toolName !== FINISH_TOOL_NAME && typeof output === "object" && output !== null
    && "ok" in output && output.ok === true && !("applied" in output && output.applied === false)).length;
}
