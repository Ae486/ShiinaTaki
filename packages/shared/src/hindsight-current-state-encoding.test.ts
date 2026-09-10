import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hindsightCurrentStateJson } from "./hindsight-current-state-encoding.ts";

describe("D78 native tagged JSON encoding", () => {
  it("matches the executed Python fixture for typed values, binary64 numbers and UTF-8 key order", () => {
    const value = { snake_case: { integer: 1, string: "1", small: 1e-7, large: 1e21, zero: -0,
      empty: "", nullable: null, empty_object: {}, empty_array: [] }, "\ue000": "private", "😀": "astral", "中": [true, false, "é", { z: 2, a: 0.1 }] };
    expect(createHash("sha256").update(hindsightCurrentStateJson(value)).digest("hex"))
      .toBe("5db3602d7f8911eea70d6a9a5ed069a93a1c54cb4e80360ad6a557d9086cf91f");
    expect(hindsightCurrentStateJson(-0)).toBe(hindsightCurrentStateJson(0));
    expect(hindsightCurrentStateJson(1)).not.toBe(hindsightCurrentStateJson("1"));
    expect(hindsightCurrentStateJson(["number", "3ff0000000000000"])).not.toBe(hindsightCurrentStateJson(1));
  });
  it.each([undefined, NaN, Infinity, "\ud800", { "\ud800": "x" }, new Date(), Array(1)])("refuses nonportable values: %p", (value) => {
    expect(() => hindsightCurrentStateJson(value)).toThrow();
  });
});
