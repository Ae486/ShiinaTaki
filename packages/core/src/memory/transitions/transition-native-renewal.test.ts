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
import { HindsightTransitionRefusal } from "../hindsight/hindsight-transition-client.ts";

afterEach(() => vi.restoreAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
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
  it.each(["before", "after"] as const)("joins the original terminal decision when renewal is refused %s its response", async (order) => {
    const h = fixture();
    try {
      const renewal = deferred<HindsightTransitionStatus>();
      const outcome = deferred<void>(); const dispatched = deferred<void>();
      const renew = vi.spyOn(h.remote.client, "renewTransition").mockReturnValueOnce(renewal.promise);
      const original = h.remote.client.resolveTransition!;
      const resolve = vi.spyOn(h.remote.client, "resolveTransition").mockImplementationOnce(async (input) => {
        const terminal = await original(input); terminal.revision++;
        dispatched.resolve(); await outcome.promise; return terminal;
      });
      const pending = h.native.renew();
      const resolving = h.native.resolve(h.bankId, { disposition: "retire", receiptId: "a".repeat(64) });
      await dispatched.promise;
      const refusal = new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: "executor_lost" });
      if (order === "after") { outcome.resolve(); await resolving; }
      const result = pending.then(() => null, (error: unknown) => error);
      renewal.reject(refusal);
      // Let the refusal arrive before the separately delayed successful decision response.
      await new Promise<void>((done) => setImmediate(done));
      outcome.resolve(); const terminal = await resolving; expect(await result).toBeNull();
      expect(h.native.active.get(h.bankId)).toEqual(terminal);
      await h.native.renew(); expect(renew).toHaveBeenCalledTimes(1);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(h.db.prepare("SELECT count(*) n FROM memory_transition_native_commands WHERE kind='decision'").get()?.n).toBe(1);
    } finally { h.db.close(); }
  });

  it.each(["unresolved", "foreign-executor", "foreign-decision", "changed-proof", "other-error", "other-refusal", "decision-failed"] as const)(
    "does not hide renewal failure with %s", async (fault) => {
      const h = fixture();
      try {
        const renewal = deferred<HindsightTransitionStatus>();
        vi.spyOn(h.remote.client, "renewTransition").mockReturnValueOnce(renewal.promise);
        const pending = h.native.renew();
        const rejected = expect(pending).rejects.toThrow();
        if (!["unresolved", "decision-failed"].includes(fault)) {
          const original = h.remote.client.resolveTransition!;
          vi.spyOn(h.remote.client, "resolveTransition").mockImplementationOnce(async (input) => {
            const terminal = await original(input); terminal.revision++; return terminal;
          });
          const terminal = await h.native.resolve(h.bankId, { disposition: "retire", receiptId: "a".repeat(64) });
          if (fault === "foreign-executor") h.native.active.set(h.bankId,
            { ...terminal, executor: { ...terminal.executor, fence_token: randomUUID() } });
          if (fault === "changed-proof") h.native.active.set(h.bankId, { ...terminal, proof: null });
          if (fault === "foreign-decision") {
            const changed = structuredClone(terminal); changed.outcome!.request.decision_id = randomUUID();
            h.native.active.set(h.bankId, changed);
          }
        }
        let resolving: Promise<unknown> | undefined;
        let failedDecision: ReturnType<typeof deferred<HindsightTransitionStatus>> | undefined;
        if (fault === "decision-failed") {
          failedDecision = deferred<HindsightTransitionStatus>(); const sent = deferred<void>();
          vi.spyOn(h.remote.client, "resolveTransition").mockImplementationOnce(() => { sent.resolve(); return failedDecision!.promise; });
          resolving = expect(h.native.resolve(h.bankId, { disposition: "retire", receiptId: "a".repeat(64) })).rejects.toThrow("decision failed");
          await sent.promise;
        }
        renewal.reject(fault === "other-error" ? new Error("HINDSIGHT_TIMEOUT")
          : new HindsightTransitionRefusal({ error: "taki_transition_refused", reason: fault === "other-refusal" ? "transition_not_found" : "executor_lost" }));
        await new Promise<void>((done) => setImmediate(done));
        failedDecision?.reject(new Error("decision failed"));
        await resolving; await rejected;
      } finally { h.db.close(); }
    });

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
