/**
 * INPUT:  the engine's TidyEngineView + auto-state/events repos + the UtilitySlot + MemoryConfig + a Logger
 * OUTPUT: createTidyPass(deps) -> { maybeRun, runNow }; TidyRunOutcome; TIDY_SYSTEM_PROMPT
 * POS:    core/memory — the model-led store maintenance pass (rc Part A clean-room): write-count trigger + operator
 *         invocation over ONE execute path; deterministic report in, tool edits out; a clean store costs ZERO model
 *         calls; the watermark advances only on success. Runs serially on the utility slot (T5-R11)
 */
import { ToolLoopAgent, hasToolCall, isStepCount, InvalidToolInputError, NoSuchToolError, type StepResult, type ToolSet } from "ai";
import { MemoryErrorCodeSchema, MemoryTidyToolNameSchema, type MemoryTidyDefects, type MemoryTidyFailureReason, type MemoryTidyIssue } from "@taki/shared";
import type { MemoryConfig } from "../config/memory-config.ts";
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { MemoryEventsRepo } from "../db/memory-events-repo.ts";
import type { TidyEngineView, TidyReviewOutcome } from "./memory-engine.ts";
import { buildTidyReport } from "./tidy-report.ts";
import { FINISH_TOOL_NAME } from "./tidy-tools.ts";
import type { UtilitySlot, UtilityUsage } from "./utility-slot.ts";
import { MEMORY_VOICE_RULE } from "./write-convention.ts";

/**
 * The six refinement principles, clean-room from Letta's voice-sleeptime prompt (rc A4) — the best single source of
 * adaptable wording for "rewrite memory well".
 */
const REFINEMENT_PRINCIPLES = [
  "- Integrate: merge new facts into what you already hold instead of piling up fragments.",
  "- Update: remove or correct outdated or contradictory information — never leave two conflicting versions live.",
  "- Organize: group related information logically (preferences, background, ongoing goals, interaction styles).",
  "- Infer sensibly: light, well-supported inferences are welcome, but do not invent unsupported details.",
  "- Be precise: absolute dates and times only, never relative words.",
  "- Be comprehensive and concise: aim for high recall and readability.",
].join("\n");

// Tool-granularity doctrine (rc A5 docstring discipline) — the cheapest defence against a runaway whole-block rewrite.
const GRANULARITY_RULE =
  "Use the precise row tools (memory_reinforce / memory_archive_supersede / memory_set_disclosure / memory_refile) " +
  "for narrow edits to single memories. Use block_rethink only for sweeping changes to a whole block — never for a " +
  "small fix.";

// The two standing block duties: R14 (index = recall triggers, never bulk content) + M-D4 (user-model = patterns and
// well-supported inferences; the Identity Card wins every conflict — R7; recurring feedback consolidates into a rule).
const BLOCK_DUTIES =
  "Two blocks are yours to keep current with block_rethink:\n" +
  "- memory-index: a compact per-layer index of what your memory HOLDS — recall triggers worded the way the question " +
  "would be asked ('用户问自己叫什么'), never the memories themselves. Do not index what is already always visible.\n" +
  "- user-model: your consolidated understanding of the user — patterns you have noticed and well-supported " +
  "inferences, dated absolutely. The user's own card wins every conflict, so never restate or contradict it. When " +
  "the same kind of feedback keeps recurring, consolidate it into one standing rule here.";

// Batch-2 F6: the chat prompt trims an over-budget block and its rendered used number can still sit over the limit.
const BUDGET_EXPECTATION =
  "A block's size may read over its budget — over-budget blocks are trimmed in the live prompt, not broken. Treat " +
  "the numbers as a signal to consolidate, not an emergency.";

// The do-nothing permission (rc A4, verbatim in spirit) — the R15 write gate's maintenance twin.
const FINISH_RULE =
  `If there are no meaningful updates to make, call ${FINISH_TOOL_NAME} immediately. Not every observation warrants ` +
  `an edit — be selective, but also aim for high recall. When your edits are done, call ${FINISH_TOOL_NAME}.`;

