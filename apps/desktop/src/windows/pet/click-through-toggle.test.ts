/**
 * INPUT:  the interaction inputs (dragging / buttonDown / opaque) across the truth table.
 * OUTPUT: assertions that shouldIgnoreCursor passes through ONLY over empty space with no gesture in flight, and
 *         that a drag or a held button forces the window to stay interactive.
 * POS:    unit test for the pure click-through toggle formula. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { shouldIgnoreCursor } from "./click-through-toggle.ts";

describe("shouldIgnoreCursor", () => {
  it("passes through only over empty space with no drag and no button down", () => {
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: false, opaque: false })).toBe(true);
  });

  it("stays interactive over the opaque body", () => {
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: false, opaque: true })).toBe(false);
  });

  it("stays interactive while dragging even over transparent space", () => {
    expect(shouldIgnoreCursor({ dragging: true, buttonDown: false, opaque: false })).toBe(false);
  });

  it("stays interactive while the button is held even over transparent space", () => {
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: true, opaque: false })).toBe(false);
  });

  it("stays interactive whenever any suspend condition holds (full truth table)", () => {
    for (const dragging of [true, false]) {
      for (const buttonDown of [true, false]) {
        for (const opaque of [true, false]) {
          const expected = !dragging && !buttonDown && !opaque;
          expect(shouldIgnoreCursor({ dragging, buttonDown, opaque })).toBe(expected);
        }
      }
    }
  });
});
