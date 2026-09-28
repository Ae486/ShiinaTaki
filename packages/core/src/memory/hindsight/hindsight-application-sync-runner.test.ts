import { afterEach, describe, expect, it, vi } from "vitest";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { curatorTestRemotePolicy } from "./hindsight-policy-curator-fixtures.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";

const fixtures: ReturnType<typeof hindsightRuntimeFixture>[] = [];
afterEach(async () => { for (const value of fixtures.splice(0)) await value.close(); });
function fixture() { const value = hindsightRuntimeFixture(); fixtures.push(value); return value; }
function hideMemory(f: ReturnType<typeof fixture>) {
  const bank = f.banks[0]!;
  curatorTestRemotePolicy(bank, "memory-a", (body) => ({ ...body, policy_basis: "curated",
    policy: { ...body.policy, visibility: "hidden", policyVersion: body.policy.policyVersion + 1 } }));
  return bank;
}

describe("application-aware snapshot and replay integration", () => {
  it("rebuilds after an authenticated replay floor reset while retaining the real native baseline identity", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    vi.spyOn(f.remote.client, "applicationChanges").mockRejectedValueOnce(new HindsightApplicationRefusal({
      error: "application_state_error", code: "state_reset_required", detail: "owned replay floor",
      checkpoint: bank.events[0]!.manifest.to_checkpoint, minimum_state_cursor: 1 }));
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const after = f.replica.checkpoint(bank.scope.bankId)!;
    expect(snapshot).toHaveBeenCalledOnce(); expect(after.checkpoint.state_cursor).toBe(1);
    expect(after.native.snapshotId).toBe(before.native.snapshotId);
    expect(after.native.snapshotManifestDigest).toBe(before.native.snapshotManifestDigest);
    expect(after.native.manifestDigest).not.toBe(before.native.manifestDigest);
    expect(after.snapshot.id).not.toBe(before.snapshot.id);
    expect(f.replica.search({ ...bank.scope, query: "fact", limit: 10 })).toEqual([]);
    expect(f.replica.record({ ...bank.scope, memoryId: "memory-a", includeHidden: true })?.policy.visibility).toBe("hidden");
  });

  it("refuses a native head behind its own checkpoint as a rollback without rebuilding the replica", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    expect(before.checkpoint.state_cursor).toBeGreaterThan(0);
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    vi.spyOn(f.remote.client, "applicationChanges").mockRejectedValueOnce(new HindsightApplicationRefusal({
      error: "application_state_error", code: "state_reset_required", detail: "restored behind",
      checkpoint: { native_cursor: 0, state_cursor: before.checkpoint.state_cursor - 1 }, minimum_state_cursor: 0 }));
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } }))
      .rejects.toMatchObject({ code: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED", providerLineageId: before.namespace.provider_lineage,
        bankGeneration: before.namespace.bank_generation });
    expect(snapshot).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
  });

  // A native-only restore leaves the application state cursor equal, so each cursor must refuse on its own.
  it.each(["state", "native"] as const)("refuses an explicit full run with only the %s cursor behind as a rollback before any snapshot", async (cursor) => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } });
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const current = cursor === "state" ? before.checkpoint.state_cursor : before.checkpoint.native_cursor;
    expect(current).toBeGreaterThan(0);
    expect(bank.server.cursor).toEqual({ native: before.checkpoint.native_cursor, state: before.checkpoint.state_cursor });
    const snapshot = vi.spyOn(f.remote.client, "createApplicationSnapshot");
    const full = () => {
      const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "explicit-full", durationMs: 30_000 });
      return subsystem.state.sync.run({ bank: { bankId: bank.scope.bankId, scope: "global", characterId: null },
        run: { lease, kind: "full", trigger: "manual", predecessor: before.native }, signal: new AbortController().signal,
        deadlineAt: new Date(Date.now() + 30_000).toISOString() }).finally(() => f.replica.leases.release(lease));
    };
    bank.server.cursor[cursor] = current - 1;
    await expect(full()).rejects.toMatchObject({ code: "HINDSIGHT_PROVIDER_ROLLBACK_DETECTED",
      providerLineageId: before.namespace.provider_lineage, bankGeneration: before.namespace.bank_generation });
    expect(snapshot).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    bank.server.cursor[cursor] = current;
    await full();
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it.each(["event-hash", "namespace"] as const)("refuses corrupt %s without publishing part of its checkpoint", async (failure) => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    const before = f.replica.checkpoint(bank.scope.bankId)!; const changes = f.remote.client.applicationChanges;
    vi.spyOn(f.remote.client, "applicationChanges").mockImplementation(async (input) => {
      const page = await changes(input);
      return failure === "namespace" ? { ...page, namespace: { ...page.namespace, bank_generation: "44444444-4444-4444-8444-444444444444" } }
        : { ...page, changes: page.changes.map((event) => ({ ...event, event_hash: "0".repeat(64) })) };
    });
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 30_000 } })).rejects.toThrow();
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    expect(f.replica.record({ ...bank.scope, memoryId: "memory-a" })?.policy.visibility).toBe("retrieved");
  });

  it("refuses downloaded event publication after its captured Bank lease was revoked", async () => {
    const f = fixture(); const subsystem = f.subsystem(); const bank = hideMemory(f);
    const before = f.replica.checkpoint(bank.scope.bankId)!;
    const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "owned-lost-lease", durationMs: 30_000 });
    const page = f.remote.client.applicationChangePage;
    vi.spyOn(f.remote.client, "applicationChangePage").mockImplementation(async (input) => {
      const value = await page(input); f.replica.leases.release(lease); return value;
    });
    await expect(subsystem.state.sync.run({ bank: { bankId: bank.scope.bankId, scope: "global", characterId: null },
      run: { lease, kind: "incremental", trigger: "catch_up", predecessor: before.native }, signal: new AbortController().signal,
      deadlineAt: new Date(Date.now() + 30_000).toISOString() })).rejects.toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
    expect(f.replica.record({ ...bank.scope, memoryId: "memory-a" })?.policy.visibility).toBe("retrieved");
  });
});
