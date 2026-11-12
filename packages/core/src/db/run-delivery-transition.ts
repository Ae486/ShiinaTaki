/**
 * INPUT: same Run/Attempt and delivery CAS version after settled reasoning
 * OUTPUT: atomic hold/resume preserving the existing Attempt and strict dispatch guard
 * POS: core/db — Run repository extension; no tool dispatch or observer publication within the transaction
 */
import type { RunEvent } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunEventRepo } from "./run-event-repo.ts";
import type { RunEventLiveBus } from "./run-event-live.ts";

export function transitionRunDelivery(deps: { db: Database; events: RunEventRepo; live?: RunEventLiveBus }, input: {
  runId: string; attemptId: string; deliveryVersion: number; resume: boolean;
}): boolean {
  const { db } = deps; let changed = false; let facts: RunEvent[] = [];
  db.transaction(() => {
    const delivery = db.prepare("SELECT * FROM run_deliveries WHERE run_id=:runId").get({ runId: input.runId });
    const run = db.prepare("SELECT * FROM runs WHERE run_id=:runId").get({ runId: input.runId });
    const at = new Date().toISOString();
    if (!delivery || !run || delivery.attempt_id !== input.attemptId || delivery.version !== input.deliveryVersion
      || run.active_attempt_id !== input.attemptId || run.state !== (input.resume ? "waiting" : "running")
      || delivery.continuation !== (input.resume ? "waiting" : "pending")
      || Date.parse(String(delivery.expires_at)) <= Date.parse(at)) return;
    if (run.deadline_at && Date.parse(String(run.deadline_at)) <= Date.parse(at)) return;
    if (db.prepare("SELECT effect_id FROM run_effects WHERE run_id=:runId AND state<>'terminal' LIMIT 1").get({ runId: input.runId })) return;
    const state = input.resume ? "running" : "waiting";
    const result = db.prepare(`UPDATE runs SET state=:state,operation_phase=:phase,state_version=state_version+1,updated_at=:at
      WHERE run_id=:runId AND state_version=:version AND active_attempt_id=:attemptId`).run({ runId: input.runId,
        attemptId: input.attemptId, version: Number(run.state_version), state, phase: input.resume ? "executing" : "waiting", at });
    if (result.changes !== 1) throw new Error("RUN_STALE_VERSION");
    db.prepare(`UPDATE run_deliveries SET continuation=:continuation,state=:state,version=version+1
      WHERE run_id=:runId AND version=:version`).run({ runId: input.runId, version: input.deliveryVersion,
        continuation: state, state: input.resume ? "staged" : "held" });
    const kind = input.resume ? "delivery.resumed" : "delivery.held";
    facts = [deps.events.append({ runId: input.runId, attemptId: input.attemptId, schemaVersion: "run-event.v2",
      category: "lifecycle", source: "core.delivery", kind, occurredAt: at,
      payload: { kind, state: input.resume ? "resumed" : "held", deliveryId: String(delivery.delivery_id) } })];
    changed = true;
  });
  deps.live?.publish(facts); return changed;
}
