import { describe, expect, it, vi } from "vitest";
import { createTurnQueue } from "./turn-queue.ts";

describe("Character queue availability for deterministic initiative", () => {
  it("reports busy for unready primary intent and reports available once on native abort", async () => {
    const available = vi.fn(); const queue = createTurnQueue({ onAvailable: available });
    const controller = new AbortController(); const reservation = queue.reservePrimary("taki", controller.signal);
    expect(queue.isBusy("taki")).toBe(true); expect(queue.tryAcquireBackground("taki")).toBeUndefined();
    controller.abort(); const waiting = reservation.acquire();
    await expect(waiting).rejects.toThrow("TURN_ACQUISITION_CANCELLED");
    expect(queue.isBusy("taki")).toBe(false); expect(available).toHaveBeenCalledExactlyOnceWith("taki");
    reservation.cancel(); controller.abort(); expect(available).toHaveBeenCalledTimes(1);
  });
  it("does not publish availability between FIFO owners or while another primary reservation remains", async () => {
    const available = vi.fn(); const queue = createTurnQueue({ onAvailable: available });
    const first = queue.tryAcquireBackground("taki")!;
    const next = queue.reservePrimary("taki"); const waiting = next.acquire();
    first(); const release = await waiting;
    expect(queue.isBusy("taki")).toBe(true); expect(available).not.toHaveBeenCalled();
    release(); release(); expect(available).toHaveBeenCalledExactlyOnceWith("taki");
  });
  it("shares repeated primary acquisition and does not turn double release into duplicate events", async () => {
    const available = vi.fn(); const queue = createTurnQueue({ onAvailable: available });
    const reservation = queue.reservePrimary("taki");
    const first = reservation.acquire(); const second = reservation.acquire();
    expect(first).toBe(second); const release = await first; const duplicate = await second;
    release(); duplicate(); reservation.cancel(); expect(available).toHaveBeenCalledTimes(1);
  });
  it("keeps independent Characters available and protects ownership against observer failures", async () => {
    const queue = createTurnQueue({ onAvailable: async () => { throw new Error("observer failure"); } });
    const taki = queue.tryAcquireBackground("taki")!; const other = queue.tryAcquireBackground("other")!;
    expect(queue.isBusy("taki")).toBe(true); expect(queue.isBusy("other")).toBe(true);
    taki(); await Promise.resolve(); expect(queue.isBusy("taki")).toBe(false); expect(queue.isBusy("other")).toBe(true);
    const replacement = queue.tryAcquireBackground("taki")!; expect(replacement).toBeTypeOf("function");
    other(); replacement(); await Promise.resolve();
  });
  it("does not preempt a running owner when its queued primary source aborts", async () => {
    const available = vi.fn(); const queue = createTurnQueue({ onAvailable: available });
    const active = await queue.acquire("taki"); const controller = new AbortController();
    const waiting = queue.reservePrimary("taki", controller.signal); controller.abort();
    await expect(waiting.acquire()).rejects.toThrow();
    expect(available).not.toHaveBeenCalled(); expect(queue.isBusy("taki")).toBe(true);
    active(); expect(available).toHaveBeenCalledExactlyOnceWith("taki");
  });
});
