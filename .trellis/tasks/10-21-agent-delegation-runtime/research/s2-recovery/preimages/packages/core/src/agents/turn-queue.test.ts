import { describe, expect, it } from "vitest";
import { createTurnQueue } from "./turn-queue.ts";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("createTurnQueue", () => {
  it("reserves primary intent before async admission, preserves priority FIFO and cancels unused reservations", async () => {
    const queue = createTurnQueue(); const first = queue.reservePrimary("taki");
    const second = queue.reservePrimary("taki");
    expect(queue.primaryVersion("taki")).toBe(2);
    expect(queue.tryAcquireBackground("taki")).toBeUndefined();
    const order: number[] = [];
    const waiting = second.acquire().then((release) => { order.push(2); release(); });
    await tick(); expect(order).toEqual([]);
    first.cancel(); await waiting; expect(order).toEqual([2]);
    expect(queue.tryAcquireBackground("taki")).toBeTypeOf("function");
  });

  it("a retired acquire or double release cannot remove a new live lane", async () => {
    const queue = createTurnQueue(); const old = queue.reservePrimary("taki"); old.cancel();
    const live = queue.tryAcquireBackground("taki")!;
    await expect(old.acquire()).rejects.toThrow("TURN_ACQUISITION_CANCELLED");
    expect(queue.tryAcquireBackground("taki")).toBeUndefined();
    live(); const next = queue.tryAcquireBackground("taki")!; live();
    expect(queue.tryAcquireBackground("taki")).toBeUndefined(); next();
  });

  it("abort cancels a pending primary without preempting an active tool lane", async () => {
    const queue = createTurnQueue(); const release = queue.tryAcquireBackground("taki")!;
    const controller = new AbortController(); const reservation = queue.reservePrimary("taki", controller.signal);
    const pending = reservation.acquire(); controller.abort();
    await expect(pending).rejects.toThrow("TURN_ACQUISITION_CANCELLED");
    expect(queue.tryAcquireBackground("taki")).toBeUndefined(); release();
    const next = queue.tryAcquireBackground("taki"); expect(next).toBeTypeOf("function"); next?.();
  });
  it("serializes acquires for the same key (second waits for the first release)", async () => {
    const queue = createTurnQueue();
    const order: string[] = [];

    const first = await queue.acquire("taki");
    const secondPending = queue.acquire("taki").then((release) => {
      order.push("second-acquired");
      return release;
    });

    await tick();
    expect(order).toEqual([]); // still held by the first turn

    order.push("first-released");
    first();
    const second = await secondPending;
    expect(order).toEqual(["first-released", "second-acquired"]);
    second();
  });

  it("keeps different keys concurrent (one character never blocks another)", async () => {
    const queue = createTurnQueue();
    const takiRelease = await queue.acquire("taki");
    // yui acquires immediately even while taki's turn is held.
    const yuiRelease = await queue.acquire("yui");
    takiRelease();
    yuiRelease();
  });

  it("does not wedge the lane: a released key can be acquired again and again", async () => {
    const queue = createTurnQueue();
    for (let i = 0; i < 3; i += 1) {
      const release = await queue.acquire("taki");
      release();
    }
  });

  it("hands the lock over in FIFO order across three waiters", async () => {
    const queue = createTurnQueue();
    const order: number[] = [];
    const first = await queue.acquire("taki");
    const waiters = [2, 3].map((n) =>
      queue.acquire("taki").then((release) => {
        order.push(n);
        release();
      }),
    );
    order.push(1);
    first();
    await Promise.all(waiters);
    expect(order).toEqual([1, 2, 3]);
  });
});
