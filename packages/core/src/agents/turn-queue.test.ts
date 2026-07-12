import { describe, expect, it } from "vitest";
import { createTurnQueue } from "./turn-queue.ts";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("createTurnQueue", () => {
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
