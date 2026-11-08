import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createHealthyTransitionHarness } from "../testing/memory-transition-healthy-fixtures.ts";
import { hindsightFixtureSecrets } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import * as canonical from "../memory/canonical-local-subsystem.ts";
import * as hindsight from "../memory/hindsight/hindsight-memory-subsystem.ts";
import * as publication from "../db/memory-transition-publication-reader.ts";
import * as native from "../memory/transitions/transition-native-evidence.ts";
import * as sources from "../db/memory-transition-source-disposition.ts";
import { createMemoryStatusObserver } from "../memory/operations/memory-status-observer.ts";
import { composeMemoryTransitions } from "./memory-transition-boot.ts";

type Harness = Awaited<ReturnType<typeof createHealthyTransitionHarness>>;
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function observer(h: Harness) {
  const { logger } = createCaptureLogger();
  const config = createConfigSource({ repo: createConfigRepo(h.db), env: {
    TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } });
  return composeMemoryTransitions({ db: h.db, config, secrets: hindsightFixtureSecrets().catalog,
    runtime: h.runtime, ownerId: "readiness-observer", actorId: "operator", logger, client: h.remote.client });
}
async function execute(h: Harness, kind: "transition.return-local" | "transition.reenter-hindsight" = "transition.return-local") {
  const operation = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
  const row = h.db.prepare("SELECT transition_id FROM memory_transition_attempts WHERE json_extract(attempt_json,'$.operationId')=:id").get({ id: operation.operationId });
  return String(row!.transition_id);
}
function expectAbsent(h: Harness, service: ReturnType<typeof observer>, input: { transitionId: string; provider: "local" | "hindsight" }) {
  const { transitionId, provider } = input;
  const snapshot = vi.spyOn(h.runtime, provider === "local" ? "bindingSnapshot" : "hindsightBindingSnapshot");
  const verification = vi.spyOn(publication, "readVerifiedTransitionPublication");
  expect(h.runtime.hasPublishedBinding(provider)).toBe(false);
  expect(service.status(transitionId).progress.runtime).toBe("unavailable");
  expect(snapshot).not.toHaveBeenCalled(); expect(verification).not.toHaveBeenCalled();
  snapshot.mockRestore(); verification.mockRestore();
}

