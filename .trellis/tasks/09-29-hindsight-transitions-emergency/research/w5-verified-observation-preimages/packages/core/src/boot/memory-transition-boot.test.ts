import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigSource } from "../config/config-source.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createHealthyTransitionHarness } from "../testing/memory-transition-healthy-fixtures.ts";
import { hindsightFixtureSecrets } from "../testing/hindsight-runtime-composition-fixtures.ts";
import { W3_AT } from "../testing/memory-transition-candidate-fixtures.ts";
import * as canonical from "../memory/canonical-local-subsystem.ts";
import * as hindsight from "../memory/hindsight/hindsight-memory-subsystem.ts";
import * as publication from "../db/memory-transition-publication-reader.ts";
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
      expect(snapshot).toHaveBeenCalledOnce(); expect(verification).toHaveBeenCalled();
    } finally { await service.stop(); await h.close(); }
  }, 30_000);

  it("still verifies complete publication evidence for a present binding and refuses corrupt stored native evidence", async () => {
    const h = await createHealthyTransitionHarness(); const service = observer(h);
    try {
      const transitionId = await execute(h);
      const snapshot = vi.spyOn(h.runtime, "bindingSnapshot");
      const verification = vi.spyOn(publication, "readVerifiedTransitionPublication");
      const status = service.status(transitionId);
      expect(status.progress.runtime).toBe("ready");
      expect(snapshot).toHaveBeenCalledOnce(); expect(verification).toHaveBeenCalled();
      h.db.prepare("UPDATE memory_authority_selection SET transition_receipt_id=:id WHERE singleton=1").run({ id: "0".repeat(64) });
      expect(h.runtime.hasPublishedBinding("local")).toBe(true);
      expect(() => service.status(transitionId)).toThrow("MEMORY_TRANSITION_PROOF_INVALID");
      h.db.prepare("UPDATE memory_authority_selection SET transition_receipt_id=:id WHERE singleton=1").run({ id: status.transition.receipt!.receiptId });
      // Corrupt only this disposable fixture after a genuine COMMIT. Presence must not hide failed reconstruction.
      h.db.exec("DROP TRIGGER memory_transition_native_evidence_immutable_update");
      h.db.prepare("UPDATE memory_transition_native_evidence SET body=x'7b7d'").run();
      snapshot.mockClear(); verification.mockClear();
      expect(h.runtime.hasPublishedBinding("local")).toBe(true);
      expect(() => service.status(transitionId)).toThrow();
      expect(snapshot).toHaveBeenCalledOnce(); expect(verification).toHaveBeenCalled();
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
});
