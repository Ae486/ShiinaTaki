import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memoryWriteFixture, writeTestRetain, WRITE_TEST_AT, WRITE_TEST_MEMORY } from "../memory/hindsight/hindsight-memory-write-fixtures.ts";
import { readTransitionTargetReceipt } from "./memory-transition-effect-repo.ts";

describe("transition factual native target receipt lookup", () => {
  it("distinguishes actual completed policy writes and superseded CAS refusal without claiming the stale edit applied", async () => {
    const f = memoryWriteFixture();
    try {
      for (const expectedRevision of [1, 2]) {
        const requestId = randomUUID(); const request = { kind: "edit" as const, bankId: f.route.bankId,
          memoryId: WRITE_TEST_MEMORY, expectedRevision, patch: { layerId: "profile" } };
        const result = await f.writes.mutate(f.call(requestId), request);
        expect(result.outcome).toBe(expectedRevision === 1 ? "applied" : "superseded");
        const receipt = readTransitionTargetReceipt(f.base.db, { provider: "hindsight", command: { kind: "mutation", request },
          execution: { intentId: randomUUID(), replayId: randomUUID(), targetRequestId: requestId, targetEpochId: "epoch",
            targetBankId: f.route.bankId, targetLogicalId: WRITE_TEST_MEMORY, expectedRevision, mappingHash: "a".repeat(64), preparedAt: WRITE_TEST_AT } });
        expect(receipt?.outcome).toMatchObject(expectedRevision === 1 ? { status: "completed", result: { kind: "mutation", memoryId: WRITE_TEST_MEMORY, revision: 1 } }
          : { status: "failed", errorCode: "MEMORY_REVISION_MISMATCH" });
      }
      expect(f.native.calls).toEqual([]);
    } finally { await f.close(); }
  });

  it("recognizes a real completed retain only after native and policy producers finish the original parent", async () => {
    const f = memoryWriteFixture();
    try {
      const requestId = randomUUID(); const request = writeTestRetain();
      const input = { provider: "hindsight" as const, command: { kind: "retain" as const, request }, execution: {
        intentId: randomUUID(), replayId: randomUUID(), targetRequestId: requestId, targetEpochId: "epoch", targetBankId: f.route.bankId,
        targetLogicalId: request.documentId!, expectedRevision: null, mappingHash: "a".repeat(64), preparedAt: WRITE_TEST_AT } };
      await f.writes.retain(f.call(requestId), request);
      expect(readTransitionTargetReceipt(f.base.db, input)).toBeUndefined();
      f.control.replayNative = true;
      const result = await f.writes.retain(f.call(requestId), request);
      expect(result.status).toBe("completed");
      expect(readTransitionTargetReceipt(f.base.db, input)?.outcome).toMatchObject({ status: "completed", result: { kind: "retain", value: result } });
    } finally { await f.close(); }
  });
});
