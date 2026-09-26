import { describe, expect, it } from "vitest";
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import { backupRef, cancelBeforeClaim, HINDSIGHT_BACKUP_FAMILY, interrupted, settleBackup } from "./memory-operation-kind-backup.ts";
import { backupAdmitKind } from "./memory-operation-kind-backup-admit.ts";
import { backupCaptureKind } from "./memory-operation-kind-backup-capture.ts";
import { backupVerifyKind } from "./memory-operation-kind-backup-verify.ts";
import { MEMORY_OPERATION_KINDS } from "./memory-operation-kinds.ts";

const BACKUP_ID = "11111111-1111-4111-8111-111111111111";
const REF = { kind: "backup", backupId: BACKUP_ID, phase: "reserved" } as const;

describe("backup kinds", () => {
  it("registers capture, admit and verify with their producers, all in family hindsight-backup", () => {
    const rows = [
      [backupCaptureKind, { kind: "backup.capture", expectedEpochId: "epoch" }],
      [backupAdmitKind, { kind: "backup.admit", expectedEpochId: "epoch", backupId: BACKUP_ID, fileName: "b.zip" }],
      [backupVerifyKind, { kind: "backup.verify", backupId: BACKUP_ID }],
    ] as const;
    for (const [kind, request] of rows) {
      expect(MEMORY_OPERATION_KINDS[request.kind]).toBe(kind);
      expect((kind.family as (request: MemoryOperationRequest) => string)(request)).toBe(HINDSIGHT_BACKUP_FAMILY);
    }
  });

  it("settles an outcome with its mismatch in the result and the last checkpointed phase", async () => {
    const checkpoints: unknown[] = [];
    const execution = { checkpoint: (ref: unknown) => { checkpoints.push(ref); } };
    const failed = await settleBackup(execution, { ref: REF, run: async (checkpoint) => {
      checkpoint("verifying");
      return { ok: false, code: "HINDSIGHT_BACKUP_PAIR_MISMATCH", mismatch: { reason: "receipt_missing", bankId: null } };
    } });
    expect(failed).toEqual({ state: "failed", reason: "producer_failed", errorCode: "HINDSIGHT_BACKUP_PAIR_MISMATCH", producer: { ...REF, phase: "verifying" },
      result: { kind: "backup", backupId: BACKUP_ID, verifiedAt: null, mismatch: { reason: "receipt_missing", bankId: null } } });
    expect(checkpoints).toEqual([{ ...REF, phase: "verifying" }]);
    const refused = await settleBackup(execution, { ref: REF, run: async () => ({ ok: false, code: "MEMORY_AUTHORITY_MISMATCH", mismatch: null }) });
    expect(refused).toMatchObject({ reason: "producer_refused", result: null });
    const done = await settleBackup(execution, { ref: REF, run: async () => ({ ok: true, verifiedAt: null }) });
    expect(done).toMatchObject({ state: "completed", producer: { phase: "completed" }, result: { verifiedAt: null, mismatch: null } });
  });

  it("cancels only an admitted row and settles a restart as outcome_unknown", () => {
    const row = { state: "running", producer: REF } as MemoryOperation;
    expect(() => cancelBeforeClaim(row)).toThrow("MEMORY_OPERATION_RUNNING");
    expect(() => cancelBeforeClaim({ ...row, state: "admitted" })).not.toThrow();
    expect(interrupted(row)).toEqual({ state: "outcome_unknown", reason: "producer_incomplete", errorCode: null, result: null, producer: REF });
    expect(() => backupRef(null)).toThrow("MEMORY_OPERATION_PRODUCER_MISMATCH");
  });
});
