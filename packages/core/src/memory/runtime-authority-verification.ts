/**
 * INPUT:  the live database and existing Local/Hindsight publication owners
 * OUTPUT: full-proof reads that mark the selected authority unavailable and withdraw only its matching binding
 * POS:    composed runtime boundary; standalone database and copied-backup readers remain pure
 */
import type { Database } from "../db/sqlite.ts";
import { readVerifiedTransitionPublication } from "../db/memory-transition-publication-reader.ts";
import { readCurrentMemoryAuthorityIdentity, readMemoryAuthoritySelection, verifyCanonicalLocalReceipt,
  type MemoryAuthorityIdentity, type MemoryAuthoritySelection } from "./legacy-migration/legacy-activation-repo.ts";
import type { TransitionEvidenceContext } from "./transitions/transition-evidence-context.ts";

export interface MemoryAuthorityVerification {
  verifySelectedAuthority(verification?: TransitionEvidenceContext): MemoryAuthoritySelection;
  verifyTransitionPublication(receiptId: string, verification?: TransitionEvidenceContext): ReturnType<typeof readVerifiedTransitionPublication>;
}
interface BindingOwner {
  boundIdentity(): MemoryAuthorityIdentity | undefined;
  unavailable(epochId: string, code: string): void;
}

export function sameMemoryAuthorityIdentity(left: MemoryAuthorityIdentity, right: MemoryAuthorityIdentity): boolean {
  return left.mode === right.mode && left.epochId === right.epochId && left.snapshotId === right.snapshotId
    && left.transactionId === right.transactionId && left.providerLineageId === right.providerLineageId
    && left.replicaCheckpointDigest === right.replicaCheckpointDigest
    && (left.transitionReceiptId ?? null) === (right.transitionReceiptId ?? null)
    && left.activeProviderId === right.activeProviderId && left.activeProviderLineageId === right.activeProviderLineageId;
}

export function createMemoryAuthorityVerification(input: { db: Database; local: BindingOwner; hindsight: BindingOwner }): MemoryAuthorityVerification {
  const withdraw = (identity: MemoryAuthorityIdentity) => {
    if (!identity.epochId) return;
    const owner = identity.mode === "canonical-local" ? input.local : input.hindsight;
    const bound = owner.boundIdentity();
    if (!bound || sameMemoryAuthorityIdentity(bound, identity)) owner.unavailable(identity.epochId, "MEMORY_AUTHORITY_INVALID");
  };
  return {
    verifySelectedAuthority: (verification) => {
      verification?.assertOwner(input.db);
      const identity = readCurrentMemoryAuthorityIdentity(input.db);
      try {
        const selected = readMemoryAuthoritySelection(input.db, verification);
        if (selected.mode === "canonical-local" && !selected.transitionReceiptId) verifyCanonicalLocalReceipt(input.db, selected);
        return selected;
      } catch (error) { withdraw(identity); throw error; }
    },
    verifyTransitionPublication: (receiptId, verification) => {
      verification?.assertOwner(input.db);
      const identity = readCurrentMemoryAuthorityIdentity(input.db);
      try { return readVerifiedTransitionPublication(input.db, receiptId, verification); }
      catch (error) {
        if (identity.transitionReceiptId === receiptId) withdraw(identity);
        throw error;
      }
    },
  };
}
