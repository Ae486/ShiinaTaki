/**
 * INPUT:  an authorized Core Run plus synchronous aggregate reads from the existing ledger
 * OUTPUT: the compact Run browser summary with complete-only usage semantics and recorded duration
 * POS:    core/observability — disposable read projection; no reconstructed execution state or zero-filled metrics
 */
import { RunMonitorSummarySchema, observabilityLabel, type Run, type RunMonitorSummary } from "@taki/shared";
import { aggregateRunEvents } from "../db/run-observability-aggregate.ts";
import type { Database } from "../db/sqlite.ts";

export function buildRunSummary(db: Database, run: Run): RunMonitorSummary {
  const attempts = db.prepare("SELECT count(*) AS count,min(provider) AS provider,min(model_id) AS model_id FROM run_attempts WHERE run_id=:id")
    .get({ id: run.runId });
  const receipt = db.prepare("SELECT summary,reason FROM run_receipts WHERE run_id=:id").get({ id: run.runId });
  const aggregate = aggregateRunEvents(db, run.runId);
  const durationMs = run.startedAt && run.terminalAt
    ? Math.max(0, Date.parse(run.terminalAt) - Date.parse(run.startedAt)) : undefined;
  return RunMonitorSummarySchema.parse({
    key: run.runId, characterId: run.characterId,
    title: `${observabilityLabel(run.initiator)} · ${observabilityLabel(run.state)}`,
    initiator: run.initiator, initiatorLabel: observabilityLabel(run.initiator),
    triggerLabel: observabilityLabel(run.provenance.provider),
    deliveryClass: run.deliveryClass, deliveryLabel: observabilityLabel(run.deliveryClass),
    state: run.state, outcome: run.outcome, queuedAt: run.queuedAt,
    startedAt: run.startedAt, terminalAt: run.terminalAt, durationMs,
    attemptCount: Number(attempts?.count ?? 0), ...aggregate,
    provider: attempts?.provider ? String(attempts.provider) : undefined,
    modelId: attempts?.model_id ? String(attempts.model_id) : undefined,
    lineageLabel: run.parentRunId ? "子运行" : run.taskId ? "定时任务" : undefined,
    summary: receipt?.summary ? String(receipt.summary) : receipt?.reason ? String(receipt.reason) : undefined,
  });
}
