/**
 * INPUT:  claimed exact targets, lexical report evidence and the existing shared Utility Slot
 * OUTPUT: durable model proposals/failures with single-attempt evidence and no remote writes during generation
 * POS:    core/memory/hindsight — publication is a later phase; queued/late model callbacks cannot touch retired work
 */
import type { TakiApplicationAssessmentFailure } from "@taki/shared";
import { policyWorkClaim, policyWorkRetryAt } from "../../db/hindsight-policy-work-repo.ts";
import { policyAssessmentTarget, type HindsightPolicyWorkRecord } from "../../db/hindsight-policy-work-contract.ts";
import { proposeHindsightPolicyFailure } from "./hindsight-policy-assessment.ts";
import { buildHindsightPolicyCuratorPrompt } from "./hindsight-policy-curator-prompt.ts";
import { createHindsightPolicyCuratorTools } from "./hindsight-policy-curator-tools.ts";
import { assertCuratorReviewInputs, assertCuratorWorkCurrent, captureCuratorBlocks, requireCuratorBank, readCuratorSnapshot } from "./hindsight-policy-curator-targets.ts";
import { runHindsightPolicyCuratorModel } from "./hindsight-policy-curator-model.ts";
import { awaitCuratorWork } from "./hindsight-policy-curator-lifetime.ts";
import type { HindsightPolicyCuratorRun, HindsightPolicyCuratorReview } from "./hindsight-policy-curator-context.ts";

export async function executeCuratorModel(run: HindsightPolicyCuratorRun, records: HindsightPolicyWorkRecord[]): Promise<HindsightPolicyWorkRecord[]> {
  if (!records.length) return [];
  const current = requireCuratorBank(run, records[0]!.key.bankId);
  const report = { run, ...current, records: new Map(records.map((record) => [record.key.workId, record])), blocks: captureCuratorBlocks(run, current.bank) };
  const prompt = readCuratorSnapshot(run, (currentRun) => buildHindsightPolicyCuratorPrompt({ ...report, run: currentRun }));
  const review: HindsightPolicyCuratorReview = { ...report, prompt: prompt.evidence, finished: false, closed: false };
  const before = run.outcome.steps; const maxSteps = run.config.memory.tidyMaxSteps - before;
  if (maxSteps < 1) return deferUnstarted(run, records);
  let failure: TakiApplicationAssessmentFailure = "model_failed";
  run.outcome.status = run.outcome.status === "failed" ? "failed" : "ran";
  try {
    const result = await awaitCuratorWork(run, () => run.deps.slot.run("hindsight-policy-curator", async () => {
      assertCuratorReviewInputs(review);
      for (const record of review.records.values()) review.records.set(record.key.workId,
        run.deps.work.prompt({ claim: policyWorkClaim(record), prompt: review.prompt }));
      const driver = run.deps.driver ?? runHindsightPolicyCuratorModel;
      return awaitCuratorWork(run, () => driver({ model: run.deps.slot.model, system: prompt.system, prompt: prompt.prompt,
        tools: createHindsightPolicyCuratorTools(review), maxSteps, signal: run.signal,
        assertInput: () => { assertCuratorReviewInputs(review); if (run.outcome.steps - before >= maxSteps) throw new Error("MEMORY_INVALID_REQUEST"); },
        onStepEnd: () => { if (!review.closed && !run.signal.aborted) run.outcome.steps++; } }));
    }));
    if (result !== undefined) {
      if (!Number.isSafeInteger(result.steps) || result.steps < 1 || result.steps > maxSteps) {
        failure = "invalid_result"; run.outcome.status = "failed";
      }
      else { run.outcome.steps = Math.max(run.outcome.steps, before + result.steps); failure = "invalid_result"; }
    } else run.outcome.status = "failed";
  } catch {
    // The slot and the journal record bounded failure classes; model exception text is never retained.
    failure = run.stopped() ? "cancelled" : "model_failed"; run.outcome.status = "failed";
  } finally { review.closed = true; }
  if (run.stopped()) return [];
  for (const record of review.records.values()) if (record.result === null) {
    const next = record.target.kind === "policy" && !run.signal.aborted
      ? saveCuratorFailure(run, record, record.prompt === null ? "model_unavailable" : failure)
      : deferRecord(run, record, failure);
    if (next) review.records.set(record.key.workId, next);
  }
  return [...review.records.values()].filter((record) => record.state === "saved" && record.claimToken !== null);
}

/** A crashed admitted policy attempt first receives its own failed revision; it is never silently reassessed. */
export function recoverCuratorPolicyAttempt(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord): HindsightPolicyWorkRecord | undefined {
  const failure = record.lastFailure && record.lastFailure !== "publication_pending" ? record.lastFailure : "cancelled";
  return saveCuratorFailure(run, record, failure);
}

function saveCuratorFailure(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord,
  failure: TakiApplicationAssessmentFailure): HindsightPolicyWorkRecord | undefined {
  if (record.target.kind !== "policy") throw new Error("MEMORY_INVALID_REQUEST");
  try {
    assertCuratorWorkCurrent(run, { scope: record.key, target: record.target });
  } catch {
    if (run.stopped()) return;
    run.outcome.status = "failed"; run.deps.work.supersede(policyWorkClaim(record)); return;
  }
  const nextAttemptAt = policyWorkRetryAt(now(run), record.target.memory.assessment.attempts + 1);
  const body = proposeHindsightPolicyFailure({ ...policyAssessmentTarget(record.key, record.target), failure,
    prompt: record.prompt, nextAttemptAt });
  run.outcome.status = "failed";
  return run.deps.work.saveResult({ claim: policyWorkClaim(record), result: {
    kind: "assessment-failure", body, prompt: record.prompt, failure, nextAttemptAt,
  } });
}
function deferRecord(run: HindsightPolicyCuratorRun, record: HindsightPolicyWorkRecord, failure: TakiApplicationAssessmentFailure) {
  if (run.stopped()) return;
  run.outcome.pending++; run.outcome.status = "failed";
  return run.deps.work.defer({ claim: policyWorkClaim(record), failure });
}
function deferUnstarted(run: HindsightPolicyCuratorRun, records: HindsightPolicyWorkRecord[]): HindsightPolicyWorkRecord[] {
  for (const record of records) deferRecord(run, record, "model_unavailable");
  return [];
}
function now(run: HindsightPolicyCuratorRun): string { return run.deps.now?.() ?? new Date().toISOString(); }
