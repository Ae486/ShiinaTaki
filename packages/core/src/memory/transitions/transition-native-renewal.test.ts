import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HindsightTransitionStatus } from "@taki/shared";
import { openDatabase } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTransitionCandidateFixture } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createHealthyTransitionTransport } from "../../testing/memory-transition-healthy-transport.ts";
import { initializeTransitionDriverBanks, markTransitionNativeDispatched, prepareTransitionNativeCommand } from "../../db/memory-transition-driver-repo.ts";
import { createTransitionNativeSession } from "./transition-native-session.ts";
import { signHindsightTransitionAcquire } from "../hindsight/hindsight-transition-proof.ts";

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const seeded = createTransitionCandidateFixture(db); const work = () => seeded.input;
  initializeTransitionDriverBanks(db, work());
  const remote = createHealthyTransitionTransport(seeded.proofs, db);
  for (const value of seeded.proofs) {
    const bankId = value.status.bank_id;
    const command = prepareTransitionNativeCommand(db, { ...work(), command: { kind: "acquire", bankId,
      slot: "original", request: value.status.request } });
    markTransitionNativeDispatched(db, { ...work(), command });
    remote.status.set(JSON.stringify([bankId, seeded.intent.transitionId]), structuredClone(value.status));
    remote.evidence.set(JSON.stringify([bankId, seeded.intent.transitionId]), value);
  }
  const native = createTransitionNativeSession({ db, intent: seeded.intent, client: remote.client, work,
    request: () => ({ timeoutMs: 1000 }), changed: () => undefined });
  const status = native.observe(structuredClone(seeded.proofs[0]!.status));
  return { db, remote, native, status, bankId: status.bank_id };
}

describe("native session late renewal ordering", () => {
  it("keeps a real session-resolved terminal outcome after the old proven renewal arrives", async () => {
    const h = fixture();
    try {
      const delayed = deferred<HindsightTransitionStatus>();
      const renew = vi.spyOn(h.remote.client, "renewTransition").mockReturnValueOnce(delayed.promise);
      const pending = h.native.renew(); const original = h.remote.client.resolveTransition!;
      vi.spyOn(h.remote.client, "resolveTransition").mockImplementationOnce(async (input) => {
        const value = await original(input);
        // Real Native resolve increments revision; the older transport fixture omits that revision-only update.
        value.revision++; h.remote.status.set(JSON.stringify([h.bankId, value.executor.transition_id]), value);
        return value;
      });
      const terminal = await h.native.resolve(h.bankId, { disposition: "retire", receiptId: "a".repeat(64) });
      delayed.resolve(structuredClone(h.status)); await pending;
      expect(h.native.active.get(h.bankId)).toEqual(terminal);
      await h.native.renew(); expect(renew).toHaveBeenCalledTimes(1);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_native_commands WHERE kind='decision'").get()?.n).toBe(1);
    } finally { h.db.close(); }
  });

  it("keeps the exact newer executor and proof after a delayed old-executor renewal", async () => {
    const h = fixture();
    try {
      const delayed = deferred<HindsightTransitionStatus>();
      vi.spyOn(h.remote.client, "renewTransition").mockReturnValueOnce(delayed.promise);
      const pending = h.native.renew();
      const key = JSON.stringify([h.bankId, h.status.executor.transition_id]);
      h.remote.status.get(key)!.executor_live = false;
      const current = await h.native.owned(h.bankId);
      expect(current.executor.generation).toBe(h.status.executor.generation + 1);
      delayed.resolve(structuredClone(h.status)); await pending;
      expect(h.native.active.get(h.bankId)).toEqual(current);
      expect(current.proof).toEqual(h.status.proof);
    } finally { h.db.close(); }
  });

  it.each(["bank", "transition", "request", "executor", "revision", "proof", "same-revision-phase"] as const)(
    "refuses incompatible %s responses even after the current entry advanced", async (fault) => {
      const h = fixture();
      try {
        const delayed = deferred<HindsightTransitionStatus>();
        vi.spyOn(h.remote.client, "renewTransition").mockReturnValueOnce(delayed.promise);
        const pending = h.native.renew();
        const response = structuredClone(h.status);
        if (fault === "bank") response.bank_id = "foreign-bank";
        if (fault === "transition") response.executor.transition_id = randomUUID();
        if (fault === "request") response.request = signHindsightTransitionAcquire(h.bankId, { ...response.request, attempt_id: randomUUID() });
        if (fault === "executor") response.executor.fence_token = randomUUID();
        if (fault === "revision") response.revision--;
        if (fault === "proof") response.proof = null;
        if (fault === "same-revision-phase") response.phase = "fenced";
        const newer = h.native.observe({ ...structuredClone(h.status), revision: h.status.revision + 1 });
        const rejected = expect(pending).rejects.toThrow(/INVALID/);
        delayed.resolve(response); await rejected;
        expect(h.native.active.get(h.bankId)).toEqual(newer);
      } finally { h.db.close(); }
    });

  it("rejects same-revision proof/phase divergence and never regresses an accepted lease expiry", async () => {
    const h = fixture();
    try {
      const renewed = { ...structuredClone(h.status), lease_expires_at: "2027-01-01T00:00:00.000Z" };
      vi.spyOn(h.remote.client, "renewTransition").mockResolvedValueOnce(renewed).mockResolvedValueOnce(structuredClone(h.status));
      await h.native.renew(); await h.native.renew();
      expect(h.native.active.get(h.bankId)?.lease_expires_at).toBe(renewed.lease_expires_at);
      const delayed = deferred<HindsightTransitionStatus>();
      vi.mocked(h.remote.client.renewTransition!).mockReturnValueOnce(delayed.promise);
      const pending = h.native.renew();
      h.native.observe({ ...structuredClone(renewed), phase: "fenced" });
      const rejected = expect(pending).rejects.toThrow("PROOF_INVALID");
      delayed.resolve(renewed); await rejected;
    } finally { h.db.close(); }
  });
});
