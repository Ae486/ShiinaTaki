import { describe, expect, it, vi } from "vitest";
import { JSON_RPC_APP_ERROR, MEMORY_ONBOARDING_METHODS, type MemoryOnboardingStatus } from "@taki/shared";
import { createLogger } from "../../logging/logger.ts";
import type { LocalOnboardingService } from "../../memory/local-onboarding/local-onboarding-service.ts";
import { MemoryOperationRefusal } from "../../memory/operations/memory-operation-contract.ts";
import type { Connection } from "../connection-registry.ts";
import { createConnectionSubscriptions } from "../memory-operation-subscriptions.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerMemoryOnboardingMethods, type MemoryOnboardingSubscriptions } from "./memory-onboarding-methods.ts";

const AT = "2026-09-22T00:00:00.000Z";
const status: MemoryOnboardingStatus = {
  authority: { mode: "legacy-markdown", epochId: null }, runtime: { available: true, unavailableReason: null }, run: null, operation: null,
  custody: { openGroups: 0, recoverableGroups: 0 }, observedAt: AT,
  actions: { preview: true, prepare: true, resume: false, replace: false, activate: false, recoverBinding: false, reconcileSources: false, cancelOperationId: null, retryOperationId: null },
};
const report = { reportId: "sha256:abc", exceptional: 0, plannedZero: 0, plannedOne: 1, plannedMany: 0, sourceCount: 1 };

function harness(local: Partial<LocalOnboardingService> = {}, read: () => MemoryOnboardingStatus = () => status) {
  const service = {
    preview: vi.fn(async () => report), exceptions: vi.fn(() => ({ items: [], nextCursor: null })),
    exclude: vi.fn(() => ({ runId: "run", phase: "staged", status: "running", sourceCount: 1, resolvedCount: 1, blockingCount: 0 })), ...local,
  } as unknown as LocalOnboardingService;
  const registry = createMethodRegistry(); const subscriptions: MemoryOnboardingSubscriptions = createConnectionSubscriptions();
  registerMemoryOnboardingMethods(registry, { local: service, status: read, subscriptions, logger: createLogger("fatal") });
  return { registry, subscriptions, service };
}

function context(role: "operator" | "node" = "operator", deviceId = "device-1") {
  const connection: Connection = { state: { status: "authenticated", deviceId, role, capabilities: [] } };
  const notifications: Array<{ method: string; params: unknown }> = []; const closers: Array<() => void> = [];
  const ctx: MethodContext = { connection, notify: (method, params) => notifications.push({ method, params }), close: () => undefined, onClose: (cb) => closers.push(cb) };
  return { ctx, notifications, close: () => { for (const cb of closers) cb(); } };
}

let id = 0;
const dispatch = (h: ReturnType<typeof harness>, ctx: MethodContext, call: { method: string; params: unknown }) =>
  h.registry.dispatch({ jsonrpc: "2.0", id: ++id, ...call }, ctx);
const errorOf = (response: unknown) => (response as { error: { code: number; message: string; data?: Record<string, unknown> } }).error;

describe("memory onboarding methods", () => {
  it("keeps every method operator-only", async () => {
    const h = harness(); const { ctx } = context("node");
    for (const [method, params] of [
      [MEMORY_ONBOARDING_METHODS.preview, {}], [MEMORY_ONBOARDING_METHODS.status, {}], [MEMORY_ONBOARDING_METHODS.exceptions, { runId: "run" }],
      [MEMORY_ONBOARDING_METHODS.exclude, { runId: "run", sourceId: "s", reason: "r" }], [MEMORY_ONBOARDING_METHODS.subscribe, {}],
    ] as const) {
      expect(errorOf(await dispatch(h, ctx, { method, params })).data?.code).toBe("FORBIDDEN");
    }
  });

  it("serves reads from the Core workspace with strict params and applies the exceptions limit default", async () => {
    const h = harness(); const { ctx } = context();
    expect(await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.preview, params: {} })).toMatchObject({ result: report });
    expect(await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.status, params: {} })).toMatchObject({ result: status });
    expect(errorOf(await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.preview, params: { workspaceRoot: "C:/elsewhere" } })).message).toBe("Invalid params");
    await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.exceptions, params: { runId: "run" } });
    expect(h.service.exceptions).toHaveBeenCalledWith({ runId: "run", limit: 100 });
  });

  it("excludes with the authenticated device as actor and returns the refreshed status", async () => {
    const h = harness(); const { ctx } = context("operator", "device-7");
    const response = await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.exclude, params: { runId: "run", sourceId: "s", reason: "  bad frontmatter " } });
    expect(h.service.exclude).toHaveBeenCalledWith({ runId: "run", sourceId: "s", reason: "bad frontmatter", actor: "device-7" });
    expect(response).toMatchObject({ result: status });
  });

  it("maps closed local codes and owner refusals to MEMORY_OPERATION_REFUSED and hides everything else", async () => {
    const h = harness({
      exclude: vi.fn(() => { throw new Error("MIGRATION_EXCLUSION_CONFLICT"); }),
      exceptions: vi.fn(() => { throw new MemoryOperationRefusal("MEMORY_OPERATION_NOT_FOUND"); }),
      preview: vi.fn(async () => { throw new Error("ENOENT: private path"); }),
    });
    const { ctx } = context();
    expect(errorOf(await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.exclude, params: { runId: "run", sourceId: "s", reason: "r" } })))
      .toMatchObject({ code: JSON_RPC_APP_ERROR, data: { code: "MEMORY_OPERATION_REFUSED", reason: "MIGRATION_EXCLUSION_CONFLICT" } });
    expect(errorOf(await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.exceptions, params: { runId: "run" } })))
      .toMatchObject({ data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_NOT_FOUND" } });
    const hidden = errorOf(await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.preview, params: {} }));
    expect(hidden).toMatchObject({ data: { code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(hidden)).not.toContain("private path");
  });

  it("refuses to serve a status that violates its own wire invariants", async () => {
    const h = harness({}, () => ({ ...status, runtime: { available: true, unavailableReason: "stopped" } }));
    const { ctx } = context();
    expect(errorOf(await dispatch(h, ctx, { method: MEMORY_ONBOARDING_METHODS.status, params: {} }))).toBeDefined();
  });

  it("subscribes once per connection, pushes strict invalidations and stops on close", async () => {
    const h = harness(); const a = context(); const b = context();
    expect(await dispatch(h, a.ctx, { method: MEMORY_ONBOARDING_METHODS.subscribe, params: {} })).toMatchObject({ result: { status: "ok" } });
    await dispatch(h, a.ctx, { method: MEMORY_ONBOARDING_METHODS.subscribe, params: {} });
    await dispatch(h, b.ctx, { method: MEMORY_ONBOARDING_METHODS.subscribe, params: {} });
    expect(h.subscriptions.count()).toBe(2);
    h.subscriptions.publish({ reason: "producer" });
    expect(a.notifications).toEqual([{ method: MEMORY_ONBOARDING_METHODS.changed, params: { reason: "producer" } }]);
    expect(b.notifications).toHaveLength(1);
    a.close();
    h.subscriptions.publish({ reason: "binding" });
    expect(a.notifications).toHaveLength(1);
    expect(b.notifications.map((n) => (n.params as { reason: string }).reason)).toEqual(["producer", "binding"]);
  });
});
