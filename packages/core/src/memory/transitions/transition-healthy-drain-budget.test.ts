import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readCurrentMemoryAuthorityIdentity } from "../legacy-migration/legacy-activation-repo.ts";
import * as hindsightModule from "../hindsight/hindsight-memory-subsystem.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(W3_AT);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// Failure modes: premature target publication; a false unknown remote outcome before dispatch;
// revived old references; unavailable source after factual abort; inability to submit a fresh switch.
it("aborts an over-budget write drain, restores the same source and permits a fresh healthy return", async () => {
  const sources: ReturnType<typeof hindsightModule.createHindsightMemorySubsystem>[] = [];
  const construct = hindsightModule.createHindsightMemorySubsystem;
  vi.spyOn(hindsightModule, "createHindsightMemorySubsystem").mockImplementation((input) => {
    const value = construct(input); sources.push(value); return value;
  });
  const h = await createHealthyTransitionHarness();
  const source = sources.at(-1)!;
  const original = readCurrentMemoryAuthorityIdentity(h.db);
  let release!: () => void;
  const held = source.writeFence.admit(async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    source.writeFence.admitSync(() => undefined);
  });
  const retiredHolder = expect(held).rejects.toThrow("MEMORY_AUTHORITY_FENCED");
  const quiesce = h.runtime.transitions.quiesce;
  const drain = vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (work) => {
    expect(work.timeoutMs).toBe(30_000);
    // Exercise the real counted fence, runtime retirement and healthy abort. Only the fixture wait is shortened.
    try { await quiesce({ ...work, timeoutMs: 5 }); }
    finally { release(); }
  });
  try {
    const first = h.owner.submit(await h.request());
    await h.owner.stop(); await retiredHolder;
    expect(drain).toHaveBeenCalledOnce();
    expect(h.owner.status(first.operationId)).toMatchObject({ state: "failed",
      errorCode: "MEMORY_TRANSITION_UNAVAILABLE", result: { authorityCommitted: false, runtime: "source", queue: "settled" } });
    expect(h.remote.calls.acquire).toBe(0);
    expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(0);
    expect(readCurrentMemoryAuthorityIdentity(h.db)).toEqual(original);
    expect(h.runtime.hindsightBindingSnapshot().binding).toEqual({ kind: "published", epochId: original.epochId });
    expect(() => source.writeFence.admitSync(() => undefined)).toThrow("MEMORY_AUTHORITY_FENCED");
    expect(sources.at(-1)).not.toBe(source);
    expect(sources.at(-1)!.writeFence.admitSync(() => "admitted")).toBe("admitted");
    const second = h.owner.submit(await h.request());
    await h.owner.stop();
    expect(h.owner.status(second.operationId)).toMatchObject({ state: "completed", result: { authorityCommitted: true, runtime: "ready" } });
    expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(1);
  } finally {
    release(); await Promise.allSettled([held]); await h.close();
  }
}, 30_000);