export const TIDY_SYSTEM_PROMPT = [
  "You run in the background, organizing and maintaining your own long-term memory between conversations. Your goal " +
    "is a store that is comprehensive, readable, and up to date.",
  REFINEMENT_PRINCIPLES,
  MEMORY_VOICE_RULE,
  GRANULARITY_RULE,
  BLOCK_DUTIES,
  BUDGET_EXPECTATION,
  FINISH_RULE,
].join("\n\n");

// rc A2: the input arrives as a role:user message wrapped in a system-reminder — she is NOT the primary agent, no
// user is present, and machine self-narration is already forbidden by the base prompt, so: tool calls only.
const INPUT_FRAMING =
  "You are reviewing your own memory store after the conversations already happened — you are NOT the primary " +
  "agent, and no user is present. The report below was computed mechanically from the store: its facts are facts, " +
  "but every flagged candidate is a question for your judgment, never a verdict. Produce no user-visible text — " +
  `respond only with tool calls, and end by calling ${FINISH_TOOL_NAME}.`;

export interface TidyRunOutcome {
  /** Incomplete outcomes cross WS as typed error details; the successful protocol result remains clean|ran. */
  status: "clean" | "ran" | "partial" | "failed";
  defects: MemoryTidyDefects;
  edits: number;
  steps: number;
  usage: UtilityUsage;
  reason?: MemoryTidyFailureReason;
  issues?: MemoryTidyIssue[];
  issueCount?: number;
}

export interface TidyPass {
  /** The write-count trigger (auto-memory seam): below threshold = return silently, not even the report SQL. */
  maybeRun(characterId: string): Promise<void>;
  /** The operator path (WS memory.tidy): bypasses the count check; a clean store still costs zero model calls. */
  runNow(characterId: string): Promise<TidyRunOutcome>;
}

/** Narrow logger seam (auto-memory precedent); counts/ids only — memory content never enters a log line. */
export interface TidyLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface TidyPassDeps {
  view: TidyEngineView;
  autoState: MemoryAutoRepo;
  events: MemoryEventsRepo;
  slot: UtilitySlot;
  config: MemoryConfig;
  logger: TidyLogger;
}

interface Progress {
  edits: number;
  steps: number;
  executionFailed: boolean;
  issues: MemoryTidyIssue[];
  issueCount: number;
}

export function createTidyPass(deps: TidyPassDeps): TidyPass {
  return {
    async maybeRun(characterId) {
      const { lastTidyAt } = deps.autoState.get(characterId);
      if (deps.view.countSince(characterId, lastTidyAt) < deps.config.tidyWriteThreshold) return;
      await execute(deps, characterId, lastTidyAt);
    },
    runNow(characterId) {
      const { lastTidyAt } = deps.autoState.get(characterId);
      return execute(deps, characterId, lastTidyAt);
    },
  };
}

async function execute(deps: TidyPassDeps, characterId: string, lastTidyAt: string | null): Promise<TidyRunOutcome> {
  // The watermark advances to the pass's START time: a write landing while the model runs stays > mark and is
  // picked up by the next trigger instead of being skipped forever.
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const view = deps.view.captureReview?.(characterId) ?? deps.view;
  const report = buildTidyReport(view, { characterId, lastTidyAt }, deps.config);
  if (!report.hasWork) {
    // rc §135: clean store + no new writes = ZERO model calls — return before any agent exists.
    return { status: "clean", defects: report.defects, edits: 0, steps: 0, usage: deps.slot.usage() };
  }

  const progress: Progress = { edits: 0, steps: 0, executionFailed: false, issues: [], issueCount: 0 };
  const result = await deps.slot.run("tidy", () => runAgent({ ...deps, view }, { characterId, reportText: report.text, progress }));
  const review = view.reviewOutcome?.();
  const reason = failureReason(result !== undefined, review, progress)
    ?? (review === undefined && view.reviewHealthy?.() === false ? "review-stale" : undefined);
  const edits = review?.edits ?? (result === undefined ? progress.edits : countEdits(result.toolResults));
  const steps = result?.steps.length ?? progress.steps;
  if (reason !== undefined) {
    const issues = [...(review?.issues ?? []), ...progress.issues].slice(0, 20);
    const issueCount = (review?.issueCount ?? 0) + progress.issueCount;
    safeLog(deps.logger, "warn", { characterId, reason, edits, steps, issues, issueCount });
    return { status: edits > 0 ? "partial" : "failed", defects: report.defects, edits, steps,
      usage: deps.slot.usage(), reason, issues, issueCount };
  }

  deps.autoState.setTidy(characterId, startedAt);
  deps.events.record({ kind: "tidy", characterId, count: edits });
  safeLog(deps.logger, "info", { characterId, defects: report.defects, edits, steps, durationMs: Date.now() - startedMs });
  return { status: "ran", defects: report.defects, edits, steps, usage: deps.slot.usage() };
}

