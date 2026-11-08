import { describe, expect, it, vi } from "vitest";
import type { MemoryAuthorityStatus, MemoryOperation, MemoryReplicaChanged } from "@taki/shared";
import { activationStatus } from "./hindsight-activation-fixtures.ts";
import { bankStatus, hindsightStatus, operation } from "./memory-authority-fixtures.ts";
import { createMemoryOperationsController, type MemoryOperationsClient, type MemoryOperationsSink } from "./memory-operations-controller.ts";

type Handler = (operation: MemoryOperation) => void;

interface FakeClient extends MemoryOperationsClient {
  calls: string[];
  handlers: Set<Handler>;
  push(operation: MemoryOperation): void;
  replicaHandlers: Set<(changed: MemoryReplicaChanged) => void>;
  pushReplica(changed: MemoryReplicaChanged): void;
}

function client(behavior: Partial<MemoryOperationsClient> = {}): FakeClient {
  const calls: string[] = [];
  const handlers = new Set<Handler>();
  const replicaHandlers = new Set<(changed: MemoryReplicaChanged) => void>();
  const base: MemoryOperationsClient = {
    memoryAuthorityStatus: async () => { calls.push("status"); return hindsightStatus(); },
    memoryActivationStatus: async () => { calls.push("activation"); return activationStatus(); },
    memoryOperationSubmit: async () => { calls.push("submit"); return operation(); },
    memoryOperationCancel: async () => { calls.push("cancel"); return operation({ state: "cancelled", reason: "cancelled_before_claim", terminalAt: "2026-09-19T00:00:01.000Z" }); },
    subscribeMemoryOperations: async () => { calls.push("subscribe"); },
    onMemoryOperationChanged: (handler) => { handlers.add(handler); return () => handlers.delete(handler); },
    memoryReplicaConfigure: async () => { calls.push("configure"); return bankStatus("global"); },
    onMemoryReplicaChanged: (handler) => { replicaHandlers.add(handler); return () => replicaHandlers.delete(handler); },
    ...behavior,
  };
  return Object.assign(base, { calls, handlers, replicaHandlers,
    push: (changed: MemoryOperation) => { for (const handler of handlers) handler(changed); },
    pushReplica: (changed: MemoryReplicaChanged) => { for (const handler of replicaHandlers) handler(changed); } });
}

function sink() {
  return { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationSettled: vi.fn() } satisfies MemoryOperationsSink<MemoryAuthorityStatus>;
}

