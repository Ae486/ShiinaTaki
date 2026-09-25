import { describe, expect, it } from "vitest";
import type { MemoryOperationContext } from "./memory-operation-contract.ts";
import { MemoryOperationRefusal } from "./memory-operation-contract.ts";
import { backupUnsupportedKind, HINDSIGHT_BACKUP_FAMILY } from "./memory-operation-kind-backup.ts";
import { MEMORY_OPERATION_KINDS } from "./memory-operation-kinds.ts";

describe("backup kinds before their producers exist", () => {
  it("registers all three kinds in family hindsight-backup and refuses each at admission", () => {
    const requests = [
      { kind: "backup.capture", expectedEpochId: "epoch" },
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
