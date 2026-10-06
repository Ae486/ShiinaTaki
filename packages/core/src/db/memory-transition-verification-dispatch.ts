/**
 * INPUT:  current Core lease and a historically verified live native executor
 * OUTPUT: immutable verification dispatch before I/O and strict per-Bank lookup after restart
 * POS:    core/db — an interrupted maintenance attempt is resumed before any positive source release
 */
import { HindsightTransitionExecutorSchema, type HindsightTransitionStatus } from "@taki/shared";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { latestTransitionNativeObservation, readTransitionDriverBank } from "./memory-transition-driver-repo.ts";
import { requireTransitionLease, type TransitionLease } from "./memory-transition-repo.ts";
import type { Database } from "./sqlite.ts";

export function recordTransitionVerificationDispatch(db: Database, input: { lease: TransitionLease; now: string; status: HindsightTransitionStatus }): void {
  db.transaction(() => {
    requireTransitionLease(db, input);
    const { status } = input; const executor = HindsightTransitionExecutorSchema.parse(status.executor);
    const prior = latestTransitionNativeObservation(db, input.lease.transitionId, status.bank_id);
    if (!prior || !status.executor_live || status.proof || status.outcome || executor.transition_id !== input.lease.transitionId
      || transitionLocalHash(prior.status.executor) !== transitionLocalHash(executor)) invalid();
    const id = transitionLocalHash(["taki-transition-verification-dispatch.v1", status.bank_id, executor]);
    const existing = db.prepare("SELECT id FROM memory_transition_native_verifications WHERE transition_id=:transition AND bank_id=:bank AND generation=:generation")
      .get({ transition: input.lease.transitionId, bank: status.bank_id, generation: executor.generation });
    if (existing) { if (existing.id !== id) invalid(); return; }
    db.prepare("INSERT INTO memory_transition_native_verifications VALUES(:id,:transition,:bank,:generation,:executor,:now)")
      .run({ id, transition: input.lease.transitionId, bank: status.bank_id, generation: executor.generation, executor: JSON.stringify(executor), now: input.now });
  });
}
export function hasTransitionVerificationDispatch(db: Database, transitionId: string, bankId: string): boolean {
  const rows = db.prepare("SELECT * FROM memory_transition_native_verifications WHERE transition_id=:transition AND bank_id=:bank")
    .all({ transition: transitionId, bank: bankId });
  if (!readTransitionDriverBank(db, transitionId, bankId)) invalid();
  for (const row of rows) {
    const executor = HindsightTransitionExecutorSchema.parse(JSON.parse(String(row.executor_json)));
    if (executor.transition_id !== transitionId || executor.generation !== row.generation
      || row.id !== transitionLocalHash(["taki-transition-verification-dispatch.v1", bankId, executor])) invalid();
  }
  return rows.length > 0;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
