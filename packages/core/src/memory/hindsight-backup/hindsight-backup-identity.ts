/**
 * INPUT:  a committed Hindsight marker, the published runtime's identity/Bank set and Core SQLite
 * OUTPUT: readHindsightBackupIdentity() — authority, per-Bank checkpoints, terminal-operation ids and migration head read in
 *         one SQLite transaction immediately before the Core copy; migrationHead() for any Core copy
 * POS:    core/memory/hindsight-backup — capture step 3 (§5.2); read-only; a later foreground pull may only raise the copy's
 *         checkpoints above these values, so they are lower bounds the native side must still meet
 */
import type { HindsightBackupBank, HindsightBackupManifest, MemoryReplicaBank } from "@taki/shared";
import { applicationCheckpointHash, readApplicationCheckpoint } from "../../db/hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "../../db/hindsight-replica-checkpoint-store.ts";
import type { Database } from "../../db/sqlite.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import type { MemoryAuthorityVerification } from "../runtime-authority-verification.ts";
import type { MemoryOperationsRuntime } from "../operations/memory-operation-contract.ts";
import { hindsightBackupOperationDigest, type HindsightBackupCoreIdentityV1 } from "./hindsight-backup-pair.ts";
import { readHindsightTerminalOperations } from "./hindsight-backup-receipts.ts";

export type HindsightBackupRuntimeIdentity = Pick<MemoryOperationsRuntime, "epochId" | "configFingerprint" | "deploymentMode" | "banks">;
export interface HindsightBackupIdentity {
  core: HindsightBackupCoreIdentityV1;
  operationIds: string[];
  migrationHead: number;
}

export function readHindsightBackupIdentity(db: Database, runtime: HindsightBackupRuntimeIdentity,
  verifySelectedAuthority?: MemoryAuthorityVerification["verifySelectedAuthority"]): HindsightBackupIdentity {
  let identity: HindsightBackupIdentity | undefined;
  db.transaction(() => { identity = readIdentity(db, runtime, verifySelectedAuthority); });
  if (!identity) throw new Error("HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED");
  return identity;
}

function readIdentity(db: Database, runtime: HindsightBackupRuntimeIdentity,
  verifySelectedAuthority?: MemoryAuthorityVerification["verifySelectedAuthority"]): HindsightBackupIdentity {
  const selection = verifySelectedAuthority?.() ?? readMemoryAuthoritySelection(db);
  const { epochId, transactionId, transitionReceiptId, providerLineageId, replicaCheckpointDigest } = selection;
  if (selection.mode !== "hindsight" || epochId !== runtime.epochId || (!transactionId && !transitionReceiptId) || !providerLineageId || !replicaCheckpointDigest) {
    throw new Error("MEMORY_AUTHORITY_MISMATCH");
  }
  const banks = runtime.banks().map((bank) => readBank(db, bank));
  const generations = new Map(banks.flatMap((bank) => bank.bankGeneration === null ? [] : [[bank.nativeBankId, bank.bankGeneration] as const]));
  const operationIds = readHindsightTerminalOperations(db, { epochId, providerLineageId, generations });
  const authority: HindsightBackupManifest["authority"] = { epochId, activationTransactionId: transactionId, providerLineageId,
    replicaCheckpointDigest, configFingerprint: runtime.configFingerprint, deploymentMode: runtime.deploymentMode,
    ...(transitionReceiptId ? { transitionReceiptId } : {}) };
  return { core: { version: 1, authority, banks, terminalOperations: { count: new Set(operationIds).size, digest: hindsightBackupOperationDigest(operationIds) } },
    operationIds: [...new Set(operationIds)], migrationHead: migrationHead(db) };
}

function readBank(db: Database, bank: MemoryReplicaBank): HindsightBackupBank {
  const replica = readReplicaCheckpoint(db, bank.bankId);
  const application = readApplicationCheckpoint(db, bank.bankId);
  return {
    bankId: bank.scope === "global" ? "global" : `character:${bank.characterId}`, nativeBankId: bank.bankId,
    scope: bank.scope, characterId: bank.characterId, bankGeneration: replica?.bankGeneration ?? null,
    core: { replicaCursor: replica?.endCursor ?? null,
      applicationNativeCursor: application?.checkpoint.native_cursor ?? null, applicationStateCursor: application?.checkpoint.state_cursor ?? null,
      checkpointHash: application ? applicationCheckpointHash(application) : null },
  };
}

/** The Core schema version a copy of this database carries. */
export function migrationHead(db: Database): number {
  const version = db.prepare("SELECT max(version) AS version FROM migrations").get()?.version;
  if (typeof version !== "number") throw new Error("HINDSIGHT_BACKUP_CORE_CAPTURE_FAILED");
  return version;
}
