import { describe, expect, it, vi } from "vitest";
import { JSONRPCErrorException } from "json-rpc-2.0";
import type { MemoryTidyFailureDetails, MemoryTidyResult } from "@taki/shared";
import { RpcDeadlineExceededError, rpcMethodPolicy } from "@/lib/rpc-deadline.js";
import { createMemoryTidyController } from "./memory-tidy-controller.ts";

const RESULT: MemoryTidyResult = {
  status: "ran", defects: { missingDisclosure: 1, overBudget: 0, stale: 2, nearDuplicate: 0, misfiled: 0 },
  edits: 2, steps: 4, usage: { calls: 4, inputTokens: 120, outputTokens: 30, usageUnknown: 0 },
};
const PARTIAL: MemoryTidyFailureDetails = {
  ...RESULT, kind: "memory-tidy", status: "partial", reason: "tool-errors",
  issues: [{ toolName: "memory_reinforce", code: "MEMORY_REVISION_MISMATCH" }], issueCount: 1,
};
const FAILED: MemoryTidyFailureDetails = { ...PARTIAL, status: "failed", edits: 0 };
function failed(details: unknown) { return new JSONRPCErrorException("Memory tidy failed", -32603, details); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const sink = { changed: vi.fn(), settled: vi.fn(async (): Promise<void> => undefined) };
  const controller = createMemoryTidyController(sink);
  return { controller, sink, state: () => sink.changed.mock.lastCall?.[0] };
}
async function flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

