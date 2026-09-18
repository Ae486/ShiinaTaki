import { afterEach, describe, expect, it } from "vitest";
import { createMemoryOperationRepo, type MemoryOperationRepo } from "./memory-operation-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  let now = "2026-09-19T00:00:00.000Z";
  const repo = createMemoryOperationRepo(db, () => now);
  return { db, repo, advance: (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString(); } };
}
function admit(repo: MemoryOperationRepo, operationId: string, options: { bankId?: string; bootId?: string } = {}) {
  const { bankId = "global", bootId = "boot-a" } = options;
  return repo.insertAdmitted({ operationId, kind: "replica.sync", family: `replica:${bankId}`, authorityEpochId: "epoch", bootId,
    request: { kind: "replica.sync", bankId, syncKind: "incremental" }, producer: { kind: "replica", bankId, admittedAt: "2026-09-19T00:00:00.000Z" } });
}

describe("memory operation repo", () => {
  it("admits one active operation per family and reports the active one on conflict", () => {
    const { repo } = fixture();
    const first = admit(repo, ids[0]!);
    expect(first).toMatchObject({ state: "admitted", producer: { kind: "replica", bankId: "global" }, result: null, terminalAt: null });
    expect(() => admit(repo, ids[1]!)).toThrow("MEMORY_OPERATION_BUSY");
    expect(repo.activeInFamily("replica:global")?.operationId).toBe(ids[0]);
    expect(admit(repo, ids[1]!, { bankId: "character" }).operationId).toBe(ids[1]);
    expect(repo.listActive().map((operation) => operation.operationId)).toEqual([ids[0], ids[1]]);
  });

  it("transitions by state CAS, seals terminal rows, and orders recent rows newest first", () => {
    const { repo, advance } = fixture();
    admit(repo, ids[0]!);
    expect(() => repo.transition({ operationId: ids[0]!, expectedState: "running", patch: { state: "completed" } })).toThrow("MEMORY_OPERATION_STATE_CONFLICT");
    const running = repo.transition({ operationId: ids[0]!, expectedState: "admitted", patch: { state: "running" } });
    expect(running).toMatchObject({ state: "running", terminalAt: null, producer: { kind: "replica" } });
    advance(1_000);
    const done = repo.transition({ operationId: ids[0]!, expectedState: "running", patch: { state: "failed", reason: "producer_failed",
      errorCode: "HINDSIGHT_UNREACHABLE", result: { kind: "replica", errorCode: "HINDSIGHT_UNREACHABLE", nextAction: "automatic_retry_scheduled", lastSuccessAt: null } } });
    expect(done).toMatchObject({ state: "failed", terminalAt: "2026-09-19T00:00:01.000Z", errorCode: "HINDSIGHT_UNREACHABLE" });
    expect(() => repo.transition({ operationId: ids[0]!, expectedState: "failed", patch: { state: "completed" } })).toThrow("MEMORY_OPERATION_STATE_CONFLICT");
    expect(() => repo.transition({ operationId: ids[2]!, expectedState: "admitted", patch: { state: "running" } })).toThrow("MEMORY_OPERATION_NOT_FOUND");
    advance(1_000);
    admit(repo, ids[1]!);
    repo.transition({ operationId: ids[1]!, expectedState: "admitted", patch: { state: "cancelled", reason: "cancelled_before_claim" } });
    expect(repo.listRecent(10).map((operation) => operation.operationId)).toEqual([ids[1], ids[0]]);
    expect(repo.listRecent(1)).toHaveLength(1);
    expect(repo.get(ids[0]!)).toEqual(done);
    expect(repo.activeInFamily("replica:global")).toBeUndefined();
  });

  it("reconciles only rows owned by another boot into outcome_unknown/core_restart", () => {
    const { repo, advance } = fixture();
    admit(repo, ids[0]!, { bootId: "boot-a" });
    admit(repo, ids[1]!, { bankId: "character", bootId: "boot-b" });
    advance(5_000);
    const reconciled = repo.reconcileForeign("boot-b");
    expect(reconciled.map((operation) => operation.operationId)).toEqual([ids[0]]);
    expect(reconciled[0]).toMatchObject({ state: "outcome_unknown", reason: "core_restart", terminalAt: "2026-09-19T00:00:05.000Z" });
    expect(repo.get(ids[1]!)?.state).toBe("admitted");
    expect(repo.reconcileForeign("boot-b")).toEqual([]);
    expect(admit(repo, ids[2]!, { bootId: "boot-b" }).state).toBe("admitted");
  });
});
