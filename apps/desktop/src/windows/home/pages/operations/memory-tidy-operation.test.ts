import { describe, expect, it, vi } from "vitest";
import type { MemoryOperation } from "@taki/shared";
import { localStatus } from "./memory-authority-fixtures.ts";
import { tidyOperation, settledTidy, TIDY_OUTCOME } from "./memory-tidy-fixtures.ts";
import { createMemoryOperationsController, type MemoryOperationsClient, type MemoryOperationsSink } from "./memory-operations-controller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(overrides: Partial<MemoryOperationsClient> = {}) {
  const handlers = new Set<(operation: MemoryOperation) => void>();
  const client = {
    memoryAuthorityStatus: vi.fn(async () => localStatus()),
    memoryOperationList: vi.fn(async () => [tidyOperation()]),
    memoryOperationStatus: vi.fn(async () => tidyOperation()),
    memoryOperationSubmit: vi.fn(async () => tidyOperation()),
    memoryOperationCancel: vi.fn(async () => tidyOperation()),
    subscribeMemoryOperations: vi.fn(async () => undefined),
    onMemoryOperationChanged: (handler: (operation: MemoryOperation) => void) => { handlers.add(handler); return () => handlers.delete(handler); },
    ...overrides,
  } satisfies MemoryOperationsClient;
  const sink = { loaded: vi.fn(), loading: vi.fn(), loadFailed: vi.fn(), tidyLoaded: vi.fn(), tidyLoadFailed: vi.fn(),
    mutationStarted: vi.fn(), mutationSettled: vi.fn() } satisfies MemoryOperationsSink;
  const controller = createMemoryOperationsController(sink);
  return { client, sink, controller, push: (operation: MemoryOperation) => { for (const handler of handlers) handler(operation); } };
}

describe("durable tidy UI recovery", () => {
  it("reads only this Character's latest tidy after the shared subscription is acknowledged", async () => {
    const subscription = deferred<void>();
    const f = fixture({ subscribeMemoryOperations: () => subscription.promise });
    f.controller.replace(f.client);
    await settle();
    expect(f.client.memoryOperationList).not.toHaveBeenCalled();
    subscription.resolve(); await settle();
    expect(f.client.memoryOperationList).toHaveBeenCalledWith({ kind: "tidy", characterId: "taki", includeTerminal: true, limit: 1 });
    expect(f.sink.tidyLoaded).toHaveBeenCalledWith(tidyOperation());
    f.controller.dispose();
  });

  it("recovers a prior partial result on a new page without resubmitting it", async () => {
    const partial = settledTidy({ ...TIDY_OUTCOME, status: "partial", remaining: 21, nextAction: "continue" });
    const f = fixture({ memoryOperationList: vi.fn(async () => [partial]) });
    f.controller.replace(f.client); await settle();
    expect(f.sink.tidyLoaded).toHaveBeenLastCalledWith(partial);
    expect(f.client.memoryOperationSubmit).not.toHaveBeenCalled();
    f.controller.dispose();
  });

  it("joins a busy operation by the returned identity and never resends the mutation", async () => {
    const active = tidyOperation();
    const f = fixture({ memoryOperationSubmit: vi.fn(async () => {
      throw { data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_BUSY", activeOperationId: active.operationId } };
    }) });
    f.controller.replace(f.client); await settle();
    await f.controller.submitTidy();
    expect(f.client.memoryOperationSubmit).toHaveBeenCalledOnce();
    expect(f.client.memoryOperationStatus).toHaveBeenCalledWith(active.operationId);
    expect(f.sink.mutationSettled).toHaveBeenLastCalledWith(expect.objectContaining({ scope: "tidy", message: expect.stringContaining("已有记忆整理正在执行") }));
    f.controller.dispose();
  });

  it("recovers an accepted operation after the submit response is lost, without replay on reconnect", async () => {
    const f = fixture({ memoryOperationSubmit: vi.fn(async () => { throw new Error("response lost"); }) });
    f.controller.replace(f.client); await settle();
    await f.controller.submitTidy();
    expect(f.sink.tidyLoaded).toHaveBeenLastCalledWith(tidyOperation());
    const replacement = fixture({ memoryOperationList: vi.fn(async () => [settledTidy()]) });
    f.controller.replace(replacement.client); await settle();
    expect(f.client.memoryOperationSubmit).toHaveBeenCalledOnce();
    expect(replacement.client.memoryOperationSubmit).not.toHaveBeenCalled();
    expect(f.sink.tidyLoaded).toHaveBeenLastCalledWith(settledTidy());
    f.controller.dispose();
  });

  it("keeps partial progress after Core restart, distinguished from a completed outcome", async () => {
    const interrupted = tidyOperation({ state: "outcome_unknown", reason: "core_restart", terminalAt: "2026-11-06T00:00:00Z" });
    const f = fixture({ memoryOperationList: vi.fn(async () => [interrupted]) });
    f.controller.replace(f.client); await settle();
    expect(f.sink.tidyLoaded).toHaveBeenLastCalledWith(interrupted);
    expect(f.client.memoryOperationSubmit).not.toHaveBeenCalled();
    f.controller.dispose();
  });

  it("does not publish a pre-submit snapshot after the admitted operation is known", async () => {
    const oldRead = deferred<MemoryOperation[]>();
    const list = vi.fn<MemoryOperationsClient["memoryOperationList"]>()
      .mockReturnValueOnce(oldRead.promise).mockResolvedValue([tidyOperation()]);
    const f = fixture({ memoryOperationList: list });
    f.controller.replace(f.client); await settle();
    await f.controller.submitTidy();
    oldRead.resolve([settledTidy()]); await settle(); await settle();
    expect(f.sink.tidyLoaded).not.toHaveBeenCalledWith(settledTidy());
    expect(f.sink.tidyLoaded).toHaveBeenLastCalledWith(tidyOperation());
    f.controller.dispose();
  });

  it("retains hidden-page obligations and ignores an unrelated Character's push payload", async () => {
    const f = fixture();
    f.controller.replace(f.client); await settle();
    f.controller.setVisible(false);
    f.sink.tidyLoaded.mockClear(); vi.mocked(f.client.memoryOperationList).mockClear();
    f.push(tidyOperation({ request: { kind: "tidy", characterId: "someone-else" } }));
    await settle();
    expect(f.client.memoryOperationList).not.toHaveBeenCalled();
    expect(f.sink.tidyLoaded).not.toHaveBeenCalled();
    f.controller.setVisible(true); await settle();
    expect(f.sink.tidyLoaded).toHaveBeenLastCalledWith(tidyOperation());
    expect(f.client.memoryOperationSubmit).not.toHaveBeenCalled();
    f.controller.dispose();
  });

  it("keeps tidy read failure separate from an available authority snapshot", async () => {
    const f = fixture({ memoryOperationList: vi.fn(async () => { throw new Error("tidy status unavailable"); }) });
    f.controller.replace(f.client); await settle();
    expect(f.sink.loaded).toHaveBeenCalledWith(localStatus());
    expect(f.sink.tidyLoadFailed).toHaveBeenCalledOnce();
    expect(f.sink.tidyLoaded).not.toHaveBeenCalled();
    f.controller.dispose();
  });
});
