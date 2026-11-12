import { describe, expect, it, vi } from "vitest";
import type { MediaClearResult } from "@taki/shared";
import { createMediaClearController } from "./media-clear-controller.ts";

const RESULT: MediaClearResult = { removedCount: 3, freedBytes: 4096 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const sink = { changed: vi.fn(), started: vi.fn(), succeeded: vi.fn(), failed: vi.fn(), settled: vi.fn() };
  return { sink, controller: createMediaClearController(sink) };
}
async function flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

describe("Media clear attempt outcomes", () => {
  it("requires explicit confirmation, serializes execution and emits one successful outcome", async () => {
    const { controller, sink } = fixture();
    const pending = deferred<MediaClearResult>();
    const client = { mediaClear: vi.fn(() => pending.promise) };
    controller.replace(client);
    controller.onEvent("confirm");
    expect(client.mediaClear).not.toHaveBeenCalled();
    controller.onEvent("request");
    controller.onEvent("cancel");
    expect(client.mediaClear).not.toHaveBeenCalled();
    controller.onEvent("request");
    controller.onEvent("confirm");
    controller.onEvent("confirm");
    controller.onEvent("cancel");
    expect(client.mediaClear).toHaveBeenCalledTimes(1);
    pending.resolve(RESULT);
    await flush();
    expect(sink.succeeded).toHaveBeenCalledTimes(1);
    expect(sink.settled).toHaveBeenCalledTimes(1);
    expect(sink.changed).toHaveBeenLastCalledWith({ phase: "idle", error: null });
  });

  it("clears the previous outcome at a new attempt and retains a later error for retry", async () => {
    const { controller, sink } = fixture();
    const client = { mediaClear: vi.fn().mockResolvedValueOnce(RESULT).mockRejectedValueOnce(new Error("refused")) };
    controller.replace(client);
    controller.onEvent("request"); controller.onEvent("confirm");
    await flush();
    controller.onEvent("request"); controller.onEvent("confirm");
    await flush();
    expect(sink.started).toHaveBeenCalledTimes(2);
    expect(sink.succeeded).toHaveBeenCalledTimes(1);
    expect(sink.failed).toHaveBeenCalledTimes(1);
    expect(sink.changed).toHaveBeenLastCalledWith({ phase: "idle", error: "refused" });
  });

  it("never lets a retired completion release or notify for the replacement client's active attempt", async () => {
    const { controller, sink } = fixture();
    const old = deferred<MediaClearResult>();
    const current = deferred<MediaClearResult>();
    controller.replace({ mediaClear: () => old.promise });
    controller.onEvent("request"); controller.onEvent("confirm");
    controller.replace({ mediaClear: () => current.promise });
    expect(sink.changed.mock.lastCall?.[0]).toMatchObject({ phase: "idle", error: expect.stringContaining("结果尚未确认") });
    controller.onEvent("request"); controller.onEvent("confirm");
    old.reject(new Error("old failure"));
    await flush();
    expect(sink.changed).toHaveBeenLastCalledWith({ phase: "clearing", error: null });
    expect(sink.succeeded).not.toHaveBeenCalled();
    expect(sink.failed).not.toHaveBeenCalled();
    current.resolve(RESULT);
    await flush();
    expect(sink.succeeded).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("keeps the unknown purge outcome across null-to-client replacement and late failure=%s", async (failed) => {
    const { controller, sink } = fixture();
    const pending = deferred<MediaClearResult>();
    const original = { mediaClear: vi.fn(() => pending.promise) };
    const replacement = { mediaClear: vi.fn(async () => RESULT) };
    controller.replace(original);
    controller.onEvent("request"); controller.onEvent("confirm");
    controller.replace(null);
    const unconfirmed = sink.changed.mock.lastCall?.[0].error;
    expect(unconfirmed).toContain("清除结果尚未确认");
    controller.replace(replacement);
    if (failed) pending.reject(new Error("retired")); else pending.resolve(RESULT);
    await flush();
    expect(sink.changed).toHaveBeenLastCalledWith({ phase: "idle", error: unconfirmed });
    expect(replacement.mediaClear).not.toHaveBeenCalled();
    expect(sink.succeeded).not.toHaveBeenCalled();
    expect(sink.failed).not.toHaveBeenCalled();
    controller.onEvent("request");
    expect(sink.changed).toHaveBeenLastCalledWith({ phase: "confirming", error: null });
    expect(replacement.mediaClear).not.toHaveBeenCalled();
    controller.onEvent("confirm");
    await flush();
    expect(replacement.mediaClear).toHaveBeenCalledTimes(1);
    expect(sink.changed).toHaveBeenLastCalledWith({ phase: "idle", error: null });
    controller.dispose();
  });
});
