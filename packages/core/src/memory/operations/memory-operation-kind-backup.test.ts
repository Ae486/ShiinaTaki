import { describe, expect, it } from "vitest";
import type { MemoryOperationContext } from "./memory-operation-contract.ts";
import { MemoryOperationRefusal } from "./memory-operation-contract.ts";
import { backupUnsupportedKind, HINDSIGHT_BACKUP_FAMILY } from "./memory-operation-kind-backup.ts";
import { backupCaptureKind } from "./memory-operation-kind-backup-capture.ts";
import { MEMORY_OPERATION_KINDS } from "./memory-operation-kinds.ts";

describe("backup kinds before the admit/verify producers exist", () => {
  it("registers capture with its producer and refuses admit/verify at admission, all in family hindsight-backup", () => {
    expect(MEMORY_OPERATION_KINDS["backup.capture"]).toBe(backupCaptureKind);
    expect(backupCaptureKind.family({ kind: "backup.capture", expectedEpochId: "epoch" })).toBe(HINDSIGHT_BACKUP_FAMILY);
    const requests = [
      { kind: "backup.admit", expectedEpochId: "epoch", fileName: "b.zip" },
      { kind: "backup.verify", backupId: "11111111-1111-4111-8111-111111111111" },
    ] as const;
    for (const request of requests) {
      expect(MEMORY_OPERATION_KINDS[request.kind]).toBe(backupUnsupportedKind);
      expect(backupUnsupportedKind.family(request)).toBe(HINDSIGHT_BACKUP_FAMILY);
      expect(() => backupUnsupportedKind.admit(request, {} as MemoryOperationContext, { origin: "operator" }))
        .toThrow(new MemoryOperationRefusal("MEMORY_OPERATION_UNSUPPORTED"));
    }
  });
});
