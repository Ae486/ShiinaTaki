import { describe, expect, it, vi } from "vitest";
import { MemoryTransitionPreviewSchema, type MemoryTransitionOverview, type MemoryTransitionPreview } from "@taki/shared";
import { createMemoryTransitionsController, INITIAL_TRANSITIONS, type MemoryTransitionsClient } from "./memory-transitions-controller.ts";
import { hindsightStatus, operation } from "./memory-authority-fixtures.ts";
import { activationStatus } from "./hindsight-activation-fixtures.ts";
import { transitionRequest } from "./memory-transition-state.ts";

const id = () => crypto.randomUUID();
const hash = "a".repeat(64);
function preview(kind: MemoryTransitionPreview["kind"] = "transition.return-local"): MemoryTransitionPreview {
  return MemoryTransitionPreviewSchema.parse({ version: kind === "transition.emergency-local" ? 2 : 1, previewId: id(), kind,
    previewHash: hash, expected: { predecessorEpochId: "source", sourceProvider: "hindsight", sourceLineageId: "remote",
      targetProvider: "local", targetLineageId: "local", configRevision: 1, configFingerprint: hash, inventoryRevision: 1,
      inventoryHash: hash, baselineReceiptId: null, baselineHash: null, custodyBoundaryHash: hash,
      banks: [{ scope: { kind: "global", characterId: null }, sourceBankId: "global", targetBankId: null, sourceRevision: 1,
        nativeBankId: "global", nativeGeneration: "generation", manifestHash: hash, mappingHash: hash, policyRevision: 1, blockRevision: 1 }] },
    actorId: "operator", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString(),
    capabilityHash: kind === "transition.emergency-local" ? null : hash, recovery: null,
    ...(kind === "transition.emergency-local" ? { takeover: "eligible", inventory: "complete", banks: [], lastVerifiedBackupId: null,
      backupAgeSeconds: null, blocking: [], offline: true, remoteHead: "unknown", remoteLoss: "unknown" } : {}) });
}
const overview = (): MemoryTransitionOverview => ({ provider: "hindsight", epochId: "source", actions: [
  { kind: "transition.return-local", allowed: true, reason: null }, { kind: "transition.reenter-hindsight", allowed: false, reason: "wrong-provider" },
  { kind: "transition.emergency-local", allowed: true, reason: null }], entries: [], hasOlder: false });
const settle = () => new Promise((resolve) => setImmediate(resolve));
function fake() {
  const order: string[] = [];
  const client = { memoryAuthorityStatus: async () => hindsightStatus(), memoryActivationStatus: async () => activationStatus(),
    memoryOperationSubmit: vi.fn(async () => operation()), memoryOperationCancel: vi.fn(async () => operation()),
    subscribeMemoryOperations: vi.fn(async () => { order.push("subscribe"); }), onMemoryOperationChanged: vi.fn(() => () => undefined),
    memoryTransitionOverview: vi.fn(async () => { order.push("read"); return overview(); }),
    memoryTransitionPreview: vi.fn(async (params) => preview(params.kind)),
  } satisfies MemoryTransitionsClient;
  let state = INITIAL_TRANSITIONS;
  const controller = createMemoryTransitionsController((next) => { state = next; });
  return { client, controller, state: () => state, order };
}

describe("transition confirmation controller", () => {
  it("subscribes before reading, confirms exactly once and refetches after admission", async () => {
    const h = fake(); h.controller.replace(h.client); await settle();
    expect(h.order).toEqual(["subscribe", "read"]);
    await h.controller.preview("transition.return-local");
    const original = h.state().preview!;
    await Promise.all([h.controller.confirm(), h.controller.confirm()]);
    expect(h.client.memoryOperationSubmit).toHaveBeenCalledTimes(1);
    expect(h.client.memoryOperationSubmit).toHaveBeenCalledWith(expect.objectContaining({ previewId: original.previewId, confirmation: "healthy-switch" }));
    expect(h.order.at(-1)).toBe("read"); h.controller.dispose();
  });
  it("does not replay a lost submit across replacement or remount and ignores a retired preview", async () => {
    const h = fake(); h.controller.replace(h.client); await settle();
    await h.controller.preview("transition.return-local");
    h.client.memoryOperationSubmit.mockRejectedValueOnce(new Error("connection lost"));
    await h.controller.confirm(); h.controller.replace(null); h.controller.replace(h.client); await settle();
    await h.controller.confirm(); expect(h.client.memoryOperationSubmit).toHaveBeenCalledTimes(1);
    let resolve!: (value: MemoryTransitionPreview) => void;
    h.client.memoryTransitionPreview.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = h.controller.preview("transition.return-local"); h.controller.replace(null);
    resolve(preview()); await pending; expect(h.state().preview).toBeNull(); h.controller.dispose();
  });
  it("keeps emergency separate and refuses a disclosure with no admissible identity", async () => {
    const h = fake(); h.controller.replace(h.client); await settle();
    await h.controller.preview("transition.emergency-local"); await h.controller.confirm();
    expect(h.client.memoryOperationSubmit).toHaveBeenCalledWith(expect.objectContaining({ confirmation: "emergency-takeover" }));
    const refused = MemoryTransitionPreviewSchema.parse({ ...preview("transition.emergency-local"), takeover: "refused", expected: null, blocking: ["source-unavailable"] });
    expect(transitionRequest(refused, id())).toBeNull();
    h.client.memoryTransitionPreview.mockResolvedValueOnce(refused);
    await h.controller.preview("transition.emergency-local"); await h.controller.confirm();
    expect(h.state().preview).toEqual(refused); expect(h.client.memoryOperationSubmit).toHaveBeenCalledTimes(1); h.controller.dispose();
  });
  it("preserves last-good status after a read error and rejects stale selection/expired confirmation", async () => {
    const h = fake(); h.controller.replace(h.client); await settle();
    const stale = { ...preview(), expiresAt: "2020-01-01T00:00:00.000Z" };
    h.client.memoryTransitionPreview.mockResolvedValueOnce(stale); await h.controller.preview(stale.kind); await h.controller.confirm();
    expect(h.state().previewError).toContain("过期"); expect(h.client.memoryOperationSubmit).not.toHaveBeenCalled();
    h.client.memoryTransitionOverview.mockRejectedValueOnce(new Error("read failure")); await h.controller.refresh();
    expect(h.state().status).toEqual(overview()); expect(h.state().error).not.toBeNull();
    await h.controller.preview("transition.emergency-local"); expect(h.state().preview).toBeNull(); h.controller.dispose();
  });
});