const readAuthority = (target: MemoryOperationsClient) => target.memoryAuthorityStatus();
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("memory operations controller", () => {
  it("saves a complete schedule once, refetches after the result and invalidates on replica changes", async () => {
    const config = { automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 172_800_000 };
    const saved = vi.fn<MemoryOperationsClient["memoryReplicaConfigure"]>(async () => bankStatus("global", config));
    const target = client({ memoryReplicaConfigure: saved }); const s = sink();
    const controller = createMemoryOperationsController(s, readAuthority); controller.replace(target); await settle();
    await controller.configureSync("global", config);
    expect(saved).toHaveBeenCalledExactlyOnceWith("global", config);
    expect(s.mutationStarted).toHaveBeenCalledWith("configure:global");
    expect(s.mutationSettled).toHaveBeenCalledWith({ tone: "ok", message: "Core 已保存此 Bank 的同步设置。" });
    expect(target.calls.filter((value) => value === "status")).toHaveLength(2);
    target.pushReplica({ bankId: "global" }); await settle();
    expect(target.calls.filter((value) => value === "status")).toHaveLength(3);
    const lateHandler = [...target.replicaHandlers][0]!;
    controller.replace(null); expect(target.replicaHandlers.size).toBe(0);
    lateHandler({ bankId: "global" }); await settle();
    expect(target.calls.filter((value) => value === "status")).toHaveLength(3);
    expect(target.calls).not.toContain("submit"); controller.dispose();
  });

  it("drops retired configuration results and never replays them in the replacement generation", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const first = client({ memoryReplicaConfigure: async () => {
      await new Promise<void>((resolve) => { gate.release = resolve; }); return bankStatus("global");
    } });
    const second = client(); const s = sink(); const controller = createMemoryOperationsController(s, readAuthority);
    controller.replace(first); await settle();
    const save = controller.configureSync("global", { automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 172_800_000 });
    controller.replace(second); await settle(); s.mutationSettled.mockClear(); gate.release?.(); await save;
    expect(s.mutationSettled).not.toHaveBeenCalled(); expect(second.calls).toEqual(["subscribe", "status"]); controller.dispose();
  });
  it("reads status and subscribes on replace, then drops results from a retired generation", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s, readAuthority);
    const first = client();
    controller.replace(first);
    await settle();
    expect(first.calls).toEqual(["subscribe", "status"]);
    expect(s.loaded).toHaveBeenCalledWith(hindsightStatus());
    expect(first.handlers.size).toBe(1);

    controller.replace(null);
    expect(first.handlers.size).toBe(0);
    s.loaded.mockClear();
    first.push(operation());
    await settle();
    expect(s.loaded).not.toHaveBeenCalled();
  });

  it("refetches Core truth on every changed push and coalesces pushes that land mid-read", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s, readAuthority);
    const gate: { release: (() => void) | null } = { release: null };
    const stub = client({
      memoryAuthorityStatus: async () => {
        stub.calls.push("status");
        if (gate.release === null) await new Promise<void>((resolve) => { gate.release = resolve; });
        return hindsightStatus();
      },
    });
    controller.replace(stub);
    await settle();
    stub.push(operation());
    stub.push(operation({ state: "running" }));
    await settle();
    expect(stub.calls.filter((call) => call === "status")).toHaveLength(1);
    gate.release?.();
    await settle();
    await settle();
    expect(stub.calls.filter((call) => call === "status")).toHaveLength(2);
  });

  it("serializes submit, reports the accepted operation and re-reads status", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s, readAuthority);
    const stub = client();
    controller.replace(stub);
    await settle();
    stub.calls.length = 0;
    await Promise.all([controller.submitSync("global", "incremental"), controller.submitSync("global", "full")]);
    expect(stub.calls).toEqual(["submit", "status"]);
    expect(s.mutationStarted).toHaveBeenCalledWith("sync:global");
    expect(s.mutationSettled).toHaveBeenCalledWith({ tone: "ok", message: `已受理 incremental 同步：${operation().operationId}` });
  });

  it("surfaces a MEMORY_OPERATION_REFUSED rejection with its closed reason and still refetches", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s, readAuthority);
    const stub = client({
      memoryOperationCancel: async () => {
        throw Object.assign(new Error("refused"), { data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_RUNNING" } });
      },
    });
    controller.replace(stub);
    await settle();
    stub.calls.length = 0;
    await controller.cancel(operation().operationId);
    expect(s.mutationSettled).toHaveBeenCalledWith({ tone: "warn", message: "Core 拒绝了该操作：MEMORY_OPERATION_RUNNING" });
    expect(stub.calls).toEqual(["status"]);
  });

  it("keeps a failed read as loadFailed without fabricating a frame", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s, readAuthority);
    controller.replace(client({ memoryAuthorityStatus: async () => { throw new Error("deadline"); } }));
    await settle();
    expect(s.loaded).not.toHaveBeenCalled();
    expect(s.loadFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "deadline" }));
  });

  it("retains the default subscription error formatter and still reads Core truth", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s, readAuthority);
    controller.replace(client({ subscribeMemoryOperations: async () => {
      throw Object.assign(new Error("refused"), { data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_RUNNING" } });
    } }));
    await settle();
    expect(s.mutationSettled).toHaveBeenCalledWith({ tone: "warn", message: "Core 拒绝了该操作：MEMORY_OPERATION_RUNNING" });
    expect(s.loaded).toHaveBeenCalledWith(hindsightStatus());
    controller.dispose();
  });
});
