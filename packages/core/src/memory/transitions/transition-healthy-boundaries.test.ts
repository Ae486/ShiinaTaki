import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { createHindsightReplicaSchedulerRepo } from "../../db/hindsight-replica-scheduler-repo.ts";
import { randomUUID } from "node:crypto";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("complete healthy driver integrity boundaries", () => {
  it("serializes real manual-sync admission with the complete transition owner in both orders", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const scheduler = createHindsightReplicaSchedulerRepo(h.db, () => W3_AT);
      const bankId = h.banks.find((row) => row.scope === "global")!.nativeBankId;
      scheduler.ensureBank({ bank: { bankId, scope: "global", characterId: null } });
      const requestId = randomUUID(); scheduler.requestManual({ bankId, kind: "incremental", requestId });
      const request = await h.request();
      expect(() => h.owner.submit(request)).toThrow(/BUSY/); expect(h.remote.calls.acquire).toBe(0);
      scheduler.cancelManual(bankId, requestId);
      const cancelled = scheduler.request(requestId);
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (input) => {
        expect(() => scheduler.requestManual({ bankId, kind: "incremental", requestId: randomUUID() })).toThrow(/TRANSITION|BUSY/);
        await quiesce(input);
      });
      const admitted = h.owner.submit(request); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).toBe("completed");
      expect(scheduler.request(requestId)).toEqual(cancelled);
      expect(h.db.prepare("SELECT count(*) n FROM hindsight_replica_manual_requests WHERE state IN ('queued','claimed')").get()?.n).toBe(0);
    } finally { await h.close(); }
  });

  it("refuses a newly witnessed Character during drain even when the setup inventory hash is unchanged", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const original = readMemoryAuthoritySelection(h.db);
      const setup = canonicalPayloadHash(h.db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all());
      const quiesce = h.runtime.transitions.quiesce;
      vi.spyOn(h.runtime.transitions, "quiesce").mockImplementationOnce(async (input) => {
        const session = h.runtime.custody.begin({ characterId: "late-character", repo: h.timeline });
        session.repo.append({ characterId: "late-character", role: "user", content: "late owned source" });
        session.finalize(); await quiesce(input);
      });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).not.toBe("completed");
      expect(h.remote.calls.acquire).toBe(0);
      expect(readMemoryAuthoritySelection(h.db)).toEqual(original);
      expect(canonicalPayloadHash(h.db.prepare("SELECT * FROM hindsight_bank_setup ORDER BY external_bank_id").all())).toBe(setup);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(0);
    } finally { await h.close(); }
  });

  it("rejects a foreign native proof without publishing a partial all-Bank candidate", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const verify = h.remote.client.verifyTransition!;
      vi.spyOn(h.remote.client, "verifyTransition").mockImplementationOnce(async (input) => {
        const status = await verify(input); status.proof!.bank_id = "foreign-native-bank"; return status;
      });
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(admitted.operationId).state).not.toBe("completed");
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(0);
      expect(readMemoryAuthoritySelection(h.db).mode).toBe("hindsight");
    } finally { await h.close(); }
  });

  it("rejects a corrupted original body and positively aborts without an authority replacement", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const part = h.remote.client.applicationBodyPart!;
      vi.spyOn(h.remote.client, "applicationBodyPart").mockImplementationOnce(async (input) => ({ ...await part(input), data_base64: "e30=" }));
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "failed", result: { runtime: "source", authorityCommitted: false } });
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_receipts").get()?.n).toBe(0);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_native_outcomes").get()?.n).toBe(2);
    } finally { await h.close(); }
  });

  it("rolls back the complete publication when receipt persistence fails, then proves source release", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const original = readMemoryAuthoritySelection(h.db);
      h.db.exec("CREATE TRIGGER fail_healthy_receipt BEFORE INSERT ON memory_transition_receipts BEGIN SELECT RAISE(ABORT,'owned publication failure'); END");
      const admitted = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(admitted.operationId)).toMatchObject({ state: "failed", result: { runtime: "source", authorityCommitted: false } });
      expect(readMemoryAuthoritySelection(h.db)).toEqual(original);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_publications").get()?.n).toBe(0);
      expect(h.remote.calls).toMatchObject({ acquire: 2, verify: 2, resolve: 2 });
    } finally { await h.close(); }
  });
});
