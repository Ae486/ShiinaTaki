import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { hindsightRuntimeFixture, type HindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { curatorTestBank, curatorTestRemotePolicy } from "./hindsight-policy-curator-fixtures.ts";
import { HindsightApplicationRefusal } from "./hindsight-application-client.ts";
import { hindsightError } from "./hindsight-errors.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";

const fixtures: HindsightRuntimeFixture[] = [];
const REQUEST_MS = 250;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(APPLICATION_TEST_AT); });
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close();
  vi.restoreAllMocks(); vi.useRealTimers();
});

function fixture(seed: boolean) {
  const value = hindsightRuntimeFixture({ seed }); fixtures.push(value);
  value.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", REQUEST_MS);
  return value;
}

/** Each individual response fits its HTTP budget; their complete body closure does not. */
function delayedReads(f: HindsightRuntimeFixture, input: { delayMs?: number; afterBody?: () => void } = {}) {
  const budgets: number[] = [];
  const advance = (context: HindsightCallContext) => {
    budgets.push(context.timeoutMs);
    const delay = input.delayMs ?? 100;
    if (context.signal?.aborted) throw hindsightError("HINDSIGHT_CANCELLED");
    if (context.timeoutMs <= delay) throw hindsightError("HINDSIGHT_TIMEOUT");
    vi.setSystemTime(Date.now() + delay);
  };
  const snapshot = f.remote.client.createApplicationSnapshot;
  const page = f.remote.client.applicationSnapshotPage;
  const event = f.remote.client.applicationChangePage;
  const body = f.remote.client.applicationBody;
  const part = f.remote.client.applicationBodyPart;
  vi.spyOn(f.remote.client, "createApplicationSnapshot").mockImplementation(async (request) => { advance(request.context); return snapshot(request); });
  vi.spyOn(f.remote.client, "applicationSnapshotPage").mockImplementation(async (request) => { advance(request.context); return page(request); });
  vi.spyOn(f.remote.client, "applicationChangePage").mockImplementation(async (request) => { advance(request.context); return event(request); });
  vi.spyOn(f.remote.client, "applicationBody").mockImplementation(async (request) => {
    advance(request.context); const result = await body(request); input.afterBody?.(); return result;
  });
  vi.spyOn(f.remote.client, "applicationBodyPart").mockImplementation(async (request) => { advance(request.context); return part(request); });
  return budgets;
}