describe("production healthy boot readiness", () => {
  it("avoids receipt/corpus reconstruction while the committed Local binding is absent, failed or stopped", async () => {
    const h = await createHealthyTransitionHarness(); const service = observer(h);
    try {
      vi.spyOn(h.runtime.transitions, "bind").mockRejectedValueOnce(new Error("owned binding interruption"));
      const transitionId = await execute(h);
      const receipt = service.status(transitionId).transition.receipt!;
      expect(receipt).not.toBeNull(); expectAbsent(h, service, { transitionId, provider: "local" });
      vi.spyOn(canonical, "createCanonicalLocalSubsystem").mockImplementationOnce(() => { throw new Error("owned draft failure"); });
      expect(() => h.runtime.recoverLocalBinding(receipt.newEpochId)).toThrow("owned draft failure");
      expect(h.runtime.bindingSnapshot().binding.kind).toBe("unavailable");
      expectAbsent(h, service, { transitionId, provider: "local" });
      h.runtime.recoverLocalBinding(receipt.newEpochId);
      expect(h.runtime.hasPublishedBinding("local")).toBe(true);
      expect(service.status(transitionId).progress.runtime).toBe("ready");
      await h.runtime.stop();
      expectAbsent(h, service, { transitionId, provider: "local" });
    } finally { await service.stop(); await h.close(); }
  });

  it("withdraws both retired providers and rejects an old epoch even when a newer Local binding exists", async () => {
    const h = await createHealthyTransitionHarness(); const service = observer(h);
    try {
      const first = await execute(h);
      const second = await execute(h, "transition.reenter-hindsight");
      expect(service.status(second).progress.runtime).toBe("ready");
      expectAbsent(h, service, { transitionId: first, provider: "local" });
      const third = await execute(h);
      expect(service.status(third).progress.runtime).toBe("ready");
      expectAbsent(h, service, { transitionId: second, provider: "hindsight" });
      const snapshot = vi.spyOn(h.runtime, "bindingSnapshot");
      const verification = vi.spyOn(publication, "readVerifiedTransitionPublication");
      expect(h.runtime.hasPublishedBinding("local")).toBe(true);
      expect(service.status(first).progress.runtime).toBe("unavailable");
      expect(snapshot).not.toHaveBeenCalled(); expect(verification).not.toHaveBeenCalled();
    } finally { await service.stop(); await h.close(); }
  }, 30_000);

  it("separates present-binding status from full proof and refuses changed current receipt identity", async () => {
    const h = await createHealthyTransitionHarness(); const service = observer(h);
    try {
      const transitionId = await execute(h);
      const snapshot = vi.spyOn(h.runtime, "bindingSnapshot");
      const verification = vi.spyOn(native, "verifyTransitionNativeEvidence");
      const fullProof = vi.spyOn(publication, "readVerifiedTransitionPublication");
      const status = service.status(transitionId);
      expect(status.progress.runtime).toBe("ready");
      expect(snapshot).not.toHaveBeenCalled(); expect(verification).not.toHaveBeenCalled();
      expect(fullProof).not.toHaveBeenCalled();
      const receiptId = status.transition.receipt!.receiptId;
      expect(h.runtime.verifyTransitionPublication(receiptId)).toMatchObject({ receiptId });
      expect(verification).toHaveBeenCalled(); expect(fullProof).toHaveBeenCalled();
      verification.mockClear(); fullProof.mockClear();
      h.db.transaction(() => {
        h.db.prepare("UPDATE memory_authority_selection SET transition_receipt_id=:id WHERE singleton=1").run({ id: "0".repeat(64) });
      });
      expect(h.runtime.hasPublishedBinding("local")).toBe(true);
      expect(() => service.status(transitionId)).toThrow("MEMORY_TRANSITION_STALE");
      expect(verification).not.toHaveBeenCalled(); expect(fullProof).not.toHaveBeenCalled();
      h.db.transaction(() => {
        h.db.prepare("UPDATE memory_authority_selection SET transition_receipt_id=:id WHERE singleton=1").run({ id: receiptId });
        // Historical-only damage belongs to the next full boundary, not ordinary status observation.
        h.db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_update");
        h.db.prepare("UPDATE memory_transition_native_evidence SET body=x'7b7d'").run();
      });
      expect(h.runtime.hasPublishedBinding("local")).toBe(true);
      expect(service.status(transitionId).progress.runtime).toBe("ready");
      expect(verification).not.toHaveBeenCalled(); expect(fullProof).not.toHaveBeenCalled();
      expect(() => h.runtime.verifyTransitionPublication(receiptId)).toThrow(ZodError);
      expect(fullProof).toHaveBeenCalled();
      expect(h.runtime.hasPublishedBinding("local")).toBe(false);
      fullProof.mockClear();
      expect(service.status(transitionId).progress.runtime).toBe("unavailable");
      expect(fullProof).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
    } finally { await service.stop(); await h.close(); }
  });

  it("does not read a Hindsight snapshot after failed replacement or process stop", async () => {
    const h = await createHealthyTransitionHarness(); const service = observer(h);
    try {
      await execute(h);
      const transitionId = await execute(h, "transition.reenter-hindsight");
      const receipt = service.status(transitionId).transition.receipt!;
      expect(service.status(transitionId).progress.runtime).toBe("ready");
      vi.spyOn(hindsight, "createHindsightMemorySubsystem").mockImplementationOnce(() => { throw new Error("owned replacement failure"); });
      await expect(h.runtime.replaceHindsightBinding(receipt.newEpochId)).rejects.toThrow("owned replacement failure");
      expectAbsent(h, service, { transitionId, provider: "hindsight" });
      h.runtime.recoverHindsightBinding(receipt.newEpochId);
      expect(service.status(transitionId).progress.runtime).toBe("ready");
      await h.runtime.stop();
      expectAbsent(h, service, { transitionId, provider: "hindsight" });
    } finally { await service.stop(); await h.close(); }
  }, 20_000);

  it.each(["application-checkpoint", "native-pair", "preparation", "delta"])("validates Hindsight %s at its owning boundary after warm status reads", async (damage) => {
    const h = await createHealthyTransitionHarness(); const service = observer(h);
    const currentStatus = createMemoryStatusObserver({ db: h.db, runtime: h.runtime });
    try {
      await execute(h); const transitionId = await execute(h, "transition.reenter-hindsight");
      const status = service.status(transitionId);
      expect(status.progress.runtime).toBe("ready");
      const receiptId = status.transition.receipt!.receiptId;
      expect(h.runtime.verifyTransitionPublication(receiptId)).toMatchObject({ receiptId });
      const classify = vi.spyOn(sources, "classifyTransitionSources");
      const fullProof = vi.spyOn(publication, "readVerifiedTransitionPublication");
      expect(service.status(transitionId).progress.runtime).toBe("ready");
      expect(currentStatus.readRuntime().runtime.unavailableReason).toBeNull();
      expect(classify).not.toHaveBeenCalled(); expect(fullProof).not.toHaveBeenCalled();
      h.db.transaction(() => {
        if (damage === "application-checkpoint") h.db.exec("DELETE FROM hindsight_application_replica_checkpoints");
        if (damage === "native-pair") h.db.exec("UPDATE hindsight_replica_sync_checkpoints SET end_cursor=end_cursor+1");
        if (damage === "preparation") {
          h.db.exec("DROP TRIGGER memory_transition_preparations_immutable_delete");
          h.db.exec("DELETE FROM memory_transition_preparations");
        }
        if (damage === "delta") {
          h.db.exec("DROP TRIGGER memory_transition_delta_results_immutable_update");
          h.db.exec("UPDATE memory_transition_delta_results SET body=x'7b7d'");
        }
      });
      // Transition progress observes the binding; current evidence status separately consumes checkpoints.
      expect(service.status(transitionId).progress.runtime).toBe("ready");
      if (damage === "application-checkpoint" || damage === "native-pair") {
        expect(currentStatus.readRuntime().runtime).toMatchObject({ present: true, unavailableReason: "evidence_invalid", replica: null, pending: null });
        expect(() => h.runtime.operations()!.assertConnection()).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      } else {
        expect(currentStatus.readRuntime().runtime.unavailableReason).toBeNull();
      }
      expect(h.runtime.hasPublishedBinding("hindsight")).toBe(true);
      expect(classify).not.toHaveBeenCalled(); expect(fullProof).not.toHaveBeenCalled();
      expect(() => h.runtime.verifyTransitionPublication(receiptId)).toThrow(damage === "delta" ? ZodError : "MEMORY_TRANSITION_PROOF_INVALID");
      expect(fullProof).toHaveBeenCalled();
      expect(h.runtime.hasPublishedBinding("hindsight")).toBe(false);
      fullProof.mockClear();
      expect(service.status(transitionId).progress.runtime).toBe("unavailable");
      expect(currentStatus.readRuntime().runtime.unavailableReason).toBe("authority_invalid");
      expect(fullProof).not.toHaveBeenCalled();
    } finally { currentStatus.close(); await service.stop(); await h.close(); }
  }, 20_000);
});
