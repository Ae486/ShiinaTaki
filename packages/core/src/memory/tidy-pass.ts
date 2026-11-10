/**
 * INPUT:  scoped memory views, review checkpoints, the Utility Slot and operation progress sink
 * OUTPUT: finite backlog draining with fresh queued batches, independent limits and truthful recovery
 * POS:    core/memory — maintenance producer; durable operation ownership remains separate
 */
import type { MemoryTidyOutcome, MemoryTidyProgress, MemoryTidyFailureReason } from "@taki/shared";
import type { MemoryConfig } from "../config/memory-config.ts";
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { MemoryEventsRepo } from "../db/memory-events-repo.ts";
import type { MemoryTidyReviewRepo } from "../db/memory-tidy-review-repo.ts";
import type { TidyEngineView } from "./memory-engine.ts";
import { buildTidyReport, type TidyReport } from "./tidy-report.ts";
import { runTidyAgent, type TidyBatchRun } from "./tidy-agent-runner.ts";
import { automaticTidyAllowed, canonicalTidyReport, checkpointTidyBatch, tidyMemoryKey } from "./tidy-coverage.ts";
import type { UtilitySlot } from "./utility-slot.ts";
import { estimateToolSchemaTokens } from "../agents/request-measurement.ts";
import { estimateTokens } from "./token-estimator.ts";
import { TIDY_INPUT_FRAMING, TIDY_SYSTEM_PROMPT } from "./tidy-prompt.ts";

export { TIDY_SYSTEM_PROMPT } from "./tidy-prompt.ts";
export type TidyRunOutcome = MemoryTidyOutcome;
export interface TidyRunOptions { onProgress?: (progress: MemoryTidyProgress) => void; }
export interface TidyPass {
  maybeRun(characterId: string): Promise<void>;
  runNow(characterId: string, options?: TidyRunOptions): Promise<TidyRunOutcome>;
}
export interface TidyLogger { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; }
export interface TidyPassDeps {
  view: TidyEngineView; autoState: MemoryAutoRepo; events: MemoryEventsRepo;
  slot: UtilitySlot; config: MemoryConfig; logger: TidyLogger;
  checkpoints?: MemoryTidyReviewRepo;
  requestRun?: (characterId: string) => Promise<void>;
  /** Override the per-batch deadline for transport tests. Production uses the configured batch timeout. */
  timeoutMs?: number;
}
interface Execution {
  progress: MemoryTidyProgress; recovered: number; skipped: number; report: TidyReport; outcome?: TidyBatchRun;
  startedAt: string; pending?: Set<string>;
  captured: boolean;
  admissionFailed?: boolean;
}
interface Work { characterId: string; options: TidyRunOptions; state: Execution; signal: AbortSignal; }

export function createTidyPass(deps: TidyPassDeps): TidyPass & { stop(): Promise<void> } {
  const inflight = new Map<string, Promise<TidyRunOutcome>>();
  const shutdown = new AbortController();
  const runNow: TidyPass["runNow"] = (characterId, options = {}) => {
    if (shutdown.signal.aborted) return Promise.reject(new Error("MEMORY_PROVIDER_UNAVAILABLE"));
    const old = inflight.get(characterId);
    if (old) return old;
    const task = execute(deps, { characterId, options, signal: shutdown.signal });
    inflight.set(characterId, task);
    void task.finally(() => { if (inflight.get(characterId) === task) inflight.delete(characterId); }).catch(() => undefined);
    return task;
  };
  return { runNow, async stop() {
    shutdown.abort();
    await Promise.allSettled([...inflight.values()]);
  }, async maybeRun(characterId) {
    if (shutdown.signal.aborted) return;
    if (!shouldRun(deps, characterId)) return;
    if (deps.requestRun) await deps.requestRun(characterId);
    else await runNow(characterId);
  } };
}

function shouldRun(deps: TidyPassDeps, characterId: string): boolean {
  if (!deps.checkpoints) return deps.view.countSince(characterId, deps.autoState.get(characterId).lastTidyAt) >= deps.config.tidyWriteThreshold;
  const coverage = deps.checkpoints.read(characterId);
  const report = reportFor(deps, deps.view, { characterId });
  return report.hasWork && automaticTidyAllowed({ coverage, candidates: report.remaining ?? 0, threshold: deps.config.tidyWriteThreshold });
}

