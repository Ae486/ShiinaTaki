import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryOperationSubmitResultSchema, MemoryTransitionPreviewSchema, MemoryTransitionReadSchema } from "@taki/shared";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { createLogger } from "../../logging/logger.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { createMemoryOperationSubscriptions } from "../memory-operation-subscriptions.ts";
import { registerMemoryOperationMethods } from "./memory-operation-methods.ts";
import { registerMemoryTransitionMethods } from "./memory-transition-methods.ts";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT); });
afterEach(() => vi.useRealTimers());

function context(role: "operator" | "node"): MethodContext {
  return { connection: { state: { status: "authenticated", deviceId: randomUUID(), role, capabilities: [] } },
    notify: () => undefined, close: () => undefined, onClose: () => undefined };
}

describe("healthy transition production method wiring", () => {
  it("gates the overview by operator role and emits only closed preview/status reasons", async () => {
    const registry = createMethodRegistry();
    registerMemoryTransitionMethods(registry, {
      preview: async () => { throw new Error("HINDSIGHT_EXTENSION_UNSUPPORTED: private credential"); },
      status: () => { throw new Error("MEMORY_TRANSITION_STALE"); },
      overview: () => { throw new Error("private endpoint"); },
    });
    const dispatch = (role: "operator" | "node", method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: 1, method, params }, context(role));
    expect(await dispatch("node", "memory.transitions.overview", {})).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(await dispatch("operator", "memory.transitions.preview", { kind: "transition.return-local" }))
      .toMatchObject({ error: { data: { code: "MEMORY_OPERATION_REFUSED", reason: "capability" } } });
    expect(await dispatch("operator", "memory.transitions.status", { transitionId: randomUUID() }))
      .toMatchObject({ error: { data: { reason: "stale" } } });
    const refused = await dispatch("operator", "memory.transitions.overview", {});
    expect(refused).toMatchObject({ error: { data: { reason: "unavailable" } } });
    expect(JSON.stringify(refused)).not.toContain("private");
  });
  it("enforces operator reads and lets a second authenticated observer recover the same lost-reply operation", async () => {
    const h = await createHealthyTransitionHarness();
    try {
      const registry = createMethodRegistry();
      registerMemoryTransitionMethods(registry, h.service);
      registerMemoryOperationMethods(registry, { service: h.owner, subscriptions: createMemoryOperationSubscriptions(), logger: createLogger("fatal") });
      const first = context("operator"); const second = context("operator"); const node = context("node");
      const dispatch = (ctx: MethodContext, method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: randomUUID(), method, params }, ctx);
      const rpc = async (ctx: MethodContext, method: string, params: unknown) => {
        const response = await dispatch(ctx, method, params);
        if ("error" in response) throw new Error(JSON.stringify(response.error));
        return response.result;
      };
      const before = { ...h.remote.calls };
      expect(await dispatch(node, "memory.transitions.preview", { kind: "transition.return-local" }))
        .toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
      expect(await dispatch(node, "memory.transitions.status", { transitionId: randomUUID() }))
        .toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
      expect(h.remote.calls).toEqual(before);
      const preview = MemoryTransitionPreviewSchema.parse(await rpc(first, "memory.transitions.preview", { kind: "transition.return-local" }));
      const request = { kind: preview.kind, requestId: randomUUID(), previewId: preview.previewId, previewHash: preview.previewHash,
        expected: preview.expected, confirmation: "healthy-switch" };
      h.remote.fault.verifyReply = true;
      const admitted = MemoryOperationSubmitResultSchema.parse(await rpc(first, "memory.operations.submit", { request })).operation;
      await h.owner.stop();
      const transitionId = admitted.producer?.kind === "transition" ? admitted.producer.transitionId : "";
      const calls = { ...h.remote.calls };
      const observed = MemoryTransitionReadSchema.parse(await rpc(second, "memory.transitions.status", { transitionId }));
      expect(observed.transition.result?.outcome).toBe("outcome_unknown");
      expect(await rpc(second, "memory.operations.submit", { request }))
        .toMatchObject({ operation: { operationId: admitted.operationId, state: "outcome_unknown" } });
      expect(h.remote.calls).toEqual(calls);
      h.remote.fault.unavailable = false; h.clock.value = "2026-10-01T00:06:00.000Z";
      const recovery = MemoryTransitionPreviewSchema.parse(await rpc(second, "memory.transitions.preview", {
        kind: "transition.return-local", recoveryTransitionId: transitionId }));
      const repaired = MemoryOperationSubmitResultSchema.parse(await rpc(second, "memory.operations.submit", { request: {
        ...request, requestId: randomUUID(), previewId: recovery.previewId, previewHash: recovery.previewHash,
        expected: recovery.expected, recovery: recovery.recovery } })).operation;
      await h.owner.stop();
      expect(await rpc(second, "memory.operations.status", { operationId: repaired.operationId }))
        .toMatchObject({ operation: { state: "completed" } });
      expect(await rpc(second, "memory.operations.status", { operationId: admitted.operationId }))
        .toMatchObject({ operation: { state: "outcome_unknown" } });
      expect(MemoryTransitionReadSchema.parse(await rpc(second, "memory.transitions.status", { transitionId })).progress.runtime).toBe("ready");
      expect(h.remote.calls).toMatchObject({ acquire: 2, verify: 2, resolve: 2 });
    } finally { await h.close(); }
  }, 20_000);
});
