import { describe, expect, it, vi } from "vitest";
import { observeBubbleCssCompletion } from "./bubble-css-completion.ts";

function pending() {
  let resolve!: () => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function flush() { for (let index = 0; index < 4; index += 1) await Promise.resolve(); }

describe("Pet finite browser animation completion", () => {
  it("settles zero-duration or unsupported animation surfaces without requiring a DOM end event", async () => {
    const settled = vi.fn();
    observeBubbleCssCompletion({ getAnimations: () => [] } as unknown as Element, settled);
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
    const fallback = vi.fn();
    observeBubbleCssCompletion({} as Element, fallback);
    await flush();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("waits for finite CSS transitions and excludes the status indicator's infinite animation", async () => {
    const transition = pending();
    const settled = vi.fn();
    const element = { getAnimations: () => [
      { finished: transition.promise, effect: { getTiming: () => ({ iterations: 1 }) } },
      { finished: new Promise(() => undefined), effect: { getTiming: () => ({ iterations: Number.POSITIVE_INFINITY }) } },
    ] } as unknown as Element;
    observeBubbleCssCompletion(element, settled);
    await flush(); expect(settled).not.toHaveBeenCalled();
    transition.resolve(); await flush();
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("settles a browser-cancelled transition but ignores the completion after local disposal", async () => {
    const cancelled = pending();
    const element = { getAnimations: () => [{ finished: cancelled.promise }] } as unknown as Element;
    const settled = vi.fn();
    observeBubbleCssCompletion(element, settled);
    cancelled.reject(new Error("cancelled")); await flush();
    expect(settled).toHaveBeenCalledTimes(1);
    const late = pending();
    const old = vi.fn();
    const dispose = observeBubbleCssCompletion({ getAnimations: () => [{ finished: late.promise }] } as unknown as Element, old);
    dispose(); late.resolve(); await flush();
    expect(old).not.toHaveBeenCalled();
  });
});
