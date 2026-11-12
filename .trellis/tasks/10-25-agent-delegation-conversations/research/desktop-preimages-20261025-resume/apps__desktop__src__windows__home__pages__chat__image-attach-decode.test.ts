/**
 * INPUT:  size/type shapes + a sample data URL.
 * OUTPUT: assertions on the size-gate verdict and the data-URL -> { mediaType, base64 } split.
 * POS:    unit test for image-attach-decode (T11). Pure, node-safe (the canvas/FileReader path lives in the hook).
 */

import { describe, expect, it } from "vitest";
import { classifyImage, parseDataUrl } from "./image-attach-decode.ts";

describe("classifyImage", () => {
  it("rejects a source over 20 MB", () => {
    expect(classifyImage({ size: 25_000_000, type: "image/png" })).toBe("reject");
  });

  it("passes a small supported image as-is", () => {
    expect(classifyImage({ size: 500_000, type: "image/png" })).toBe("asis");
  });

  it("normalizes a large supported image", () => {
    expect(classifyImage({ size: 5_000_000, type: "image/jpeg" })).toBe("normalize");
  });

  it("normalizes a small UNSUPPORTED type (canvas re-encodes it to JPEG)", () => {
    expect(classifyImage({ size: 500_000, type: "image/bmp" })).toBe("normalize");
  });
});

describe("parseDataUrl", () => {
  it("splits a data URL into mediaType + raw base64", () => {
    expect(parseDataUrl("data:image/png;base64,iVBORw0AAA")).toEqual({
      mediaType: "image/png",
      base64: "iVBORw0AAA",
    });
  });
});
