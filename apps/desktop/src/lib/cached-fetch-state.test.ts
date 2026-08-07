/**
 * INPUT:  the load lifecycle of one cached page read (seeded from cache or not, resolving, rejecting).
 * OUTPUT: assertions that a cache seed renders before any load resolves and that a REJECTED load keeps the last good
 *         value on screen behind an error line instead of blanking the page.
 * POS:    unit test for lib/cached-fetch-state. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { initialCachedFetch, isLoading, isRefreshing, reduceCachedFetch } from "./cached-fetch-state.ts";

describe("reduceCachedFetch", () => {
  it("renders a cache seed immediately — a seeded page is never 'loading'", () => {
    const seeded = initialCachedFetch([1, 2, 3]);

    expect(seeded.data).toEqual([1, 2, 3]);
    expect(isLoading(seeded)).toBe(false);
    expect(isRefreshing(reduceCachedFetch(seeded, { kind: "start" }))).toBe(true);
  });

  it("shows a placeholder only while there is no answer of any kind", () => {
    const cold = initialCachedFetch<number[]>(null);

    expect(isLoading(cold)).toBe(true);
    expect(isRefreshing(reduceCachedFetch(cold, { kind: "start" }))).toBe(false);
  });

  it("replaces the value and clears the previous error on a successful load", () => {
    const failed = reduceCachedFetch(initialCachedFetch([1]), { kind: "failed", reason: "socket closed" });

    const loaded = reduceCachedFetch(failed, { kind: "loaded", value: [9] });

    expect(loaded).toEqual({ data: [9], error: null, running: false });
  });

  it("keeps the last good value visible when a refresh rejects", () => {
    const running = reduceCachedFetch(initialCachedFetch([1, 2]), { kind: "start" });

    const failed = reduceCachedFetch(running, { kind: "failed", reason: "connection closed" });

    expect(failed.data).toEqual([1, 2]);
    expect(failed.error).toBe("connection closed");
    expect(failed.running).toBe(false);
    expect(isLoading(failed)).toBe(false);
  });

  it("surfaces the failure alone when there was nothing cached to fall back on", () => {
    const failed = reduceCachedFetch(reduceCachedFetch(initialCachedFetch<number[]>(null), { kind: "start" }), {
      kind: "failed",
      reason: "no character imported",
    });

    expect(failed.data).toBeNull();
    expect(isLoading(failed)).toBe(false);
    expect(isRefreshing(failed)).toBe(false);
  });

  it("applies a local edit to the loaded value, and ignores one that arrives before any load", () => {
    const loaded = reduceCachedFetch(initialCachedFetch([1]), { kind: "mutate", update: (previous) => [...previous, 2] });
    expect(loaded.data).toEqual([1, 2]);

    const cold = initialCachedFetch<number[]>(null);
    expect(reduceCachedFetch(cold, { kind: "mutate", update: () => [7] })).toEqual(cold);
  });
});
