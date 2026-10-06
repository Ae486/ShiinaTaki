import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { composeEmergencyFixture } from "../../testing/memory-transition-emergency-service-fixtures.ts";
import { createEmergencyCandidateFixture } from "../../testing/memory-transition-emergency-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readTransitionAttempt } from "../../db/memory-transition-repo.ts";
import { readTransitionReceipt } from "../../db/memory-transition-evidence-repo.ts";
import { publishMemoryTransition } from "../../db/memory-transition-publication-repo.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import * as candidates from "../../db/memory-transition-emergency-candidate.ts";
import * as leases from "../../db/memory-transition-repo.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

async function fixture() {
  const h = await createHealthyTransitionHarness();
  for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
    const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
    expect(h.owner.status(operation.operationId).state).toBe("completed");
  }
  const e = composeEmergencyFixture(h);
  return { h, e, close: async () => { await e.stopEmergency(); await h.close(); } };
}

describe("offline emergency executor lifetime", () => {
  it("renews the same executor across independent work totaling over five minutes with zero Native dispatch", async () => {
    const f = await fixture();
    try {
      const request = await f.e.emergencyRequest(); const before = { ...f.h.remote.calls };
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      const advance = async () => {
        f.h.clock.value = new Date(Date.parse(f.h.clock.value) + 180_000).toISOString();
        await vi.advanceTimersByTimeAsync(180_000);
      };
      const copy = f.h.db.backupTo.bind(f.h.db);
      vi.spyOn(f.h.db, "backupTo").mockImplementationOnce(async (path) => { const pages = await copy(path); await advance(); return pages; });
      const bind = f.h.runtime.transitions.bind;
      vi.spyOn(f.h.runtime.transitions, "bind").mockImplementationOnce(async (id) => { const value = await bind(id); await advance(); return value; });
      const operation = f.e.emergencyOwner.submit(request); await f.e.emergencyOwner.stop();
      expect(f.e.emergencyOwner.status(operation.operationId).state).toBe("completed");
      const id = operation.producer!.kind === "transition" ? operation.producer!.transitionId : "";
      expect(readTransitionAttempt(f.h.db, id)).toMatchObject({ generation: 1, phase: "terminal" });
      expect(Date.parse(f.h.clock.value) - Date.parse(W3_AT)).toBe(360_000);
      expect(f.h.remote.calls).toEqual(before);
      await f.close(); expect(vi.getTimerCount()).toBe(0);
    } finally { await f.close(); }
  }, 30_000);

  it.each(["copy", "after-commit"] as const)("does not renew an expired executor at %s or pretend a committed receipt rolled back", async (at) => {
    const f = await fixture();
    try {
      const request = await f.e.emergencyRequest();
      const expired = () => { f.h.clock.value = new Date(Date.parse(f.h.clock.value) + 300_001).toISOString(); };
      if (at === "copy") {
        const copy = f.h.db.backupTo.bind(f.h.db);
        vi.spyOn(f.h.db, "backupTo").mockImplementationOnce(async (path) => { const pages = await copy(path); expired(); return pages; });
      } else {
        const bind = f.h.runtime.transitions.bind;
        vi.spyOn(f.h.runtime.transitions, "bind").mockImplementationOnce(async (id) => { const value = await bind(id); expired(); return value; });
      }
      const operation = f.e.emergencyOwner.submit(request); await f.e.emergencyOwner.stop();
      expect(f.e.emergencyOwner.status(operation.operationId).state).toBe("outcome_unknown");
      const id = operation.producer!.kind === "transition" ? operation.producer!.transitionId : "";
      const receipt = readTransitionReceipt(f.h.db, id);
      expect(!!receipt).toBe(at === "after-commit");
      expect(readMemoryAuthoritySelection(f.h.db).epochId).toBe(receipt?.newEpochId ?? request.expected.predecessorEpochId);
      expect(readTransitionAttempt(f.h.db, id)!.generation).toBe(1);
    } finally { await f.close(); }
  }, 30_000);

  it.each(["stop", "renewal-failed", "foreign-owner"] as const)("stops after %s without publishing or adopting a different executor", async (fault) => {
    const f = await fixture(); let stopping: Promise<void> | undefined;
    try {
      const request = await f.e.emergencyRequest(); const before = { ...f.h.remote.calls };
      vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
      let transitionId = "";
      const copy = f.h.db.backupTo.bind(f.h.db);
      vi.spyOn(f.h.db, "backupTo").mockImplementationOnce(async (path) => {
        const pages = await copy(path);
        if (fault === "stop") stopping = f.e.emergency.stop();
        if (fault === "renewal-failed") {
          vi.spyOn(leases, "renewTransitionLease").mockImplementationOnce(() => { throw new Error("MEMORY_TRANSITION_LEASE_LOST"); });
          await vi.advanceTimersByTimeAsync(30_000);
        }
        if (fault === "foreign-owner") {
          const attempt = readTransitionAttempt(f.h.db, transitionId)!;
          f.h.db.prepare("UPDATE memory_transition_attempts SET attempt_json=:json WHERE transition_id=:id")
            .run({ id: transitionId, json: JSON.stringify({ ...attempt, ownerId: "foreign-owner" }) });
        }
        return pages;
      });
      const operation = f.e.emergencyOwner.submit(request);
      transitionId = operation.producer!.kind === "transition" ? operation.producer!.transitionId : "";
      await f.e.emergencyOwner.stop(); await stopping;
      expect(f.e.emergencyOwner.status(operation.operationId).state).toBe("outcome_unknown");
      expect(readTransitionReceipt(f.h.db, transitionId)).toBeUndefined();
      expect(readMemoryAuthoritySelection(f.h.db).epochId).toBe(request.expected.predecessorEpochId);
      expect(readTransitionAttempt(f.h.db, transitionId)!.ownerId).toBe(fault === "foreign-owner" ? "foreign-owner" : "emergency-owner");
      expect(f.h.remote.calls).toEqual(before);
      await f.close(); expect(vi.getTimerCount()).toBe(0);
    } finally { await f.close(); }
  }, 30_000);
});