function reportFor(deps: TidyPassDeps, view: TidyEngineView, input: {
  characterId: string; candidateKeys?: Set<string>; reportTokenBudget?: number;
}): TidyReport {
  const { characterId } = input;
  const lastTidyAt = deps.autoState.get(characterId).lastTidyAt;
  return deps.checkpoints
    ? canonicalTidyReport({ view, ...input, lastTidyAt, config: deps.config, coverage: deps.checkpoints.read(characterId) })
    : buildTidyReport(view, { characterId, lastTidyAt }, deps.config);
}

async function execute(deps: TidyPassDeps, input: Omit<Work, "state">): Promise<TidyRunOutcome> {
  const { characterId, options, signal } = input;
  // This cheap clean check admits no snapshot: non-clean work is recaptured when its queued task starts.
  let preview: TidyReport;
  try { preview = reportFor(deps, deps.view, { characterId }); }
  catch (error) {
    // Legacy has no later captured read: retain its explicit retirement/error contract before admission.
    if (!deps.view.captureReview) throw error;
    preview = { defects: { missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 0 },
      hasWork: true, newWrites: 0, text: "" };
  }
  if (!preview.hasWork) {
    deps.checkpoints?.succeeded(characterId);
    return { status: "clean", defects: preview.defects, edits: 0, steps: 0, usage: deps.slot.usage(), remaining: 0, reviewed: 0, nextAction: "none" };
  }
  const state: Execution = { progress: { edits: 0, steps: 0, reviewed: 0, remaining: null }, recovered: 0, skipped: 0, report: preview,
    startedAt: "", captured: false };
  const work: Work = { characterId, options, state, signal };
  do {
    state.outcome = undefined;
    const settled = await deps.slot.run("tidy", async () => {
      if (signal.aborted) return undefined;
      try { await runQueued(deps, work); }
      catch (error) {
        if (!state.captured) { state.admissionFailed = true; throw error; }
        state.outcome = emptyFailure("execution-failed");
      }
      // Slot accounting owns each dispatched batch, never the cumulative operation totals.
      return { usage: state.outcome ? state.outcome.usage : { inputTokens: 0, outputTokens: 0 } };
    });
    if (state.admissionFailed) throw new Error("MEMORY_PROVIDER_UNAVAILABLE");
    if (!settled) state.outcome = emptyFailure("unfinished");
    if (state.outcome?.reason || !deps.checkpoints) break;
  } while (state.pending && state.pending.size > 0);
  return settle(deps, work);
}

async function runQueued(deps: TidyPassDeps, work: Work): Promise<void> {
  const { state, characterId, options } = work;
  const deadline = Date.now() + (deps.timeoutMs ?? deps.config.tidyBatchTimeoutMs);
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  const baseEdits = state.progress.edits;
  const baseSteps = state.progress.steps;
  const view = deps.view.captureReview?.(characterId, { modelReferences: true,
    onEdits: (edits) => options.onProgress?.({ ...state.progress, edits: baseEdits + edits }) }) ?? deps.view;
  const initial = reportFor(deps, view, { characterId });
  const continuing = state.pending !== undefined;
  if (deps.checkpoints) {
    const eligible = new Set(initial.candidateIds?.map(tidyMemoryKey));
    state.pending = state.pending === undefined ? eligible : new Set([...state.pending].filter((key) => eligible.has(key)));
  }
  state.captured = true;
  state.progress.remaining = initial.remaining ?? null;
  options.onProgress?.({ ...state.progress });
  // Departed or externally reviewed identities cannot keep this operation alive through new Block changes.
  if (continuing && state.pending?.size === 0) return;
  const tools = view.createTools(characterId);
  const overhead = estimateTokens(TIDY_SYSTEM_PROMPT + `\n<system-reminder>\n${TIDY_INPUT_FRAMING}\n</system-reminder>\n\n`)
    + await estimateToolSchemaTokens(tools, Object.keys(tools)) + 16;
  const report = reportFor(deps, view, { characterId, candidateKeys: state.pending,
    reportTokenBudget: deps.config.tidyInputTokens - overhead });
  if (state.progress.steps === 0) state.report = report;
  if (!report.hasWork) { state.pending?.clear(); return; }
  if (report.inputTooLarge) { state.outcome = emptyFailure("input-too-large"); return; }
  deps.checkpoints?.begin(characterId);
  view.setVisibleReferences?.(report.reviewedIds ?? view.listActive(characterId).map((row) => row.id));
  const batch = await runTidyAgent({ view, characterId, report: report.text, model: deps.slot.model, logger: deps.logger,
    tools, signal: work.signal, maxSteps: deps.config.tidyMaxSteps, totalMs: Math.max(1, deadline - Date.now()),
    onStep: (steps, edits) => {
      state.progress = { ...state.progress, steps: baseSteps + steps, edits: baseEdits + edits };
      options.onProgress?.({ ...state.progress });
    } });
  state.outcome = batch;
  state.progress.edits = baseEdits + batch.edits;
  state.progress.steps = baseSteps + batch.steps;
  state.recovered += batch.recoveredIssues;
  state.skipped += batch.skippedIssues;
  if (batch.reason || !deps.checkpoints) return;
  completeBatch(deps, work, { view, report });
  for (const id of report.reviewedIds ?? []) state.pending?.delete(tidyMemoryKey(id));
}

