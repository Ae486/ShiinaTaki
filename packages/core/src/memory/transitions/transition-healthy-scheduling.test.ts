import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { hindsightError } from "../hindsight/hindsight-errors.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe("healthy finalization event-loop scheduling", () => {
  it.each(["transition.return-local", "transition.reenter-hindsight"] as const)(
    "joins a genuinely delayed renewal before full binding and terminal resolution for %s", async (kind) => {
      const h = await createHealthyTransitionHarness();
      try {
        if (kind === "transition.reenter-hindsight") {
          const first = h.owner.submit(await h.request()); await h.owner.stop();
          expect(h.owner.status(first.operationId).state).toBe("completed");
        }
        const request = await h.request(undefined, kind);
        vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
        const intervals = vi.spyOn(globalThis, "setInterval"); const cleared = vi.spyOn(globalThis, "clearInterval");
        const events: string[] = []; const started = deferred();
        let pending = 0; let fullReads = 0; let bound = false;
        const resolve = h.remote.client.resolveTransition!; let firstResolve = true;
        vi.spyOn(h.remote.client, "renewTransition").mockImplementation(async (input) => {
          pending++; events.push("renew-start");
          const status = structuredClone(h.remote.status.get(JSON.stringify([input.bankId, input.request.transition_id]))!);
          started.resolve(); await nextTurn(); await nextTurn(); await nextTurn();
          pending--; events.push("renew-end"); return status;
        });
        vi.spyOn(h.remote.client, "resolveTransition").mockImplementation(async (input) => {
          if (firstResolve) { firstResolve = false; vi.advanceTimersByTime(30_000); await started.promise; }
          const value = await resolve(input);
          value.revision++; // Match the real Native outcome SQL revision increment, absent from the older double.
          h.remote.status.set(JSON.stringify([input.bankId, input.request.executor.transition_id]), value);
          events.push("resolve"); return value;
        });
        const advance = (milliseconds: number) => {
          h.clock.value = new Date(Date.parse(h.clock.value) + milliseconds).toISOString();
          vi.advanceTimersByTime(milliseconds);
        };
        const bind = h.runtime.transitions.bind;
        vi.spyOn(h.runtime.transitions, "bind").mockImplementation(async (id) => {
          expect(pending).toBe(0); events.push("bind");
          const receipt = h.db.prepare("SELECT receipt_id FROM memory_transition_receipts WHERE transition_id=:id").get({ id });
          expect(receipt).toBeDefined();
          expect(h.db.prepare("SELECT count(*) n FROM memory_transition_native_outcomes WHERE transition_id=:id").get({ id })?.n).toBe(2);
          const result = await bind(id); bound = true; advance(100_000); return result;
        });
        const snapshotName = kind === "transition.return-local" ? "bindingSnapshot" : "hindsightBindingSnapshot";
        const snapshot = h.runtime[snapshotName];
        vi.spyOn(h.runtime, snapshotName).mockImplementation(() => {
          const result = snapshot(); if (bound && fullReads++ === 0) { events.push("full-ready"); advance(80_000); }
          return result;
        });
        const executeIntents = h.runtime.transitions.executeIntents;
        vi.spyOn(h.runtime.transitions, "executeIntents").mockImplementation(async (lease) => {
          events.push("queue"); const result = await executeIntents(lease); advance(140_000); return result;
        });
        const release = h.runtime.transitions.nativeRelease;
        vi.spyOn(h.runtime.transitions, "nativeRelease").mockImplementation((work) => {
          events.push("release"); const result = release(work); advance(70_000); return result;
        });
        const operation = h.owner.submit(request); await h.owner.stop();
        expect(h.owner.status(operation.operationId)).toMatchObject({ state: "completed", result: { runtime: "ready", queue: "settled" } });
        expect(events.indexOf("renew-end")).toBeLessThan(events.indexOf("bind"));
        expect(events.filter((event) => ["bind", "full-ready", "queue", "release"].includes(event)))
          .toEqual(["bind", "full-ready", "queue", "release"]);
        expect(fullReads).toBeGreaterThan(0); expect(pending).toBe(0);
        // A newly bound Local runtime owns its own maintenance timer. Assert the actual driver's timer ended.
        expect(intervals.mock.calls[0]?.[1]).toBe(30_000);
        expect(cleared).toHaveBeenCalledWith(intervals.mock.results[0]?.value);
        expect(h.records.map((record) => record.obj)).not.toContainEqual(expect.objectContaining({ stage: "heartbeat" }));
      } finally { vi.useRealTimers(); await h.close(); }
    }, 30_000);

  it.each(["cancel", "configuration", "lease-expired", "lease-replaced"] as const)(
    "rechecks %s after yielding from full bind and prevents queue execution", async (fault) => {
      const h = await createHealthyTransitionHarness(); let stopping: Promise<void> | undefined;
      try {
        const bind = h.runtime.transitions.bind;
        vi.spyOn(h.runtime.transitions, "bind").mockImplementation(async (id) => {
          const result = await bind(id);
          setImmediate(() => {
            if (fault === "cancel") stopping = h.service.stop();
            if (fault === "configuration") h.db.prepare("UPDATE hindsight_connection_state SET revision=revision+1").run();
            if (fault === "lease-expired") h.clock.value = new Date(Date.parse(h.clock.value) + 301_000).toISOString();
            if (fault === "lease-replaced") {
              const attempt = JSON.parse(String(h.db.prepare("SELECT attempt_json FROM memory_transition_attempts").get()!.attempt_json));
              attempt.ownerId = "replacement-owner";
              h.db.prepare("UPDATE memory_transition_attempts SET attempt_json=:json").run({ json: JSON.stringify(attempt) });
            }
          });
          return result;
        });
        const queue = vi.spyOn(h.runtime.transitions, "executeIntents");
        const operation = h.owner.submit(await h.request()); await h.owner.stop(); await stopping;
        expect(h.owner.status(operation.operationId).state).toBe("outcome_unknown");
        expect(queue).not.toHaveBeenCalled();
        expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(1);
        expect(h.db.prepare("SELECT count(*) n FROM memory_transition_resolutions").get()?.n).toBe(0);
      } finally { await h.close(); }
    });

  it("retains unknown outcome when the pending heartbeat fails at a full-validation boundary", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const request = await h.request(); vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      const nativeOutcome = h.runtime.transitions.nativeOutcome;
      vi.spyOn(h.runtime.transitions, "nativeOutcome").mockImplementationOnce((work) => {
        nativeOutcome(work); vi.advanceTimersByTime(30_000);
      });
      vi.spyOn(h.remote.client, "renewTransition").mockImplementation(async () => {
        await nextTurn(); throw hindsightError("HINDSIGHT_TIMEOUT");
      });
      const bind = vi.spyOn(h.runtime.transitions, "bind");
      const operation = h.owner.submit(request); await h.owner.stop();
      expect(h.owner.status(operation.operationId).state).toBe("outcome_unknown");
      expect(bind).not.toHaveBeenCalled();
      expect(h.records).toContainEqual(expect.objectContaining({ obj: { stage: "heartbeat", code: "HINDSIGHT_TIMEOUT" } }));
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); await h.close(); }
  });
});
