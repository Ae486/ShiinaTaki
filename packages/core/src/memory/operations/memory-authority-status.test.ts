import { afterEach, describe, expect, it } from "vitest";
import { MemoryAuthorityStatusSchema } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createLogger } from "../../logging/logger.ts";
import { AT, CHARACTER, GLOBAL, fakeRuntime, fakeSetup, seedHindsightAuthority, type FakeRuntime } from "./memory-operation-fixtures.ts";
import { readMemoryAuthorityStatus } from "./memory-authority-status.ts";
import { createMemoryOperationService } from "./memory-operation-service.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function fixture(mode: "canonical-local" | "hindsight", runtime: FakeRuntime | null) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  db.prepare("UPDATE memory_authority_selection SET mode='canonical-local',active_epoch_id='epoch',verified_snapshot_id='snapshot',activation_transaction_id='tx' WHERE singleton=1").run();
  if (mode === "hindsight") seedHindsightAuthority(db);
  const setup = fakeSetup();
  const operations = createMemoryOperationService({ db, live: () => runtime, setup, bootId: "boot", now: () => AT, onChanged: () => undefined, logger: createLogger("fatal") });
  return { db, setup, operations, read: () => readMemoryAuthorityStatus({ db, live: () => runtime, setup, operations, now: () => AT }) };
}

describe("memory.authority.status read", () => {
  it("reports Local authority with null replica/pending evidence and the literal unknown freshness", () => {
    const f = fixture("canonical-local", null);
    const status = f.read();
    expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({ authority: { mode: "canonical-local", epochId: "epoch", providerLineageId: null },
      runtime: { providerId: "local", available: true, unavailableReason: null }, replica: null, pending: null,
      operations: { active: [], recent: [] }, derivedFreshness: "unknown", observedAt: AT, setup: { revision: 3 } });
  });

  it("reports per-Bank replica status and separate Pending/parent-write counts when the Hindsight runtime is live", async () => {
    const runtime = fakeRuntime([GLOBAL, CHARACTER], () => AT);
    const f = fixture("hindsight", runtime);
    const submitted = f.operations.submit({ kind: "replica.sync", bankId: "global", syncKind: "full" });
    await f.operations.stop();
    const status = f.read();
    expect(MemoryAuthorityStatusSchema.parse(status)).toEqual(status);
    expect(status.runtime).toEqual({ providerId: "hindsight", available: true, unavailableReason: null });
    expect(status.replica?.map((bank) => bank.bankId)).toEqual(["global", "character"]);
    expect(status.pending).toEqual([
      { bankId: "global", summary: expect.objectContaining({ pendingCount: 0, failedCount: 1, unknownCount: 2 }), parentWritesPending: 0 },
      { bankId: "character", summary: expect.objectContaining({ failedCount: 1 }), parentWritesPending: 0 },
    ]);
    expect(status.operations.active).toEqual([]);
    expect(status.operations.recent.map((operation) => [operation.operationId, operation.state])).toEqual([[submitted.operationId, "completed"]]);
  });

  it("keeps the read successful with a closed reason when the runtime is unavailable or not installed", () => {
    const runtime = fakeRuntime([GLOBAL], () => AT);
    const f = fixture("hindsight", runtime);
    runtime.breakConnection("MEMORY_AUTHORITY_MISMATCH");
    expect(f.read()).toMatchObject({ runtime: { available: false, unavailableReason: "authority_mismatch" }, replica: null, pending: null });
    runtime.breakConnection("MEMORY_OPERATION_CANCELLED");
    expect(f.read().runtime.unavailableReason).toBe("stopped");
    runtime.breakConnection("HINDSIGHT_APPLICATION_CONNECTION_UNAVAILABLE");
    expect(f.read().runtime.unavailableReason).toBe("connection_unavailable");
    expect(fixture("hindsight", null).read()).toMatchObject({ runtime: { providerId: "hindsight", available: false, unavailableReason: "not_installed" }, replica: null });
  });
});