describe("emergency COMMIT final real-clock fence", () => {
  it.each(["candidate", "complete-readback"] as const)("rolls back every authority effect on expiry during %s while retaining the original seal", async (at) => {
    const f = await createEmergencyCandidateFixture();
    try {
      const work = f.prove(); const source = readMemoryAuthoritySelection(f.db);
      const expires = readTransitionAttempt(f.db, f.intent.transitionId)!.leaseUntil;
      if (at === "candidate") {
        const read = candidates.readVerifiedEmergencyCandidate;
        vi.spyOn(candidates, "readVerifiedEmergencyCandidate").mockImplementationOnce((...args) => {
          const value = read(...args); f.clock.value = expires; return value;
        });
      } else work.currentTime = () => {
        expect(f.db.prepare("SELECT active_epoch_id FROM memory_authority_selection").get()?.active_epoch_id).toBe(f.candidate.targetEpochId);
        expect(readTransitionReceipt(f.db, f.intent.transitionId)).toBeDefined();
        return expires;
      };
      expect(() => publishMemoryTransition(f.db, work)).toThrow("MEMORY_TRANSITION_LEASE_LOST");
      expect(readMemoryAuthoritySelection(f.db)).toEqual(source);
      expect(readTransitionReceipt(f.db, f.intent.transitionId)).toBeUndefined();
      expect(f.db.prepare("SELECT * FROM memory_transition_foreign_branches").all()).toEqual([]);
      expect(f.db.prepare("SELECT * FROM canonical_memory_authority_epochs WHERE epoch_id=:id").get({ id: f.candidate.targetEpochId })).toBeUndefined();
      expect(readTransitionAttempt(f.db, f.intent.transitionId)!.phase).toBe("proven");
      expect(await f.store.readIncident(f.capture.incidentId)).toEqual(f.sealed.manifest);
    } finally { await f.close(); }
  }, 30_000);
});
