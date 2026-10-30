/**
 * INPUT: claimed Intention plus canonical Run and delivery truth
 * OUTPUT: crash-cut linkage repair and factual one-shot terminal dispositions
 * POS: core/initiative/intentions — never starts, retries, cancels or rewrites a Run
 */
import { HeartbeatDecisionSchema, type InitiativeIntention, type InitiativeIntentionDisposition } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { linkedRun, attachIntentionRun, closeIntention, type IntentionClaim } from "./intention-repository.ts";

export function reconcileIntention(db: Database, input: { intention: InitiativeIntention; at: string; restart: boolean }): boolean {
  const value = input.intention;
  if (value.state !== "claimed" || value.canonicalRunKey === null) return false;
  const claim: IntentionClaim = { characterId: value.characterId, intentionId: value.intentionId, canonicalRunKey: value.canonicalRunKey };
  const run = linkedRun(db, claim);
  if (!run) return input.restart && closeIntention(db, { scope: claim, at: input.at, disposition: "unknown" });
  // Admission can commit just before the caller loses its callback. Only the canonical key repairs this cut.
  if (value.runId === null) attachIntentionRun(db, { ...claim, runId: String(run.run_id) });
  const disposition = runDisposition(db, { runId: String(run.run_id), state: String(run.state), restart: input.restart });
  return disposition !== null && closeIntention(db, { scope: claim, at: input.at, disposition });
}

function runDisposition(db: Database, run: { runId: string; state: string; restart: boolean }): InitiativeIntentionDisposition | null {
  if (["queued", "running", "waiting", "reconciliation_required"].includes(run.state)) return null;
  if (run.state === "deadline_exceeded") return "expired";
  if (run.state === "outcome_unknown") return "unknown";
  if (run.state === "cancelled" || run.state === "skipped") return "cancelled";
  if (run.state === "failed") return "failed";
  if (run.state !== "completed") return null;
  const delivery = db.prepare("SELECT decision_json,state,continuation FROM run_deliveries WHERE run_id=:runId").get({ runId: run.runId });
  if (!delivery) return "completed";
  const decision = HeartbeatDecisionSchema.parse(JSON.parse(String(delivery.decision_json)));
  if (decision.outcome === "silent") return "silent";
  // Expressions finish at the executable continuation. Their delivery row has no speech
  // publication transition, so its retained "staged" state is not pending user-facing work.
  if (decision.outcome === "express" && delivery.continuation === "completed") return "express";
  // A text Run may finish before publication. Keep its original source fence alive through that held output.
  if (delivery.state === "staged" || delivery.state === "held") return null;
  if (delivery.state === "expired") return "expired";
  if (delivery.state === "suppressed") return "cancelled";
  // The commit event precedes the live transport result. Keep this exact claim while that owner
  // is still sending; after restart its lost acknowledgement is unknown and must never replay.
  if (delivery.state === "dispatch_committed") return run.restart ? "unknown" : null;
  if (delivery.state === "unknown") return "unknown";
  return decision.outcome;
}
