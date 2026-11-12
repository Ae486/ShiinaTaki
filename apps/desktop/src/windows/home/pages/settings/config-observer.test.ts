import { describe, expect, it, vi } from "vitest";
import type { ConfigChanged, ConfigListResult } from "@taki/shared";
import { createReadCoordinator } from "@/lib/read-coordinator.js";
import { createConfigObserver } from "./config-observer.ts";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
function fixture() {
  let visible = true;
  let change: (value: ConfigChanged) => void = () => undefined;
  const order: string[] = [];
  const client = {
    subscribeConfig: vi.fn(async () => { order.push("subscribe"); }),
    configList: vi.fn(async (): Promise<ConfigListResult> => { order.push("list"); return { entries: [] }; }),
    onConfigChanged: (handler: (value: ConfigChanged) => void) => {
      order.push("handler"); change = handler; return () => { change = () => undefined; };
    },
  };
  const sink = { started: vi.fn(), loaded: vi.fn(), failed: vi.fn(), retired: vi.fn() };
  const reads = createReadCoordinator<ConfigListResult>(sink);
  const gap = vi.fn();
  const observer = createConfigObserver({ client, visible: () => visible, apply: () => reads.acceptUpdate(), demand: () => reads.demand(), gap });
  const stop = observer.start();
  reads.replace(observer.read);
  return {
    client, observer, reads, sink, gap, order, stop, change: (value: ConfigChanged) => change(value),
    show(next: boolean) { visible = next; reads.setActive(next); observer.setVisible(next); },
  };
}

describe("config observation recovery", () => {
  it("installs its listener before baseline and reuses an intact hidden observation", async () => {
    const f = fixture();
    f.show(true);
    await f.reads.demand();
    expect(f.order).toEqual(["handler", "subscribe", "list"]);
    f.show(false);
    f.show(true);
    await flush();
    expect(f.client.configList).toHaveBeenCalledTimes(1);
  });

  it("retains the hidden gap through failure and retries only on explicit demand", async () => {
    const f = fixture();
    f.show(true);
    await f.reads.demand();
    f.show(false);
    f.change({ key: "TAKI_PROVIDER_MODEL", value: "changed" });
    expect(f.client.configList).toHaveBeenCalledTimes(1);
    f.client.configList.mockRejectedValueOnce(new Error("unavailable"));
    f.show(true);
    await flush();
    expect(f.gap).toHaveBeenLastCalledWith(true);
    expect(f.client.configList).toHaveBeenCalledTimes(2);
    await f.reads.demand();
    expect(f.client.configList).toHaveBeenCalledTimes(3);
    expect(f.gap).toHaveBeenLastCalledWith(false);
  });

  it("recovers setup on the same client and does not list before its acknowledgement", async () => {
    const f = fixture();
    f.client.subscribeConfig.mockRejectedValueOnce(new Error("setup lost"));
    f.show(true);
    await flush();
    expect(f.client.configList).not.toHaveBeenCalled();
    expect(f.gap).toHaveBeenLastCalledWith(true);
    await f.reads.demand();
    expect(f.client.subscribeConfig).toHaveBeenCalledTimes(2);
    expect(f.client.configList).toHaveBeenCalledTimes(1);
    expect(f.gap).toHaveBeenLastCalledWith(false);
  });

  it("keeps an initialization push dirty until one trailing current read", async () => {
    const f = fixture();
    const first = deferred<ConfigListResult>();
    f.client.configList.mockReturnValueOnce(first.promise);
    f.show(true);
    await flush();
    f.change({ key: "TAKI_PROVIDER_MODEL", value: "new" });
    first.resolve({ entries: [] });
    await f.reads.demand();
    expect(f.client.configList).toHaveBeenCalledTimes(2);
    expect(f.sink.loaded).toHaveBeenCalledTimes(1);
    expect(f.gap).toHaveBeenLastCalledWith(false);
  });
});
