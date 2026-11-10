import { describe, expect, it, vi } from "vitest";
import { JSON_RPC_APP_ERROR, MEMORY_OPERATION_METHODS, type MemoryOperation } from "@taki/shared";
import { createLogger } from "../../logging/logger.ts";
import { MemoryOperationRefusal } from "../../memory/operations/memory-operation-contract.ts";
import type { MemoryOperationService } from "../../memory/operations/memory-operation-service.ts";
import type { Connection } from "../connection-registry.ts";
import { createMemoryOperationSubscriptions } from "../memory-operation-subscriptions.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerMemoryOperationMethods } from "./memory-operation-methods.ts";

const AT = "2026-09-19T00:00:00.000Z";
const operation: MemoryOperation = {
  operationId: "11111111-1111-4111-8111-111111111111", kind: "replica.sync", state: "admitted", reason: null, authorityEpochId: "epoch",
  request: { kind: "replica.sync", bankId: "global", syncKind: "incremental" }, producer: { kind: "replica", bankId: "global", admittedAt: AT },
  result: null, errorCode: null, createdAt: AT, updatedAt: AT, terminalAt: null,
};

function harness(service: Partial<MemoryOperationService> = {}) {
  const complete: MemoryOperationService = {
    submit: vi.fn(() => operation), status: vi.fn(() => operation), list: vi.fn(() => [operation]), recent: vi.fn(() => []),
    wait: async () => operation,
    cancel: vi.fn((): MemoryOperation => ({ ...operation, state: "cancelled", reason: "cancelled_before_claim", terminalAt: AT })), stop: async () => undefined, ...service,
  };
  const registry = createMethodRegistry(); const subscriptions = createMemoryOperationSubscriptions();
  registerMemoryOperationMethods(registry, { service: complete, subscriptions, logger: createLogger("fatal") });
  return { registry, subscriptions, service: complete };
}

function context(role: "operator" | "node" = "operator") {
  const connection: Connection = { state: { status: "authenticated", deviceId: `d-${Math.random()}`, role, capabilities: [] } };
  const notifications: Array<{ method: string; params: unknown }> = []; const closers: Array<() => void> = [];
  const ctx: MethodContext = { connection, notify: (method, params) => notifications.push({ method, params }), close: () => undefined, onClose: (cb) => closers.push(cb) };
  return { ctx, notifications, close: () => { for (const cb of closers) cb(); } };
}

let id = 0;
const dispatch = (h: ReturnType<typeof harness>, ctx: MethodContext, call: { method: string; params: unknown }) =>
  h.registry.dispatch({ jsonrpc: "2.0", id: ++id, ...call }, ctx);

describe("memory operation methods", () => {
  it("keeps every method operator-only", async () => {
    const h = harness(); const { ctx } = context("node");
    for (const [method, params] of [
      [MEMORY_OPERATION_METHODS.submit, { request: { kind: "replica.sync", bankId: "global", syncKind: "incremental" } }],
      [MEMORY_OPERATION_METHODS.status, { operationId: operation.operationId }], [MEMORY_OPERATION_METHODS.list, {}],
      [MEMORY_OPERATION_METHODS.cancel, { operationId: operation.operationId }], [MEMORY_OPERATION_METHODS.subscribe, {}],
    ] as const) {
      const response = await dispatch(h, ctx, { method, params });
      expect((response as { error: { data: { code: string } } }).error.data.code).toBe("FORBIDDEN");
    }
  });

  it("submits through the strict request schema and applies list defaults", async () => {
    const h = harness(); const { ctx } = context();
    const submitted = await dispatch(h, ctx, { method: MEMORY_OPERATION_METHODS.submit, params: { request: { kind: "replica.sync", bankId: "global", syncKind: "full" } } });
    expect(submitted).toMatchObject({ result: { operation: { operationId: operation.operationId, state: "admitted" } } });
    expect(h.service.submit).toHaveBeenCalledWith({ kind: "replica.sync", bankId: "global", syncKind: "full" });
    const invalid = await dispatch(h, ctx, { method: MEMORY_OPERATION_METHODS.submit, params: { request: { kind: "backup.create" } } });
    expect((invalid as { error: { message: string } }).error.message).toBe("Invalid params");
    await dispatch(h, ctx, { method: MEMORY_OPERATION_METHODS.list, params: {} });
    expect(h.service.list).toHaveBeenCalledWith({ includeTerminal: false, limit: 20 });
  });

  it("maps service refusals to MEMORY_OPERATION_REFUSED with the closed reason and the active id", async () => {
    const h = harness({ submit: () => { throw new MemoryOperationRefusal("MEMORY_OPERATION_BUSY", operation.operationId); },
      cancel: () => { throw new Error("private database detail"); } });
    const { ctx } = context();
    const busy = await dispatch(h, ctx, { method: MEMORY_OPERATION_METHODS.submit, params: { request: { kind: "setup.validate", expectedRevision: 1 } } });
    expect((busy as { error: unknown }).error).toMatchObject({ code: JSON_RPC_APP_ERROR,
      data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_BUSY", activeOperationId: operation.operationId } });
    const failed = await dispatch(h, ctx, { method: MEMORY_OPERATION_METHODS.cancel, params: { operationId: operation.operationId } });
    expect((failed as { error: { data: { code: string } } }).error.data.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(failed)).not.toContain("private database detail");
  });

  it("fans transitions to every subscribed connection and drops membership on close", async () => {
    const h = harness(); const first = context(); const second = context();
    await dispatch(h, first.ctx, { method: MEMORY_OPERATION_METHODS.subscribe, params: {} });
    await dispatch(h, second.ctx, { method: MEMORY_OPERATION_METHODS.subscribe, params: {} });
    expect(h.subscriptions.count()).toBe(2);
    h.subscriptions.publish({ ...operation, state: "running" });
    expect(first.notifications).toEqual([{ method: MEMORY_OPERATION_METHODS.changed, params: { operation: { ...operation, state: "running" } } }]);
    expect(second.notifications).toHaveLength(1);
    first.close();
    h.subscriptions.publish({ ...operation, state: "completed", terminalAt: AT, result: { kind: "replica", errorCode: null, nextAction: null, lastSuccessAt: AT } });
    expect(first.notifications).toHaveLength(1);
    expect(second.notifications).toHaveLength(2);
    expect(h.subscriptions.count()).toBe(1);
  });
});
