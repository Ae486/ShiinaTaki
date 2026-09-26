/**
 * INPUT:  the memory authority fixtures (hindsightStatus / lifecycleSection / bankStatus) and hand-built backup.* rows
 * OUTPUT: backupSection() / backupOperation() / backupStatus() plus one MemoryAuthorityStatus per backup block state (none,
 *         unknown, verified, in flight, failed with a code, route unavailable, route-b staged, rollback detected)
 * POS:    ui/windows/home/pages/operations — test support only; not in the production path
 */
import type { HindsightBackupStatusSection, MemoryAuthorityStatus, MemoryBackupErrorCode, MemoryOperation } from "@taki/shared";
import { AT, bankStatus, hindsightStatus, lifecycleSection } from "./memory-authority-fixtures.ts";

export const BACKUP_ID = "44444444-4444-4444-8444-444444444444";
export const STAGED_ID = "55555555-5555-4555-8555-555555555555";
const LATER = "2026-09-19T01:00:00.000Z";

export function backupSection(patch: Partial<HindsightBackupStatusSection> = {}): HindsightBackupStatusSection {
  return {
    lastVerified: { backupId: BACKUP_ID, createdAt: AT, verifiedAt: AT, nativeCursors: [{ bankId: "global", currentCursor: 40 }] },
    ageSeconds: 2 * 3_600 + 59,
    missingInterval: [
      { bankId: "global", fromNativeCursor: 40, toReplicaCursor: 52, pendingCount: 1 },
      { bankId: "character-taki", fromNativeCursor: null, toReplicaCursor: null, pendingCount: null },
    ],
    ...patch,
  };
}

export const NO_BACKUP = backupSection({ lastVerified: null, ageSeconds: null,
  missingInterval: [{ bankId: "global", fromNativeCursor: null, toReplicaCursor: 52, pendingCount: 0 }] });

/** A settled or running backup.* row; `patch` supplies kind/request and the terminal fields together. */
export function backupOperation(patch: Partial<MemoryOperation> = {}): MemoryOperation {
  return {
    operationId: "66666666-6666-4666-8666-666666666666", kind: "backup.capture", state: "running", reason: null, authorityEpochId: "epoch-2",
    request: { kind: "backup.capture", expectedEpochId: "epoch-2", route: "native-endpoint" },
    producer: { kind: "backup", backupId: BACKUP_ID, phase: "capturing-native" }, result: null, errorCode: null,
    createdAt: AT, updatedAt: AT, terminalAt: null, ...patch,
  };
}

export function failedCapture(errorCode: MemoryBackupErrorCode, createdAt = AT): MemoryOperation {
  return backupOperation({ operationId: "77777777-7777-4777-8777-777777777777", state: "failed", reason: "producer_failed", errorCode,
    producer: { kind: "backup", backupId: BACKUP_ID, phase: "capturing-native" }, createdAt, updatedAt: createdAt, terminalAt: createdAt });
}

export function stagedCapture(): MemoryOperation {
  return backupOperation({
    operationId: "88888888-8888-4888-8888-888888888888", state: "completed", createdAt: LATER, updatedAt: LATER, terminalAt: LATER,
    request: { kind: "backup.capture", expectedEpochId: "epoch-2", route: "operator-artifact" },
    producer: { kind: "backup", backupId: STAGED_ID, phase: "completed" },
    result: { kind: "backup", backupId: STAGED_ID, verifiedAt: null, mismatch: null },
  });
}

/** Under the lifecycle fixture's Banks, so interval rows resolve Global and Character · taki from native Bank ids. */
export function backupStatus(backup: HindsightBackupStatusSection | null, operations: MemoryOperation[] = [],
  patch: Partial<MemoryAuthorityStatus> = {}): MemoryAuthorityStatus {
  return hindsightStatus({
    hindsight: lifecycleSection({ actions: { revalidate: false, provision: [] }, backup }),
    operations: { active: operations.filter((operation) => operation.terminalAt === null), recent: operations.filter((operation) => operation.terminalAt !== null) },
    ...patch,
  });
}

export const ROLLBACK_REPLICA = bankStatus("global", { mode: "failed", automatic: false, errorCode: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED",
  nextAction: "explicit_retry_required" });

/** One status per backup block state, named for the state it renders. */
export const BACKUP_STATES = {
  unknown: backupStatus(null),
  none: backupStatus(NO_BACKUP),
  verified: backupStatus(backupSection()),
  capturing: backupStatus(backupSection(), [backupOperation()]),
  failed: backupStatus(backupSection(), [{ ...failedCapture("HINDSIGHT_BACKUP_PAIR_MISMATCH"),
    result: { kind: "backup", backupId: BACKUP_ID, verifiedAt: null, mismatch: { reason: "receipt_missing", bankId: "global" } } }]),
  routeUnavailable: backupStatus(NO_BACKUP, [failedCapture("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE")]),
  staged: backupStatus(NO_BACKUP, [stagedCapture(), failedCapture("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE")]),
  rollback: backupStatus(backupSection(), [], { replica: [ROLLBACK_REPLICA] }),
} satisfies Record<string, MemoryAuthorityStatus>;
