import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createHindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";

const databases: Database[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-09-13T00:00:00.000Z"); });
afterEach(() => { for (const db of databases.splice(0)) db.close(); vi.useRealTimers(); });
function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const repo = createHindsightReplicaLeaseRepo(db, () => new Date().toISOString());
  const lease = repo.acquire({ bankId: "bank", ownerId: "foreground", durationMs: 11_000 });
  const row = () => db.prepare("SELECT * FROM hindsight_replica_sync_leases WHERE bank_id='bank'").get();
  return { db, repo, lease, row };
}

describe("Hindsight Bank lease renewal", () => {
  it("changes only expiry under the same run, owner and fence and invalidates the old token", () => {
    const f = fixture(); const before = f.row(); const original = structuredClone(f.lease);
    vi.setSystemTime(Date.now() + 5000);
    const renewed = f.repo.renew({ lease: f.lease, durationMs: 11_000 });
    expect(renewed).toEqual({ ...original, expiresAt: new Date(Date.now() + 11_000).toISOString() });
    expect(f.lease).toEqual(original);
    expect(f.row()).toEqual({ ...before, expires_at: renewed.expiresAt });
    expect(() => f.repo.assert(renewed)).not.toThrow();
    expect(() => f.repo.assert(original)).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(() => f.repo.renew({ lease: original, durationMs: 11_000 })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.row()?.expires_at).toBe(renewed.expiresAt);
  });

  it.each(["bankId", "runId", "ownerId", "fence", "expiresAt"] as const)("refuses a changed %s without updating the current lease", (key) => {
    const f = fixture(); const before = f.row(); vi.setSystemTime(Date.now() + 1000);
    const stale = { ...f.lease, [key]: key === "fence" ? f.lease.fence + 1
      : key === "expiresAt" ? new Date(Date.parse(f.lease.expiresAt) + 1).toISOString()
        : key === "runId" ? "33333333-3333-4333-8333-333333333333" : "another-owner" };
    expect(() => f.repo.renew({ lease: stale, durationMs: 11_000 })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.row()).toEqual(before); expect(() => f.repo.assert(f.lease)).not.toThrow();
  });

  it("cannot revive an expired lease or replace its successor", () => {
    const f = fixture(); vi.setSystemTime(f.lease.expiresAt);
    expect(() => f.repo.renew({ lease: f.lease, durationMs: 11_000 })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    const replacement = f.repo.acquire({ bankId: "bank", ownerId: "successor", durationMs: 11_000 });
    const before = f.row();
    expect(() => f.repo.renew({ lease: f.lease, durationMs: 11_000 })).toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.row()).toEqual(before); expect(() => f.repo.assert(replacement)).not.toThrow();
  });

  it("rolls renewal back with its enclosing transaction", () => {
    const f = fixture(); const before = f.row(); vi.setSystemTime(Date.now() + 1000);
    expect(() => f.db.transaction(() => { f.repo.renew({ lease: f.lease, durationMs: 11_000 }); throw new Error("rollback"); }))
      .toThrow("rollback");
    expect(f.row()).toEqual(before); expect(() => f.repo.assert(f.lease)).not.toThrow();
  });
});
