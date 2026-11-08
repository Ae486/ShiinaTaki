/**
 * INPUT:  selected Hindsight marker, full publication proof and validated current replica checkpoints
 * OUTPUT: binding-time full proof followed by current identity and saved checkpoint-floor assertions
 * POS:    Core memory runtime — historical proof is consumed once per connection; current authority is never cached
 */
import type { TakiApplicationNamespace } from "@taki/shared";
import { readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import { requireTransitionTargetReady } from "../../db/memory-transition-native-outcome.ts";
import { readVerifiedTransitionPublication } from "../../db/memory-transition-publication-reader.ts";
import type { Database } from "../../db/sqlite.ts";
import { readCurrentMemoryAuthorityIdentity, readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { sameApplicationValue } from "./hindsight-application-integrity.ts";

interface CheckpointFloor {
  bankId: string;
  namespace: TakiApplicationNamespace;
  nativeCursor: number;
  applicationCursor: number;
}

const IDENTITY_FIELDS = ["mode", "epochId", "snapshotId", "transactionId", "providerLineageId", "replicaCheckpointDigest",
  "transitionReceiptId", "activeProviderId", "activeProviderLineageId"] as const;

export function bindHindsightRuntimeAuthority(db: Database, epochId: string) {
  const identity = readCurrentMemoryAuthorityIdentity(db);
  if (identity.mode !== "hindsight" || identity.epochId !== epochId) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  const floors = readVerifiedFloors(db, identity.transitionReceiptId ?? null);
  requireTransitionTargetReady(db, epochId);
  return {
    assertIdentity: () => {
      const current = readCurrentMemoryAuthorityIdentity(db);
      if (IDENTITY_FIELDS.some((key) => (current[key] ?? null) !== (identity[key] ?? null))) {
        throw new Error("MEMORY_AUTHORITY_MISMATCH");
      }
    },
    assertCheckpointFloors: () => {
      for (const floor of floors) assertCheckpointFloor(db, epochId, floor);
    },
  };
}

function readVerifiedFloors(db: Database, receiptId: string | null): CheckpointFloor[] {
  if (receiptId === null) { readMemoryAuthoritySelection(db); return []; }
  const publication = readVerifiedTransitionPublication(db, receiptId);
  if (publication.version !== 1) throw new Error("MEMORY_AUTHORITY_MISMATCH");
  // The full reader has already verified each current namespace against its saved native evidence.
  return publication.checkpoints.map((saved) => {
    const current = readApplicationCheckpoint(db, saved.bankId);
    if (!current) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
    return { bankId: saved.bankId, namespace: current.namespace,
      nativeCursor: saved.nativeCursor, applicationCursor: saved.applicationCursor };
  });
}

function assertCheckpointFloor(db: Database, epochId: string, floor: CheckpointFloor): void {
  const current = readApplicationCheckpoint(db, floor.bankId);
  if (!current || current.authorityEpochId !== epochId || current.bankDeleted
    || current.checkpoint.native_cursor < floor.nativeCursor || current.checkpoint.state_cursor < floor.applicationCursor
    || !sameApplicationValue(current.namespace, floor.namespace)
    || !sameApplicationValue(current.native, readReplicaCheckpoint(db, floor.bankId))) {
    throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  }
}
