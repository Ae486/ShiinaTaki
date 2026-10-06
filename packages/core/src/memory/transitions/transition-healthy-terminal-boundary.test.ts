import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("healthy transition final terminal boundary", () => {
  it.each(["cancel", "configuration", "lease-expired", "lease-replaced"] as const)(
    "refuses terminal completion when %s arrives after complete native release validation", async (fault) => {
      const h = await createHealthyTransitionHarness(); let stopping: Promise<void> | undefined;
      try {
        const release = h.runtime.transitions.nativeRelease;
        const validated = vi.spyOn(h.runtime.transitions, "nativeRelease").mockImplementation((work) => {
          const result = release(work);
          // Deliver drift after the full release check, during the production terminal event-loop boundary.
          // An earlier bind-only assertion cannot prove the final resolution uses current ownership.
          setImmediate(() => {
            if (fault === "cancel") stopping = h.service.stop();
            if (fault === "configuration") h.db.exec("UPDATE hindsight_connection_state SET revision=revision+1");
            if (fault === "lease-expired") h.clock.value = new Date(Date.parse(h.clock.value) + 301_000).toISOString();
            if (fault === "lease-replaced") {
              const row = h.db.prepare("SELECT attempt_json FROM memory_transition_attempts").get()!;
              const attempt = JSON.parse(String(row.attempt_json)); attempt.ownerId = "terminal-replacement-owner";
              h.db.prepare("UPDATE memory_transition_attempts SET attempt_json=:json").run({ json: JSON.stringify(attempt) });
            }
          });
          return result;
        });
        const operation = h.owner.submit(await h.request()); await h.owner.stop(); await stopping;
        expect(validated).toHaveBeenCalledOnce();
        expect(h.owner.status(operation.operationId).state).toBe("outcome_unknown");
        expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(1);
        expect(h.db.prepare("SELECT count(*) n FROM memory_transition_native_outcomes").get()?.n).toBe(2);
        expect(h.db.prepare("SELECT count(*) n FROM memory_transition_resolutions").get()?.n).toBe(0);
      } finally { await h.close(); }
    });
});
