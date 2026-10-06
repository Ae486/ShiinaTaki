import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness, composeHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("healthy recovery after complete Core reconstruction", () => {
  it("recovers a lost native takeover reply before proof without repeating the successful claim", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      h.remote.fault.acquireReply = true;
      const original = h.owner.submit(await h.request()); await h.owner.stop();
      const transitionId = original.producer?.kind === "transition" ? original.producer.transitionId : "";
      [...h.remote.status.values()][0]!.executor_live = false;
      h.remote.fault.unavailable = false; h.clock.value = "2026-10-01T00:06:00.000Z";
      const claim = h.remote.client.claimTransition!;
      vi.spyOn(h.remote.client, "claimTransition").mockImplementationOnce(async (input) => {
        await claim(input); h.remote.fault.unavailable = true; throw new Error("owned lost claim reply");
      });
      const lost = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(lost.operationId).state).toBe("outcome_unknown");
      h.remote.fault.unavailable = false; h.clock.value = "2026-10-01T00:12:00.000Z";
      const recovered = h.owner.submit(await h.request(transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed");
      expect(h.remote.calls).toMatchObject({ claim: 1, acquire: 2, verify: 2, resolve: 2 });
      expect(h.owner.status(lost.operationId).state).toBe("outcome_unknown");
    } finally { await h.close(); }
  });

  it.each(["verifyReply", "resolveReply"] as const)("reopens SQLite and replaces all Core owners after %s", async (fault) => {
    const h = await createHealthyTransitionHarness();
    h.remote.fault[fault] = true;
    const admitted = h.owner.submit(await h.request()); await h.owner.stop();
    expect(h.owner.status(admitted.operationId).state).toBe("outcome_unknown");
    const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
    const originalOperation = h.owner.status(admitted.operationId);
    const proof = [...h.remote.status.values()].find((value) => value.proof)!.proof;
    await h.stop(); await h.utility.stop(); h.db.close();
    const db = openDatabase({ path: join(h.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
    h.remote.reconnectDatabase(db); h.remote.fault.unavailable = false; h.clock.value = "2026-10-01T00:06:00.000Z";
    const calls = { ...h.remote.calls };
    const resumed = composeHealthyTransitionHarness({ db, dataDir: h.dataDir, timeline: createTimelineRepo(db), remote: h.remote, clock: h.clock });
    try {
      expect(resumed.service.status(transitionId).transition.intent.transitionId).toBe(transitionId);
      expect(h.remote.calls).toEqual(calls);
      const recovery = resumed.owner.submit(await resumed.request(transitionId)); await resumed.owner.stop();
      expect(resumed.owner.status(recovery.operationId).state).toBe("completed");
      expect(resumed.owner.status(admitted.operationId)).toEqual(originalOperation);
      expect([...h.remote.status.values()].find((value) => value.bank_id === proof!.bank_id)!.proof).toEqual(proof);
      expect(h.remote.calls).toMatchObject({ acquire: 2, verify: 2, resolve: 2 });
      expect(db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(1);
    } finally { await resumed.stop(); db.close(); rmTempDir(h.dataDir); }
  }, 20_000);
});
