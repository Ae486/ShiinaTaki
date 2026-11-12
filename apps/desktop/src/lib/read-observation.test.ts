import { describe, expect, it, vi } from "vitest";
import { createReadObservation, type ReadObservationChannel } from "./read-observation.ts";
import type { ReadSubscriptionSupport } from "./ws-read-subscriptions.ts";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const handlers: Array<(revision: number) => void> = [];
  const order: string[] = [];
  const sink = { changed: vi.fn(), failed: vi.fn(), invalidated: vi.fn() };
  const setup = deferred<ReadSubscriptionSupport>();
  const stop = vi.fn();
  const channel: ReadObservationChannel = {
    subscribe: vi.fn(() => { order.push("subscribe"); return setup.promise; }),
    onChanged: (handler) => { order.push("handler"); handlers.push(handler); return stop; },
  };
  return { observation: createReadObservation(sink), sink, setup, channel, handlers, stop, order };
}

describe("disposable read observation readiness", () => {
  it("installs the handler before setup, deduplicates setup and forwards only newer hints", async () => {
    const f = fixture();
    f.observation.replace(f.channel);
    expect(f.order).toEqual(["handler"]);
    const first = f.observation.prepare();
    const duplicate = f.observation.prepare();
    await flush();
    expect(first).toBe(duplicate);
    expect(f.order).toEqual(["handler", "subscribe"]);
    for (const revision of [0, 0, 2, 1, 3]) f.handlers[0]?.(revision);
    expect(f.sink.invalidated).toHaveBeenCalledTimes(3);
    expect(f.observation.usable()).toBe(false);
    f.setup.resolve("supported");
    expect(await first).toBe(true);
    expect(f.observation.state()).toBe("live");
    expect(await f.observation.prepare()).toBe(true);
    expect(f.channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("retires old setup and notifications, including rejected setup=%s", async (reject) => {
    const f = fixture();
    f.observation.replace(f.channel);
    const old = f.observation.prepare();
    await flush();
    f.observation.replace(null);
    const count = f.sink.changed.mock.calls.length;
    f.handlers[0]?.(20);
    if (reject) f.setup.reject(new Error("retired setup")); else f.setup.resolve("supported");
    expect(await old).toBe(false);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(f.sink.changed).toHaveBeenCalledTimes(count);
    expect(f.sink.failed).not.toHaveBeenCalled();
    expect(f.sink.invalidated).not.toHaveBeenCalled();
  });

  it("does not retry failure from hints and recovers only on fresh demand", async () => {
    const f = fixture();
    f.observation.replace(f.channel);
    const failed = f.observation.prepare();
    f.setup.reject(new Error("lost acknowledgement"));
    expect(await failed).toBe(false);
    f.handlers[0]?.(1);
    expect(f.channel.subscribe).toHaveBeenCalledTimes(1);
    expect(f.observation.state()).toBe("failure");
    vi.mocked(f.channel.subscribe).mockResolvedValue("supported");
    expect(await f.observation.prepare()).toBe(true);
    expect(f.channel.subscribe).toHaveBeenCalledTimes(2);
    expect(f.sink.failed).toHaveBeenCalledTimes(1);
  });

  it("does not turn an unsupported subscription into live coverage through unsolicited hints", async () => {
    const f = fixture();
    f.observation.replace(f.channel);
    const ready = f.observation.prepare();
    f.setup.resolve("unsupported");
    expect(await ready).toBe(true);
    f.handlers[0]?.(1);
    expect(f.sink.invalidated).not.toHaveBeenCalled();
    expect(f.observation.state()).toBe("unsupported");
  });
});
