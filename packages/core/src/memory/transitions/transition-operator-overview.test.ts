import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { composeEmergencyFixture } from "../../testing/memory-transition-emergency-service-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { transitionOperatorReason } from "./transition-operator-actions.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Core transition operator projection", () => {
  it("derives initial actions, actual preclaim cancellation and completed Local history without probing Native", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const before = { ...h.remote.calls };
      expect(h.service.overview().actions).toEqual([
        { kind: "transition.return-local", allowed: true, reason: null },
        { kind: "transition.reenter-hindsight", allowed: false, reason: "wrong-provider" },
        { kind: "transition.emergency-local", allowed: true, reason: null },
      ]);
      expect(h.remote.calls).toEqual(before);
      const op = h.owner.submit(await h.request());
      expect(h.service.overview().entries[0]?.cancel.allowed).toBe(true);
      expect(h.service.overview().actions.find((a) => a.kind === "transition.emergency-local")?.allowed).toBe(true);
      h.owner.cancel(op.operationId);
      expect(h.service.overview().entries[0]?.cancel.reason).toBe("settled");
      const next = h.owner.submit(await h.request()); await h.owner.stop();
      expect(h.owner.status(next.operationId).state).toBe("completed");
      const local = h.service.overview();
      expect(local.provider).toBe("local");
      expect(local.actions.find((a) => a.kind === "transition.reenter-hindsight")?.allowed).toBe(true);
      expect(local.entries[0]?.status.progress.runtime).toBe("ready");
      expect(local.entries[0]?.recovery.reason).toBe("settled");
    } finally { await h.close(); }
  }, 20_000);

  it("shows original emergency evidence and never waits for native release; quarantine disables old recovery", async () => {
    const h = await createHealthyTransitionHarness({ aliases: true });
    for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
      const seeded = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
      expect(h.owner.status(seeded.operationId).state).toBe("completed");
    }
    const e = composeEmergencyFixture(h);
    try {
      h.remote.fault.verifyReply = true;
      const old = h.owner.submit(await h.request()); await h.owner.stop();
      h.clock.value = "2026-10-01T00:06:00.000Z";
      expect(h.service.overview().entries[0]?.recovery.allowed).toBe(true);
      expect(h.service.overview().actions.find((a) => a.kind === "transition.return-local")?.reason).toBe("busy");
      const before = { ...h.remote.calls };
      const op = e.emergencyOwner.submit(await e.emergencyRequest());
      const admitted = e.emergency.overview();
      expect(admitted.entries.find((row) => row.operation.operationId === op.operationId)?.status.progress.nativeReleasePending).toBe(false);
      expect(admitted.entries.find((row) => row.operation.operationId === old.operationId)?.recovery.reason).toBe("quarantined");
      await e.emergencyOwner.stop();
      const final = e.emergency.overview();
      expect(final.provider).toBe("local");
      expect(final.entries[0]?.operation.state).toBe("completed");
      expect(final.entries[0]?.emergency?.banks.length).toBeGreaterThan(0);
      expect(final.entries[0]?.emergency?.lastVerifiedBackupId).toBeNull();
      expect(final.actions.find((a) => a.kind === "transition.reenter-hindsight")?.reason).toBe("foreign-branch");
      expect(h.remote.calls).toEqual(before);
    } finally { await e.stopEmergency(); await h.close(); }
  }, 20_000);

  it("sanitizes closed refusals without forwarding private exception text", () => {
    expect(transitionOperatorReason(new Error("HINDSIGHT_EXTENSION_UNSUPPORTED: private-url"))).toBe("capability");
    expect(transitionOperatorReason(new Error("MEMORY_TRANSITION_STALE"))).toBe("stale");
    expect(transitionOperatorReason(new Error("credential secret"))).toBe("unavailable");
  });

  it("keeps committed unavailable state distinct and refuses recovery after configuration drift", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      vi.spyOn(h.runtime.transitions, "bind").mockRejectedValueOnce(new Error("owned binding unavailable"));
      const op = h.owner.submit(await h.request()); await h.owner.stop();
      const entry = h.service.overview().entries[0]!;
      expect(entry.operation.operationId).toBe(op.operationId);
      expect(entry.status.transition.receipt).not.toBeNull();
      expect(entry.status.progress.runtime).toBe("unavailable");
      expect(entry.cancel.allowed).toBe(false); expect(entry.recovery.reason).toBe("lease-active");
      expect(h.service.overview().actions.find((a) => a.kind === "transition.reenter-hindsight")?.reason).toBe("busy");
      h.clock.value = "2026-10-01T00:06:00.000Z";
      expect(h.service.overview().entries[0]?.recovery.allowed).toBe(true);
      h.db.exec("UPDATE hindsight_connection_state SET revision=revision+1 WHERE singleton=1");
      const drift = h.service.overview().entries[0]!;
      expect(drift.recovery.reason).toBe("configuration"); expect(drift.status.recoverable).toBe(false);
    } finally { await h.close(); }
  }, 20_000);

  it("does not let emergency bypass unrelated exclusive setup work", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const repo = createMemoryOperationRepo(h.db, () => h.clock.value);
      const operationId = crypto.randomUUID();
      repo.insertAdmitted({ operationId, kind: "setup.validate", family: "setup", authorityEpochId: null,
        request: { kind: "setup.validate", expectedRevision: 1 }, producer: { kind: "setup", attemptId: null, revisionBefore: 1, revisionAfter: null }, bootId: "owned-busy" });
      expect(h.service.overview().actions.filter((a) => a.kind !== "transition.reenter-hindsight").map((a) => a.reason)).toEqual(["busy", "busy"]);
      repo.transition({ operationId, expectedState: "admitted", patch: { state: "failed", reason: "producer_failed" } });
    } finally { await h.close(); }
  });

  it.each(["binding", "resolveReply"] as const)("allows the next complete cycle after %s recovery while preserving the old unknown row", async (fault) => {
    const h = await createHealthyTransitionHarness();
    try {
      if (fault === "binding") vi.spyOn(h.runtime.transitions, "bind").mockRejectedValueOnce(new Error("owned bind failure"));
      else h.remote.fault.resolveReply = true;
      const original = h.owner.submit(await h.request()); await h.owner.stop();
      const originalRow = h.db.prepare("SELECT * FROM memory_operations WHERE operation_id=:id").get({ id: original.operationId });
      const entry = h.service.overview().entries[0]!;
      expect(entry.operation.state).toBe("outcome_unknown");
      expect(entry.status.transition.receipt).not.toBeNull();
      expect(h.service.overview().actions.find((a) => a.kind === "transition.reenter-hindsight")?.reason).toBe("busy");
      h.clock.value = "2026-10-01T00:06:00.000Z"; h.remote.fault.unavailable = false;
      expect(h.service.overview().entries[0]?.recovery.allowed).toBe(true);
      const recovered = h.owner.submit(await h.request(entry.status.transition.intent.transitionId)); await h.owner.stop();
      expect(h.owner.status(recovered.operationId).state).toBe("completed");
      for (const kind of ["transition.reenter-hindsight", "transition.return-local"] as const) {
        expect(h.service.overview().actions.find((a) => a.kind === kind)).toEqual({ kind, allowed: true, reason: null });
        const next = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
        expect(h.owner.status(next.operationId).state).toBe("completed");
      }
      expect(h.db.prepare("SELECT * FROM memory_operations WHERE operation_id=:id").get({ id: original.operationId })).toEqual(originalRow);
      const history = h.service.overview().entries.find((row) => row.operation.operationId === original.operationId)!;
      expect(history.operation.state).toBe("outcome_unknown");
      expect(history.recovery.reason).toBe("settled");
      expect(history.currentAuthority).toBe(false);
      expect(h.db.prepare("SELECT count(*) AS n FROM memory_transition_receipts").get()?.n).toBe(3);
    } finally { await h.close(); }
  }, 30_000);
});
