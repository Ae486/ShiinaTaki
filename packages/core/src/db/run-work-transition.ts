/**
 * INPUT: trusted accepted-purpose identity and exact Run/Attempt/version transition request
 * OUTPUT: atomic quiescent wait/resume with immutable bounded lifecycle evidence
 * POS: core/db — reuses runs/provenance as authority; no extra task or event-derived state store
 */
import { ACCEPTED_WORK_PROVIDER, RunWorkHoldSchema, RunWorkTransitionSchema,
  type RunEvent, type RunWorkHold, type RunWorkResult, type RunWorkTransition } from "@taki/shared";
import type { Database } from "./sqlite.ts";
import type { RunEventRepo } from "./run-event-repo.ts";
import type { RunEventLiveBus } from "./run-event-live.ts";

interface Dependencies { db: Database; events: RunEventRepo; live?: RunEventLiveBus }

export function transitionRunWork(deps: Dependencies, input: RunWorkHold | RunWorkTransition, resume: boolean): RunWorkResult {
  const parsed = (resume ? RunWorkTransitionSchema : RunWorkHoldSchema).safeParse(input);
  if (!parsed.success) return { changed: false, reason: "invalid_input" };
  const request = parsed.data;
  let result: RunWorkResult = { changed: false, reason: "missing_run" };
  const facts: RunEvent[] = [];
  deps.db.transaction(() => {
    const row = deps.db.prepare(`SELECT r.*,a.state AS attempt_state FROM runs r
      LEFT JOIN run_attempts a ON a.attempt_id=r.active_attempt_id AND a.run_id=r.run_id
      WHERE r.run_id=:runId`).get({ runId: request.runId });
    const refusal = validate(deps.db, row, { request, resume });
    if (refusal) { result = refusal; return; }
    const state = resume ? "running" : "waiting";
    const changed = deps.db.prepare(`UPDATE runs SET state=:state,operation_phase=:phase,
      state_version=state_version+1,updated_at=:at WHERE run_id=:runId
      AND active_attempt_id=:attemptId AND state_version=:version`).run({ state,
        phase: resume ? "executing" : "waiting", at: new Date().toISOString(),
        runId: request.runId, attemptId: request.attemptId, version: request.expectedRunVersion });
    if (changed.changes !== 1) { result = { changed: false, reason: "stale_version" }; return; }
    const runVersion = request.expectedRunVersion + 1;
    const payload = resume ? { kind: "run.work_resumed" as const, state: "running" as const, runVersion }
      : { kind: "run.work_held" as const, state: "waiting" as const, runVersion };
    facts.push(deps.events.append({ runId: request.runId, attemptId: request.attemptId,
      schemaVersion: "run-event.v3", category: "lifecycle", source: "core.run-work",
      kind: payload.kind, occurredAt: new Date().toISOString(), payload }));
    result = { changed: true, state, runVersion };
  });
  if (facts.length > 0) deps.live?.publish(facts);
  return result;
}

function validate(db: Database, row: Record<string, unknown> | undefined,
  input: { request: RunWorkHold | RunWorkTransition; resume: boolean }): RunWorkResult | undefined {
  const { request, resume } = input;
  if (!row) return { changed: false, reason: "missing_run" };
  let provenance: unknown;
  try { provenance = JSON.parse(String(row.provenance_json)); }
  catch { return { changed: false, reason: "wrong_scope" }; }
  if (row.delivery_class !== "internal" || typeof provenance !== "object" || provenance === null
    || !("provider" in provenance) || provenance.provider !== ACCEPTED_WORK_PROVIDER
    || !("sourceRef" in provenance) || typeof provenance.sourceRef !== "string" || !provenance.sourceRef
    || ("reasonRef" in request && provenance.sourceRef !== request.reasonRef)) return { changed: false, reason: "wrong_scope" };
  if (row.active_attempt_id !== request.attemptId) return { changed: false, reason: "stale_attempt" };
  if (row.state_version !== request.expectedRunVersion) return { changed: false, reason: "stale_version" };
  if (row.state !== (resume ? "waiting" : "running") || row.attempt_state !== "effect_running") return { changed: false, reason: "invalid_state" };
  if (row.deadline_at && !(Date.parse(String(row.deadline_at)) > Date.now())) return { changed: false, reason: "expired" };
  if (db.prepare("SELECT 1 FROM run_effects WHERE run_id=:runId AND state<>'terminal' LIMIT 1")
    .get({ runId: request.runId })) return { changed: false, reason: "unfinished_effect" };
  // This primitive never repurposes the delivery-specific continuation or its immutable decision.
  if (db.prepare("SELECT 1 FROM run_deliveries WHERE run_id=:runId LIMIT 1").get({ runId: request.runId })) {
    return { changed: false, reason: "delivery_pending" };
  }
  return undefined;
}
