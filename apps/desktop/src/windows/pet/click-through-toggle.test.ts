/**
 * INPUT:  the interaction inputs (dragging / buttonDown / bubbleOpen / opaque) across the truth table.
 * OUTPUT: assertions that shouldIgnoreCursor passes through ONLY over empty space with no gesture in flight and no
 *         open bubble, and that a drag / held button / open bubble forces the window to stay interactive.
 * POS:    unit test for the pure click-through toggle formula. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { shouldIgnoreCursor } from "./click-through-toggle.ts";

describe("shouldIgnoreCursor", () => {
  it("passes through only over empty space with no drag, button, or open bubble", () => {
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: false, bubbleOpen: false, opaque: false })).toBe(true);
  });

  it("stays interactive over the opaque body", () => {
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: false, bubbleOpen: false, opaque: true })).toBe(false);
  });

  it("stays interactive while dragging even over transparent space", () => {
    expect(shouldIgnoreCursor({ dragging: true, buttonDown: false, bubbleOpen: false, opaque: false })).toBe(false);
  });

  it("stays interactive while the button is held even over transparent space", () => {
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: true, bubbleOpen: false, opaque: false })).toBe(false);
  });

  it("stays interactive while the bubble is open even over transparent space", () => {
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: false, bubbleOpen: true, opaque: false })).toBe(false);
  });

  it("stays interactive whenever any suspend condition holds (full truth table)", () => {
    for (const dragging of [true, false]) {
      for (const buttonDown of [true, false]) {
        for (const bubbleOpen of [true, false]) {
          for (const opaque of [true, false]) {
            const expected = !dragging && !buttonDown && !bubbleOpen && !opaque;
            expect(shouldIgnoreCursor({ dragging, buttonDown, bubbleOpen, opaque })).toBe(expected);
          }
        }
      }
    }
  });
});
