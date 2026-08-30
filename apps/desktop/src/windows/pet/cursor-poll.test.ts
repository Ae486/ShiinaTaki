/**
 * INPUT:  the pure poll-economy decisions (shouldPollRun / shouldRefreshOrigin) and the cursor→canvas transform with
 *         synthetic values.
 * OUTPUT: assertions that the poll runs only while visible, that the cached window origin refreshes when dirty or
 *         past the TTL backstop (never on a fresh clean cache; a backwards clock reads as fresh), and that
 *         mapCursorToCanvas pins the physical→logical transform the entire click-through correctness rests on.
 * POS:    unit test for windows/pet/cursor-poll (P1d). Node-safe — no Tauri/React/DOM.
 */

import { describe, expect, it } from "vitest";
import { ORIGIN_TTL_MS, mapCursorToCanvas, shouldPollRun, shouldRefreshOrigin } from "./cursor-poll.ts";

describe("shouldPollRun", () => {
  it("runs while visible and pauses while hidden", () => {
    expect(shouldPollRun(false)).toBe(true);
    expect(shouldPollRun(true)).toBe(false);
  });
});

describe("shouldRefreshOrigin", () => {
  it("refreshes a dirty cache (window moved/resized)", () => {
    expect(shouldRefreshOrigin({ dirty: true, ageMs: 0 })).toBe(true);
  });

  it("keeps a fresh, clean cache (the common idle tick — no second IPC)", () => {
    expect(shouldRefreshOrigin({ dirty: false, ageMs: ORIGIN_TTL_MS - 1 })).toBe(false);
  });

  it("refreshes once the cache reaches the TTL backstop", () => {
    expect(shouldRefreshOrigin({ dirty: false, ageMs: ORIGIN_TTL_MS })).toBe(true);
  });

  it("treats a backwards clock as fresh instead of refreshing forever", () => {
    expect(shouldRefreshOrigin({ dirty: false, ageMs: -5 })).toBe(false);
  });
});

describe("mapCursorToCanvas", () => {
  it("maps physical cursor − client-area origin through the scale factor to canvas-local logical px", () => {
    expect(mapCursorToCanvas({ x: 500, y: 300 }, { x: 100, y: 50 }, 1.25)).toEqual({ x: 320, y: 200 });
    expect(mapCursorToCanvas({ x: 400, y: 600 }, { x: 0, y: 0 }, 1)).toEqual({ x: 400, y: 600 });
  });
});
