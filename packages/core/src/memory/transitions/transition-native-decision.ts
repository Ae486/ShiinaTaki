/**
 * INPUT:  historically verified native status and an exact Core release/activation decision
 * OUTPUT: immutable decision commands, including a proof-bound continuation of a refused pre-proof abort
 * POS:    core/memory/transitions — rejected original requests remain inspectable and are never rewritten
 */
import { randomUUID } from "node:crypto";
import type { HindsightTransitionOutcomeRequest, HindsightTransitionStatus } from "@taki/shared";
import { prepareTransitionNativeCommand, readTransitionNativeCommand } from "../../db/memory-transition-driver-repo.ts";
import { hindsightTransitionHash } from "../hindsight/hindsight-transition-proof.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import type { TransitionNativeSessionInput } from "./transition-native-session.ts";

type Decision = { disposition: HindsightTransitionOutcomeRequest["disposition"]; receiptId: string | null };
export function transitionNativeDecision(input: TransitionNativeSessionInput, status: HindsightTransitionStatus, decision: Decision) {
  const originalSlot = `${decision.disposition}:${status.executor.generation}`;
  const key = { transitionId: input.intent.transitionId, bankId: status.bank_id, kind: "decision" as const };
  const original = readTransitionNativeCommand(input.db, { ...key, slot: originalSlot });
  if (original && original.kind !== "decision") invalid();
  // A pre-proof abort can be refused after maintenance starts. A later observed final proof plus absent outcome
  // proves that abort did not release this Bank. Keep the old command and reserve a separate proof-bound decision.
  const continued = decision.disposition === "abort" && original?.kind === "decision"
    && original.request.proof_hash === null && status.proof !== null && status.outcome === null;
  const slot = continued ? `${originalSlot}:${status.proof!.proof_hash}` : originalSlot;
  const prior = continued ? readTransitionNativeCommand(input.db, { ...key, slot }) : original;
  if (prior) return prior;
  const body = { executor: status.executor, disposition: decision.disposition, decision_id: randomUUID(),
    core_receipt_id: decision.receiptId, proof_hash: status.proof?.proof_hash ?? null };
  return prepareTransitionNativeCommand(input.db, { ...input.work(), command: { kind: "decision", bankId: status.bank_id,
    slot, request: { ...body, decision_hash: hindsightTransitionHash(["taki-core-transition-decision.v1", body]) } } });
}
export function requireStoredNativeDecision(input: TransitionNativeSessionInput, status: HindsightTransitionStatus, decision: Decision): void {
  const request = status.outcome?.request; if (!request) invalid();
  if (request.core_receipt_id !== decision.receiptId || request.disposition !== decision.disposition) invalid();
  const slot = `${decision.disposition}:${request.executor.generation}`;
  const slots = request.disposition === "abort" && request.proof_hash ? [slot, `${slot}:${request.proof_hash}`] : [slot];
  for (const candidate of slots) {
    const command = readTransitionNativeCommand(input.db, { transitionId: input.intent.transitionId, bankId: status.bank_id,
      kind: "decision", slot: candidate });
    if (command?.kind === "decision" && transitionLocalHash(command.request) === transitionLocalHash(request)) return;
  }
  invalid();
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