function completeBatch(deps: TidyPassDeps, work: Work, input: { view: TidyEngineView; report: TidyReport }): void {
  const { state, characterId, options } = work;
  const { view, report } = input;
  const reviewed = state.progress.reviewed + (report.reviewedIds?.length ?? 0);
  checkpointTidyBatch({ repo: deps.checkpoints!, view, characterId, shown: report.reviewedIds ?? [], at: new Date().toISOString(),
    onCommitted: () => {
      const remaining = reportFor(deps, deps.view, { characterId }).remaining ?? 0;
      options.onProgress?.({ ...state.progress, reviewed, remaining });
    } });
  state.progress = { ...state.progress, reviewed, remaining: reportFor(deps, deps.view, { characterId }).remaining ?? 0 };
  deps.checkpoints!.continued(characterId);
}

function settle(deps: TidyPassDeps, work: Work): TidyRunOutcome {
  const { state, characterId } = work;
  const reason = state.outcome?.reason;
  const extra = deps.checkpoints ? { reviewed: state.progress.reviewed,
    ...(state.progress.remaining === null ? {} : { remaining: state.progress.remaining }) } : {};
  if (reason) {
    let retryAt: string | null = null;
    let nextAction: NonNullable<TidyRunOutcome["nextAction"]> = reason === "unfinished" ? "continue" : "retry";
    if (deps.checkpoints && reason !== "unfinished") {
      try {
        const retry = deps.checkpoints.failed(characterId, new Date().toISOString());
        retryAt = retry.retryAt;
        if (retry.failures > 0 && retry.retryAt === null) nextAction = "manual-retry";
      }
      catch { /* Authority retirement cannot write retry metadata into a retired provider. */ }
    }
    const outcome: TidyRunOutcome = { status: state.progress.edits > 0 ? "partial" : "failed", defects: state.report.defects,
      edits: state.progress.edits, steps: state.progress.steps, usage: deps.slot.usage(), reason,
      issues: state.outcome?.issues ?? [], issueCount: state.outcome?.issueCount ?? 0, recoveredIssues: state.recovered,
      skippedIssues: state.skipped,
      ...extra, nextAction: reason === "input-too-large" ? "check-settings" : nextAction, retryAt };
    safeLog(deps.logger, "warn", { characterId, reason, edits: outcome.edits, steps: outcome.steps, issues: outcome.issues, issueCount: outcome.issueCount });
    return outcome;
  }
  const pending = deps.checkpoints && reportFor(deps, deps.view, { characterId }).hasWork;
  if (pending) deps.checkpoints?.continued(characterId);
  else deps.checkpoints?.succeeded(characterId);
  const status = state.progress.steps === 0 ? "clean" : "ran";
  if (status === "ran") {
    deps.autoState.setTidy(characterId, state.startedAt);
    deps.events.record({ kind: "tidy", characterId, count: state.progress.edits });
  }
  safeLog(deps.logger, "info", { characterId, edits: state.progress.edits, steps: state.progress.steps });
  return { status, defects: state.report.defects, edits: state.progress.edits, steps: state.progress.steps, usage: deps.slot.usage(),
    ...extra, recoveredIssues: state.recovered, skippedIssues: state.skipped, nextAction: pending ? "continue" : "none", retryAt: null };
}

function emptyFailure(reason: MemoryTidyFailureReason): TidyBatchRun {
  return { edits: 0, steps: 0, issues: [], issueCount: 0, recoveredIssues: 0, skippedIssues: 0, reason };
}

function safeLog(logger: TidyLogger, level: "info" | "warn", details: object): void {
  try { logger[level](details, level === "info" ? "tidy pass completed" : "tidy pass failed; watermark not advanced"); }
  catch { /* Optional diagnostics do not govern completion or induce another model call. */ }
}
