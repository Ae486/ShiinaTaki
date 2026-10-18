/**
 * INPUT:  none — test-only builders for backup manifests, native proofs and Core Bank identities
 * OUTPUT: BACKUP_ID / LINEAGE / GENERATION constants, backupBank(), nativeProof(), backupManifest() used by the backup tests
 * POS:    core/memory/hindsight-backup — test support; not in the production path
 */
import type { HindsightBackupBank, HindsightBackupManifestV1, HindsightBackupNativeProofV1 } from "@taki/shared";
import { hindsightBackupOperationDigest } from "./hindsight-backup-pair.ts";

export const AT = "2026-09-26T00:00:00.000Z";
export const BACKUP_ID = "11111111-1111-4111-8111-111111111111";
export const LINEAGE = "22222222-2222-4222-8222-222222222222";
export const GENERATION = "33333333-3333-4333-8333-333333333333";
export const TERMINAL_IDS = ["write:a", "pending:b", "ingestion:c"];
const hex = (character: string) => character.repeat(64);

/** A Core Bank at replica cursor 10 with a D77 checkpoint at native 10 / state 4. */
export function backupBank(nativeBankId: string, characterId: string | null = null): HindsightBackupBank {
  return {
    bankId: `core-${nativeBankId}`, nativeBankId, scope: characterId === null ? "global" : "character", characterId,
    bankGeneration: GENERATION,
    core: { replicaCursor: 10, applicationNativeCursor: 10, applicationStateCursor: 4, checkpointHash: hex("d") },
  };
}

/** The native side exactly equal to backupBank() for each id, answering membership for TERMINAL_IDS with nothing missing. */
export function nativeProof(nativeBankIds: readonly string[], patch: Partial<HindsightBackupNativeProofV1> = {}): HindsightBackupNativeProofV1 {
  return {
    providerLineage: LINEAGE, alembicRevision: "a1b2c3d4e5f6", upstreamCommit: "0123456789abcdef", compatibilityBuild: "taki-build",
    banks: nativeBankIds.map((bankId) => ({
      bankId, bankGeneration: GENERATION, currentCursor: 10, minimumAvailableCursor: 0, application: { nativeCursor: 10, stateCursor: 4 },
    })),
    receipts: { count: TERMINAL_IDS.length, digest: hindsightBackupOperationDigest(TERMINAL_IDS), missingCount: 0, missingSample: [] },
    zipSha256: hex("e"), zipBytes: 4096, ...patch,
  };
}

export function backupManifest(core: { sha256: string; bytes: number; pages: number }, patch: Partial<HindsightBackupManifestV1> = {}): HindsightBackupManifestV1 {
  const banks = [backupBank("taki-hs-g"), backupBank("taki-hs-c", "taki")];
  return {
    version: 1, backupId: BACKUP_ID, createdAt: AT, operationId: "44444444-4444-4444-8444-444444444444", route: "native-endpoint",
    core: { file: "core.sqlite", ...core, migrationHead: 50 },
    native: { location: "native-host", file: "/var/lib/hindsight/backups/b.zip", nativeManifestVersion: "2", schema: "public",
      proof: nativeProof(banks.map((bank) => bank.nativeBankId)) },
    authority: { epochId: "epoch-h", activationTransactionId: "tx-1", providerLineageId: LINEAGE, replicaCheckpointDigest: hex("c"),
      configFingerprint: hex("f"), deploymentMode: "existing-instance" },
    banks,
    terminalOperations: { count: TERMINAL_IDS.length, digest: hindsightBackupOperationDigest(TERMINAL_IDS) },
    custody: { storeId: "host-1", connectionMarker: hex("a"), refs: [
      { ref: "memory.hindsight.connection.api-key", present: true, health: "ok", keyVersion: 1, updatedAt: AT },
    ] },
    sensitive: true, verifiedAt: AT, ...patch,
  };
}
