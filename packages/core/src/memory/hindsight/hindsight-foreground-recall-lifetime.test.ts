import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";
import { hindsightError } from "./hindsight-errors.ts";

const fixtures: HindsightRuntimeFixture[] = [];
const HTTP_MS = 10_000;
/** min(HTTP_MS, half the default 15000 chat ack deadline). */
const ADMISSION_MS = 7500;
const STEP_MS = 4000;
const call = { requestId: "foreground-lifetime", authorityEpochId: "epoch", actor: "foreground-agent" as const };
const request = { bankId: "bank-a", query: "fact", queryTimestamp: null, limit: 8, maxTokens: 1024,
  factTypes: ["world" as const, "experience" as const, "observation" as const], layerIds: [], includeInvalidated: false as const, budget: "low" as const };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT); });
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});
function fixture(seed: boolean) { const f = hindsightRuntimeFixture({ seed }); fixtures.push(f); return f; }
function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(hindsightError("HINDSIGHT_CANCELLED"));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(hindsightError("HINDSIGHT_CANCELLED")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
async function settled<T>(work: Promise<T>) {
  const result = work.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync(); return result;
}

function slowClient(f: HindsightRuntimeFixture) {
  const budgets: number[] = [];
  const delayed = <Input, Output>(action: (input: Input) => Promise<Output>, context: (input: Input) => HindsightCallContext) => async (input: Input) => {
    const current = context(input); budgets.push(current.timeoutMs);
    await pause(Math.min(STEP_MS, current.timeoutMs), current.signal);
    if (current.timeoutMs <= STEP_MS) throw hindsightError("HINDSIGHT_TIMEOUT");
    return action(input);
  };
  const client = f.remote.client; const original = { ...client };
  vi.spyOn(client, "health").mockImplementation(delayed(original.health, (input) => input));
  vi.spyOn(client, "version").mockImplementation(delayed(original.version, (input) => input));
  vi.spyOn(client, "compatibility").mockImplementation(delayed(original.compatibility, (input) => input));
  vi.spyOn(client, "createLogicalSnapshot").mockImplementation(delayed(original.createLogicalSnapshot!, (input) => input.context));
  vi.spyOn(client, "initializeApplication").mockImplementation(delayed(original.initializeApplication, (input) => input.context));
  vi.spyOn(client, "createApplicationSnapshot").mockImplementation(delayed(original.createApplicationSnapshot, (input) => input.context));
  vi.spyOn(client, "applicationSnapshotPage").mockImplementation(delayed(original.applicationSnapshotPage, (input) => input.context));
  vi.spyOn(client, "applicationChanges").mockImplementation(delayed(original.applicationChanges, (input) => input.context));
  vi.spyOn(client, "hydrateApplication").mockImplementation(delayed(original.hydrateApplication, (input) => input.context));
  vi.spyOn(client, "applicationBody").mockImplementation(delayed(original.applicationBody, (input) => input.context));
  vi.spyOn(client, "applicationBodyPart").mockImplementation(delayed(original.applicationBodyPart, (input) => input.context));
  f.remote.control.beforeRecall = () => pause(STEP_MS);
  return budgets;
}

describe("foreground Hindsight Recall lifetime", () => {
  it("refuses a directly captured Run if its caller cancels after capability capture", async () => {
    const f = fixture(true); const subsystem = f.subsystem(); await subsystem.captureRun("taki");
    const caller = new AbortController(); const capabilities = subsystem.state.provider.capabilities;
    vi.spyOn(subsystem.state.provider, "capabilities").mockImplementationOnce(async () => {
      const value = await capabilities(); caller.abort(); return value;
    });
    const result = await subsystem.captureRun("taki", caller.signal).then(() => ({ code: "admitted" }),
      (error: unknown) => ({ code: error instanceof Error ? error.message : "unknown" }));
    expect(result).toEqual({ code: "MEMORY_OPERATION_CANCELLED" });
  });

  it("keeps Reflect's explicit whole-operation deadline on the real synchronization path and reports its timeout truthfully", async () => {
    const f = fixture(true); const subsystem = f.subsystem(); const bank = f.banks[0]!;
    await subsystem.state.provider.capabilities();
    const before = f.replica.checkpoint(bank.scope.bankId); const renew = vi.spyOn(subsystem.state.replica.leases, "renew");
    const health = f.remote.client.health; const reflect = vi.spyOn(f.remote.client, "reflectApplication");
    vi.spyOn(f.remote.client, "health").mockImplementationOnce(async (input) => {
      const value = await health(input);
      // The response has finished; elapsed work before the next request still
      // counts against an explicit operation deadline, not its HTTP timeout.
      vi.setSystemTime(Date.now() + 300_000); return value;
    });
    const result = await settled(subsystem.state.provider.reflect(call,
      { bankId: bank.scope.bankId, query: "fact", budget: "low", maxTokens: 128 }));
    expect(result).toMatchObject({ value: { ok: false, error: { code: "MEMORY_PROVIDER_UNAVAILABLE", retryable: true } } });
    expect(reflect).not.toHaveBeenCalled(); expect(renew).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toEqual(before);
  });

  it("completes a cold provider Recall beyond 10s with a fresh finite allowance per HTTP and hydration stage", async () => {
    const f = fixture(true); const budgets = slowClient(f); const subsystem = f.subsystem(); const started = Date.now();
    expect(subsystem.state.provider.capabilitiesSnapshot()).toBeUndefined();
    const result = await settled(subsystem.state.provider.recall(call, request));
    expect(result).toMatchObject({ value: { ok: true, data: { returned: 1, partial: false, vectorState: "ready" } } });
    expect(Date.now() - started).toBeGreaterThan(HTTP_MS);
    expect(budgets.length).toBeGreaterThan(5); expect(budgets.every((value) => value === HTTP_MS)).toBe(true);
    expect(f.remote.client.hydrateApplication).toHaveBeenCalledOnce();
  });

  it("bounds an unseeded Run capture by the admission budget and finishes the cold sync in the background for the next Run", async () => {
    const f = fixture(false); const budgets = slowClient(f); const subsystem = f.subsystem();
    expect(subsystem.state.runtime.connection.requestTimeoutMs).toBe(HTTP_MS);
    expect(subsystem.state.provider.capabilitiesSnapshot()).toBeUndefined();
    for (const bank of f.banks) expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
    let first: { tools: object; automaticRecall?: unknown } | undefined;
    void subsystem.captureRun("taki").then((run) => { first = run; });
    await vi.advanceTimersByTimeAsync(ADMISSION_MS - 1); expect(first).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    // No admission evidence yet: the Run replies without memory instead of waiting for the cold pull.
    expect(first?.tools).toEqual({}); expect(first?.automaticRecall).toBeUndefined();
    expect(f.logs.filter((log) => log.level === "warn").map((log) => log.obj)).toEqual([
      { characterId: "taki", bankId: "bank-a", code: "HINDSIGHT_DEADLINE_EXCEEDED", outcome: "deferred" },
      { characterId: "taki", bankId: "bank-taki", code: "HINDSIGHT_DEADLINE_EXCEEDED", outcome: "deferred" },
      { characterId: "taki", code: "admission_unavailable" }]);
    await vi.runAllTimersAsync();
    expect(subsystem.state.provider.capabilitiesSnapshot()).toBeDefined();
    for (const bank of f.banks) expect(f.replica.checkpoint(bank.scope.bankId)?.checkpoint).toEqual({ native_cursor: 2, state_cursor: 0 });
    const result = await settled(subsystem.captureRun("taki"));
    expect(result).toHaveProperty("value"); if (!("value" in result)) return;
    const recalled = await settled(result.value.automaticRecall!({ query: "fact", visibleContext: "", now: Date.now() }));
    expect(recalled).toHaveProperty("value"); if (!("value" in recalled)) return;
    expect(recalled.value).toContain("bank-a fact memory-a"); expect(recalled.value).toContain("bank-taki fact memory-a");
    expect(budgets.every((value) => value === HTTP_MS)).toBe(true);
  });

  it("renews one owned lease across a complete cold synchronization while keeping its publication identity frozen", async () => {
    const f = fixture(false); slowClient(f); const subsystem = f.subsystem(); const bank = f.banks[0]!;
    const repo = subsystem.state.replica; const acquire = vi.spyOn(repo.leases, "acquire"); const renew = vi.spyOn(repo.leases, "renew");
    const cached = vi.spyOn(repo, "cacheBodies"); const publish = vi.spyOn(repo, "seedVerifiedSnapshot");
    const result = await settled(subsystem.state.service.synchronize({ bankId: bank.scope.bankId,
      mode: "foreground", context: { timeoutMs: HTTP_MS } }));
    expect(result).toEqual({ value: undefined }); expect(acquire).toHaveBeenCalledOnce();
    expect(renew.mock.calls.length).toBeGreaterThan(2); expect(publish).toHaveBeenCalledOnce(); expect(cached).toHaveBeenCalled();
    const first = acquire.mock.results[0]!.value;
    expect(first.expiresAt).toBe(new Date(Date.parse(APPLICATION_TEST_AT) + HTTP_MS + 1000).toISOString());
    for (const [input] of renew.mock.calls) expect(input.lease).toMatchObject({ bankId: first.bankId, runId: first.runId, ownerId: first.ownerId, fence: first.fence });
    for (const [input] of [...cached.mock.calls, ...publish.mock.calls]) {
      expect(input).toMatchObject({ namespace: bank.scope.namespace, authorityEpochId: "epoch", expectedCheckpoint: null,
        expectedNativeCheckpoint: null, expectedBank: { bankId: bank.scope.bankId, scope: "global", characterId: null } });
      expect(Date.parse(input.lease.expiresAt)).toBeGreaterThan(Date.parse(first.expiresAt));
      expect(input.deadlineAt).toBe(input.lease.expiresAt);
    }
    expect(f.replica.checkpoint(bank.scope.bankId)?.checkpoint).toEqual({ native_cursor: 2, state_cursor: 0 });
  });

  it.each(["released", "expired", "replaced", "cancelled"] as const)("cannot cache or publish a cold read after its owner is %s", async (failure) => {
    const f = fixture(false); slowClient(f); const subsystem = f.subsystem(); const bank = f.banks[0]!;
    const repo = subsystem.state.replica; const run = vi.spyOn(subsystem.state.sync, "run"); const controller = new AbortController();
    const cache = vi.spyOn(repo, "cacheBodies"); const publish = vi.spyOn(repo, "seedVerifiedSnapshot");
    const body = vi.mocked(f.remote.client.applicationBody).getMockImplementation()!; let changed = false;
    vi.spyOn(f.remote.client, "applicationBody").mockImplementation(async (input) => {
      const result = await body(input);
      if (!changed) {
        changed = true; const lease = run.mock.calls[0]![0].foreground!.current();
        if (failure === "cancelled") controller.abort();
        else if (failure === "expired") vi.setSystemTime(lease.expiresAt);
        else {
          repo.leases.release(lease);
          if (failure === "replaced") repo.leases.acquire({ bankId: bank.scope.bankId, ownerId: "new-owner", durationMs: 60_000 });
        }
      }
      return result;
    });
    const result = await settled(subsystem.state.service.synchronize({ bankId: bank.scope.bankId,
      mode: "foreground", context: { timeoutMs: HTTP_MS, signal: controller.signal } }));
    expect(result).toMatchObject({ error: { message: failure === "cancelled" ? "HINDSIGHT_CANCELLED" : "HINDSIGHT_REPLICA_LEASE_LOST" } });
    expect(changed).toBe(true); expect(cache).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
  });
});
