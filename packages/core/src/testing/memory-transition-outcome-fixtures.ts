/**
 * INPUT:  deterministic native transition proof envelopes from isolated Core fixtures
 * OUTPUT: correctly hashed native terminal response shapes for Core outcome tests
 * POS:    core/testing — synthetic transport evidence; no native execution or acceptance is claimed
 */
import { randomUUID } from "node:crypto";
import { HindsightTransitionStatusSchema, type HindsightTransitionStatus } from "@taki/shared";
import { hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import { W3_AT } from "./memory-transition-candidate-fixtures.ts";

export function transitionOutcomeFixture(status: HindsightTransitionStatus, receiptId: string | null): HindsightTransitionStatus {
  const abort = receiptId === null;
  const returning = status.request.direction === "return-local";
  const unused = status.request.unused_scope;
  const phase = abort ? unused ? "quarantined" : "aborted" : returning ? "retired" : "active";
  const outcome = { request: { executor: status.executor, disposition: abort ? "abort" : returning ? "retire" : "activate",
    decision_id: randomUUID(), decision_hash: "a".repeat(64), core_receipt_id: receiptId, proof_hash: status.proof?.proof_hash ?? null },
    bank_id: status.bank_id, provider_lineage: status.request.provider_lineage, bank_generation: status.request.bank_generation,
    phase, resolution: abort ? returning ? "source_resumed" : unused ? "unused_baseline_held" : "retired_baseline_restored" : "committed",
    restored_baseline_hash: abort && !returning ? unused?.proof_hash ?? status.request.baseline_proof_hash : null, recorded_at: W3_AT };
  return HindsightTransitionStatusSchema.parse({ ...status, phase, outcome: { ...outcome, outcome_hash: hindsightTransitionHash(outcome) } });
}
