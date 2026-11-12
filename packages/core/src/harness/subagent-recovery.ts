/**
 * INPUT: orphan linked child/parent Run and durable Effect evidence during the boot barrier
 * OUTPUT: honest terminal private report without automatic replay or reconstructed source authority
 * POS: core/harness — delegation-specific classification inside the existing RecoveryCoordinator
 */
import type { RunStatusResult } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { RunRepo } from "../db/run-repo.ts";
import type { EffectLifecycleService } from "./effect-lifecycle-service.ts";

export function recoverSubagentRun(input: { db: Database; runs: RunRepo; effects: EffectLifecycleService }, status: RunStatusResult,
  scan: { now: string; generation: string }): boolean {
  const linked = input.db.prepare(`SELECT run_id FROM subagent_executions WHERE run_id=:id OR parent_run_id=:id
    UNION ALL SELECT run_id FROM subagent_inbox_consumers WHERE run_id=:id`).get({ id: status.run.runId });
  if (!linked || !status.run.activeAttemptId) return false;
  const effects = input.effects.list?.(status.run.runId) ?? input.effects.unfinished(status.run.runId);
  const unfinished = effects.filter((effect) => effect.state !== "terminal");
  for (const effect of unfinished) {
    const outcome = effect.state === "waiting" || effect.state === "prepared" ? "cancelled" : "outcome_unknown";
    const settlement = { effectId: effect.effectId, runId: effect.runId, attemptId: effect.attemptId, expectedVersion: effect.version,
      outcome, errorCode: "subagent_restart" } as const;
    if (effect.state === "waiting" && input.effects.settleWaiting) input.effects.settleWaiting({ ...settlement, outcome: "cancelled" });
    else input.effects.settle(settlement);
  }
  const unknown = unfinished.some((effect) => !["waiting", "prepared"].includes(effect.state))
    || effects.some((effect) => effect.outcome === "outcome_unknown");
  // A last completed model/tool Effect is not proof that the whole child or parent decision completed.
  const outcome = unknown ? "outcome_unknown" : status.run.deadlineAt && Date.parse(scan.now) >= Date.parse(status.run.deadlineAt)
    ? "deadline_exceeded" : "cancelled";
  input.runs.classifyRecovery({ runId: status.run.runId, classification: outcome,
    reason: "Delegated execution requires explicit continuation", ...scan });
  input.runs.settle({ runId: status.run.runId, attemptId: status.run.activeAttemptId, outcome,
    retryability: "not_retryable", summary: "Delegated execution lost its live binding; explicit continuation is required",
    errorCode: "subagent_restart" });
  return true;
}
