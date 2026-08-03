/**
 * INPUT:  the wheel rendered to static markup at a summon point (no DOM: static rendering only).
 * OUTPUT: assertions that every registry row renders as a labelled control, that the container carries the REAL
 *         keep-interactive attribute the click-through toggle honours, and that such an element keeps the window
 *         interactive (shouldIgnoreCursor === false) while the wheel is open over transparent pixels.
 * POS:    unit test for features/operation-wheel/operation-wheel (node-safe via renderToStaticMarkup). Exempt from
 *         size caps.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/open-home-window.js", () => ({ openHome: () => Promise.resolve() }));

const { OperationWheel } = await import("./operation-wheel.tsx");
const { WHEEL_ITEMS } = await import("./wheel-items.ts");
const { KEEP_INTERACTIVE_ATTR, KEEP_INTERACTIVE_SELECTOR, shouldIgnoreCursor } = await import(
  "@/windows/pet/click-through-toggle.js"
);

function markup() {
  return renderToStaticMarkup(
    <OperationWheel point={{ x: 120, y: 90 }} onClose={() => undefined} onOpenCostume={() => undefined} />,
  );
}

describe("OperationWheel", () => {
  it("renders one control per registry row", () => {
    const html = markup();
    for (const item of WHEEL_ITEMS) expect(html).toContain(item.label);
  });

  it("carries the keep-interactive attribute the click-through poll hit-tests for", () => {
    expect(KEEP_INTERACTIVE_SELECTOR).toBe(`[${KEEP_INTERACTIVE_ATTR}]`);
    expect(markup()).toContain(KEEP_INTERACTIVE_ATTR);
  });

  it("keeps the window interactive while open over transparent pixels", () => {
    // The poll's element test matches the wheel container → overUi true → the window must NOT ignore the cursor.
    expect(shouldIgnoreCursor({ dragging: false, buttonDown: false, overUi: true, opaque: false })).toBe(false);
  });
});
