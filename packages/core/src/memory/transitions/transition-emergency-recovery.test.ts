import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHealthyTransitionHarness, composeHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { composeEmergencyFixture } from "../../testing/memory-transition-emergency-service-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { readMemoryAuthoritySelection } from "../legacy-migration/legacy-activation-repo.ts";
import { readEmergencyCapture, readEmergencyIncident } from "../../db/memory-transition-emergency-repo.ts";
import { readTransitionReceipt } from "../../db/memory-transition-evidence-repo.ts";
import { readTransitionAttempt } from "../../db/memory-transition-repo.ts";
import { createHindsightBackupStore } from "../hindsight-backup/hindsight-backup-store.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createTimelineRepo } from "../../db/timeline-repo.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("offline emergency crash boundaries with a physically reopened Core", () => {
  it.each(["seal-before-ack", "ack-before-candidate", "before-commit", "commit-reply", "binding"] as const)("recovers %s using original incident and receipt identities", async (boundary) => {
    const h = await createHealthyTransitionHarness({ aliases: true });
    let reopened: Database | undefined;
    let next: ReturnType<typeof composeHealthyTransitionHarness> | undefined;
    let recovery: ReturnType<typeof composeEmergencyFixture> | undefined;
    let e: ReturnType<typeof composeEmergencyFixture> | undefined;
    try {
      for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
        const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
        expect(h.owner.status(operation.operationId).state).toBe("completed");
      }
      e = composeEmergencyFixture(h); const before = { ...h.remote.calls };
      if (boundary === "seal-before-ack") h.db.exec("CREATE TRIGGER owned_fault BEFORE INSERT ON memory_transition_incidents BEGIN SELECT RAISE(ABORT,'owned ACK interruption'); END");
      if (boundary === "ack-before-candidate") h.db.exec("CREATE TRIGGER owned_fault BEFORE INSERT ON memory_transition_surviving_evidence BEGIN SELECT RAISE(ABORT,'owned post ACK interruption'); END");
      if (boundary === "before-commit" || boundary === "commit-reply") {
        const publish = h.runtime.transitions.publish.bind(h.runtime.transitions);
        vi.spyOn(h.runtime.transitions, "publish").mockImplementationOnce((work) => {
          if (boundary === "commit-reply") publish(work);
          throw new Error("owned publication interruption");
        });
      }
      if (boundary === "binding") vi.spyOn(h.runtime.transitions, "bind").mockRejectedValueOnce(new Error("owned binding interruption"));
      const operation = e.emergencyOwner.submit(await e.emergencyRequest()); await e.emergencyOwner.stop();
      expect(e.emergencyOwner.status(operation.operationId).state).toBe("outcome_unknown");
      const id = operation.producer!.kind === "transition" ? operation.producer!.transitionId : "";
      const capture = readEmergencyCapture(h.db, id)!; const receipt = readTransitionReceipt(h.db, id);
      expect(!!receipt).toBe(boundary === "commit-reply" || boundary === "binding");
      const incident = await createHindsightBackupStore(h.dataDir).readIncident(capture.incidentId);
      expect(incident).not.toBeNull();
      expect(!!readEmergencyIncident(h.db, id)).toBe(boundary !== "seal-before-ack");
      const generation = readTransitionAttempt(h.db, id)!.generation;
      h.db.exec("DROP TRIGGER IF EXISTS owned_fault");
      await e.stopEmergency(); await h.stop(); h.db.close();
      h.clock.value = "2026-10-01T00:06:00.000Z";
      reopened = openDatabase({ path: join(h.dataDir, "memory.sqlite"), migrations: MIGRATIONS });
      next = composeHealthyTransitionHarness({ db: reopened, dataDir: h.dataDir, timeline: createTimelineRepo(reopened), remote: h.remote, clock: h.clock });
      recovery = composeEmergencyFixture({ db: reopened, dataDir: h.dataDir, runtime: next.runtime, remote: h.remote, clock: h.clock });
      const recovered = recovery.emergencyOwner.submit(await recovery.emergencyRequest(id)); await recovery.emergencyOwner.stop();
      expect(recovery.emergencyOwner.status(recovered.operationId)).toMatchObject({ state: "completed", result: { authorityCommitted: true, runtime: "ready" } });
      expect(readEmergencyCapture(reopened, id)).toEqual(capture);
      expect(readEmergencyIncident(reopened, id)).toEqual(incident);
      const final = readTransitionReceipt(reopened, id)!;
      if (receipt) expect(final).toEqual(receipt);
      expect(readMemoryAuthoritySelection(reopened).epochId).toBe(final.newEpochId);
      expect(readTransitionAttempt(reopened, id)!.generation).toBe(generation + 1);
      expect(reopened.prepare("SELECT count(*) AS n FROM memory_transition_incidents").get()?.n).toBe(1);
      expect(recovery.emergencyOwner.status(operation.operationId).state).toBe("outcome_unknown");
      expect(next.runtime.hasPublishedBinding("hindsight")).toBe(false);
      await expect(recovery.emergency.preview({ kind: "transition.reenter-hindsight" })).rejects.toThrow();
      expect(h.remote.calls).toEqual(before);
    } finally {
      await recovery?.stopEmergency(); await next?.stop(); reopened?.close();
      // The original fixture closes an already closed handle safely and owns only its synthetic temporary directory.
      await e?.stopEmergency(); await h.close();
    }
  }, 30_000);
});