function failureReason(settled: boolean, review: TidyReviewOutcome | undefined, progress: Progress): MemoryTidyFailureReason | undefined {
  if (!settled) return progress.executionFailed ? "execution-failed" : "unfinished";
  if (review && progress.issueCount > 0) return "tool-errors";
  if (review && !review.complete) return review.reason ?? "unfinished";
  return undefined;
}

async function runAgent(deps: TidyPassDeps, input: { characterId: string; reportText: string; progress: Progress }) {
  try {
    const agent = new ToolLoopAgent({
      model: deps.slot.model,
      instructions: TIDY_SYSTEM_PROMPT,
      tools: deps.view.createTools(input.characterId),
      // Completed steps remain factual even when a later model request fails.
      onStepEnd: (step) => {
        input.progress.steps += 1;
        input.progress.edits += countEdits(step.toolResults);
        recordStepIssues(step, input.progress, deps.logger);
      },
      stopWhen: [hasToolCall(FINISH_TOOL_NAME), isStepCount(deps.config.tidyMaxSteps)],
    });
    return await agent.generate({ prompt: `<system-reminder>\n${INPUT_FRAMING}\n</system-reminder>\n\n${input.reportText}` });
  } catch {
    // Keep a closed observed failure locally. Returning undefined retains the
    // Utility Slot's unknown-usage convention without exposing provider errors.
    input.progress.executionFailed = true;
    return undefined;
  }
}

function recordStepIssues(step: StepResult<ToolSet>, progress: Progress, logger: TidyLogger): void {
  for (const part of step.content) {
    if (part.type === "tool-error") {
      // SDK validation outputs contain stringified errors; the matching call
      // retains the structural invalid flag, so never classify by raw text.
      const invalid = step.toolCalls.some((call) => call.toolCallId === part.toolCallId && "invalid" in call && call.invalid === true);
      const code = invalid || InvalidToolInputError.isInstance(part.error) || NoSuchToolError.isInstance(part.error)
        ? "MEMORY_INVALID_REQUEST" : "MEMORY_INTERNAL_ERROR";
      const issue = safeIssue(part.toolName, code);
      progress.issueCount += 1;
      if (progress.issues.length < 20) progress.issues.push(issue);
      safeToolLog(logger, issue);
    } else if (part.type === "tool-result" && typeof part.output === "object" && part.output !== null
      && "ok" in part.output && part.output.ok === false) {
      safeToolLog(logger, safeIssue(part.toolName, "code" in part.output ? part.output.code : undefined));
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
  catch { /* Optional diagnostics cannot change an already committed mutation or induce another model call. */ }
}

function safeLog(logger: TidyLogger, level: "info" | "warn", details: object): void {
  try { logger[level](details, level === "info" ? "tidy pass completed" : "tidy pass failed; watermark not advanced"); }
  catch { /* Pass settlement and committed effects do not depend on the log destination. */ }
}

// Successful MUTATING tool results only: finish is a no-op terminal, and a refused/failed op is not an edit.
function countEdits(toolResults: Array<{ toolName: string; output: unknown }>): number {
  return toolResults.filter((entry) => entry.toolName !== FINISH_TOOL_NAME && isOkResult(entry.output)).length;
}

function isOkResult(output: unknown): boolean {
  return typeof output === "object" && output !== null && "ok" in output && output.ok === true;
}
