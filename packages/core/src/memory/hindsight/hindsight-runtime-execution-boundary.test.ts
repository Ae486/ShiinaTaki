import { afterEach, describe, expect, it, vi } from "vitest";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { createHindsightApplicationSyncRunner, type HindsightApplicationBindingPass } from "./hindsight-application-sync-runner.ts";
import { templateLifecycleFixture } from "./template-lifecycle/template-lifecycle-fixtures.ts";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks(); vi.useRealTimers();
});
function fixture() {
  const f = hindsightRuntimeFixture(); cleanup.push(f.close);
  const { state } = f.subsystem(); const bank = f.banks[0]!;
  const guard = { key: { authorityEpochId: "epoch", bankId: bank.scope.bankId, requestId: "boundary-command" }, namespace: bank.scope.namespace };
  return { ...f, state, bank, guard };
}
function observeBinding(f: ReturnType<typeof fixture>, bind: (input: HindsightApplicationBindingPass) => Promise<boolean>) {
  const runner = createHindsightApplicationSyncRunner({ client: f.remote.client, repo: f.state.replica,
    authority: f.state.runtime.authority, bankScope: f.state.bankScope,
    requestTimeoutMs: f.state.runtime.connection.requestTimeoutMs, bind });
  cleanup.push(async () => { runner.stop(); await runner.settle(); });
  vi.spyOn(f.state.sync, "run").mockImplementation(runner.run);
  return () => f.state.service.synchronize({ bankId: f.bank.scope.bankId, mode: "foreground", context: { timeoutMs: 10_000 } });
}

describe("runtime execution boundary ownership", () => {
  it("validates the live connection once in each foreground request, including lease renewal", async () => {
    vi.useFakeTimers(); const f = fixture();
    const connectionReads = vi.spyOn(f.secrets.catalog, "presence");
    const renew = vi.spyOn(f.state.replica.leases, "renew");
    const bind = vi.fn(async (input: HindsightApplicationBindingPass) => {
      for (const elapsed of [0, 2_000]) {
        vi.setSystemTime(Date.now() + elapsed); connectionReads.mockClear();
        expect(input.request().timeoutMs).toBe(10_000);
        expect(connectionReads).toHaveBeenCalledOnce();
      }
      return false;
    });
    await observeBinding(f, bind)();
    expect(bind).toHaveBeenCalledOnce(); expect(renew).toHaveBeenCalledOnce();
  });

  it("validates the guarded Bank once before reading the command checkpoint", () => {
    const f = fixture(); const connectionReads = vi.spyOn(f.secrets.catalog, "presence");
    const checkpoint = f.state.replica.checkpoint;
    vi.spyOn(f.state.replica, "checkpoint").mockImplementation((bankId) => {
      expect(connectionReads).toHaveBeenCalledOnce(); return checkpoint(bankId);
    });
    f.state.assertActive(f.guard); expect(connectionReads).toHaveBeenCalledOnce();
  });

  it.each(["stop", "config", "secret", "authority"] as const)(
    "still rejects %s drift at command admission and the next actual foreground request", async (damage) => {
      const f = fixture(); const before = f.state.replica.checkpoint(f.bank.scope.bankId);
      const code = damage === "stop" ? "MEMORY_OPERATION_CANCELLED" : "MEMORY_AUTHORITY_MISMATCH";
      const bind = vi.fn(async (input: HindsightApplicationBindingPass) => {
        if (damage === "stop") f.state.runtime.stop();
        if (damage === "config") f.config.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://127.0.0.1:18482");
        if (damage === "secret") f.secrets.state.version++;
        if (damage === "authority") f.db.prepare("UPDATE canonical_memory_authority_epochs SET provider_lineage_id='foreign' WHERE epoch_id='epoch'").run();
        expect(() => f.state.assertActive(f.guard)).toThrow(new Error(code));
        input.request(); return false;
      });
      await expect(observeBinding(f, bind)()).rejects.toThrow(new Error(code));
      expect(bind).toHaveBeenCalledOnce(); expect(f.replica.checkpoint(f.bank.scope.bankId)).toEqual(before);
      expect(f.db.prepare("SELECT COUNT(*) AS n FROM hindsight_application_command_jobs").get()?.n).toBe(0);
    });

  it("still rejects an admitted template hold at both command and foreground entry", async () => {
    const f = templateLifecycleFixture(); cleanup.push(f.close); const { state } = f.base.subsystem();
    const bank = f.base.banks[0]!;
    const operation = f.admit(await f.request()); f.plan(operation);
    expect(() => state.assertActive({ key: { authorityEpochId: "epoch", bankId: bank.scope.bankId, requestId: "held-command" },
      namespace: bank.scope.namespace })).toThrow(new Error("MEMORY_TEMPLATE_HOLD"));
    await expect(state.service.synchronize({ bankId: bank.scope.bankId, mode: "foreground", context: { timeoutMs: 10_000 } }))
      .rejects.toThrow(new Error("MEMORY_TEMPLATE_HOLD"));
  });

  it.each(["expired", "replaced", "old-expiry"] as const)("never renews a %s foreground token", async (damage) => {
    vi.useFakeTimers(); const f = fixture(); const renew = vi.spyOn(f.state.replica.leases, "renew");
    const acquire = vi.spyOn(f.state.replica.leases, "acquire");
    const bind = vi.fn(async (input: HindsightApplicationBindingPass) => {
      const lease = acquire.mock.results[0]!.value;
      if (damage === "expired") vi.setSystemTime(Date.parse(lease.expiresAt));
      if (damage === "replaced") {
        f.state.replica.leases.release(lease);
        f.state.replica.leases.acquire({ bankId: lease.bankId, ownerId: "replacement", durationMs: 30_000 });
      }
      if (damage === "old-expiry") {
        vi.setSystemTime(Date.now() + 2_000);
        f.state.replica.leases.renew({ lease, durationMs: 30_000 }); renew.mockClear();
      }
      input.request(); return false;
    });
    const before = f.state.replica.checkpoint(f.bank.scope.bankId);
    await expect(observeBinding(f, bind)()).rejects.toThrow(new Error("HINDSIGHT_REPLICA_LEASE_LOST"));
    expect(bind).toHaveBeenCalledOnce(); expect(renew).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(f.bank.scope.bankId)).toEqual(before);
  });

  it("retains the command's captured epoch, namespace and Bank scope checks", () => {
    const f = fixture();
    expect(() => f.state.assertActive({ ...f.guard, key: { ...f.guard.key, authorityEpochId: "old-epoch" } }))
      .toThrow(new Error("MEMORY_AUTHORITY_MISMATCH"));
    expect(() => f.state.assertActive({ ...f.guard, namespace: { ...f.guard.namespace, provider_lineage: "foreign" } }))
      .toThrow(new Error("MEMORY_AUTHORITY_MISMATCH"));
    const checkpoint = f.state.replica.checkpoint(f.bank.scope.bankId)!;
    vi.spyOn(f.state.replica, "checkpoint").mockReturnValue({ ...checkpoint, bankScope: { kind: "character", characterId: "foreign" } });
    expect(() => f.state.assertActive(f.guard)).toThrow(new Error("MEMORY_AUTHORITY_MISMATCH"));
  });
});