describe("D77 complete-read deadline ownership", () => {
  it("keeps every large-body part inside its own request cap and the shared Bank deadline", async () => {
    const bank = curatorTestBank({ memories: [{ id: "large-memory", text: "记".repeat(100000) }] });
    const f = hindsightRuntimeFixture({ seed: false, banks: [bank] }); fixtures.push(f);
    f.config.upsert("TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS", REQUEST_MS);
    const subsystem = f.subsystem(); const budgets = delayedReads(f);
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 5000 } });
    expect(f.remote.client.applicationBodyPart).toHaveBeenCalledWith(expect.objectContaining({ partNumber: 1 }));
    expect(budgets.every((budget) => budget <= REQUEST_MS)).toBe(true);
    expect(f.replica.record({ ...bank.scope, memoryId: "large-memory" })?.unit.text).toBe("记".repeat(100000));
  });

  it.each(["initial", "event", "reset"] as const)("uses the Bank run deadline across %s pages and bodies", async (mode) => {
    const f = fixture(mode !== "initial"); const bank = f.banks[0]!;
    const subsystem = f.subsystem();
    if (mode !== "initial") {
      curatorTestRemotePolicy(bank, "memory-a", (value) => ({ ...value,
        policy: { ...value.policy, visibility: "hidden", policyVersion: value.policy.policyVersion + 1 } }));
    }
    if (mode === "reset") vi.spyOn(f.remote.client, "applicationChanges").mockRejectedValueOnce(new HindsightApplicationRefusal({
      error: "application_state_error", code: "state_reset_required", detail: "owned replay floor",
      checkpoint: bank.events[0]!.manifest.to_checkpoint, minimum_state_cursor: 1 }));
    const budgets = delayedReads(f); const started = Date.now();
    await subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 5000 } });
    expect(Date.now() - started).toBeGreaterThan(REQUEST_MS);
    expect(budgets.every((budget) => budget > 0 && budget <= REQUEST_MS)).toBe(true);
    const checkpoint = f.replica.checkpoint(bank.scope.bankId)!;
    expect(checkpoint.checkpoint.state_cursor).toBe(mode === "initial" ? 0 : 1);
    expect(f.replica.record({ ...bank.scope, memoryId: "memory-a", includeHidden: true })?.policy.visibility)
      .toBe(mode === "initial" ? "retrieved" : "hidden");
  });

  it("still refuses an individual response exceeding the configured HTTP limit", async () => {
    const f = fixture(false); const bank = f.banks[0]!; const subsystem = f.subsystem();
    delayedReads(f, { delayMs: REQUEST_MS + 1 });
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 5000 } }))
      .rejects.toThrow("HINDSIGHT_TIMEOUT");
    expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
  });

  it("does not restart the whole-operation deadline for each body", async () => {
    const f = fixture(false); const bank = f.banks[0]!; const subsystem = f.subsystem();
    const budgets = delayedReads(f);
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 650 } })).rejects.toThrow();
    expect(budgets.some((budget) => budget < REQUEST_MS)).toBe(true);
    expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
  });

  it("honors owner cancellation before downloading the next body part", async () => {
    const f = fixture(false); const bank = f.banks[0]!; const subsystem = f.subsystem(); const abort = new AbortController();
    delayedReads(f, { afterBody: () => abort.abort() });
    await expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 5000, signal: abort.signal } }))
      .rejects.toThrow("HINDSIGHT_CANCELLED");
    expect(f.remote.client.applicationBodyPart).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
  });

  it("rechecks the Bank lease between descriptor and part requests", async () => {
    const f = fixture(false); const bank = f.banks[0]!; const subsystem = f.subsystem();
    const lease = f.replica.leases.acquire({ bankId: bank.scope.bankId, ownerId: "deadline-owner", durationMs: 5000 });
    delayedReads(f, { afterBody: () => f.replica.leases.release(lease) });
    await expect(subsystem.state.sync.run({ bank: { bankId: bank.scope.bankId, scope: "global", characterId: null },
      run: { lease, kind: "full", trigger: "catch_up", predecessor: null }, signal: new AbortController().signal,
      deadlineAt: new Date(Date.now() + 5000).toISOString() })).rejects.toThrow("HINDSIGHT_REPLICA_LEASE_LOST");
    expect(f.remote.client.applicationBodyPart).not.toHaveBeenCalled();
    expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
  });

  it("finishes independent cold-body reads within one finite run using bounded concurrency", async () => {
    vi.useRealTimers(); vi.useFakeTimers(); vi.setSystemTime(APPLICATION_TEST_AT);
    const f = fixture(false); const bank = f.banks[0]!; const subsystem = f.subsystem();
    let current = 0; let maximum = 0;
    const pause = async () => {
      current++; maximum = Math.max(maximum, current);
      try { await new Promise((resolve) => setTimeout(resolve, 80)); }
      finally { current--; }
    };
    const body = f.remote.client.applicationBody; const part = f.remote.client.applicationBodyPart;
    vi.spyOn(f.remote.client, "applicationBody").mockImplementation(async (input) => { await pause(); return body(input); });
    vi.spyOn(f.remote.client, "applicationBodyPart").mockImplementation(async (input) => { await pause(); return part(input); });
    const assertion = expect(subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 500 } }))
      .resolves.toBeUndefined();
    const settled = assertion.then(() => undefined, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await settled).toBeUndefined();
    expect(maximum).toBeGreaterThan(1); expect(maximum).toBeLessThanOrEqual(8); expect(current).toBe(0);
    expect(f.replica.checkpoint(bank.scope.bankId)).toBeDefined();
  });

  it("preserves a corrupt-body cause and drains cancelled sibling reads before releasing the Bank run", async () => {
    const f = fixture(false); const bank = f.banks[0]!; const subsystem = f.subsystem();
    let releaseFirst!: () => void; let releaseSiblings!: () => void; let started!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const siblings = new Promise<void>((resolve) => { releaseSiblings = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const signals: AbortSignal[] = []; let calls = 0; let finished = false;
    const body = f.remote.client.applicationBody;
    vi.spyOn(f.remote.client, "applicationBody").mockImplementation(async (input) => {
      const index = calls++; signals.push(input.context.signal!); if (calls === 2) started();
      await (index === 0 ? first : siblings);
      const value = await body(input);
      return index === 0 ? { ...value, descriptor: { ...value.descriptor, payload_hash: "0".repeat(64) } } : value;
    });
    const outcome = subsystem.state.service.synchronize({ bankId: bank.scope.bankId, context: { timeoutMs: 5000 } })
      .then(() => { finished = true; return null; }, (error: unknown) => { finished = true; return error; });
    try {
      await ready; releaseFirst();
      await expect.poll(() => signals.every((signal) => signal.aborted)).toBe(true);
      expect(finished).toBe(false);
      expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
    } finally { releaseFirst(); releaseSiblings(); }
    expect(await outcome).toMatchObject({ message: "HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR" });
    expect(finished).toBe(true); expect(f.replica.checkpoint(bank.scope.bankId)).toBeUndefined();
  });
});
