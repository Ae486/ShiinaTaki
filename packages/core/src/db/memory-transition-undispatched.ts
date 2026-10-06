/**
 * INPUT:  the complete admitted Bank registry, current executor and durable dispatch reservations
 * OUTPUT: positive never-dispatched release evidence with an atomic permanent dispatch barrier
 * POS:    core/db — local facts only; no native fence/outcome is fabricated for a request never sent
 */
import { MemoryTransitionUndispatchedSchema, type MemoryTransitionUndispatched } from "@taki/shared";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { readTransitionDriverBank } from "./memory-transition-driver-repo.ts";
import { readTransitionIntent, requireTransitionLease, assertTransitionPredecessor, type TransitionLease } from "./memory-transition-repo.ts";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import type { Database } from "./sqlite.ts";

export function sealTransitionUndispatched(db: Database, input: { lease: TransitionLease; now: string; bankId: string }): MemoryTransitionUndispatched {
  let value: MemoryTransitionUndispatched | undefined;
  db.transaction(() => {
    requireTransitionLease(db, input);
    const intent = readTransitionIntent(db, input.lease.transitionId);
    const bank = readTransitionDriverBank(db, input.lease.transitionId, input.bankId);
    if (!intent || !bank || readTransitionReceipt(db, intent.transitionId)) invalid();
    assertTransitionPredecessor(db, intent);
    value = readTransitionUndispatched(db, intent.transitionId, input.bankId);
    if (value) return;
    if (hasDispatch(db, intent.transitionId, input.bankId)) throw new Error("MEMORY_TRANSITION_OUTCOME_UNKNOWN");
    const body = { ...bank, bankId: bank.nativeBankId, nativeBankId: undefined,
      disposition: "never-dispatched" as const, recordedAt: input.now };
    // Only the normalized wire fields belong to the evidence hash; no omitted/undefined surrogate fields.
    const normalized = { version: 1 as const, transitionId: body.transitionId, bankId: body.bankId,
      sourceBankId: body.sourceBankId, identityHash: body.identityHash, disposition: body.disposition, recordedAt: body.recordedAt };
    value = MemoryTransitionUndispatchedSchema.parse({ ...normalized, evidenceId: transitionLocalHash(["taki-transition-undispatched.v1", normalized]) });
    db.prepare("INSERT INTO memory_transition_undispatched VALUES(:id,:transition,:bank,:json)")
      .run({ id: value.evidenceId, transition: value.transitionId, bank: value.bankId, json: JSON.stringify(value) });
  });
  if (!value) invalid(); return value;
}
export function readTransitionUndispatched(db: Database, transitionId: string, bankId: string): MemoryTransitionUndispatched | undefined {
  const row = db.prepare("SELECT * FROM memory_transition_undispatched WHERE transition_id=:transition AND bank_id=:bank")
    .get({ transition: transitionId, bank: bankId });
  if (!row) return undefined;
  const value = MemoryTransitionUndispatchedSchema.parse(JSON.parse(String(row.body_json)));
  const { evidenceId, ...body } = value;
  const bank = readTransitionDriverBank(db, transitionId, bankId);
  if (!bank || value.transitionId !== transitionId || value.bankId !== bankId || value.sourceBankId !== bank.sourceBankId
    || value.identityHash !== bank.identityHash || row.id !== evidenceId
    || evidenceId !== transitionLocalHash(["taki-transition-undispatched.v1", body]) || hasDispatch(db, transitionId, bankId)) invalid();
  return value;
}
function hasDispatch(db: Database, transitionId: string, bankId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM memory_transition_native_commands c JOIN memory_transition_native_dispatches d
    ON d.command_id=c.id WHERE c.transition_id=:transition AND c.bank_id=:bank LIMIT 1`).get({ transition: transitionId, bank: bankId });
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
