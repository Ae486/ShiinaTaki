import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_TEST_AT, applicationTestSnapshot } from "../../testing/hindsight-application-fixtures.ts";
import { applicationTestBoundBank, applicationTestReplica } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { createHindsightRuntimeBankService } from "./hindsight-runtime-bank-service.ts";
import type { HindsightReplicaRunInput } from "./hindsight-replica-sync-runner.ts";

const fixtures: ReturnType<typeof createFixture>[] = [];
afterEach(async () => {
  for (const value of fixtures.splice(0)) { value.release?.(); await value.service.stop(); value.db.close(); }
  vi.useRealTimers();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() { const result = createFixture(); fixtures.push(result); return result; }
function createFixture() {
  const value = applicationTestReplica(); const bank = applicationTestBoundBank();
  value.publish(applicationTestSnapshot({ native: [bank.native], artifacts: [bank.application] }));
  const route = { bankId: value.scope.bankId, scope: "global" as const, characterId: null };
  const complete = async (input: HindsightReplicaRunInput) => {
    value.repo.leases.assert(input.run.lease);
    const checkpoint = value.repo.nativeCheckpoint(route.bankId)!;
    return { checkpoint, observedCursor: checkpoint.endCursor };
  };
  const sync = { run: vi.fn(complete), rebuild: vi.fn(complete) };
  const recovery = { run: vi.fn(complete), rebuild: vi.fn(complete) };
  const onRecovered = vi.fn(async () => undefined);
  const service = createHindsightRuntimeBankService({ replica: value.repo, sync, recovery,
    bank: () => route, assertConnection: () => undefined, onRecovered, now: () => APPLICATION_TEST_AT });
  return { ...value, service, sync, recovery, route, onRecovered, release: undefined as (() => void) | undefined };
}

describe("Hindsight on-demand Bank recovery lifetime", () => {
  it("keeps the earlier Bank owner in the queue after a foreground waiter cancels", async () => {
    vi.useFakeTimers(); const f = fixture(); const entered = deferred(); const release = deferred(); f.release = release.resolve;
    const result = { checkpoint: f.repo.nativeCheckpoint(f.route.bankId)!, observedCursor: 1 };
    f.sync.run.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return result; });
    const acquire = vi.spyOn(f.repo.leases, "acquire");
    const input = { bankId: f.route.bankId, mode: "foreground" as const, context: { timeoutMs: 10_000 } };
    const first = f.service.synchronize(input); await entered.promise;
    const controller = new AbortController();
    const second = f.service.synchronize({ ...input, context: { ...input.context, signal: controller.signal } })
      .catch((error: unknown) => error);
    controller.abort(); await expect(second).resolves.toMatchObject({ message: "HINDSIGHT_CANCELLED" });
    let completed = false; const third = f.service.synchronize(input).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(completed).toBe(false); expect(acquire).toHaveBeenCalledOnce(); expect(f.sync.run).toHaveBeenCalledOnce();
    release.resolve(); await first; await third;
    expect(acquire).toHaveBeenCalledTimes(2); expect(f.sync.run).toHaveBeenCalledTimes(2); expect(completed).toBe(true);
  });

  it("cancels running and queued foreground work on stop without acquiring a late lease", async () => {
    const f = fixture(); const entered = deferred(); const acquire = vi.spyOn(f.repo.leases, "acquire");
    f.sync.run.mockImplementationOnce(async (input) => {
      entered.resolve(); await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("HINDSIGHT_CANCELLED")), { once: true });
      });
      throw new Error("aborted fixture must not resume");
    });
    const input = { bankId: f.route.bankId, mode: "foreground" as const, context: { timeoutMs: 10_000 } };
    const first = f.service.synchronize(input); await entered.promise;
    const outcomes = Promise.allSettled([first, f.service.synchronize(input)]);
    await f.service.stop(); expect((await outcomes).every((entry) => entry.status === "rejected")).toBe(true);
    expect(acquire).toHaveBeenCalledOnce(); expect(f.sync.run).toHaveBeenCalledOnce();
    await expect(f.service.synchronize(input)).rejects.toThrow("HINDSIGHT_CANCELLED");
    expect(acquire).toHaveBeenCalledOnce();
  });

  it("retries a generation reset through full recovery under the same lease and absolute deadline", async () => {
    const f = fixture();
    f.recovery.run.mockRejectedValueOnce(new Error("HINDSIGHT_REPLICA_GENERATION_MISMATCH"));
    await expect(f.service.recover({ bankId: f.route.bankId, context: { timeoutMs: 30_000 } })).resolves.toBeUndefined();
    expect(f.recovery.rebuild).toHaveBeenCalledOnce(); expect(f.onRecovered).toHaveBeenCalledOnce();
    const original = f.recovery.run.mock.calls[0]![0]; const reset = f.recovery.rebuild.mock.calls[0]![0];
    expect(reset.run.kind).toBe("full"); expect(reset.run.lease).toEqual(original.run.lease);
    expect(reset.deadlineAt).toBe(original.deadlineAt);
    expect(reset.run.predecessor).toEqual(f.repo.nativeCheckpoint(f.route.bankId));
  });

  it.each(["timeout", "abort"] as const)("settles a queued request on %s without waiting for the earlier transport", async (reason) => {
    vi.useFakeTimers(); const f = fixture(); const entered = deferred(); const release = deferred(); f.release = release.resolve;
    const result = { checkpoint: f.repo.nativeCheckpoint(f.route.bankId)!, observedCursor: 1 };
    f.sync.run.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return result; });
    const acquire = vi.spyOn(f.repo.leases, "acquire");
    const first = f.service.synchronize({ bankId: f.route.bankId, context: { timeoutMs: 60_000 } });
    await entered.promise;
    const controller = new AbortController(); let failure: string | undefined;
    const queued = f.service.synchronize({ bankId: f.route.bankId, context: { timeoutMs: 20, signal: controller.signal } })
      .catch((error: unknown) => { failure = error instanceof Error ? error.message : "unknown"; });
    if (reason === "abort") controller.abort(); else await vi.advanceTimersByTimeAsync(21);
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    const beforeRelease = failure;
    release.resolve(); await first; await queued;
    expect(beforeRelease).toBe(reason === "abort" ? "HINDSIGHT_CANCELLED" : "HINDSIGHT_TIMEOUT");
    expect(f.sync.run).toHaveBeenCalledOnce(); expect(acquire).toHaveBeenCalledOnce();
  });
});
