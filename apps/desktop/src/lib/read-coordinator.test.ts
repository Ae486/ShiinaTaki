import { describe, expect, it, vi } from "vitest";
import { createReadCoordinator } from "./read-coordinator.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function fixture() {
  const sink = { started: vi.fn(), loaded: vi.fn(), failed: vi.fn(), retired: vi.fn() };
  return { sink, reads: createReadCoordinator<number>(sink) };
}

describe("disposable read coordination", () => {
  it("joins duplicate demand without creating a trailing read", async () => {
    const { reads, sink } = fixture();
    const pending = deferred<number>();
    const load = vi.fn(() => pending.promise);
    reads.replace(load);
    const first = reads.demand();
    const second = reads.demand();
    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve(1);
    await first;
    expect(load).toHaveBeenCalledTimes(1);
    expect(sink.loaded).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("coalesces an invalidation burst and never publishes its uncovered first answer", async () => {
    const { reads, sink } = fixture();
    const first = deferred<number>();
    const final = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(final.promise);
    reads.replace(load);
    const done = reads.demand();
    void reads.invalidate();
    void reads.invalidate();
    void reads.invalidate();
    first.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(sink.loaded).not.toHaveBeenCalled();
    final.resolve(2);
    await done;
    expect(sink.loaded).toHaveBeenCalledExactlyOnceWith(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retains an invalidation raised while a successful answer is being published", async () => {
    const { reads, sink } = fixture();
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    sink.loaded.mockImplementationOnce(() => { void reads.invalidate(); });
    reads.replace(load);
    await reads.demand();
    expect(load).toHaveBeenCalledTimes(2);
    expect(sink.loaded.mock.calls).toEqual([[1], [2]]);
  });

  it("reports an active trailing read after publication synchronously invalidates the resource", async () => {
    let refreshing = false;
    const trailing = deferred<number>();
    const load = vi.fn().mockResolvedValueOnce(1).mockReturnValueOnce(trailing.promise);
    const reads = createReadCoordinator<number>({
      started: () => { refreshing = true; },
      loaded: (value) => { refreshing = false; if (value === 1) void reads.invalidate(); },
      failed: () => { refreshing = false; },
      retired: () => { refreshing = false; },
    });
    reads.replace(load);
    const done = reads.demand();
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(refreshing).toBe(true);
    trailing.resolve(2);
    await done;
    expect(refreshing).toBe(false);
  });

  it.each(["replace", "hide"])("does not call an obsolete loader when started synchronously triggers %s", async (action) => {
    const load = vi.fn(async () => 1);
    const current = vi.fn(async () => 2);
    const sink = { started: vi.fn(), loaded: vi.fn(), failed: vi.fn(), retired: vi.fn() };
    const reads = createReadCoordinator<number>(sink);
    sink.started.mockImplementationOnce(() => {
      if (action === "replace") { reads.replace(current); void reads.demand(); }
      else reads.setActive(false);
    });
    reads.replace(load);
    await reads.demand();
    expect(load).not.toHaveBeenCalled();
    if (action === "replace") {
      await reads.demand();
      expect(sink.loaded).toHaveBeenCalledWith(2);
    } else expect(sink.loaded).not.toHaveBeenCalled();
  });

  it("owns its flight before a loader can synchronously report a producer change", async () => {
    const { reads, sink } = fixture();
    let first = true;
    const load = vi.fn(async () => {
      if (first) { first = false; void reads.invalidate(); }
      return 2;
    });
    reads.replace(load);
    await reads.demand();
    expect(load).toHaveBeenCalledTimes(2);
    expect(sink.loaded).toHaveBeenCalledExactlyOnceWith(2);
  });

  it.each(["success", "failure"])("rejects a retired %s after null binding or hide", async (outcome) => {
    for (const retire of ["null", "hidden"] as const) {
      const { reads, sink } = fixture();
      const old = deferred<number>();
      reads.replace(() => old.promise);
      const done = reads.demand();
      if (retire === "null") reads.replace(null);
      else reads.setActive(false);
      if (outcome === "success") old.resolve(1);
      else old.reject(new Error("retired"));
      await done;
      expect(sink.loaded).not.toHaveBeenCalled();
      expect(sink.failed).not.toHaveBeenCalled();
      expect(sink.retired).toHaveBeenCalled();
    }
  });

  it("retains hidden invalidations for one demand on return, without hidden reads", async () => {
    const { reads, sink } = fixture();
    const load = vi.fn(async () => 2);
    reads.replace(load);
    reads.setActive(false);
    await reads.invalidate();
    await reads.invalidate();
    expect(load).not.toHaveBeenCalled();
    reads.setActive(true);
    await reads.demand();
    expect(load).toHaveBeenCalledTimes(1);
    expect(sink.loaded).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("does not let an old read overwrite a newer accepted push or echo", async () => {
    const { reads, sink } = fixture();
    const old = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(3);
    reads.replace(load);
    const done = reads.demand();
    reads.acceptUpdate();
    old.resolve(1);
    await done;
    expect(sink.loaded.mock.calls).toEqual([[3]]);
    reads.acceptUpdate();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stops after failure even with dirty work, and retries only on a new demand", async () => {
    const { reads, sink } = fixture();
    const pending = deferred<number>();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(2);
    reads.replace(load);
    const done = reads.demand();
    void reads.invalidate();
    pending.reject(new Error("unavailable"));
    await done;
    expect(load).toHaveBeenCalledTimes(1);
    await reads.demand();
    expect(load).toHaveBeenCalledTimes(2);
    expect(sink.loaded).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("allows a replacement scope while its non-cancellable old flight settles", async () => {
    const { reads, sink } = fixture();
    const old = deferred<number>();
    reads.replace(() => old.promise);
    const obsolete = reads.demand();
    reads.replace(async () => 2);
    await reads.demand();
    old.reject(new Error("old failure"));
    await obsolete;
    expect(sink.loaded.mock.calls).toEqual([[2]]);
    expect(sink.failed).not.toHaveBeenCalled();
  });
});
