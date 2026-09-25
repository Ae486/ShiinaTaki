/**
 * INPUT:  backup.capture / backup.admit / backup.verify requests
 * OUTPUT: backupUnsupportedKind — refuses every backup kind MEMORY_OPERATION_UNSUPPORTED at admission (no row, no effect)
 * POS:    core/memory/operations — family hindsight-backup; holds the registry rows the Shared contract requires until the
 *         Stage 3 backup producers replace this handler (task 09-25-hindsight-backup-restore W2/W3)
 */
import type { MemoryOperationRequest } from "@taki/shared";
import { MemoryOperationRefusal, type MemoryOperationKindHandler } from "./memory-operation-contract.ts";

type BackupRequest = Extract<MemoryOperationRequest, { kind: "backup.capture" | "backup.admit" | "backup.verify" }>;

export const HINDSIGHT_BACKUP_FAMILY = "hindsight-backup";

export const backupUnsupportedKind: MemoryOperationKindHandler<BackupRequest> = {
  family: () => HINDSIGHT_BACKUP_FAMILY,
  admit: () => { throw new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED"); },
  // Unreachable: admission always refuses, so no row of this family ever executes.
  execute: () => Promise.resolve(null),
};