describe("Memory tidy attempt truth", () => {
  it.each([RESULT, { ...RESULT, status: "clean", edits: 0, steps: 0 } satisfies MemoryTidyResult])("preserves the existing $status success and refreshes once", async (result) => {
    const { controller, sink, state } = fixture();
    const client = { memoryTidy: vi.fn(async () => result) };
    controller.replace(client);
    await controller.runTidy();
    expect(client.memoryTidy).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ tidy: result, tidyFailure: null, tidying: false, error: null, refreshError: null });
    expect(sink.settled).toHaveBeenCalledTimes(1);
  });

  it.each([PARTIAL, FAILED])("keeps $status details on the failure path and refreshes affected snapshots", async (details) => {
    const { controller, sink, state } = fixture();
    const client = { memoryTidy: vi.fn().mockRejectedValue(failed(details)) };
    controller.replace(client);
    await controller.runTidy();
    expect(state()).toEqual({ tidy: null, tidyFailure: details, tidying: false, error: null, refreshError: null });
    expect(sink.settled).toHaveBeenCalledTimes(1);
    expect(client.memoryTidy).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    { ...PARTIAL, kind: "something-else" },
    { ...PARTIAL, status: "failed" },
    { ...PARTIAL, issues: [{ toolName: "secret-tool", code: "MEMORY_INTERNAL_ERROR" }] },
    { ...PARTIAL, rawArguments: "not safe to display" },
  ])("retains legacy/generic handling for absent or invalid failure data %#", async (data) => {
    const { controller, sink, state } = fixture();
    controller.replace({ memoryTidy: vi.fn().mockRejectedValue(failed(data)) });
    await controller.runTidy();
    expect(state()).toMatchObject({ tidy: null, tidyFailure: null, tidying: false, error: "Memory tidy failed" });
    expect(sink.settled).not.toHaveBeenCalled();
  });

  it("does not turn a transport timeout into known failed work or retry it", async () => {
    const { controller, sink, state } = fixture();
    const error = new RpcDeadlineExceededError("memory.tidy", 100, rpcMethodPolicy("memory.tidy"));
    const client = { memoryTidy: vi.fn().mockRejectedValue(error) };
    controller.replace(client);
    await controller.runTidy();
    expect(state()).toMatchObject({ tidy: null, tidyFailure: null, tidying: false });
    expect(state()?.error).toContain("执行结果尚未确认");
    expect(state()?.error).not.toContain("memory.tidy");
    expect(sink.settled).not.toHaveBeenCalled();
    expect(client.memoryTidy).toHaveBeenCalledTimes(1);
  });

  it("clears prior success before an attempted request can fail and clears prior failure before the next success", async () => {
    const { controller, state } = fixture();
    const pending = deferred<MemoryTidyResult>();
    const client = { memoryTidy: vi.fn().mockResolvedValueOnce(RESULT).mockImplementationOnce(() => pending.promise).mockResolvedValueOnce(RESULT) };
    controller.replace(client);
    await controller.runTidy();
    const attempt = controller.runTidy();
    expect(state()).toEqual({ tidy: null, tidyFailure: null, tidying: true, error: null, refreshError: null });
    pending.reject(failed(PARTIAL));
    await attempt;
    expect(state()?.tidyFailure).toEqual(PARTIAL);
    const next = controller.runTidy();
    expect(state()).toMatchObject({ tidy: null, tidyFailure: null, error: null, tidying: true });
    await next;
    expect(state()?.tidy).toEqual(RESULT);
  });

  it("clears a previous success when the next request returns an old generic error", async () => {
    const { controller, state } = fixture();
    controller.replace({ memoryTidy: vi.fn().mockResolvedValueOnce(RESULT).mockRejectedValueOnce(new Error("legacy refusal")) });
    await controller.runTidy();
    await controller.runTidy();
    expect(state()).toMatchObject({ tidy: null, tidyFailure: null, error: "legacy refusal" });
  });

  it("serializes repeated clicks through both the request and its read reconciliation", async () => {
    const { controller, sink, state } = fixture();
    const request = deferred<MemoryTidyResult>();
    const refresh = deferred<void>();
    sink.settled.mockReturnValue(refresh.promise);
    const client = { memoryTidy: vi.fn(() => request.promise) };
    controller.replace(client);
    const first = controller.runTidy();
    await controller.runTidy();
    request.resolve(RESULT);
    await flush();
    await controller.runTidy();
    expect(state()?.tidying).toBe(true);
    expect(client.memoryTidy).toHaveBeenCalledTimes(1);
    expect(sink.settled).toHaveBeenCalledTimes(1);
    refresh.resolve();
    await first;
    expect(state()?.tidying).toBe(false);
  });

  it.each([false, true])("keeps the pending lock across client replacement and rejects retired failure=%s", async (reject) => {
    const { controller, sink, state } = fixture();
    const pending = deferred<MemoryTidyResult>();
    const nextClient = { memoryTidy: vi.fn(async () => RESULT) };
    controller.replace({ memoryTidy: () => pending.promise });
    const attempt = controller.runTidy();
    controller.replace(null);
    controller.replace(nextClient);
    await controller.runTidy();
    expect(nextClient.memoryTidy).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ tidying: true, error: expect.stringContaining("结果尚未确认") });
    if (reject) pending.reject(failed(PARTIAL)); else pending.resolve(RESULT);
    await attempt;
    expect(state()).toMatchObject({ tidy: null, tidyFailure: null, tidying: false, error: expect.stringContaining("结果尚未确认") });
    expect(sink.settled).not.toHaveBeenCalled();
    expect(nextClient.memoryTidy).not.toHaveBeenCalled();
    await controller.runTidy();
    expect(nextClient.memoryTidy).toHaveBeenCalledTimes(1);
    expect(state()?.tidy).toEqual(RESULT);
  });

  it.each([RESULT, PARTIAL, FAILED])("keeps the original $status outcome when refreshing fails", async (outcome) => {
    const { controller, sink, state } = fixture();
    sink.settled.mockRejectedValue(new Error("read failed with unsafe raw content"));
    controller.replace({ memoryTidy: "kind" in outcome ? vi.fn().mockRejectedValue(failed(outcome)) : vi.fn().mockResolvedValue(outcome) });
    await controller.runTidy();
    expect(state()).toMatchObject({ tidying: false, error: null, refreshError: expect.stringContaining("状态刷新失败") });
    expect(state()?.refreshError).not.toContain("unsafe raw content");
    expect("kind" in outcome ? state()?.tidyFailure : state()?.tidy).toEqual(outcome);
  });

  it("ignores a late refresh failure after client retirement without relabeling known partial work", async () => {
    const { controller, sink, state } = fixture();
    const refresh = deferred<void>();
    sink.settled.mockReturnValue(refresh.promise);
    controller.replace({ memoryTidy: vi.fn().mockRejectedValue(failed(PARTIAL)) });
    const attempt = controller.runTidy();
    await flush();
    controller.replace(null);
    refresh.reject(new Error("retired read"));
    await attempt;
    expect(state()).toMatchObject({ tidyFailure: PARTIAL, tidying: false, error: null, refreshError: null });
  });

  it("does no work without a client and publishes no outcomes after disposal", async () => {
    const { controller, sink } = fixture();
    await controller.runTidy();
    expect(sink.changed).not.toHaveBeenCalled();
    const pending = deferred<MemoryTidyResult>();
    controller.replace({ memoryTidy: () => pending.promise });
    const attempt = controller.runTidy();
    controller.dispose();
    const calls = sink.changed.mock.calls.length;
    pending.resolve(RESULT);
    await attempt;
    expect(sink.changed).toHaveBeenCalledTimes(calls);
    expect(sink.settled).not.toHaveBeenCalled();
  });
});
