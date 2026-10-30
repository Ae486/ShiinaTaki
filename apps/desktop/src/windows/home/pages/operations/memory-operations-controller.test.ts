import { describe, expect, it, vi } from "vitest";
import type { MemoryOperation } from "@taki/shared";
import { hindsightStatus, operation } from "./memory-authority-fixtures.ts";
import { createMemoryOperationsController, type MemoryOperationsClient, type MemoryOperationsSink } from "./memory-operations-controller.ts";

type Handler = (operation: MemoryOperation) => void;

interface FakeClient extends MemoryOperationsClient {
  calls: string[];
  handlers: Set<Handler>;
  push(operation: MemoryOperation): void;
}

function client(behavior: Partial<MemoryOperationsClient> = {}): FakeClient {
  const calls: string[] = [];
  const handlers = new Set<Handler>();
  const base: MemoryOperationsClient = {
    memoryAuthorityStatus: async () => { calls.push("status"); return hindsightStatus(); },
    memoryOperationSubmit: async () => { calls.push("submit"); return operation(); },
    memoryOperationCancel: async () => { calls.push("cancel"); return operation({ state: "cancelled", reason: "cancelled_before_claim", terminalAt: "2026-09-19T00:00:01.000Z" }); },
    subscribeMemoryOperations: async () => { calls.push("subscribe"); },
    onMemoryOperationChanged: (handler) => { handlers.add(handler); return () => handlers.delete(handler); },
    ...behavior,
  };
  return Object.assign(base, { calls, handlers, push: (changed: MemoryOperation) => { for (const handler of handlers) handler(changed); } });
}

function sink() {
  return { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationSettled: vi.fn() } satisfies MemoryOperationsSink;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("memory operations controller", () => {
  it("reads status and subscribes on replace, then drops results from a retired generation", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s);
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
    const controller = createMemoryOperationsController(s);
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
    const controller = createMemoryOperationsController(s);
    const stub = client();
    controller.replace(stub);
    await settle();
    stub.calls.length = 0;
    await Promise.all([controller.submitSync("global", "incremental"), controller.submitSync("global", "full")]);
    expect(stub.calls).toEqual(["submit", "status"]);
    expect(s.mutationStarted).toHaveBeenCalledWith("sync:global");
    expect(s.mutationSettled).toHaveBeenCalledWith({ tone: "ok", message: "已受理增量同步。" });
  });

  it("surfaces a MEMORY_OPERATION_REFUSED rejection with its closed reason and still refetches", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s);
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
    const controller = createMemoryOperationsController(s);
    controller.replace(client({ memoryAuthorityStatus: async () => { throw new Error("deadline"); } }));
    await settle();
    expect(s.loaded).not.toHaveBeenCalled();
    expect(s.loadFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "deadline" }));
  });
});

describe("T4 retained-page Memory integration", () => {
  it("gates hidden changed pushes and discards a pre-hide read without retiring a mutation", async () => {
    const s = sink();
    const controller = createMemoryOperationsController(s);
    let releaseRead!: () => void;
    let releaseMutation!: () => void;
    let reads = 0;
    const stub = client({
      memoryAuthorityStatus: async () => { reads += 1; if (reads === 1) await new Promise<void>((resolve) => { releaseRead = resolve; }); return hindsightStatus(); },
      memoryOperationSubmit: async () => { stub.calls.push("submit"); await new Promise<void>((resolve) => { releaseMutation = resolve; }); return operation(); },
    });
    controller.replace(stub);
    await settle();
    const mutation = controller.submitSync("global", "incremental");
    controller.setVisible(false);
    stub.push(operation()); stub.push(operation({ state: "running" }));
    releaseRead(); releaseMutation();
    await mutation; await settle();
    expect(reads).toBe(1);
    expect(s.loaded).not.toHaveBeenCalled();
    expect(s.mutationSettled).not.toHaveBeenCalled();
    controller.setVisible(true);
    await settle();
    expect(reads).toBe(2);
    expect(stub.calls.filter((call) => call === "submit")).toHaveLength(1);
    expect(s.mutationSettled).toHaveBeenCalledOnce();
    expect(s.mutationSettled).toHaveBeenCalledWith({ tone: "ok", message: "已受理增量同步。" });
    expect(s.loaded).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("waits for accepted subscription before its first read", async () => {
    const s = sink(); let accept!: () => void;
    const stub = client({ subscribeMemoryOperations: () => new Promise<void>((resolve) => { accept = resolve; }) });
    const controller = createMemoryOperationsController(s);
    controller.replace(stub);
    await settle();
    expect(stub.calls).toEqual([]);
    accept(); await settle();
    expect(stub.calls).toEqual(["status"]);
    controller.dispose();
  });

  it("coalesces pushes, refresh and re-entry behind the pending subscription acknowledgement", async () => {
    const s = sink(); let accept!: () => void;
    const stub = client({ subscribeMemoryOperations: vi.fn(() => new Promise<void>((resolve) => { accept = resolve; })) });
    const controller = createMemoryOperationsController(s);
    controller.replace(stub);
    stub.push(operation());
    void controller.refresh();
    controller.setVisible(false);
    controller.setVisible(true);
    await settle();
    expect(stub.calls).toEqual([]);
    expect(stub.subscribeMemoryOperations).toHaveBeenCalledOnce();
    accept(); await settle();
    expect(stub.calls).toEqual(["status"]);
    expect(s.loaded).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("keeps failed setup retryable without reading, polling, or settling a pending mutation", async () => {
    const s = sink(); let rejectSetup!: (cause: Error) => void; let finishMutation!: () => void;
    const subscribe = vi.fn<MemoryOperationsClient["subscribeMemoryOperations"]>()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSetup = reject; }))
      .mockResolvedValue(undefined);
    const stub = client({ subscribeMemoryOperations: subscribe,
      memoryOperationSubmit: async () => { await new Promise<void>((resolve) => { finishMutation = resolve; }); return operation(); } });
    const controller = createMemoryOperationsController(s);
    controller.replace(stub);
    const mutation = controller.submitSync("global", "incremental");
    stub.push(operation());
    rejectSetup(new Error("subscription unavailable")); await settle();
    expect(stub.calls).toEqual([]);
    expect(s.loadFailed).toHaveBeenCalledWith(expect.objectContaining({ message: "subscription unavailable" }));
    expect(s.mutationSettled).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledOnce();
    await controller.refresh();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(stub.calls).toEqual(["status"]);
    finishMutation(); await mutation;
    expect(s.mutationSettled).toHaveBeenCalledOnce();
    controller.dispose();
  });
});
