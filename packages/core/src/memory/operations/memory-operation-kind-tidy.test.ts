import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation, MemoryTidyOutcome, MemoryTidyProgress } from "@taki/shared";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { createLogger } from "../../logging/logger.ts";
import { fakeSetup } from "./memory-operation-fixtures.ts";
import { createMemoryOperationService } from "./memory-operation-service.ts";
import { createTidyOperationAdapter } from "./tidy-operation-adapter.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const outcome = (status: MemoryTidyOutcome["status"] = "ran"): MemoryTidyOutcome => ({
  status, defects: { missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 2 },
  edits: 1, steps: 2, reviewed: 2, remaining: 0,
  usage: { calls: 1, inputTokens: 20, outputTokens: 10, usageUnknown: 0 },
  ...(status === "partial" ? { reason: "tool-errors", nextAction: "retry" } as const : {}),
});
const progress: MemoryTidyProgress = { edits: 1, steps: 1, reviewed: 0, remaining: 2 };

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  db.exec("CREATE TABLE tidy_probe (id INTEGER PRIMARY KEY)");
  const changes: MemoryOperation[] = [];
  let release!: (result: MemoryTidyOutcome) => void;
  let report!: (value: MemoryTidyProgress) => void;
  const runNow = vi.fn((_character: string, options?: { onProgress?: (value: MemoryTidyProgress) => void }) => {
    report = (value) => { options?.onProgress?.(value); };
    return new Promise<MemoryTidyOutcome>((resolve) => { release = resolve; });
  });
  const input = { db, live: () => null, tidy: () => ({ authorityEpochId: null, runNow }), setup: fakeSetup(),
    bootId: "tidy-boot", onChanged: (operation: MemoryOperation) => { changes.push(operation); }, logger: createLogger("fatal") };
  const service = createMemoryOperationService(input);
  return { db, service, changes, runNow, input, release: (value = outcome()) => { release(value); }, report: (value = progress) => { report(value); } };
}

describe("durable tidy operation", () => {
  it("joins manual compatibility requests with the admitted operation and retains partial outcomes", async () => {
    const f = fixture();
    const adapter = createTidyOperationAdapter(f.service, () => null);
    const first = f.service.submit({ kind: "tidy", characterId: "taki" });
    const joined = adapter.runNow("taki");
    expect(f.runNow).toHaveBeenCalledTimes(1);
    expect(first.state).toBe("admitted");
    f.report();
    expect(f.service.status(first.operationId)).toMatchObject({ state: "running", producer: { progress } });
    f.release(outcome("partial"));
    expect(await joined).toMatchObject({ status: "partial", edits: 1 });
    expect(await f.service.wait(first.operationId)).toMatchObject({ state: "failed", result: { kind: "tidy", outcome: { status: "partial" } } });
  });

  it("persists progress with the mutation and publishes only after its outer commit", async () => {
    const f = fixture();
    const operation = f.service.submit({ kind: "tidy", characterId: "taki" });
    const before = f.changes.length;
    f.db.transaction(() => {
      f.db.prepare("INSERT INTO tidy_probe VALUES (1)").run();
      f.report();
      expect(f.changes).toHaveLength(before);
    });
    expect(f.changes.length).toBeGreaterThan(before);
    const after = f.changes.length;
    expect(() => f.db.transaction(() => {
      f.report({ ...progress, edits: 2 });
      throw new Error("rollback");
    })).toThrow("rollback");
    expect(f.changes).toHaveLength(after);
    expect(f.service.status(operation.operationId).producer).toMatchObject({ progress });
    f.release();
    await f.service.stop();
  });

  it("does not borrow an active result from a different authority", async () => {
    const f = fixture();
    f.service.submit({ kind: "tidy", characterId: "taki" });
    const adapter = createTidyOperationAdapter(f.service, () => "new-authority");
    await expect(adapter.runNow("taki")).rejects.toMatchObject({ reason: "MEMORY_OPERATION_BUSY" });
    expect(f.runNow).toHaveBeenCalledTimes(1);
    f.release();
    await f.service.stop();
  });

  it("preserves committed progress after restart and refuses retired progress inside a mutation", async () => {
    const f = fixture();
    const first = f.service.submit({ kind: "tidy", characterId: "taki" });
    f.report();
    const restarted = createMemoryOperationService({ ...f.input, bootId: "next-boot" });
    expect(restarted.status(first.operationId)).toMatchObject({ state: "outcome_unknown", reason: "core_restart", producer: { progress } });
    expect(() => f.db.transaction(() => {
      f.db.prepare("INSERT INTO tidy_probe VALUES (2)").run();
      f.report({ ...progress, edits: 2 });
    })).toThrow();
    expect(f.db.prepare("SELECT count(*) AS count FROM tidy_probe").get()?.count).toBe(0);
    f.release();
    await f.service.stop();
    expect(restarted.status(first.operationId).state).toBe("outcome_unknown");
  });

  it("filters before limiting, so another kind or Character cannot hide the latest tidy", async () => {
    const f = fixture();
    const first = f.service.submit({ kind: "tidy", characterId: "taki" });
    f.release();
    await f.service.wait(first.operationId);
    const other = f.service.submit({ kind: "tidy", characterId: "other" });
    f.release();
    await f.service.wait(other.operationId);
    for (let i = 0; i < 22; i += 1) {
      const setup = f.service.submit({ kind: "setup.validate", expectedRevision: f.input.setup.status().revision });
      await f.service.wait(setup.operationId);
    }
    expect(f.service.list({ kind: "tidy", characterId: "taki", includeTerminal: true, limit: 1 }).map((value) => value.operationId)).toEqual([first.operationId]);
  });
});
