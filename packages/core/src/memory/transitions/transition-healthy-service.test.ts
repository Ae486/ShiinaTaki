import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => vi.useRealTimers());

describe("healthy production operation driver", () => {
  it("executes the complete return through the actual owner and runtime", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "completed", result: { authorityCommitted: true, runtime: "ready", queue: "settled" } });
      expect(h.remote.calls).toMatchObject({ acquire: 2, verify: 2, resolve: 2 });
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.service.status(transitionId).progress).toMatchObject({ phase: "terminal", runtime: "ready", nativeReleasePending: false });
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(1);
    } finally { await h.close(); }
  });
  it("releases every never-dispatched Bank after client construction fails", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const request = await h.request(); h.fault.constructor = true;
      const admitted = h.owner.submit(request); await h.owner.stop();
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "failed", result: { authorityCommitted: false, runtime: "source" } });
      expect(h.remote.calls.acquire).toBe(0);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_undispatched").get()?.n).toBe(2);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_native_outcomes").get()?.n).toBe(0);
      expect(h.runtime.hindsightBindingSnapshot().binding.kind).toBe("published");
    } finally { await h.close(); }
  });
  it("runs two full return and reentry cycles through the same operation owner", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      for (const kind of ["transition.return-local", "transition.reenter-hindsight", "transition.return-local", "transition.reenter-hindsight"] as const) {
        const admitted = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
        expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "completed" });
      }
      expect(h.remote.calls).toMatchObject({ acquire: 8, verify: 8, resolve: 8, delta: 4 });
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(4);
      expect(h.runtime.hindsightBindingSnapshot().binding.kind).toBe("published");
    } finally { await h.close(); }
  }, 30_000);
  it.each(["acquireReply", "verifyReply", "resolveReply"] as const)("recovers the same all-Bank transition after %s loss", async (fault) => {
    const h = await createHealthyTransitionHarness();
    try {
      h.remote.fault[fault] = true;
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      const before = { ...h.remote.calls };
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_undispatched").get()?.n).toBe(0);
      h.clock.value = "2026-10-01T00:06:00.000Z"; h.remote.fault.unavailable = false;
      const recovering = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovering.operationId)).toMatchObject({ state: "completed", result: { transitionId, authorityCommitted: true } });
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      expect(h.remote.calls.acquire).toBe(2); expect(h.remote.calls.verify).toBe(2); expect(h.remote.calls.resolve).toBe(2);
      expect(h.remote.calls.acquire).toBeGreaterThanOrEqual(before.acquire);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(1);
      expect(h.service.status(transitionId).transition.result?.outcome).toBe("completed");
    } finally { await h.close(); }
  });
  it("rejects capability drift before acquiring any Bank", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const request = await h.request(); delete h.remote.manifest.contracts.transition_source_evidence;
      const admitted = h.owner.submit(request); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("failed"); expect(h.remote.calls.acquire).toBe(0);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_undispatched").get()?.n).toBe(2);
    } finally { await h.close(); }
  });
  it("cancels a durable admission before producer claim without native effects", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const admitted = h.owner.submit(await h.request()); h.owner.cancel(admitted.operationId); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("cancelled"); expect(h.remote.calls.acquire).toBe(0);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_attempts").get()?.n).toBe(0);
    } finally { await h.close(); }
  });
  it("recovers a sealed proof across native executor takeover without another verification", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      h.remote.fault.verifyReply = true;
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      const proven = [...h.remote.status.values()].find((value) => value.proof)!;
      const originalProof = structuredClone(proven.proof); proven.executor_live = false;
      h.clock.value = "2026-10-01T00:06:00.000Z"; h.remote.fault.unavailable = false;
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed");
      expect(h.remote.calls.claim).toBe(1); expect(h.remote.calls.verify).toBe(2);
      const final = [...h.remote.status.values()].find((value) => value.bank_id === proven.bank_id)!;
      expect(final.executor.generation).toBe(2); expect(final.proof).toEqual(originalProof);
    } finally { await h.close(); }
  });
  it("records a failed recovery separately before a later recovery completes", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      h.remote.fault.acquireReply = true;
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      h.clock.value = "2026-10-01T00:06:00.000Z"; h.remote.fault.unavailable = false; h.remote.fault.verifyReply = true;
      const recovering = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovering.operationId).state).toBe("outcome_unknown");
      expect(h.db.prepare("SELECT operation_id FROM memory_transition_driver_failures").get()?.operation_id).toBe(recovering.operationId);
      expect(h.service.status(transitionId).transition.result?.outcome).toBe("outcome_unknown");
      h.clock.value = "2026-10-01T00:12:00.000Z"; h.remote.fault.unavailable = false;
      const final = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(final.operationId).state).toBe("completed");
      expect(h.owner.status(recovering.operationId).state).toBe("outcome_unknown");
    } finally { await h.close(); }
  });
  it("rebinds the same committed epoch after target construction fails", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      vi.spyOn(h.runtime.transitions, "bind").mockRejectedValueOnce(new Error("owned target construction failure"));
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "outcome_unknown", result: { authorityCommitted: true, runtime: "unavailable" } });
      const receipt = h.service.status(transitionId).transition.receipt;
      h.clock.value = "2026-10-01T00:06:00.000Z";
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed");
      expect(h.service.status(transitionId).transition.receipt).toEqual(receipt);
      expect(h.remote.calls).toMatchObject({ acquire: 2, verify: 2, resolve: 2 });
    } finally { await h.close(); }
  });
  it("recovers a lost reentry delta reply without abort or duplicate delta", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const returned = h.owner.submit(await h.request()); await h.owner.stop(); expect(h.owner.status(returned.operationId).state).toBe("completed");
      h.remote.fault.deltaReply = true;
      const admitted = h.owner.submit(await h.request(undefined, "transition.reenter-hindsight")); await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
      expect(h.db.prepare("SELECT id FROM memory_transition_native_commands WHERE transition_id=:id AND slot LIKE 'abort:%'").get({ id: transitionId })).toBeUndefined();
      h.clock.value = "2026-10-01T00:06:00.000Z"; h.remote.fault.unavailable = false;
      const recovered = h.owner.submit(await h.request(transitionId, "transition.reenter-hindsight")); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed"); expect(h.remote.calls.delta).toBe(2);
    } finally { await h.close(); }
  }, 15_000);
});
