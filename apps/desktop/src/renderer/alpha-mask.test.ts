/**
 * INPUT:  a hand-built alpha bitmap (known opaque/transparent cells) exercised through the pure sampler.
 * OUTPUT: assertions that sampleAlphaAt maps logical points to the right cell, honours bounds, and that isOpaqueAt
 *         applies the threshold at its boundary. No Pixi — the RenderTexture readback is stubbed as a raw bitmap.
 * POS:    unit test for the framework-free click-through mask sampler. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { isOpaqueAt, sampleAlphaAt, OPAQUE_ALPHA_THRESHOLD, type AlphaBitmap } from "./alpha-mask.ts";

// A 2x2 mask: top-left cell opaque (a=255), top-right at exactly the threshold, bottom row fully transparent.
function makeBitmap(): AlphaBitmap {
  const pixels = new Uint8ClampedArray(2 * 2 * 4);
  const setCell = (cx: number, cy: number, alpha: number) => {
    pixels[(cy * 2 + cx) * 4 + 3] = alpha;
  };
  setCell(0, 0, 255);
  setCell(1, 0, OPAQUE_ALPHA_THRESHOLD);
  setCell(0, 1, OPAQUE_ALPHA_THRESHOLD - 1);
  setCell(1, 1, 0);
  return { pixels, width: 2, height: 2 };
}

const logical = { width: 4, height: 4 }; // each mask cell covers a 2x2 logical-px quadrant.

describe("sampleAlphaAt", () => {
  it("maps a logical point to its mask cell", () => {
    const b = makeBitmap();
    expect(sampleAlphaAt(b, logical, { x: 1, y: 1 })).toBe(255); // top-left quadrant
    expect(sampleAlphaAt(b, logical, { x: 3, y: 1 })).toBe(OPAQUE_ALPHA_THRESHOLD); // top-right quadrant
    expect(sampleAlphaAt(b, logical, { x: 1, y: 3 })).toBe(OPAQUE_ALPHA_THRESHOLD - 1); // bottom-left
    expect(sampleAlphaAt(b, logical, { x: 3, y: 3 })).toBe(0); // bottom-right
  });

  it("reads out-of-bounds points as fully transparent", () => {
    const b = makeBitmap();
    expect(sampleAlphaAt(b, logical, { x: -1, y: 0 })).toBe(0);
    expect(sampleAlphaAt(b, logical, { x: 4, y: 0 })).toBe(0);
    expect(sampleAlphaAt(b, logical, { x: 0, y: 4 })).toBe(0);
  });

  it("clamps the max edge to the last cell (no overflow read)", () => {
    const b = makeBitmap();
    expect(sampleAlphaAt(b, logical, { x: 3.999, y: 0 })).toBe(OPAQUE_ALPHA_THRESHOLD);
  });

  it("treats an empty (pre-first-refresh) bitmap as transparent", () => {
    const empty: AlphaBitmap = { pixels: new Uint8ClampedArray(0), width: 0, height: 0 };
    expect(sampleAlphaAt(empty, logical, { x: 1, y: 1 })).toBe(0);
  });
});

describe("isOpaqueAt", () => {
  it("is opaque at exactly the threshold and above, transparent just below", () => {
    const b = makeBitmap();
    expect(isOpaqueAt(b, logical, { x: 1, y: 1 })).toBe(true); // 255
    expect(isOpaqueAt(b, logical, { x: 3, y: 1 })).toBe(true); // == threshold
    expect(isOpaqueAt(b, logical, { x: 1, y: 3 })).toBe(false); // threshold - 1
    expect(isOpaqueAt(b, logical, { x: 3, y: 3 })).toBe(false); // 0
  });
});
