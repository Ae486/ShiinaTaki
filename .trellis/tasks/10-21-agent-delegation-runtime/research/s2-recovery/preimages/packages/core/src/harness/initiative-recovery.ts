/**
 * INPUT: interrupted initiative Run and original durable decision/continuation
 * OUTPUT: decision-aware terminal repair with no model rerun or presentation replay
 * POS: core/harness — restart loses executable bindings; it cannot reacquire authority for an old decision
 */
import type { RunStatusResult } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { RunRepo } from "../db/run-repo.ts";
import { createRunDeliveryRepo } from "../db/run-delivery-repo.ts";
import { createRunEventRepo } from "../db/run-event-repo.ts";
import type { EffectLifecycleService } from "./effect-lifecycle-service.ts";

/** Text publication follows Run completion, so it needs recovery even when the Run is already terminal. */
export function recoverTerminalDeliveries(db: Database): void {
  const repo = createRunDeliveryRepo({ db, events: createRunEventRepo(db) });
  while (true) {
    const pending = db.prepare(`SELECT d.run_id FROM run_deliveries d JOIN runs r ON r.run_id=d.run_id
      WHERE r.state IN ('completed','failed','cancelled','skipped','deadline_exceeded','outcome_unknown')
      AND d.state IN ('staged','held','dispatch_committed')
      AND (json_extract(d.decision_json,'$.outcome')='speak' OR d.continuation IN ('pending','waiting','running'))
      ORDER BY d.run_id LIMIT 100`).all();
    if (pending.length === 0) return;
    for (const row of pending) {
      const delivery = repo.get(String(row.run_id));
      if (!delivery) continue;
      const uncertain = delivery.state === "dispatch_committed";
      const continuation = ["pending", "waiting"].includes(delivery.continuation) ? "expired"
        : delivery.continuation === "running" ? "unknown" : delivery.continuation;
      repo.transition({ runId: delivery.runId, expectedVersion: delivery.version, state: uncertain ? "unknown" : "expired",
        continuation,
        fact: { kind: uncertain ? "delivery.unknown" : "delivery.expired", state: uncertain ? "unknown" : "expired", reasonCode: "binding_lost" } });
    }
  }
}

export function recoverInitiativeRun(input: { db: Database; runs: RunRepo; effects: EffectLifecycleService }, status: RunStatusResult): boolean {
  if (status.run.initiator !== "heartbeat" || !status.run.activeAttemptId) return false;
  const repo = createRunDeliveryRepo({ db: input.db, events: createRunEventRepo(input.db) });
  const delivery = repo.get(status.run.runId);
  const unfinished = input.effects.unfinished(status.run.runId);
  // No adapter is consulted: even a nominally safe model Effect cannot rerun a required structural decision.
  for (const effect of unfinished) input.effects.settle({ effectId: effect.effectId, runId: effect.runId,
    attemptId: effect.attemptId, expectedVersion: effect.version, outcome: "outcome_unknown", errorCode: "initiative_restart" });
  const unknown = unfinished.length > 0 || delivery?.continuation === "running" || delivery?.continuation === "unknown";
  if (delivery && ["staged", "held", "dispatch_committed"].includes(delivery.state)) {
    const uncertain = delivery.state === "dispatch_committed";
    repo.transition({ runId: delivery.runId, expectedVersion: delivery.version, state: uncertain ? "unknown" : "expired",
      continuation: delivery.continuation === "none" ? "none" : unknown ? "unknown" : "expired",
      fact: { kind: uncertain ? "delivery.unknown" : "delivery.expired", state: uncertain ? "unknown" : "expired", reasonCode: "binding_lost" } });
  }
  const completed = delivery && delivery.continuation === "none" && !unknown;
  input.runs.settle({ runId: status.run.runId, attemptId: status.run.activeAttemptId,
    outcome: unknown ? "outcome_unknown" : status.run.state === "cancel_requested" ? "cancelled" : completed ? "completed" : "failed",
    retryability: "not_retryable", errorCode: completed ? undefined : delivery ? "delivery_binding_lost" : "decision_missing" });
  return true;
}
